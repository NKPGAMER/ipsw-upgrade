import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { download, deleteFile, updateFirmware, getRedundantFilesFromProduct, getFileNameFromUrl, parseIPSW } from "@/core/helper";
import { state, DEVICE_GROUPS } from "@/data";
import { useLocation, useNavigate } from "react-router-dom";
import { ProductId } from "@/ui/home";
import { ipswClient } from "@/init";
import { useSearchStore } from "@/stores/search-store";
import { usePageLayout } from "@/ui/layout";
import utils from "@/core/utils";
import { downloader } from "@/services/downloader";
import { data } from "@/services/api";
import { DeviceCard } from "./DeviceCard";
import { DetailPanel } from "./DetailPanel";
import { Resizer } from "./Resizer";
import { TASKBAR_ICON } from "./icons";
import { Tooltip } from "./Tooltip";
import { CardSkeleton } from "./CardSkeleton";
import "./styles.css";

import type { Task } from "@custom-type/downloader";
import type { IncompleteTaskClient } from "@/core/ipswClient";
import type { ControlAction, DeviceEntry, VerifyState } from "./types";

const PENDING_TIMEOUT_MS = 15000;
const IDLE_REDIRECT_MS = 60_000;

export default function IPSWManager() {
  usePageLayout("fullContent");
  const [entries, setEntries] = useState<DeviceEntry[]>([]);
  const [allFiles, setAllFiles] = useState<IPSWFile[]>([]);
  const [incompleteTasks, setIncompleteTasks] = useState<IncompleteTaskClient[]>(ipswClient.getIncompleteTasks());
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listWidthPct, setListWidthPct] = useState(65);
  const [pendingActions, setPendingActions] = useState<Map<string, ControlAction>>(new Map());

  const [verifyStates, setVerifyStates] = useState<Map<string, VerifyState>>(new Map());
  const verifyRunningRef = useRef(false);
  const allFilesRef = useRef<IPSWFile[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);
  const [isResizing, setIsResizing] = useState(false);
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
  const locState = location.state as
    | { product: ProductId; globalSearch?: undefined }
    | { globalSearch: true; product?: undefined }
    | null;
  const product: ProductId | undefined = locState?.product;
  const isGlobalSearch = locState?.globalSearch === true;
  const navigate = useNavigate();

  const debouncedQuery = useSearchStore((s) => s.debouncedQuery);
  const customDevices = useSearchStore((s) => s.customDevices);

  useEffect(() => {
    if (product) state.currentProduct = product;
  }, [product]);

  useEffect(() => { entriesRef.current = entries; }, [entries]);

  useEffect(() => {
    const store = useSearchStore.getState();
    store.setSearchVisible(true);
    store.setFromSelectDevice(false);
    return () => store.setSearchVisible(false);
  }, []);

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

  // ── Idle auto-redirect: nếu có task đang downloading + 60s không tương tác → /downloads ──

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let idleTimer: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        for (const task of taskMapRef.current.values()) {
          if (task.status === "downloading") {
            navigate("/downloads");
            return;
          }
        }
      }, IDLE_REDIRECT_MS);
    };

    const events = ["mousedown", "wheel", "keydown", "touchstart"] as const;
    events.forEach((e) => container.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      clearTimeout(idleTimer);
      events.forEach((e) => container.removeEventListener(e, resetTimer));
    };
  }, [navigate]);

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
    const unsub = data.onDeviceDataUpdated(({ identifier, data: deviceData }) => {
      setEntries(prev => {
        const group = identifierGroupRef.current.get(identifier);
        if (group && group.size > 1) {
          return prev.map(e =>
            group.has(e.device.identifier)
              ? { ...e, firmwares: deviceData.firmwares ?? [] }
              : e
          );
        }
        return prev.map(e =>
          e.device.identifier === identifier
            ? { ...e, firmwares: deviceData.firmwares ?? [] }
            : e
        );
      });
    });
    return () => unsub?.();
  }, []);

  const handleCardVisible = useCallback(async (identifier: string) => {
    if (requestedFwRef.current.has(identifier)) return;
    requestedFwRef.current.add(identifier);

    setEntries(prev => prev.map(e =>
      e.device.identifier === identifier
        ? { ...e, firmwares: undefined }
        : e
    ));

    const result = await data.getDeviceModelData(identifier);
    if (!result) return;
    if (result.status === "ready") {
      const newFirmwares: Firmware[] = result.data.firmwares ?? [];

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
              data.getDeviceModelData(id).then(reloadResult => {
                if (!reloadResult) return;
                if (reloadResult.status === "ready") {
                  setEntries(prev2 => prev2.map(e =>
                    linkedIds.has(e.device.identifier)
                      ? { ...e, firmwares: reloadResult.data.firmwares ?? [] }
                      : e
                  ));
                }
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
    }
  }, []);

  useEffect(() => {
    const d = downloader;

    const timers = pendingTimersRef.current;

    const refreshIncomplete = () => {
      ipswClient.refreshIncompleteTasks().then(() => {
        setIncompleteTasks(ipswClient.getIncompleteTasks());
      }).catch((err) => {
        console.error("[IPSWManager] refresh incomplete tasks failed:", err);
      });
    };

    const subs = [
      d.onAdded((_id, task) => {
        upsertTask(task);
        clearPendingForGroup(task.firmware.identifier);
        refreshIncomplete();
      }),
      d.onProgress((_id, task) => upsertTask(task)),
      d.onPaused((_id, task) => {
        upsertTask(task);
        clearPendingForGroup(task.firmware.identifier);
      }),
      d.onResumed((_id, task) => {
        if (task) {
          upsertTask(task);
          clearPendingForGroup(task.firmware.identifier);
        }
      }),
      d.onCompleted((_id, task) => {
        upsertTask(task);
        clearPendingForGroup(task.firmware.identifier);
        updateAllFiles();
      }),
      d.onError((_id, err, task) => {
        upsertTask(task);
        clearPendingForGroup(task.firmware.identifier);
      }),
      d.onCancelled((id) => {
        const affected = new Set<string>();
        for (const [identifier, t] of taskMapRef.current) {
          if (t.id === id) affected.add(identifier);
        }
        removeTaskById(id);
        for (const identifier of affected) {
          clearPendingForGroup(identifier);
        }
        updateAllFiles();
        refreshIncomplete();
      }),
      d.onIncompleteDeleted((id) => {
        const task = ipswClient.getIncompleteTasks().find(t => t.id === id);
        removeTaskById(id);
        if (task) clearPendingForGroup(task.firmware.identifier);
        ipswClient.removeIncompleteTask(id);
        setIncompleteTasks(ipswClient.getIncompleteTasks());
      }),

      d.onVerifyProgress((info) => {
        setVerifyStates(prev => {
          const next = new Map(prev);
          next.set(info.identifier, {
            phase: "verifying",
            progress: { pct: info.pct, speed: info.speed, eta: info.eta },
          });
          return next;
        });
      }),
      d.onVerifyCompleted((info) => {
        verifyRunningRef.current = false;
        setVerifyStates(prev => {
          const next = new Map(prev);
          next.delete(info.identifier);
          return next;
        });
        setPending(info.identifier, null);

        if (info.ok) {
          utils.showSuccessMessage("Xác minh thành công! Tệp IPSW khớp với checksum.");
        } else {
          const algoLabel = info.algo?.toUpperCase() ?? "?";
          utils.customConfirm(
            `Tệp IPSW **không khớp** checksum.\n\n` +
            `**Thuật toán:** ${algoLabel}\n` +
            `**Mong đợi:** \`${info.expected}\`\n` +
            `**Thực tế:** \`${info.actual}\`\n\n` +
            `Xoá tệp bị hỏng?`,
            { variant: "danger", title: "Xác minh thất bại", confirmText: "Xoá tệp", cancelText: "Giữ lại" }
          ).then((shouldDelete) => {
            if (shouldDelete) {
              deleteFile({ identifier: info.identifier }).then(() => {
                updateAllFiles();
              });
            }
          });
        }
      }),
      d.onVerifyCancelled((info) => {
        verifyRunningRef.current = false;
        setVerifyStates(prev => {
          const next = new Map(prev);
          next.delete(info.identifier);
          return next;
        });
        setPending(info.identifier, null);
      }),
      d.onVerifyError((info) => {
        verifyRunningRef.current = false;
        setVerifyStates(prev => {
          const next = new Map(prev);
          next.delete(info.identifier);
          return next;
        });
        setPending(info.identifier, null);
        utils.showErrorMessage(`Lỗi xác minh: ${info.error}`);
      }),
    ];

    return () => {
      subs.forEach(s => s.unsubscribe());
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isGlobalSearch && loadedProductRef.current === product) return;
    loadedProductRef.current = product ?? null;

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
      let devices: Device[];
      if (customDevices) {
        devices = customDevices;
      } else {
        const allDevices = await data.getDevices();
        if (!allDevices) return;
        devices = isGlobalSearch
          ? [...allDevices].reverse()
          : allDevices.filter(d => d.identifier.toLocaleLowerCase().startsWith(product!)).reverse();
      }

      const [initialFiles, activeTasks] = await Promise.all([
        ipswClient.getFiles(),
        downloader.getAllTask().catch(() => [] as Task[]),
      ]);

      if (cancelled) return;

      const taskMap = new Map<string, Task>();
      for (const t of activeTasks) taskMap.set(t.firmware.identifier, t);
      taskMapRef.current = taskMap;

      const builtEntries: DeviceEntry[] = devices.map(device => ({
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
  }, [product, isGlobalSearch, customDevices]);

  const filtered = useMemo(() => {
    if (!debouncedQuery.trim()) return entries;
    const q = debouncedQuery.toLowerCase();
    return entries.filter(
      e => e.device.name.toLowerCase().includes(q) || e.device.identifier.toLowerCase().includes(q)
    );
  }, [entries, debouncedQuery]);

  const groupedEntries = useMemo(() => {
    const groups = product ? DEVICE_GROUPS[product] ?? [] : Object.values(DEVICE_GROUPS).flat();
    const selectedGroups = groups
      .map(group => ({
        name: group.name,
        entries: filtered.filter(entry => group.ids.includes(entry.device.identifier)),
      }))
      .filter(group => group.entries.length > 0);

    const groupedIds = new Set(groups.flatMap(group => group.ids));
    const ungroupedEntries = filtered.filter(entry => !groupedIds.has(entry.device.identifier));

    return { selectedGroups, ungroupedEntries };
  }, [filtered, product]);

  const ungroupedTitle = product
    ? `${product.charAt(0).toUpperCase()}${product.slice(1)} Series`
    : "All Devices";

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
              if (result.error === "NOT_FOUND") {
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
              if (result.error === "NOT_FOUND") {
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
              if (result.error === "NOT_FOUND") {
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
          await deleteFile({ identifier: deviceIdentifier });
          {
            updateAllFiles();
            const nextMap = new Map(taskMapRef.current);
            nextMap.delete(deviceIdentifier);
            applyTaskMap(nextMap);
          }
          setPending(deviceIdentifier, null);
          break;

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
            await d.verifyChecksum(deviceIdentifier, file.path, latestFw);
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
          await d.cancelVerify(deviceIdentifier);
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

          const result = await d.add(incompTask.firmware, { taskId: incompTask.id })
          if (result.success) {
            ipswClient.removeIncompleteTask(incompTask.id);
            setIncompleteTasks(ipswClient.getIncompleteTasks());
            await deleteFile({ identifier: deviceIdentifier }).catch(() => { });
          } else {
            clearPendingForGroup(deviceIdentifier);
          }
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
    if (!product) {
      utils.showErrorMessage("Tính năng này chỉ khả dụng khi chọn một dòng sản phẩm.");
      return;
    }
    try {
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

      await ipswClient.deleteFile([...oldFiles, ...duplicateFiles]);
    } catch (err) {
      console.error("[IPSWManager] handleRedundantFiles failed:", err);
      utils.showErrorMessage("Không thể xoá file dư thừa.");
    }
  }, [product, t]);

  return (
    <div className="size-full">
      <div
        ref={containerRef}
        className="flex size-full bg-apple-tile-3 text-white overflow-hidden"
      >
        <div
          className="flex flex-col overflow-hidden shrink-0"
          style={{
            width: selectedEntry ? `${listWidthPct}%` : "100%",
            transition: isResizing ? "none" : "width 220ms cubic-bezier(0.2, 0, 0, 1)",
          }}
        >
          <div className="flex items-center gap-2 px-3! h-11 border-b border-white/6 shrink-0 bg-apple-tile-3">
            <div className="flex items-center gap-2 shrink-0 min-w-0">
              <span className="text-[16px] font-bold text-gray-200 whitespace-nowrap">{filtered.length} thiết bị</span>
              {debouncedQuery && (
                <span className="text-[11px] text-apple-primary bg-apple-primary/10 px-2 py-0.5 rounded-full">
                  "{debouncedQuery}"
                </span>
              )}
            </div>
            <div className="flex-1" />
            <div className="flex items-center justify-between gap-1.5 shrink-0">
              {!isGlobalSearch && (
                <Tooltip label={t("tooltip.removeRedundantFiles")} position="bottom">
                  <button
                    onClick={async () => handleRedundantFiles()}
                    className="w-10 h-8 p-2! rounded-lg bg-white/4 hover:bg-white/8 border border-white/6 text-apple-ink-muted-48 hover:text-white flex items-center justify-center transition-colors shrink-0"
                  >
                    {TASKBAR_ICON.delete}
                  </button>
                </Tooltip>
              )}

              <button
                onClick={() => navigate("/", { replace: true })}
                className="w-10 h-8 rounded-lg bg-white/4 hover:bg-[#ff3b30]/15 border border-white/6 hover:border-[#ff3b30]/25 text-apple-ink-muted-48 hover:text-[#ff453a] flex items-center justify-center transition-all"
              >
                {TASKBAR_ICON.close}
              </button>
            </div>
          </div>

          <div ref={scrollAreaRef} className="flex-1 overflow-y-auto p-3! scrollbar-thin">
            {loading ? (
              <motion.div
                className="grid gap-2"
                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(285px, 1fr))" }}
                initial="hidden"
                animate="show"
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.03, delayChildren: 0.01 } } }}
              >
                {[...Array(8)].map((_, i) => (
                  <motion.div
                    key={i}
                    variants={{
                      hidden: { opacity: 0, y: 8 },
                      show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: [0, 0, 0.2, 1] } },
                    }}
                    className="h-50 relative rounded-[14px] cursor-default select-none overflow-hidden bg-apple-tile-1 border border-white/6"
                  >
                    <CardSkeleton />
                  </motion.div>
                ))}
              </motion.div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-gray-600">
                <svg className="w-6 h-6 opacity-40" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" strokeLinecap="round" />
                </svg>
                <span className="text-[12px]">{debouncedQuery ? "Không tìm thấy thiết bị" : "Không có thiết bị"}</span>
              </div>
            ) : (
              <div className="space-y-4">
                {groupedEntries.ungroupedEntries.length > 0 && (
                  <div className="space-y-2!">
                    <div className="flex items-center gap-2 px-1! mt-3! mb-2!">
                      <div className="w-1.5 h-1.5 rounded-full bg-apple-primary" />
                      <h3 className="text-[18px] font-bold text-gray-200">{ungroupedTitle}</h3>
                      <span className="text-[12px] text-gray-400">{groupedEntries.ungroupedEntries.length} models</span>
                    </div>
                    <motion.div
                      className="grid gap-2"
                      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(285px, 1fr))" }}
                      initial="hidden"
                      animate="show"
                      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.035, delayChildren: 0.02 } } }}
                    >
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
                    </motion.div>
                  </div>
                )}

                {groupedEntries.selectedGroups.map(group => (
                  <div key={group.name} className="space-y-2!">
                    <div className="flex items-center gap-2 px-1! mt-2.5!">
                      <div className="w-1.5 h-1.5 rounded-full bg-apple-primary" />
                      <h3 className="text-[16px] font-semibold text-gray-200">{group.name}</h3>
                      <span className="text-[12px] text-gray-400">{group.entries.length} models</span>
                    </div>
                    <motion.div
                      className="grid gap-2"
                      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(285px, 1fr))" }}
                      initial="hidden"
                      animate="show"
                      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.035, delayChildren: 0.02 } } }}
                    >
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
                    </motion.div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Panel open/close animation — stable key so switching cards doesn't remount */}
        <AnimatePresence mode="wait">
          {selectedEntry && (
            <>
              <Resizer
                key="resizer"
                onResize={handleResize}
                onDragStart={() => { isResizingRef.current = true; setIsResizing(true); }}
                onDragEnd={() => { isResizingRef.current = false; setIsResizing(false); }}
              />
              <motion.div
                key="detail-panel"
                className="flex-1 min-w-0 border-l border-white/6 bg-apple-tile-1 overflow-hidden"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0, transition: { duration: 0.22, ease: [0.2, 0, 0, 1] } }}
                exit={{ opacity: 0, x: 20, transition: { duration: 0.15, ease: [0.4, 0, 1, 1] } }}
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
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

    </div>
  );
}
