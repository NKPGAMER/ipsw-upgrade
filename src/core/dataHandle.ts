import utils from "./utils";

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
  dataHandleVersion: string;
  lastRelease: string;
  data: Device[];
}

interface ModelData {
  dataHandleVersion: string;
  lastRelease: string;
  device: DeviceResponse;
}

interface ReleaseResponse {
  date: string;
  releases: {
    name: string;
    date: string;
    count: number;
    type: string;
  }[];
}

const DATA_HANDLE_VERSION = '2.0.0';
const METADATA_RELEASE_KEY = 'lastRelease';

let devices: Device[] = [];
let lastRelease: string | undefined;
const deviceMap: Map<string, Device> = new Map();
const modelMap: Map<string, ModelData> = new Map();

const metadata = new class {
  private readonly filename = 'metadata.json';

  private parse(raw: string | null): Record<string, unknown> {
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  async read(): Promise<Record<string, unknown>>;
  async read<T = unknown>(key: string): Promise<T | null>;
  async read<T = unknown>(key?: string): Promise<Record<string, unknown> | T | null> {
    const raw = await window.api.userData.read(this.filename);
    const data = this.parse(raw);
    if (key === undefined) return data;
    return (data[key] as T) ?? null;
  }

  async write(data: Record<string, unknown>): Promise<boolean> {
    try {
      await window.api.userData.write(this.filename, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error('[metadata] Failed to write:', error);
      return false;
    }
  }

  async update(patch: Record<string, unknown>): Promise<boolean> {
    const current = await this.read();
    return this.write({ ...current, ...patch });
  }
};

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

// Lấy date release mới nhất từ API và cache vào metadata
async function fetchLatestRelease(): Promise<string> {
  if (lastRelease) return lastRelease;

  const response = await fetch(window.ipsw_api.releases);
  if (response.status !== 200) {
    throw new Error(`Failed to fetch releases: ${response.status}`);
  }
  const data: ReleaseResponse[] = await response.json();
  const latestDate = data[0].date;

  lastRelease = latestDate;

  await metadata.update({ [METADATA_RELEASE_KEY]: latestDate });
  return latestDate;
}

// Invalidate release cache trong metadata để buộc fetch lại
async function invalidateReleaseCache(): Promise<void> {
  const current = await metadata.read();
  const { [METADATA_RELEASE_KEY]: _, ...rest } = current;
  await metadata.write(rest);
}

// Kiểm tra xem stored data có cần update không
function shouldUpdate(storedRelease: string, latestRelease: string): boolean {
  return storedRelease !== latestRelease;
}

// Kiểm tra version và xóa file nếu không hợp lệ
async function validateOrDeleteFile(filePath: string, stored: StoredData | ModelData): Promise<boolean> {
  if (!stored.dataHandleVersion || stored.dataHandleVersion !== DATA_HANDLE_VERSION) {
    console.log(`Version mismatch for ${filePath}, deleting...`);
    await window.api.userData.deleteFile(filePath);
    return false;
  }
  return true;
}

// Load danh sách devices
async function loadDevices(): Promise<void> {
  const filePath = 'devices.json';
  try {
    const stored = await window.api.userData.read(filePath);

    if (stored) {
      const data: StoredData = JSON.parse(stored);

      const isValid = await validateOrDeleteFile(filePath, data);
      if (isValid) {
        const latestRelease = await fetchLatestRelease();
        if (!shouldUpdate(data.lastRelease, latestRelease)) {
          devices = data.data;
          devices.forEach(device => deviceMap.set(device.identifier, device));
          return;
        }

        console.log('Devices data needs update');
      }
    }
  } catch {}

  utils.showSuccessMessage({ id: "app.data.update.start" });
  await loadDevicesFromAPI();
  utils.showSuccessMessage({ id: "app.data.update.success" });
}

// Tải devices từ API
async function loadDevicesFromAPI(): Promise<void> {
  try {
    const [response, latestRelease] = await Promise.all([
      fetch(window.ipsw_api.devices),
      fetchLatestRelease()
    ]);

    if (response.status !== 200) {
      throw new Error(`Failed to fetch devices: ${response.status}`);
    }

    const data: Device[] = await response.json();
    const filteredDevices = data.map(d => ({ name: d.name, identifier: d.identifier }));

    devices = filteredDevices;

    deviceMap.clear();
    devices.forEach(device => deviceMap.set(device.identifier, device));

    window.api.userData.write('devices.json', JSON.stringify({
      dataHandleVersion: DATA_HANDLE_VERSION,
      lastRelease: latestRelease,
      data: filteredDevices
    } satisfies StoredData));
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

  const latestRelease = await fetchLatestRelease();

  // Kiểm tra cache trong memory
  if (modelMap.has(identifier)) {
    const cached = modelMap.get(identifier)!;
    if (cached.dataHandleVersion === DATA_HANDLE_VERSION && !shouldUpdate(cached.lastRelease, latestRelease)) {
      return cached.device;
    }
  }

  // Kiểm tra local storage
  const filePath = `products/${product}/${identifier}.json`;
  try {
    const stored = await window.api.userData.read(filePath);
    if (stored) {
      const data: ModelData = JSON.parse(stored);

      const isValid = await validateOrDeleteFile(filePath, data);
      if (isValid && !shouldUpdate(data.lastRelease, latestRelease)) {
        modelMap.set(identifier, data);
        return data.device;
      }

      console.log(`Stored data for ${identifier} needs update`);
    }
  } catch {}

  return await loadModelDataFromAPI(identifier, product, latestRelease);
}

// Tải model data từ API
async function loadModelDataFromAPI(identifier: string, product?: Product, latestRelease?: string): Promise<DeviceResponse> {
  try {
    const productType = product ?? getProductType(identifier);
    if (!productType) {
      throw new Error(`Cannot determine product type for ${identifier}`);
    }

    const [response, release] = await Promise.all([
      fetch(window.ipsw_api.getFirmware.replace('$id', identifier)),
      latestRelease ? Promise.resolve(latestRelease) : fetchLatestRelease()
    ]);

    if (response.status !== 200) {
      throw new Error(`Failed to fetch model data for ${identifier}: ${response.status}`);
    }

    const deviceData: DeviceResponse = await response.json();

    const modelData: ModelData = {
      dataHandleVersion: DATA_HANDLE_VERSION,
      lastRelease: release,
      device: deviceData
    };

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

    if (!deviceData.firmwares?.length) return null;

    return [...deviceData.firmwares].sort((a, b) =>
      new Date(b.releasedate).getTime() - new Date(a.releasedate).getTime()
    )[0];
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

// Clear tất cả cache kể cả release trong metadata
async function clearCache(): Promise<void> {
  modelMap.clear();
  await invalidateReleaseCache();
  console.log('Memory cache cleared');
}

// Clear cache của một device cụ thể
function clearDeviceCache(identifier: string): void {
  modelMap.delete(identifier);
  console.log(`Cache cleared for ${identifier}`);
}

export {
  metadata,
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