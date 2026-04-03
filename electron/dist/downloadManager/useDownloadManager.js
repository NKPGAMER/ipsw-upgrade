"use strict";
/**
 * useDownloadManager.ts
 * React hook for renderer — place in your React component tree.
 *
 * Usage:
 *   const { tasks, add, pause, resume, cancel, pauseAll, resumeAll, updateQueue } = useDownloadManager();
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.useDownloadManager = useDownloadManager;
exports.formatSpeed = formatSpeed;
exports.formatETA = formatETA;
exports.formatSize = formatSize;
const react_1 = require("react");
function useDownloadManager() {
    const [tasks, setTasks] = (0, react_1.useState)(new Map());
    const [networkOnline, setNetworkOnline] = (0, react_1.useState)(true);
    const tasksRef = (0, react_1.useRef)(tasks);
    tasksRef.current = tasks;
    (0, react_1.useEffect)(() => {
        // Initial load
        window.downloadManager.getAll().then((all) => {
            const map = new Map();
            for (const t of all)
                map.set(t.id, t);
            setTasks(new Map(map));
        });
        // Subscribe to events
        const unsub = window.downloadManager.onEvent((event) => {
            if (event.id === "__global__") {
                if ("networkOnline" in event.payload) {
                    setNetworkOnline(!!event.payload.networkOnline);
                }
                return;
            }
            setTasks((prev) => {
                const next = new Map(prev);
                const existing = next.get(event.id);
                const updated = {
                    ...(existing ?? {}),
                    ...event.payload,
                    id: event.id,
                };
                // Attach merge progress if present
                if (event.type === "merge-progress" && event.payload.mergeProgress !== undefined) {
                    updated.mergeProgress = event.payload.mergeProgress;
                }
                next.set(event.id, updated);
                return next;
            });
        });
        return unsub;
    }, []);
    const add = (0, react_1.useCallback)((url, destPath, priority) => window.downloadManager.add(url, destPath, priority), []);
    const pause = (0, react_1.useCallback)((id) => window.downloadManager.pause(id), []);
    const resume = (0, react_1.useCallback)((id) => window.downloadManager.resume(id), []);
    const cancel = (0, react_1.useCallback)((id) => window.downloadManager.cancel(id), []);
    const pauseAll = (0, react_1.useCallback)(() => window.downloadManager.pauseAll(), []);
    const resumeAll = (0, react_1.useCallback)(() => window.downloadManager.resumeAll(), []);
    const updateQueue = (0, react_1.useCallback)((orderedIds) => window.downloadManager.updateQueue(orderedIds), []);
    /** Helpers for rendering */
    const taskList = Array.from(tasks.values()).sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
    const waitingTasks = taskList.filter((t) => t.state === "wait");
    const activeTasks = taskList.filter((t) => t.state === "downloading");
    const pausedTasks = taskList.filter((t) => t.state === "paused");
    const doneTasks = taskList.filter((t) => t.state === "done");
    const errorTasks = taskList.filter((t) => t.state === "error");
    return {
        tasks,
        taskList,
        waitingTasks,
        activeTasks,
        pausedTasks,
        doneTasks,
        errorTasks,
        networkOnline,
        add,
        pause,
        resume,
        cancel,
        pauseAll,
        resumeAll,
        updateQueue,
    };
}
/** Format bytes/s into human-readable speed string */
function formatSpeed(bps) {
    if (bps <= 0)
        return "0 B/s";
    if (bps < 1024)
        return `${bps} B/s`;
    if (bps < 1024 * 1024)
        return `${(bps / 1024).toFixed(1)} KB/s`;
    if (bps < 1024 * 1024 * 1024)
        return `${(bps / 1024 / 1024).toFixed(2)} MB/s`;
    return `${(bps / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
}
/** Format seconds into h:mm:ss or mm:ss */
function formatETA(seconds) {
    if (seconds <= 0 || !isFinite(seconds))
        return "--:--";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0)
        return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
/** Format bytes into human-readable size */
function formatSize(bytes) {
    if (bytes <= 0)
        return "0 B";
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
