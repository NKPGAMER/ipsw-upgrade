// ─── Shared types for LAN file sharing system ────────────────────────────────

export type StorageType = "SSD" | "HDD";

export interface PeerInfo {
  nodeId: string;
  ip: string;
  port: number;
  storageType: StorageType;
  activeUploads: number;
  activeDownloads: number;
  lastSeen: number; // epoch ms
}

export interface FileEntry {
  fileId: string;   // sha256 of content, or user-provided ID
  name: string;
  size: number;     // bytes
  path: string;     // local absolute path on the peer
}

export interface PeerRegistration {
  nodeId: string;
  ip: string;
  port: number;
  storageType: StorageType;
  files: Omit<FileEntry, "path">[];  // don't expose local paths to coordinator
}

export interface HeartbeatPayload {
  nodeId: string;
  activeUploads: number;
  activeDownloads: number;
  files?: Omit<FileEntry, "path">[];  // optional file list update
}

export interface FileLocation {
  nodeId: string;
  ip: string;
  port: number;
  storageType: StorageType;
  activeUploads: number;
  activeDownloads: number;
}

export interface CanServeResponse {
  status: "ACCEPT" | "BUSY";
  reason?: string;
  score: number;  // higher = better candidate (0–100)
  activeDownloads: number;
  activeUploads: number;
}

export interface ChunkPlan {
  index: number;   // maps to ChunkState.index for download state persistence
  nodeId: string;
  ip: string;
  port: number;
  rangeStart: number;
  rangeEnd: number;
}
