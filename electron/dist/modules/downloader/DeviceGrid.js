"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = DeviceGrid;
const react_1 = __importStar(require("react"));
const DeviceCard_1 = __importDefault(require("./DeviceCard"));
// ── Helpers ────────────────────────────────────────────────────────────────────
const cache = new Map();
async function loadWithCache(id, loadModelData) {
    if (cache.has(id))
        return cache.get(id);
    const data = await loadModelData(id);
    cache.set(id, data);
    return data;
}
// ── Skeleton card ──────────────────────────────────────────────────────────────
function SkeletonCard() {
    return (<div className="product-card bg-[#0e1720] border border-[#1a2838] rounded-xl p-3.5 animate-pulse">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 space-y-1.5">
          <div className="h-3 w-2/3 rounded bg-zinc-800"/>
          <div className="h-2.5 w-1/2 rounded bg-zinc-800/60"/>
        </div>
        <div className="h-4 w-16 rounded-full bg-zinc-800"/>
      </div>
      <div className="mt-2 h-2.5 w-1/3 rounded bg-zinc-800/60"/>
    </div>);
}
// ── DeviceGrid ─────────────────────────────────────────────────────────────────
function DeviceGrid({ product, getDevices, loadModelData, getFiles, getFileNameFromUrl, t, onCardClick, searchTerm = "", searchVisible = false, }) {
    const [cards, setCards] = (0, react_1.useState)([]);
    const [visibleIds, setVisibleIds] = (0, react_1.useState)(new Set());
    const observerRef = (0, react_1.useRef)(null);
    const cardRefs = (0, react_1.useRef)(new Map());
    const loadingRef = (0, react_1.useRef)(new Set());
    // Filtered device list
    const devices = (0, react_1.useMemo)(() => {
        const all = getDevices()
            .filter((d) => d.identifier.toLowerCase().startsWith(product))
            .reverse();
        if (!searchTerm.trim())
            return all;
        const term = searchTerm.toLowerCase();
        return all.filter((d) => d.name.toLowerCase().includes(term) ||
            d.identifier.toLowerCase().includes(term));
    }, [product, searchTerm, getDevices]);
    // Reset when product changes
    (0, react_1.useEffect)(() => {
        setCards(devices.map((d) => ({
            device: d,
            firmware: null,
            allFirmwares: [],
            modelFiles: [],
            status: "not-downloaded",
            statusText: "Loading…",
            loading: true,
            error: false,
        })));
        setVisibleIds(new Set());
        loadingRef.current.clear();
    }, [product]); // intentionally NOT devices to avoid re-init on search
    // Load card data when it becomes visible
    const loadCard = (0, react_1.useCallback)(async (device) => {
        const id = device.identifier;
        if (loadingRef.current.has(id))
            return;
        loadingRef.current.add(id);
        try {
            const deviceData = await loadWithCache(id, loadModelData);
            const allFirmwares = deviceData.firmwares;
            const signedFirmwares = allFirmwares.filter((fw) => fw.signed);
            const displayFirmwares = signedFirmwares.length > 0 ? signedFirmwares : allFirmwares;
            if (displayFirmwares.length === 0) {
                setCards((prev) => prev.map((c) => c.device.identifier === id
                    ? { ...c, loading: false, statusText: "No firmware", status: "not-downloaded" }
                    : c));
                return;
            }
            const latest = displayFirmwares[0];
            const fileName = getFileNameFromUrl(latest.url);
            const modelFiles = await getFiles(id);
            if (modelFiles.length > 1) {
                modelFiles.sort((a, b) => {
                    if (a.name === fileName)
                        return -1;
                    const hasA = a.name.includes(latest.buildid);
                    const hasB = b.name.includes(latest.buildid);
                    return hasA && !hasB ? -1 : !hasA && hasB ? 1 : 0;
                });
            }
            const hasOldVersions = !modelFiles.some((f) => f.name.includes(latest.buildid));
            let status = "not-downloaded";
            let statusText = t("state.notDownloaded");
            if (modelFiles.length > 0) {
                if (hasOldVersions) {
                    status = "update-available";
                    statusText = t("state.updateAvailable");
                }
                else {
                    const localFile = modelFiles[0];
                    if (localFile.name.includes(latest.buildid) && localFile.size !== latest.filesize) {
                        status = "uncomplete";
                        const activeTasks = await window.downloader.getAllTask();
                        statusText = t(activeTasks.some((task) => task.firmware.url === latest.url)
                            ? "state.downloading"
                            : "state.uncomplete");
                    }
                    else {
                        status = "downloaded";
                        statusText = t("state.downloaded");
                    }
                }
            }
            if (signedFirmwares.length === 0) {
                status = "unsigned";
                statusText = t("state.unsupported");
            }
            setCards((prev) => prev.map((c) => c.device.identifier === id
                ? { ...c, firmware: latest, allFirmwares, modelFiles, status, statusText, loading: false }
                : c));
        }
        catch (err) {
            console.error("Error loading device:", id, err);
            setCards((prev) => prev.map((c) => c.device.identifier === id
                ? { ...c, loading: false, error: true, statusText: "Error" }
                : c));
        }
    }, [loadModelData, getFiles, getFileNameFromUrl, t]);
    // IntersectionObserver — triggers loadCard when card scrolls into view
    (0, react_1.useEffect)(() => {
        observerRef.current?.disconnect();
        observerRef.current = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    const id = entry.target.dataset.id;
                    setVisibleIds((prev) => new Set([...prev, id]));
                    const device = devices.find((d) => d.identifier === id);
                    if (device)
                        loadCard(device);
                }
            });
        }, { rootMargin: "120px", threshold: 0.01 });
        cardRefs.current.forEach((el) => observerRef.current.observe(el));
        return () => observerRef.current?.disconnect();
    }, [devices, loadCard]);
    // Register / unregister card DOM elements
    const setCardRef = (0, react_1.useCallback)((id) => (el) => {
        if (el) {
            cardRefs.current.set(id, el);
            observerRef.current?.observe(el);
        }
        else {
            cardRefs.current.delete(id);
        }
    }, []);
    if (devices.length === 0) {
        return (<div className="flex flex-col items-center justify-center h-40 text-zinc-600 text-sm gap-2">
        <svg className="w-8 h-8 opacity-40" viewBox="0 0 24 24" fill="currentColor">
          <path d="M9.5 3A6.5 6.5 0 0 1 16 9.5c0 1.61-.59 3.09-1.56 4.23l.27.27h.79l5 5-1.5 1.5-5-5v-.79l-.27-.27A6.516 6.516 0 0 1 9.5 16 6.5 6.5 0 0 1 3 9.5 6.5 6.5 0 0 1 9.5 3m0 2C7 5 5 7 5 9.5S7 14 9.5 14 14 12 14 9.5 12 5 9.5 5Z"/>
        </svg>
        <span>No devices found</span>
      </div>);
    }
    // Use the filtered list for search; otherwise use full device list with lazy loading
    const displayList = searchTerm.trim() ? devices : devices;
    return (<div className="device-grid">
      {displayList.map((device, idx) => {
            const id = device.identifier;
            const card = cards.find((c) => c.device.identifier === id);
            const isVisible = visibleIds.has(id) || searchTerm.trim() !== "";
            return (<div key={id} ref={setCardRef(id)} data-id={id} className={`product-card-wrapper ${isVisible ? "visible" : ""}`} style={{ animationDelay: `${idx * 0.04}s` }}>
            {!isVisible || !card || card.loading ? (<SkeletonCard />) : card.error || !card.firmware ? (
                /* Error state */
                <div className="bg-[#0e1720] border border-[#1a2838] rounded-xl p-3.5">
                <div className="text-[13px] font-semibold text-white truncate">{device.name}</div>
                <div className="text-[10px] text-zinc-600 mt-0.5 font-mono">{device.identifier}</div>
                <div className="mt-1.5 text-[11px] text-red-400">
                  {card.error ? "Error loading data" : "No firmware available"}
                </div>
              </div>) : (<DeviceCard_1.default device={device} firmware={card.firmware} status={card.status} statusText={card.statusText} index={idx} onClick={() => {
                        onCardClick(device, card.allFirmwares, card.modelFiles, card.status);
                    }}/>)}
          </div>);
        })}
    </div>);
}
