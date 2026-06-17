import type { DeviceWithIPSWs, DeviceWithOTAs, IPSWFirmware, OTAFirmware, Releases } from "@custom-type/ipswAPI";

interface FetchResult<T = any> {
  success: boolean;
  data: T | null;
  status: number;
  error?: string;
};

async function safeFetch<T = any>(url: string): Promise<FetchResult<T>> {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      return {
        success: false,
        data: null,
        status: response.status,
        error: `HTTP error! Status: ${response.status} ${response.statusText}`
      }
    }

    const data = await response.json();
    return {
      success: true,
      data: data as T,
      status: response.status
    }
  } catch (err) {
    return {
      success: false,
      data: null,
      status: -1,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

export const ipswAPI = (() => {
  const base = "https://api.ipsw.me/v4";

  return {
    baseUrl: base,

    // Device
    getDevices: () => safeFetch<DeviceWithIPSWs[]>(`${base}/devices`),
    getIdentifierByModel: (model: string) => safeFetch<{ identifier: string }>(`${base}/model/${model}`),

    // IPSW
    ipsw: {
      getDevice: (identifier: string) => safeFetch<DeviceWithIPSWs>(`${base}/ipsw/device/${identifier}`),
      getFirmware: (identifier: string, buildid: string) => safeFetch<IPSWFirmware>(`${base}/ipsw/${identifier}/${buildid}`),
      getFirmwares: (version: string) => safeFetch<IPSWFirmware[]>(`${base}/ipsw/${version}`),
    },

    // OTA
    ota: {
      getDevice: (identifier: string) => safeFetch<DeviceWithOTAs>(`${base}/ota/device/${identifier}`),
      getFirmware: (identifier: string, buildid: string) => safeFetch<OTAFirmware>(`${base}/ota/${identifier}/${buildid}`),
      getFirmwares: (version: string) => safeFetch<OTAFirmware[]>(`${base}/ota/${version}`),
    },

    // Releases
    getReleases: () => safeFetch<Releases[]>(`${base}/releases`)
  }
})();