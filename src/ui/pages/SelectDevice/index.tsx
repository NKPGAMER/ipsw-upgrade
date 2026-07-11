import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { download, deleteFile, updateFirmware, getRedundantFilesFromProduct, getFileNameFromUrl, parseIPSW, waitReady } from "@/core/helper";
import { downloader } from "@/core/downloader";
import { state, DEVICE_GROUPS } from "@/data";
import { useLocation, useNavigate } from "react-router-dom";
import { ProductId } from "@/ui/home";
import { ipswClient } from "@/init";
import type { IncompleteTaskClient } from "@/core/ipswClient";
import { state as globalState } from "@/data";
import utils from "@/core/utils";
import type { ControlAction, DeviceEntry, VerifyState } from "./types";
import { DeviceCard } from "./DeviceCard";
import { DetailPanel } from "./DetailPanel";
import { Resizer } from "./Resizer";
import { TASKBAR_ICON } from "./icons";
import { Tooltip } from "./Tooltip";
import { CardSkeleton } from "./CardSkeleton";
import { listen } from "@tauri-apps/api/event";
import { commands, type DeviceWithIpsws, type Task } from "@/bind";

const PENDING_TIMEOUT_MS = 15000;

export default function IPSWManager() {
  const [entries, setEntries] = useState<DeviceEntry[]>([]);
  const [allFiles, setAllFiles] = useState<IPSWFile[]>([]);
  const [incompleteTasks, setIncompleteTasks] = useState<IncompleteTaskClient[]>(ipswClient.getIncompleteTasks());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listWidthPct, setListWidthPct] = useState(65);
  const [pendingActions, setPendingActions] = useState<Map<string, ControlAction>>(new Map());

  const [verifyStates, setVerifyStates] = useState<Map<string, VerifyState>>(new Map());
  const verifyRunningRef = useRef(false);
  const allFilesRef = useRef<IPSWFile[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const loadedProductRef = useRef<Product | null>(null);
  const taskMapRef = useRef<Map<string, Task>>(new Map());
  const entriesRef = useRef<DeviceEntry[]>([]);
  const requestedFwRef = useRef<Set<string>>(new Set());
  const urlToIdentifiersRef = useRef<Map<string, Set<string>>>(new Map());
  const identifierGroupRef = useRef<Map<string, Set<string>>>(new Map());
  const pendingTimersRef = useRef<Map<string, number>>(new Map());
  const [identifierToGroup, setIdentifierToGroup] = useState<Map<string, Set<string>>>(new Map());

  const { t } = useTranslation();
  const location = useLocation();
  const { product }: { product: ProductId } = location.state;
  const navigate = useNavigate();

  useEffect(() => { state.currentProduct = product }, [product]);

  useEffect(() => { entriesRef.current = entries; }, [entries]);

  useEffect(() => {
    const unsub = ipswClient.onIncompleteTasksChanged((tasks) => {
      setIncompleteTasks([...tasks]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = ipswClient.onReload(() => {
      const files = ipswClient.getFiles();
      setAllFiles(files);
      allFilesRef.current = files;
    });
    return () => unsub();
  }, []);

  const setPending = useCallback((identifier: string, action: ControlAction | null) => {
    const existing = pendingTimersRef.current.get(identifier);
    if (existing) {
      window.clearTimeout(existing);
      pendingTimersRef.current.delete(identifier);
    }

    setPendingActions(prev => {
      const next = new Map(prev);
      if (action === null) next.delete(identifier);
      else next.set(identifier, action);
      return next;
    });

    if (action !== null) {
      const timer = window.setTimeout(() => {
        setPendingActions(prev => {
          const next = new Map(prev);
          next.delete(identifier);
          return next;
        });
        pendingTimersRef.current.delete(identifier);
      }, PENDING_TIMEOUT_MS);
      pendingTimersRef.current.set(identifier, timer);
    }
  }, []);

  const updateAllFiles = useCallback(() => {
    const files = ipswClient.getFiles();
    setAllFiles(files);
    allFilesRef.current = files;
  }, []);

  const clearPendingForGroup = useCallback((identifier: string) => {
    setPending(identifier, null);
    const group = identifierGroupRef.current.get(identifier);
    if (group) {
      for (const id of group) {
        if (id !== identifier) setPending(id, null);
      }
    }
  }, [setPending]);

  const applyTaskMap = useCallback((next: Map<string, Task>) => {
    taskMapRef.current = next;
    setEntries(prev => {
      let changed = false;
      const result = prev.map(e => {
        let newTask = next.get(e.device.identifier);
        if (!newTask) {
          const group = identifierGroupRef.current.get(e.device.identifier);
          if (group) {
            for (const linkedId of group) {
              const linkedTask = next.get(linkedId);
              if (linkedTask) {
                newTask = { ...linkedTask };
                break;
              }
            }
          }
        }
        if (e.task === newTask) return e;
        changed = true;
        return { ...e, task: newTask };
      });
      return changed ? result : prev;
    });
  }, []);

  const upsertTask = useCallback((task: Task) => {
    const next = new Map(taskMapRef.current);
    next.set(task.firmware.identifier, task);
    applyTaskMap(next);
  }, [applyTaskMap]);

  const removeTaskById = useCallback((taskId: string) => {
    const next = new Map(taskMapRef.current);
    for (const [key, t] of next) {
      if (t.id === taskId) { next.delete(key); break; }
    }
    applyTaskMap(next);
  }, [applyTaskMap]);

  useEffect(() => {
    const unlisten = listen<{ identifier: string; data: DeviceWithIpsws }>("dh:deviceDataUpdated", (event) => {
      const { identifier, data } = event.payload;
      setEntries(prev => {
        const group = identifierGroupRef.current.get(identifier);
        if (group && group.size > 1) {
          return prev.map(e =>
            group.has(e.device.identifier)
              ? { ...e, firmwares: data.firmwares ?? [] }
              : e
          );
        }
        return prev.map(e =>
          e.device.identifier === identifier
            ? { ...e, firmwares: data.firmwares ?? [] }
            : e
        );
      });
    });

    return () => { unlisten.then((unlisten) => unlisten()) }
  }, []);

  const handleCardVisible = useCallback(async (identifier: string) => {
    if (requestedFwRef.current.has(identifier)) return;
    requestedFwRef.current.add(identifier);

    setEntries(prev => prev.map(e =>
      e.device.identifier === identifier
        ? { ...e, firmwares: undefined }
        : e
    ));

    const modelData = await waitReady<DeviceWithIpsws>(() => commands.getModelData(identifier));
    const newFirmwares: Firmware[] = modelData.firmwares ?? [];

    setEntries(prev => {
      if (newFirmwares.length === 0) {
        return prev.map(e =>
          e.device.identifier === identifier
            ? { ...e, firmwares: newFirmwares }
            : e
        );
      }

      const targetUrl = newFirmwares[0].url;
      const idx = prev.findIndex(e => e.device.identifier === identifier);
      if (idx === -1) {
        return prev.map(e =>
          e.device.identifier === identifier
            ? { ...e, firmwares: newFirmwares }
            : e
        );
      }

      const start = Math.max(0, idx - 4);
      const end = Math.min(prev.length - 1, idx + 4);
      const linkedIds = new Set<string>();
      linkedIds.add(identifier);

      for (let i = start; i <= end; i++) {
        if (i === idx) continue;
        const fw = prev[i].firmwares;
        if (fw && fw.length > 0 && fw[0].url === targetUrl) {
          linkedIds.add(prev[i].device.identifier);
        }
      }

      if (linkedIds.size > 1) {
        urlToIdentifiersRef.current.set(targetUrl, linkedIds);
        for (const id of linkedIds) {
          identifierGroupRef.current.set(id, linkedIds);
        }
        setIdentifierToGroup(prevGroups => {
          const next = new Map(prevGroups);
          for (const id of linkedIds) next.set(id, linkedIds);
          return next;
        });

        for (const id of linkedIds) {
          if (id !== identifier && !requestedFwRef.current.has(id)) {
            requestedFwRef.current.add(id);

            waitReady<DeviceWithIpsws>(() => commands.getModelData(id))
              .then((data) => {
                setEntries(prev2 => prev2.map(e =>
                  linkedIds.has(e.device.identifier)
                    ? { ...e, firmwares: data.firmwares ?? [] }
                    : e
                ));
              });
          }
        }

        return prev.map(e =>
          linkedIds.has(e.device.identifier)
            ? { ...e, firmwares: newFirmwares }
            : e
        );
      }

      return prev.map(e =>
        e.device.identifier === identifier
          ? { ...e, firmwares: newFirmwares }
          : e
      );
    });
  }, []);

  useEffect(() => {
    const d = downloader;
    if (!d) return;

    const subs = [
          downloader.onAdded(({ task }) => {
            upsertTask(task);
            clearPendingForGroup(task.firmware.identifier);
          }),
          downloader.onProgress((payload) => upsertTask(payload.task)),
          downloader.onCompleted(({ task }) => {
            upsertTask(task);
            clearPendingForGroup(task.firmware.identifier);
          }),
          downloader.onPaused(({ task }) => {
            upsertTask(task);
            clearPendingForGroup(task.firmware.identifier);
          }),
          downloader.onCancelled((payload) => removeTaskById(payload.task_id)),
          downloader.onIncompleteDeleted((payload) => removeTaskById(payload.id)),
          downloader.onError(({ task }) => {
            upsertTask(task);
            clearPendingForGroup(task.firmware.identifier);
          }),
        ];
    
        return () => {
          subs.forEach(s => s.unsubscribe())
        };
  }, [clearPendingForGroup, removeTaskById, upsertTask]);

  useEffect(() => {
    if (loadedProductRef.current === product) return;
    loadedProductRef.current = product;

    let cancelled = false;
    setLoading(true);
    setEntries([]);
    setAllFiles([]);
    setSelectedId(null);
    setPendingActions(new Map());
    setVerifyStates(new Map());
    verifyRunningRef.current = false;
    requestedFwRef.current = new Set();
    urlToIdentifiersRef.current = new Map();
    identifierGroupRef.current = new Map();
    setIdentifierToGroup(new Map());

    async function load() {
      const devices = (await commands.getDevices(product));

      if (devices.status === "error") {
        if (!cancelled) setLoading(false);
        return;
      }
      devices.data.reverse();

      const [initialFiles, activeTasks] = await Promise.all([
        ipswClient.getFiles(),
        Promise.resolve([] as Task[])
        // window.downloader.getAllTask().catch(() => [] as Task[]),
      ]);

      if (cancelled) return;

      const taskMap = new Map<string, Task>();
      for (const t of activeTasks) taskMap.set(t.firmware.identifier, t);
      taskMapRef.current = taskMap;

      const builtEntries: DeviceEntry[] = devices.data.map(device => ({
        device,
        firmwares: null,
        task: taskMap.get(device.identifier),
      }));

      setEntries(builtEntries);
      setAllFiles(initialFiles);
      allFilesRef.current = initialFiles;
      setIncompleteTasks(ipswClient.getIncompleteTasks());
      setLoading(false);
    }

    load().catch(err => {
      console.error("[IPSWManager] load failed:", err);
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [product]);

  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(
      e => e.device.name.toLowerCase().includes(q) || e.device.identifier.toLowerCase().includes(q)
    );
  }, [entries, search]);

  const groupedEntries = useMemo(() => {
    const selectedGroups = DEVICE_GROUPS
      .map(group => ({
        name: group.name,
        entries: filtered.filter(entry => group.ids.includes(entry.device.identifier)),
      }))
      .filter(group => group.entries.length > 0);

    const groupedIds = new Set(DEVICE_GROUPS.flatMap(group => group.ids));
    const ungroupedEntries = filtered.filter(entry => !groupedIds.has(entry.device.identifier));

    return { selectedGroups, ungroupedEntries };
  }, [filtered]);

  const ungroupedTitle = `${product.charAt(0).toUpperCase()}${product.slice(1)} Series`;

  const selectedEntry = useMemo(
    () => entries.find(e => e.device.identifier === selectedId) ?? null,
    [entries, selectedId]
  );

  const linkedEntries = useMemo(() => {
    if (!selectedEntry) return [] as DeviceEntry[];
    const group = identifierToGroup.get(selectedEntry.device.identifier);
    if (!group || group.size <= 1) return [] as DeviceEntry[];
    return entries.filter(e =>
      e.device.identifier !== selectedEntry.device.identifier && group.has(e.device.identifier)
    );
  }, [entries, selectedEntry, identifierToGroup]);

  const handleResize = useCallback((dx: number) => {
    if (!containerRef.current) return;
    const totalW = containerRef.current.clientWidth;
    setListWidthPct(prev => Math.max(28, Math.min(72, prev + (dx / totalW) * 100)));
  }, []);

  const getEffectiveTask = useCallback((identifier: string): Task | undefined => {
    const direct = taskMapRef.current.get(identifier);
    if (direct) return direct;
    const group = identifierGroupRef.current.get(identifier);
    if (group) {
      for (const linkedId of group) {
        const t = taskMapRef.current.get(linkedId);
        if (t) return t;
      }
    }
    return undefined;
  }, []);

  const handleAction = useCallback(async (
    deviceIdentifier: string,
    action: ControlAction,
    fw?: Firmware,
  ) => {
    const d = downloader;
    const entry = entriesRef.current.find(e => e.device.identifier === deviceIdentifier);
    if (!entry) return;

    const task = getEffectiveTask(deviceIdentifier);
    const raw = fw ?? entry.firmwares?.[0];
    const firmware = raw ? { ...raw, identifier: deviceIdentifier } : undefined;

    setPending(deviceIdentifier, action);

    try {
      switch (action) {
        case "download":
          if (!firmware) { setPending(deviceIdentifier, null); return; }
          {
            const { success } = await download(firmware);
            if (!success) setPending(deviceIdentifier, null);
          }
          break;

        case "redownload":
          if (!firmware) { setPending(deviceIdentifier, null); return; }
          {
            await deleteFile({ identifier: deviceIdentifier });
            updateAllFiles();
            const nextMap = new Map(taskMapRef.current);
            nextMap.delete(deviceIdentifier);
            applyTaskMap(nextMap);
            const { success } = await download(firmware);
            if (!success) setPending(deviceIdentifier, null);
          }
          break;

        case "update":
          await deleteFile({ identifier: deviceIdentifier });
          updateAllFiles();
          if (firmware) await updateFirmware(firmware);
          setPending(deviceIdentifier, null);
          break;

        case "pause":
          if (task) {
            const result = await d.pause(task.id);
            clearPendingForGroup(deviceIdentifier);
            if (!result.success) {
              if (result.error === "NotFound") {
                utils.showErrorMessage(t("message.downloader.lifecycle.pause.not_found"));
              } else {
                utils.showErrorMessage(t("message.downloader.lifecycle.pause.invalid_status"));
              }
            } else {
              utils.showSuccessMessage(t("message.downloader.lifecycle.pause.success"));
            }
          }
          break;

        case "resume":
          if (task) {
            const result = await d.resume(task.id);
            clearPendingForGroup(deviceIdentifier);
            if (!result.success) {
              if (result.error === "NotFound") {
                utils.showErrorMessage(t("message.downloader.lifecycle.resume.not_found"));
              } else {
                utils.showErrorMessage(t("message.downloader.lifecycle.resume.invalid_status"));
              }
            } else {
              utils.showSuccessMessage(t("message.downloader.lifecycle.resume.success"));
            }
          }
          break;

        case "cancel":
          if (task) {
            const result = await d.cancel(task.id);
            clearPendingForGroup(deviceIdentifier);
            if (!result.success) {
              if (result.error === "NotFound") {
                utils.showErrorMessage(t("message.downloader.lifecycle.cancel.not_found"));
              } else {
                utils.showErrorMessage(t("message.downloader.lifecycle.cancel.invalid_status"));
              }
            } else {
              utils.showSuccessMessage(t("message.downloader.lifecycle.cancel.success"));
            }
            updateAllFiles();
            ipswClient.refreshIncompleteTasks().then(() => {
              setIncompleteTasks(ipswClient.getIncompleteTasks());
            }).catch((err) => {
              console.error("[IPSWManager] cancel refresh incomplete failed:", err);
            });
          }
          break;

        case "delete":
          {
            await deleteFile({ identifier: deviceIdentifier });
            updateAllFiles();
            const nextMap = new Map(taskMapRef.current);
            nextMap.delete(deviceIdentifier);
            applyTaskMap(nextMap);
            setPending(deviceIdentifier, null);
            break;
          }

        case "verify": {
          if (verifyRunningRef.current) {
            utils.showErrorMessage("Đang xác minh tệp khác, vui lòng đợi.");
            setPending(deviceIdentifier, null);
            return;
          }

          const latestFw = entry.firmwares?.[0];
          if (!latestFw) { setPending(deviceIdentifier, null); return; }

          const info = parseIPSW(getFileNameFromUrl(latestFw.url));
          if (!info) { setPending(deviceIdentifier, null); return; }

          const file = allFilesRef.current.find(f => {
            const parsed = parseIPSW(f.name);
            return parsed?.id === info.id && parsed?.build === latestFw.buildid;
          });

          if (!file) {
            utils.showErrorMessage("Không tìm thấy tệp IPSW.");
            setPending(deviceIdentifier, null);
            return;
          }

          verifyRunningRef.current = true;
          setVerifyStates(prev => {
            const next = new Map(prev);
            next.set(deviceIdentifier, { phase: "verifying", progress: { pct: 0, speed: 0 } });
            return next;
          });

          try {
            // await d.verifyChecksum(deviceIdentifier, file.path, latestFw);
          } catch (err) {
            console.error("[IPSWManager] verify invoke failed:", err);
            verifyRunningRef.current = false;
            setVerifyStates(prev => {
              const next = new Map(prev);
              next.delete(deviceIdentifier);
              return next;
            });
            setPending(deviceIdentifier, null);
            utils.showErrorMessage("Không thể bắt đầu xác minh.");
          }
          break;
        }

        case "cancel_verify":
          // await d.cancelVerify(deviceIdentifier);
          break;

        case "resume_incomplete": {
          const latestFw = entry.firmwares?.[0];
          const linkedGroup = identifierGroupRef.current.get(deviceIdentifier);
          let incompTask = latestFw
            ? ipswClient.getIncompleteTasks().find(
              t => t.firmware.identifier === deviceIdentifier && t.firmware.buildid === latestFw.buildid
            )
            : undefined;

          if (!incompTask && latestFw && linkedGroup) {
            for (const linkedId of linkedGroup) {
              if (linkedId === deviceIdentifier) continue;
              const match = ipswClient.getIncompleteTasks().find(
                t => t.firmware.identifier === linkedId && t.firmware.buildid === latestFw.buildid
              );
              if (match) { incompTask = match; break; }
            }
          }

          if (!incompTask) {
            if (firmware) {
              await deleteFile({ identifier: deviceIdentifier }).catch(() => { });
              const { success } = await download(firmware);
              if (!success) clearPendingForGroup(deviceIdentifier);
            } else {
              clearPendingForGroup(deviceIdentifier);
            }
            break;
          }

          // const result = await d.add(incompTask.firmware, { taskId: incompTask.id })
          // if (result.success) {
          //   ipswClient.removeIncompleteTask(incompTask.id);
          //   setIncompleteTasks(ipswClient.getIncompleteTasks());
          //   await deleteFile({ identifier: deviceIdentifier }).catch(() => { });
          // } else {
          //   clearPendingForGroup(deviceIdentifier);
          // }
          break;
        }

        case "delete_incomplete": {
          const latestFw = entry.firmwares?.[0];
          const linkedGroup = identifierGroupRef.current.get(deviceIdentifier);
          let incompTask = latestFw
            ? ipswClient.getIncompleteTasks().find(
              t => t.firmware.identifier === deviceIdentifier && t.firmware.buildid === latestFw.buildid
            )
            : undefined;

          if (!incompTask && latestFw && linkedGroup) {
            for (const linkedId of linkedGroup) {
              if (linkedId === deviceIdentifier) continue;
              const match = ipswClient.getIncompleteTasks().find(
                t => t.firmware.identifier === linkedId && t.firmware.buildid === latestFw.buildid
              );
              if (match) { incompTask = match; break; }
            }
          }

          if (incompTask) {
            const result = await d.deleteIncomplete(incompTask.id);
            if (result.success) {
              ipswClient.removeIncompleteTask(incompTask.id);
              setIncompleteTasks(ipswClient.getIncompleteTasks());
            }
          }
          clearPendingForGroup(deviceIdentifier);
          break;
        }

        default:
          setPending(deviceIdentifier, null);
      }
    } catch (err) {
      console.error(`[IPSWManager] Action "${action}" on ${deviceIdentifier} failed:`, err);
      clearPendingForGroup(deviceIdentifier);
    }
  }, [getEffectiveTask, setPending, applyTaskMap, clearPendingForGroup, updateAllFiles, t]);

  const handleRedundantFiles = useCallback(async () => {
    const { oldFiles, duplicateFiles } = await getRedundantFilesFromProduct(product);

    if (oldFiles.length === 0 && duplicateFiles.length === 0) {
      utils.showSuccessMessage(t("confirm.removeRedundantFiles.message.notFound"));
      return;
    }

    const result = await utils.customConfirm(t("confirm.removeRedundantFiles.body", {
      old: oldFiles.length,
      duplicate: duplicateFiles.length
    }), {
      variant: "danger",
      title: t("confirm.default.title"),
      confirmText: t("confirm.removeRedundantFiles.confirm"),
      cancelText: t("confirm.default.cancel")
    });

    if (!result) return;

    ipswClient.deleteFile([...oldFiles, ...duplicateFiles]);
  }, [product, t]);

  return (
    <div className="fixed inset-0 z-1000">
      <div
        ref={containerRef}
        className="flex h-full bg-[#0c0c0f] text-white overflow-hidden"
        style={{ fontFamily: "'SF Pro Display','SF Pro Text',-apple-system,BlinkMacSystemFont,sans-serif" }}
      >
        <div
          className="flex flex-col overflow-hidden shrink-0"
          style={{
            width: selectedEntry ? `${listWidthPct}%` : "100%",
            transition: "width 0.15s ease",
          }}
        >
          <div className="flex items-center gap-2 px-3! h-11 border-b border-white/7 shrink-0 bg-[#0e0e12]">
            <div className="flex items-center gap-2 shrink-0 min-w-0">
              <span className="text-[16px] font-bold text-gray-200 whitespace-nowrap">{entries.length} thiết bị</span>
            </div>
            <div className="flex-1 flex justify-center px-2!">
              <div className="flex items-center gap-2 px-2.5! py-1.5! rounded-lg bg-white/5 border border-white/8 w-full max-w-xs hover:border-white/15 focus-within:border-[#137fec]/45 transition-colors">
                <svg className="w-3 h-3 text-gray-600 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" strokeLinecap="round" />
                </svg>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Tìm thiết bị…"
                  className="flex-1 bg-transparent text-[11px] text-white placeholder-gray-600 outline-none min-w-0"
                />
                {search && (
                  <button onClick={() => setSearch("")} className="text-gray-600 hover:text-gray-400 transition-colors shrink-0">
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between gap-1.5 shrink-0">
              <Tooltip label={t("tooltip.updateFirmware")} position="bottom">
                <button
                  className="w-10 h-8 p-2! rounded-lg bg-white/5 hover:bg-white/10 border border-white/8 text-gray-500 hover:text-gray-400 flex items-center justify-center transition-colors shrink-0"
                  onClick={() => navigate("/ipswUpdate", { state: { product: globalState.currentProduct } })}
                >
                  {TASKBAR_ICON.update}
                </button>
              </Tooltip>

              <Tooltip label={t("tooltip.removeRedundantFiles")} position="bottom">
                <button
                  onClick={async () => handleRedundantFiles()}
                  className="w-10 h-8 p-2! rounded-lg bg-white/5 hover:bg-white/10 border border-white/8 text-gray-500 hover:text-gray-400 flex items-center justify-center transition-colors shrink-0"
                >
                  {TASKBAR_ICON.delete}
                </button>
              </Tooltip>

              <Tooltip label={t("tooltip.downloads")} position="bottom">
                <button
                  onClick={() => navigate("/downloads")}
                  className="w-10 h-8 p-2! rounded-lg bg-white/5 hover:bg-white/10 border border-white/8 text-gray-500 hover:text-gray-400 flex items-center justify-center transition-colors shrink-0"
                >
                  {TASKBAR_ICON.download}
                </button>
              </Tooltip>

              <button
                onClick={() => navigate("/")}
                className="w-10 h-8 rounded-lg bg-white/5 hover:bg-red-500/15 border border-white/8 hover:border-red-500/25 text-gray-500 hover:text-red-400 flex items-center justify-center transition-all"
              >
                {TASKBAR_ICON.close}
              </button>
            </div>
          </div>

          <div ref={scrollAreaRef} className="flex-1 overflow-y-auto p-3! scrollbar-thin">
            {loading ? (
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(285px, 1fr))" }}>
                {[...Array(8)].map((_, i) => (
                  <div
                    key={i}
                    className="h-50 relative rounded-[14px] cursor-default select-none overflow-visible aurora-border"
                  >
                    <div className="relative w-full h-full rounded-[14px] border border-transparent bg-[#0c0c0f] overflow-hidden">
                      <CardSkeleton />
                    </div>
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-gray-600">
                <svg className="w-6 h-6 opacity-40" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" strokeLinecap="round" />
                </svg>
                <span className="text-[12px]">{search ? "Không tìm thấy thiết bị" : "Không có thiết bị"}</span>
              </div>
            ) : (
              <div className="space-y-4">
                {groupedEntries.ungroupedEntries.length > 0 && (
                  <div className="space-y-2!">
                    <div className="flex items-center gap-2 px-1! mt-3! mb-2!">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#137fec]" />
                      <h3 className="text-[18px] font-bold text-gray-200">{ungroupedTitle}</h3>
                      <span className="text-[12px] text-gray-400">{groupedEntries.ungroupedEntries.length} models</span>
                    </div>
                    <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(285px, 1fr))" }}>
                      {groupedEntries.ungroupedEntries.map(entry => (
                        <DeviceCard
                          key={entry.device.identifier}
                          entry={entry}
                          selected={selectedId === entry.device.identifier}
                          allFiles={allFiles}
                          incompleteTasks={incompleteTasks}
                          pending={pendingActions.has(entry.device.identifier)}
                          linkedGroup={identifierToGroup.get(entry.device.identifier)}
                          onClick={() => {
                            if (entry.firmwares == null) return;
                            setSelectedId(prev =>
                              prev === entry.device.identifier ? null : entry.device.identifier
                            );
                          }}
                          onVisible={handleCardVisible}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {groupedEntries.selectedGroups.map(group => (
                  <div key={group.name} className="space-y-2!">
                    <div className="flex items-center gap-2 px-1! mt-2.5!">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#137fec]" />
                      <h3 className="text-[16px] font-semibold text-gray-200">{group.name}</h3>
                      <span className="text-[12px] text-gray-400">{group.entries.length} models</span>
                    </div>
                    <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(285px, 1fr))" }}>
                      {group.entries.map(entry => (
                        <DeviceCard
                          key={entry.device.identifier}
                          entry={entry}
                          selected={selectedId === entry.device.identifier}
                          allFiles={allFiles}
                          incompleteTasks={incompleteTasks}
                          pending={pendingActions.has(entry.device.identifier)}
                          linkedGroup={identifierToGroup.get(entry.device.identifier)}
                          onClick={() => {
                            if (entry.firmwares == null) return;
                            setSelectedId(prev =>
                              prev === entry.device.identifier ? null : entry.device.identifier
                            );
                          }}
                          onVisible={handleCardVisible}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {selectedEntry && (
          <>
            <Resizer onResize={handleResize} />
            <div
              className="flex-1 min-w-0 border-l border-white/7 bg-[#0e0e12] overflow-hidden"
              style={{ animation: "slideIn 0.2s cubic-bezier(0.22,1,0.36,1)" }}
            >
              <DetailPanel
                entry={selectedEntry}
                product={product}
                allFiles={allFiles}
                incompleteTasks={incompleteTasks}
                pendingAction={pendingActions.get(selectedEntry.device.identifier) ?? null}
                verifyState={verifyStates.get(selectedEntry.device.identifier)}
                onClose={() => setSelectedId(null)}
                onAction={(action, fw) => handleAction(selectedEntry.device.identifier, action, fw)}
                linkedDevices={linkedEntries}
                linkedGroup={identifierToGroup.get(selectedEntry.device.identifier)}
              />
            </div>
          </>
        )}
      </div>

      <style>{`
        @property --aurora-angle {
          syntax: '<angle>';
          initial-value: 0deg;
          inherits: false;
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(8px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes cardFlash {
          0%   { box-shadow: 0 0 0 0 rgba(19,127,236,0); }
          30%  { box-shadow: 0 0 0 3px rgba(19,127,236,0.35); }
          100% { box-shadow: 0 0 0 0 rgba(19,127,236,0); }
        }
        .animate-card-flash { animation: cardFlash 0.6s ease-out; }
        .animate-shimmer { animation: shimmer 1.8s linear infinite; }
        @keyframes turboFlash {
          0%   { box-shadow: 0 0 0 0 rgba(224,139,26,0); }
          30%  { box-shadow: 0 0 0 4px rgba(224,139,26,0.5); }
          100% { box-shadow: 0 0 0 0 rgba(224,139,26,0); }
        }
        .animate-turbo-flash { animation: turboFlash 0.6s ease-out 3; }
        @keyframes cardEnter {
          from { opacity: 0; transform: translateY(10px) scale(0.985); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .animate-card-enter { animation: cardEnter 0.35s cubic-bezier(0.22,1,0.36,1) both; }
        .aurora-border::before {
          content: "";
          position: absolute;
          inset: -3px;
          border-radius: 17px;
          padding: 3px;
          background: conic-gradient(from var(--aurora-angle), #137fec, #8b5cf6, #06b6d4, #137fec);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask-composite: exclude;
          z-index: -1;
          animation: aurora-rotate 3s linear infinite;
        }
        .aurora-border::after {
          content: "";
          position: absolute;
          inset: -3px;
          border-radius: 17px;
          padding: 3px;
          background: conic-gradient(from var(--aurora-angle), #137fec, #8b5cf6, #06b6d4, #137fec);
          filter: blur(10px);
          opacity: 0.45;
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask-composite: exclude;
          z-index: -2;
          animation: aurora-rotate 3s linear infinite;
        }
        @keyframes aurora-rotate { to { --aurora-angle: 360deg; } }
        .scrollbar-thin { scrollbar-color: rgba(19,127,236,0.5) transparent; scrollbar-width: thin; }
        .scrollbar-thin::-webkit-scrollbar { width: 4px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: rgba(19,127,236,0.5); border-radius: 2px; }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover { background: rgba(19,127,236,0.8); }
      `}</style>
    </div>
  );
}
