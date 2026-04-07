"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useDownloadTask = useDownloadTask;
const react_1 = require("react");
const ACTIVE = ["downloading", "queued", "verifying", "moving", "paused"];
function useDownloadTask(firmwareUrl) {
    const [task, setTask] = (0, react_1.useState)(null);
    const timerRef = (0, react_1.useRef)(null);
    (0, react_1.useEffect)(() => {
        let alive = true;
        const poll = async () => {
            if (!window.downloader || !alive)
                return;
            try {
                const all = await window.downloader.getAllTask();
                const match = all.find((t) => t.firmware?.url === firmwareUrl && ACTIVE.includes(t.status)) ?? null;
                if (alive)
                    setTask(match);
            }
            catch { /* ignore */ }
        };
        const cb = () => poll();
        window.downloader?.onProgress?.(cb);
        window.downloader?.onCompleted?.(cb);
        window.downloader?.onPaused?.(cb);
        window.downloader?.onResumed?.(cb);
        window.downloader?.onError?.(cb);
        window.downloader?.onCancelled?.(cb);
        window.downloader?.onAdded?.(cb);
        poll();
        timerRef.current = setInterval(poll, 1200);
        return () => {
            alive = false;
            if (timerRef.current)
                clearInterval(timerRef.current);
        };
    }, [firmwareUrl]);
    return task;
}
