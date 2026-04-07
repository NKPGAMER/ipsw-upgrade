"use strict";
/**
 * SelectModelPage.tsx
 *
 * Drop-in React replacement for the `ui` object's loadDevices / addCard logic.
 * Mount this inside #main:selectModel (or whatever container you prefer).
 *
 * Usage in index.tsx:
 *
 *   import { createRoot } from "react-dom/client";
 *   import SelectModelPage from "./ui/SelectModelPage";
 *
 *   const selectModelRoot = createRoot(document.getElementById('main:selectModel')!);
 *
 *   // Expose a function so legacy code can trigger product changes:
 *   export function showProduct(product: Product) {
 *     selectModelRoot.render(
 *       <SelectModelPage
 *         product={product}
 *         getDevices={getDevices}
 *         loadModelData={loadModelData}
 *         getFiles={getFiles}
 *         getFileNameFromUrl={getFileNameFromUrl}
 *         t={t}
 *         onCardClick={(device, allFirmwares, modelFiles, status) => {
 *           detail.show(device, allFirmwares, modelFiles, status);
 *         }}
 *       />
 *     );
 *   }
 */
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
exports.default = SelectModelPage;
const react_1 = __importStar(require("react"));
const DeviceGrid_1 = __importDefault(require("./DeviceGrid"));
// ── Search bar ─────────────────────────────────────────────────────────────────
function SearchBar({ value, onChange, onClear, }) {
    return (<div className="relative flex items-center">
      <svg className="absolute left-3 w-3.5 h-3.5 text-zinc-600 pointer-events-none" viewBox="0 0 24 24" fill="currentColor">
        <path d="m19.485 20.154-6.262-6.262a6.516 6.516 0 0 1-1.725.989A5.953 5.953 0 0 1 9.538 15.23c-1.66 0-3.077-.587-4.25-1.76C4.114 12.297 3.527 10.88 3.527 9.22c0-1.66.587-3.077 1.76-4.25C6.461 3.797 7.878 3.21 9.538 3.21c1.66 0 3.077.587 4.25 1.76 1.173 1.173 1.76 2.59 1.76 4.25a5.95 5.95 0 0 1-.97 3.285l6.261 6.262-.707.708ZM9.538 14.23c1.99 0 3.361-.457 3.361-1.37s-1.37-3.36-3.36-3.36-3.361 1.37-3.361 3.36 1.37 3.36 3.36 3.36Z"/>
      </svg>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Search devices…" className="
          w-full bg-[#0e1720] border border-[#1a2838] rounded-lg
          pl-8 pr-7 py-1.5 text-xs text-zinc-300 placeholder-zinc-600
          focus:outline-none focus:border-[#137fec]/50 transition-colors
        "/>
      {value && (<button onClick={onClear} className="absolute right-2.5 text-zinc-600 hover:text-zinc-400 transition-colors text-sm leading-none">
          ×
        </button>)}
    </div>);
}
// ── SelectModelPage ────────────────────────────────────────────────────────────
function SelectModelPage({ product, getDevices, loadModelData, getFiles, getFileNameFromUrl, t, onCardClick, }) {
    const [search, setSearch] = (0, react_1.useState)("");
    const deviceCount = getDevices().filter((d) => d.identifier.toLowerCase().startsWith(product)).length;
    const handleClearSearch = (0, react_1.useCallback)(() => setSearch(""), []);
    return (<div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[#1a2838] shrink-0">
        <div className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
          {product.toUpperCase()}
          <span className="ml-1.5 text-zinc-600 font-normal normal-case tracking-normal">
            {deviceCount} devices
          </span>
        </div>
        <div className="w-52">
          <SearchBar value={search} onChange={setSearch} onClear={handleClearSearch}/>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <DeviceGrid_1.default product={product} getDevices={getDevices} loadModelData={loadModelData} getFiles={getFiles} getFileNameFromUrl={getFileNameFromUrl} t={t} onCardClick={onCardClick} searchTerm={search}/>
      </div>
    </div>);
}
