# LAN Share — High-Performance P2P File Sharing

Multi-source, chunked, resume-capable file sharing for local networks.
Zero relay — coordinator is control-plane only, all file data flows peer-to-peer.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  COORDINATOR (one machine)            PORT: 8700         │
│  - Peer registry (nodeId, IP, port, storageType, load)   │
│  - File location index (fileId → [peer list])            │
│  - Heartbeat monitor (30s TTL, auto-sweep dead peers)    │
│  - NEVER relays file data                                │
└─────────────────────────────────────────────────────────┘
         │  /register  │  /heartbeat  │  /files/:id
         ▼             ▼              ▼
┌────────────┐  ┌────────────┐  ┌────────────┐
│  PEER A    │  │  PEER B    │  │  PEER C    │
│  SSD       │  │  SSD       │  │  HDD       │
│  port 8800 │  │  port 8800 │  │  port 8800 │
└────────────┘  └────────────┘  └────────────┘
      │                │               │
      └────────────────┴───────────────┘
              Direct HTTP (no relay)
              Range requests, streaming
              Multi-source chunk download
```

## Capacity Rules

| Storage | Base Slots |
|---------|-----------|
| SSD     | 4         |
| HDD     | 2         |

**Dynamic capacity** = base − activeUploads − activeDownloads  
**Priority rule**: If activeDownloads > 0 → reject upload requests (downloads first)

## Download Flow

```
Client                 Coordinator              Peers
  │                        │                     │
  ├─ GET /files/:fileId ──▶│                     │
  │◀─ [{ip, port, load}] ──┤                     │
  │                        │                     │
  ├─ GET /can-serve ────────────────────────────▶│  (probe all candidates)
  │◀─ ACCEPT/BUSY ──────────────────────────────┤
  │                        │                     │
  ├── Build chunk plan (distribute byte ranges) ─┤
  │                        │                     │
  ├─ GET /file/:id [Range: bytes=0-32MB] ───────▶│ chunk 1 from Peer A
  ├─ GET /file/:id [Range: bytes=32-64MB] ──────▶│ chunk 2 from Peer B  (parallel)
  ├─ GET /file/:id [Range: bytes=64-96MB] ──────▶│ chunk 3 from Peer A
  │      ◀────── stream ──────────────────────── │
  │      direct offset write to file (fd.write)  │
```

## Project Structure

```
lan-share/
├── coordinator/
│   └── server.ts          # Express coordinator — registry + file lookup
├── peer/
│   ├── node.ts            # PeerNode — registration, heartbeat, file scan
│   ├── file-server.ts     # Express file server — streaming, range requests
│   └── downloader.ts      # Multi-source chunked downloader
├── shared/
│   ├── types.ts           # Shared TypeScript types
│   └── utils.ts           # Capacity calc, node ranking, chunk plan, port utils
├── client-example/
│   └── index.ts           # Full example: peer + download flow
├── package.json
└── tsconfig.json
```

## Quick Start

```bash
npm install

# Machine 1: Start coordinator
npm run coordinator

# Machine 2+: Start peer nodes (set COORDINATOR_URL env var)
COORDINATOR_URL=http://192.168.1.10:8700 \
SHARE_DIR=/path/to/files \
npm run peer

# Download a file (get fileId from /peers or /files/:fileId)
COORDINATOR_URL=http://192.168.1.10:8700 \
npm run download -- <fileId>
```

## API Reference

### Coordinator

| Method | Path | Description |
|--------|------|-------------|
| POST | `/register` | Register a new peer |
| POST | `/heartbeat` | Update peer load + keepalive |
| GET | `/files/:fileId` | Get peers hosting a file |
| GET | `/peers` | List all live peers |
| GET | `/health` | Coordinator health check |

### Peer

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Peer health + capacity info |
| GET | `/can-serve` | Returns ACCEPT/BUSY + score |
| GET | `/file/:fileId` | Stream file, supports Range header |

## Key Design Decisions

**File IDs** are computed as SHA-256 of `name + size + first 64KB`. This is fast (no full hash for large files) while still uniquely identifying files across peers.

**Sequential reads** — `fs.createReadStream` with a 256 KB highWaterMark keeps reads sequential and buffer-friendly, optimal for both SSD (throughput) and HDD (avoid head seeks).

**Back-pressure** — stream piping uses Node's built-in back-pressure. The downloader pauses reads while the write buffer flushes, preventing memory blow-up on 10 GB+ files.

**Port conflict handling** — `findFreePort()` scans a range of ports and binds to the first available one. Both coordinator and peers use this.

**Coordinator re-registration** — if the coordinator restarts, peers detect 404 on heartbeat and automatically re-register.

**Chunk retry on alternate peer** — if a chunk download fails, the downloader picks a different peer from the ranked list and retries that byte range.
