import { parentPort, workerData } from "worker_threads"; import { IPSWDownloader } from "./downloader";
import type { MainToWorker, WorkerToMain } from "./worker-messages";

if (!parentPort) throw new Error("downloader-worker must run as a worker_threads Worker");

// ─── Boot ─────────────────────────────────────────────────────────────────────

// workerData is set by the main thread when spawning the Worker
const { stateDir, config } = workerData as { stateDir: string; config: any };
const dl = new IPSWDownloader(stateDir, config);

// ─── Relay downloader events → main thread ───────────────────────────────────

function relay(channel: WorkerToMain & { type: "event" }): void {
  parentPort!.postMessage(channel);
}

dl.on("started", (taskId, task) => relay({ type: "event", channel: "started", taskId, task }))
dl.on("progress", (taskId, task) => relay({ type: "event", channel: "progress", taskId, task }));
dl.on("completed", (taskId, task) => relay({ type: "event", channel: "completed", taskId, task }));
dl.on("error", (taskId, error, task) => relay({ type: "event", channel: "error", taskId, error, task }));
dl.on("paused", (taskId, task) => relay({ type: "event", channel: "paused", taskId, task }));
dl.on("resumed", (taskId, task) => relay({ type: "event", channel: "resumed", taskId, task }));
dl.on("added", (taskId, task) => relay({ type: "event", channel: "added", taskId, task }));
dl.on("cancelled", (taskId) => relay({ type: "event", channel: "cancelled", taskId }));
dl.on("incomplete_deleted", (taskId) => relay({ type: "event", channel: "incomplete_deleted", taskId }));

// ─── Handle commands from main thread ────────────────────────────────────────

function reply(reqId: string, result: any, error?: string): void {
  const msg: WorkerToMain = { type: "reply", reqId, result, error };
  parentPort!.postMessage(msg);
}

parentPort.on("message", async (msg: MainToWorker) => {
  switch (msg.type) {
    case "init":
      // Already initialised above via workerData; ignore duplicate inits.
      break;

    case "add": {
      const result = await dl.add(msg.firmware, msg.config).catch(e => ({ success: false, error: e.message }));
      reply(msg.reqId, result);
      break;
    }

    case "pause":
      dl.pause(msg.id);
      break;

    case "resume":
      dl.resume(msg.id);
      break;

    case "cancel":
      dl.cancel(msg.id);
      break;

    case "getAllTask":
      reply(msg.reqId, dl.getAllTask());
      break;

    case "getIncompleteTasks":
      reply(msg.reqId, dl.getIncompleteTasks());
      break;

    case "resumeIncomplete":
      reply(msg.reqId, dl.resumeIncomplete(msg.id));
      break;

    case "deleteIncomplete":
      reply(msg.reqId, dl.deleteIncomplete(msg.id));
      break;

    case "getEnvironmentInfo":
      reply(msg.reqId, await dl.getEnvironmentInfo(msg.savePath));
      break;

    default:
      console.warn("[downloader-worker] unknown message:", (msg as any).type);
  }
});
