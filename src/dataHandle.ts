interface DeviceResponse {
  name: string;
  identifier: string;
  boardconfig: string;
  platform: string;
  cpid: number;
  bdid: number;
  firmwares: Firmware[];
}

interface StoredData {
  lastUpdate: number;
  data: Device[];
}

interface ModelData {
  lastUpdate: number;
  device: DeviceResponse;
}

const products: Product[] = ['iphone', 'ipad', 'watch', 'mac', 'realitydevice', 'tv', 'homepod', 'ipod'];

let devices: Device[] = [];
const deviceMap: Map<string, Device> = new Map();
const modelMap: Map<string, ModelData> = new Map();

// Xác định product type dựa trên identifier
function getProductType(identifier: string): Product | undefined {
  const lower = identifier.toLowerCase();

  if (lower.startsWith('iphone')) return 'iphone';
  if (lower.startsWith('ipad')) return 'ipad';
  if (lower.startsWith('watch')) return 'watch';
  if (lower.startsWith('mac')) return 'mac';
  if (lower.startsWith('realitydevice')) return 'realitydevice';
  if (lower.startsWith('appletv')) return 'tv';
  if (lower.startsWith('homepod') || lower.startsWith('audioaccessory')) return 'homepod';
  if (lower.startsWith('ipod')) return 'ipod';

  return undefined;
}

// Kiểm tra có cần cập nhật không (đã qua 00:00 UTC chưa)
function shouldUpdate(lastUpdate: number): boolean {
  const last = new Date(lastUpdate);
  const now = new Date();

  // Đặt về 00:00 UTC
  const lastMidnight = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate()));
  const todayMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  return todayMidnight.getTime() > lastMidnight.getTime();
}

// Load danh sách devices
async function loadDevices(): Promise<void> {
  try {
    const stored = await window.api.userData.read('devices.json');

    if (stored) {
      const data: StoredData = JSON.parse(stored);
      devices = data.data;
      
      // Populate deviceMap
      devices.forEach(device => {
        deviceMap.set(device.identifier, device);
      });

      // Check Update
      if (!shouldUpdate(data.lastUpdate)) return;
    }
  } catch {}

  await loadDevicesFromAPI();
}

// Tải devices từ API
async function loadDevicesFromAPI(): Promise<void> {
  try {
    const response = await fetch(window.ipsw_api.devices);

    if (response.status !== 200) {
      throw new Error(`Failed to fetch devices: ${response.status}`);
    }

    const data: Device[] = await response.json();
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
  } catch (error) {
    console.error('Error loading devices from API:', error);
    throw error;
  }
}

// Load thông tin chi tiết của một model
async function loadModelData(identifier: string): Promise<DeviceResponse> {
  const product = getProductType(identifier);
  if (!product) {
    throw new Error(`Failed to get product type from identifier: ${identifier}`);
  }

  // Kiểm tra cache trong memory
  if (modelMap.has(identifier)) {
    const cached = modelMap.get(identifier)!;
    if (!shouldUpdate(cached.lastUpdate)) {
      return cached.device;
    }
  }

  // Kiểm tra local storage
  try {
    const stored = await window.api.userData.read(`products/${product}/${identifier}.json`);
    if (stored) {
      const data: ModelData = await JSON.parse(stored);

      if (!shouldUpdate(data.lastUpdate)) {;
        modelMap.set(identifier, data);
        return data.device;
      }
      console.log(`Stored data for ${identifier} needs update`);
    }
  } catch { };

  // Load từ API
  return await loadModelDataFromAPI(identifier, product);
}

// Tải model data từ API
async function loadModelDataFromAPI(identifier: string, product?: Product): Promise<DeviceResponse> {
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

    const deviceData: DeviceResponse = await response.json();
    
    const modelData: ModelData = {
      lastUpdate: Date.now(),
      device: deviceData
    };

    // Lưu vào local storage
    window.api.userData.write(
      `products/${productType}/${identifier}.json`, 
      JSON.stringify(modelData)
    );
    
    modelMap.set(identifier, modelData);
    return deviceData;
  } catch (error) {
    console.error(`Error loading model data for ${identifier}:`, error);
    throw error;
  }
}

// Lấy danh sách tất cả devices
function getDevices(): Device[] {
  return devices;
}

// Lấy device theo identifier
function getDevice(identifier: string): Device | undefined {
  return deviceMap.get(identifier);
}

// Tìm kiếm devices theo tên hoặc identifier
function searchDevices(query: string): Device[] {
  const lowerQuery = query.toLowerCase();
  return devices.filter(device => 
    device.name.toLowerCase().includes(lowerQuery) || 
    device.identifier.toLowerCase().includes(lowerQuery)
  );
}

// Lấy danh sách devices theo product type
function getDevicesByProduct(product: Product): Device[] {
  return devices.filter(device => getProductType(device.identifier) === product);
}

// Lấy firmware mới nhất cho một device
async function getLatestFirmware(identifier: string): Promise<Firmware | null> {
  try {
    const deviceData = await loadModelData(identifier);
    
    if (!deviceData.firmwares || deviceData.firmwares.length === 0) {
      return null;
    }
    
    // Sắp xếp theo ngày release và lấy firmware mới nhất
    const sortedFirmwares = [...deviceData.firmwares].sort((a, b) => 
      new Date(b.releasedate).getTime() - new Date(a.releasedate).getTime()
    );
    
    return sortedFirmwares[0];
  } catch (error) {
    console.error(`Error getting latest firmware for ${identifier}:`, error);
    return null;
  }
}

// Lấy tất cả signed firmwares cho một device
async function getSignedFirmwares(identifier: string): Promise<Firmware[]> {
  try {
    const deviceData = await loadModelData(identifier);
    return deviceData.firmwares.filter(fw => fw.signed);
  } catch (error) {
    console.error(`Error getting signed firmwares for ${identifier}:`, error);
    return [];
  }
}

// Clear tất cả cache
function clearCache(): void {
  modelMap.clear();
  console.log('Memory cache cleared');
}

// Clear cache của một device cụ thể
function clearDeviceCache(identifier: string): void {
  modelMap.delete(identifier);
  console.log(`Cache cleared for ${identifier}`);
}

// Export các hàm public
export {
  loadDevices,
  loadModelData,
  getDevices,
  getDevice,
  searchDevices,
  getDevicesByProduct,
  getLatestFirmware,
  getSignedFirmwares,
  getProductType,
  clearCache,
  clearDeviceCache,
  type Device,
  type Firmware,
  type DeviceResponse,
  type Product
};