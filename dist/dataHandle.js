const products = ['iphone', 'ipad', 'watch', 'mac', 'realitydevice', 'tv', 'homepod', 'ipod'];
let devices = [];
const deviceMap = new Map();
const modelMap = new Map();
// Xác định product type dựa trên identifier
function getProductType(identifier) {
    const lower = identifier.toLowerCase();
    if (lower.startsWith('iphone'))
        return 'iphone';
    if (lower.startsWith('ipad'))
        return 'ipad';
    if (lower.startsWith('watch'))
        return 'watch';
    if (lower.startsWith('mac'))
        return 'mac';
    if (lower.startsWith('realitydevice'))
        return 'realitydevice';
    if (lower.startsWith('appletv'))
        return 'tv';
    if (lower.startsWith('homepod') || lower.startsWith('audioaccessory'))
        return 'homepod';
    if (lower.startsWith('ipod'))
        return 'ipod';
    return undefined;
}
// Kiểm tra có cần cập nhật không (đã qua 00:00 UTC chưa)
function shouldUpdate(lastUpdate) {
    const last = new Date(lastUpdate);
    const now = new Date();
    // Đặt về 00:00 UTC
    const lastMidnight = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate()));
    const todayMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return todayMidnight.getTime() > lastMidnight.getTime();
}
// Load danh sách devices
async function loadDevices() {
    try {
        const stored = await window.api.userData.read('devices.json');
        if (stored) {
            const data = JSON.parse(stored);
            devices = data.data;
            // Populate deviceMap
            devices.forEach(device => {
                deviceMap.set(device.identifier, device);
            });
            // Check Update
            if (!shouldUpdate(data.lastUpdate))
                return;
        }
    }
    catch { }
    await loadDevicesFromAPI();
}
// Tải devices từ API
async function loadDevicesFromAPI() {
    try {
        const response = await fetch(window.ipsw_api.devices);
        if (response.status !== 200) {
            throw new Error(`Failed to fetch devices: ${response.status}`);
        }
        const data = await response.json();
        const filteredDevices = data.map(d => ({ name: d.name, identifier: d.identifier }));
        devices = filteredDevices;
        // Clear và populate lại deviceMap
        deviceMap.clear();
        devices.forEach(device => {
            deviceMap.set(device.identifier, device);
        });
        window.api.userData.write('devices.json', JSON.stringify({
            lastUpdate: Date.now(),
            data: filteredDevices
        }));
    }
    catch (error) {
        console.error('Error loading devices from API:', error);
        throw error;
    }
}
// Load thông tin chi tiết của một model
async function loadModelData(identifier) {
    const product = getProductType(identifier);
    if (!product) {
        throw new Error(`Failed to get product type from identifier: ${identifier}`);
    }
    // Kiểm tra cache trong memory
    if (modelMap.has(identifier)) {
        const cached = modelMap.get(identifier);
        if (!shouldUpdate(cached.lastUpdate)) {
            return cached.device;
        }
    }
    // Kiểm tra local storage
    try {
        const stored = await window.api.userData.read(`products/${product}/${identifier}.json`);
        if (stored) {
            const data = await JSON.parse(stored);
            if (!shouldUpdate(data.lastUpdate)) {
                ;
                modelMap.set(identifier, data);
                return data.device;
            }
            console.log(`Stored data for ${identifier} needs update`);
        }
    }
    catch { }
    ;
    // Load từ API
    return await loadModelDataFromAPI(identifier, product);
}
// Tải model data từ API
async function loadModelDataFromAPI(identifier, product) {
    try {
        const productType = product || getProductType(identifier);
        if (!productType) {
            throw new Error(`Cannot determine product type for ${identifier}`);
        }
        const url = window.ipsw_api.getFirmware.replace('$id', identifier);
        const response = await fetch(url);
        if (response.status !== 200) {
            throw new Error(`Failed to fetch model data for ${identifier}: ${response.status}`);
        }
        const deviceData = await response.json();
        const modelData = {
            lastUpdate: Date.now(),
            device: deviceData
        };
        // Lưu vào local storage
        window.api.userData.write(`products/${productType}/${identifier}.json`, JSON.stringify(modelData));
        modelMap.set(identifier, modelData);
        return deviceData;
    }
    catch (error) {
        console.error(`Error loading model data for ${identifier}:`, error);
        throw error;
    }
}
// Lấy danh sách tất cả devices
function getDevices() {
    return devices;
}
// Lấy device theo identifier
function getDevice(identifier) {
    return deviceMap.get(identifier);
}
// Tìm kiếm devices theo tên hoặc identifier
function searchDevices(query) {
    const lowerQuery = query.toLowerCase();
    return devices.filter(device => device.name.toLowerCase().includes(lowerQuery) ||
        device.identifier.toLowerCase().includes(lowerQuery));
}
// Lấy danh sách devices theo product type
function getDevicesByProduct(product) {
    return devices.filter(device => getProductType(device.identifier) === product);
}
// Lấy firmware mới nhất cho một device
async function getLatestFirmware(identifier) {
    try {
        const deviceData = await loadModelData(identifier);
        if (!deviceData.firmwares || deviceData.firmwares.length === 0) {
            return null;
        }
        // Sắp xếp theo ngày release và lấy firmware mới nhất
        const sortedFirmwares = [...deviceData.firmwares].sort((a, b) => new Date(b.releasedate).getTime() - new Date(a.releasedate).getTime());
        return sortedFirmwares[0];
    }
    catch (error) {
        console.error(`Error getting latest firmware for ${identifier}:`, error);
        return null;
    }
}
// Lấy tất cả signed firmwares cho một device
async function getSignedFirmwares(identifier) {
    try {
        const deviceData = await loadModelData(identifier);
        return deviceData.firmwares.filter(fw => fw.signed);
    }
    catch (error) {
        console.error(`Error getting signed firmwares for ${identifier}:`, error);
        return [];
    }
}
// Clear tất cả cache
function clearCache() {
    modelMap.clear();
    console.log('Memory cache cleared');
}
// Clear cache của một device cụ thể
function clearDeviceCache(identifier) {
    modelMap.delete(identifier);
    console.log(`Cache cleared for ${identifier}`);
}
// Export các hàm public
export { loadDevices, loadModelData, getDevices, getDevice, searchDevices, getDevicesByProduct, getLatestFirmware, getSignedFirmwares, getProductType, clearCache, clearDeviceCache };
