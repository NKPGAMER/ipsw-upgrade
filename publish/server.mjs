// publish/server.mjs
// Internal release tool for IPSW Manager
// Run: node publish/server.mjs (from project root)

import http from "http";
import { WebSocketServer } from "ws";
import { spawn, exec } from "child_process";
import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const PORT = 4321;
const ROOT = path.resolve(__dirname, ".."); // project root
const PKG_PATH = path.join(ROOT, "package.json");

// ⚠️  Paste your GitHub PAT here (repo scope)
const GITHUB_TOKEN = "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";
const GITHUB_OWNER = "NKPGAMER";
const GITHUB_REPO = "ipsw-manager";
// ──────────────────────────────────────────────────────────────────────────────

/** Read package.json from project root */
function readPkg() {
  return JSON.parse(fs.readFileSync(PKG_PATH, "utf8"));
}

/** Write package.json preserving formatting */
function writePkg(data) {
  fs.writeFileSync(PKG_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/** Send a log line to all connected WS clients */
function broadcast(clients, type, text) {
  const msg = JSON.stringify({ type, text, ts: Date.now() });
  for (const c of clients) {
    if (c.readyState === 1) c.send(msg);
  }
}

/** Run a shell command, streaming stdout/stderr to WS clients */
function runCmd(clients, cmd, cwd) {
  return new Promise((resolve, reject) => {
    broadcast(clients, "cmd", `$ ${cmd}`);
    const proc = spawn(cmd, { shell: true, cwd });
    proc.stdout.on("data", (d) => broadcast(clients, "stdout", d.toString()));
    proc.stderr.on("data", (d) => broadcast(clients, "stderr", d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Exit code ${code}`));
    });
  });
}

/** GitHub API helper */
function githubRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "api.github.com",
      path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}${endpoint}`,
      method,
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        "User-Agent": "ipsw-manager-publish",
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(data
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(data),
            }
          : {}),
      },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

/** Upload a release asset via GitHub Upload API */
function uploadAsset(uploadUrl, filePath, clients) {
  return new Promise((resolve, reject) => {
    const name = path.basename(filePath);
    const fileData = fs.readFileSync(filePath);
    const size = fileData.length;

    // uploadUrl: https://uploads.github.com/repos/.../assets{?name,label}
    const base = uploadUrl.replace(/\{.*\}/, "");
    const parsed = new URL(`${base}?name=${encodeURIComponent(name)}`);

    broadcast(
      clients,
      "stdout",
      `Uploading asset: ${name} (${(size / 1024 / 1024).toFixed(2)} MB)`
    );

    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        "User-Agent": "ipsw-manager-publish",
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/octet-stream",
        "Content-Length": size,
      },
    };

    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        if (res.statusCode === 201) {
          broadcast(clients, "stdout", `✓ Uploaded: ${name}`);
          resolve();
        } else {
          reject(new Error(`Upload failed ${res.statusCode}: ${raw}`));
        }
      });
    });
    req.on("error", reject);
    req.write(fileData);
    req.end();
  });
}

/**
 * Find exactly the 3 release artifacts for the given name+version:
 *   {name}-{version}-setup.exe          ← matches artifactName = "${name}-${version}-setup.${ext}"
 *   {name}-{version}-setup.exe.blockmap
 *   latest.yml
 */
function findArtifacts(outputDir, pkgName, version) {
  if (!fs.existsSync(outputDir))
    throw new Error(`Thư mục output không tồn tại: ${outputDir}`);

  // electron-builder replaces spaces with hyphens in the artifact name
  const safeName = pkgName.replace(/\s+/g, "-");
  const stem = `${safeName}-${version}-setup`;

  const required = [
    `${stem}.exe`,
    `${stem}.exe.blockmap`,
    "latest.yml",
  ];

  const missing = required.filter(
    (f) => !fs.existsSync(path.join(outputDir, f))
  );

  if (missing.length > 0)
    throw new Error(
      `Không tìm thấy file sau trong ${outputDir}:\n${missing.map((f) => "  • " + f).join("\n")}`
    );

  return required.map((f) => path.join(outputDir, f));
}

// ─── MAIN PUBLISH FLOW ────────────────────────────────────────────────────────
async function runPublish(clients, { version, changelog, draft }) {
  const log = (type, text) => broadcast(clients, type, text);
  try {
    // Step 1 – bump version
    log("step", "📦 Bước 1: Cập nhật phiên bản...");
    const pkg = readPkg();
    const prevVersion = pkg.version;
    pkg.version = version;
    writePkg(pkg);
    log("stdout", `package.json: ${prevVersion} → ${version}`);

    // Step 2 – build
    log("step", "🔨 Bước 2: Build ứng dụng...");
    await runCmd(clients, "npm run dist", ROOT);

    // Step 3 – find artifacts
    log("step", "🔍 Bước 3: Tìm file build...");
    const outputDir = path.join(ROOT, pkg.build?.directories?.output ?? "release");
    // artifactName template uses ${name} = pkg.name (e.g. "ipsw-manager")
    const artifacts = findArtifacts(outputDir, pkg.name, version);
    log(
      "stdout",
      `Tìm thấy ${artifacts.length} file:\n${artifacts.map((f) => "  • " + path.basename(f)).join("\n")}`
    );

    // Step 4 – create GitHub release
    log("step", "🚀 Bước 4: Tạo GitHub Release...");
    const tagName = `v${version}`;

    // Delete existing release if present (re-run safety)
    const existing = await githubRequest("GET", `/releases/tags/${tagName}`);
    if (existing.status === 200) {
      log("stdout", `Release ${tagName} đã tồn tại, đang xóa...`);
      await githubRequest("DELETE", `/releases/${existing.body.id}`);
    }

    const releaseRes = await githubRequest("POST", "/releases", {
      tag_name: tagName,
      name: `IPSW Manager ${tagName}`,
      body: changelog,
      draft,
      prerelease: false,
    });

    if (releaseRes.status !== 201)
      throw new Error(
        `Tạo release thất bại (${releaseRes.status}): ${JSON.stringify(releaseRes.body)}`
      );

    const release = releaseRes.body;
    log("stdout", `✓ Release tạo thành công: ${release.html_url}`);

    // Step 5 – upload assets
    log("step", "📤 Bước 5: Upload artifacts...");
    for (const artifact of artifacts) {
      await uploadAsset(release.upload_url, artifact, clients);
    }

    log(
      "done",
      `✅ Hoàn tất! Release ${tagName} đã được ${draft ? "lưu nháp" : "phát hành"} trên GitHub.\n${release.html_url}`
    );
  } catch (err) {
    log("error", `❌ Lỗi: ${err.message}`);
    throw err;
  }
}

// ─── HTTP + WS SERVER ────────────────────────────────────────────────────────
const clients = new Set();

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://127.0.0.1`);

  if (req.method === "GET" && reqUrl.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(path.join(__dirname, "index.html")));
    return;
  }

  if (req.method === "GET" && reqUrl.pathname === "/api/version") {
    const pkg = readPkg();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ version: pkg.version }));
    return;
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/publish") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const payload = JSON.parse(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      runPublish(clients, payload).catch(() => {});
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
});

server.listen(PORT, "127.0.0.1", () => {
  const addr = `http://127.0.0.1:${PORT}`;
  console.log(`\n🚀 IPSW Manager Publisher đang chạy tại: ${addr}\n`);
  const opener =
    process.platform === "win32"
      ? `start ${addr}`
      : process.platform === "darwin"
        ? `open ${addr}`
        : `xdg-open ${addr}`;
  exec(opener);
});
