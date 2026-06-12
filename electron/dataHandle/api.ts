// import {  } from "@types/";

interface FetchResult<T = any> {
    success: boolean;
    data: T | null;
    status?: number;
    error?: string;
};

async function safeFetch<T = any>(url: string, init?: RequestInit): Promise<FetchResult<T>> {
    try {
        const response = await fetch(url, init);

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
    } catch(err) {
        return {
            success: false,
            data: null,
            error: err instanceof Error ? err.message : String(err)
        }
    }
}

const _api = (() => {
    const base = "api.ipsw.me/v4";

    return {
        base,
        
        // Device
        getDevices: () => safeFetch<Device[]>(base + "/devices"),
        getIdentifierByModel: (model: string) => safeFetch<{identifier: string}>(`${base}/model/${model}`),

        // IPSW
    }
})();