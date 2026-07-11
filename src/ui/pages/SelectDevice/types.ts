import type { Task, TaskStatus } from "@/bind";

export type CardTask = TaskStatus | "none" | "downloaded" | "old" | "corrupted" | "incomplete_dl";

export interface DeviceEntry {
  device: Device;
  firmwares: Firmware[] | null | undefined;
  task?: Task;
}

export interface DeviceGroup {
  name: string;
  ids: string[];
}

export type ControlAction =
  | "download" | "pause" | "resume" | "cancel"
  | "delete" | "verify" | "cancel_verify" | "redownload" | "update"
  | "resume_incomplete" | "delete_incomplete";

export interface VerifyState {
  phase: "verifying";
  progress: { pct: number; speed: number; eta?: number };
}
