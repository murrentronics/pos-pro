/**
 * Windows: electron-builder extracts nsis-resources into a .tmp folder then
 * renames it. Defender locks the plugin DLLs, rename throws EPERM, and you
 * get a leftover .nsis.7z instead of Setup.exe.
 *
 * This wrapper extracts with 7za straight into the destination (no rename),
 * marks the cache complete, then runs electron-builder with
 * ELECTRON_BUILDER_NSIS_RESOURCES_DIR so that extract is skipped.
 */
const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const ARCHIVE_NAME = "nsis-resources-3.4.1.7z";
const ARCHIVE_SHA256 = "593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103";
const ARCHIVE_URL =
  "https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-resources-3.4.1/nsis-resources-3.4.1.7z";

function localAppData() {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
}

function nsisCacheDir() {
  return path.join(localAppData(), "electron-builder", "Cache", "nsis-resources-3.4.1");
}

function stableResourcesDir() {
  return path.join(localAppData(), "pos-pro", "nsis-resources");
}

function pluginsReady(dir) {
  const plugins = path.join(dir, "plugins");
  if (!fs.existsSync(plugins) || !fs.statSync(plugins).isDirectory()) return false;
  const files = [];
  const stack = [plugins];
  while (stack.length) {
    const cur = stack.pop();
    for (const name of fs.readdirSync(cur)) {
      const p = path.join(cur, name);
      if (fs.statSync(p).isDirectory()) stack.push(p);
      else files.push(p);
    }
  }
  return files.length > 0;
}

function countFiles(dir) {
  let fileCount = 0;
  let extractedSize = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else {
        fileCount++;
        try {
          extractedSize += fs.statSync(full).size;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return { fileCount, extractedSize };
}

function writeCompleteState(extractDir) {
  const { fileCount, extractedSize } = countFiles(extractDir);
  const state = {
    version: 1,
    state: "complete",
    timestamp: Date.now(),
    fileCount,
    extractedSize,
  };
  fs.writeFileSync(`${extractDir}.state`, JSON.stringify(state, null, 2), "utf8");
}

function findFile(root, name) {
  if (!fs.existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(cur, entry);
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(full);
      else if (entry.toLowerCase() === name.toLowerCase()) return full;
    }
  }
  return null;
}

function find7za() {
  const fromEnv = process.env.ELECTRON_BUILDER_7ZIP_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const cache = path.join(localAppData(), "electron-builder", "Cache", "7zip@1.0.0");
  return findFile(cache, process.platform === "win32" ? "7za.exe" : "7za");
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const tmp = `${dest}.download`;
    const get = (u, hops) => {
      if (hops > 8) return reject(new Error(`too many redirects: ${u}`));
      const lib = u.startsWith("https:") ? https : http;
      const req = lib.get(u, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return get(new URL(res.headers.location, u).href, hops + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`download failed ${res.statusCode}: ${u}`));
        }
        const out = fs.createWriteStream(tmp);
        res.pipe(out);
        out.on("finish", () => {
          out.close(() => {
            fs.renameSync(tmp, dest);
            resolve(dest);
          });
        });
        out.on("error", reject);
      });
      req.on("error", reject);
    };
    get(url, 0);
  });
}

async function ensureArchive() {
  const cache = nsisCacheDir();
  fs.mkdirSync(cache, { recursive: true });
  const archive = path.join(cache, ARCHIVE_NAME);
  if (fs.existsSync(archive) && sha256File(archive) === ARCHIVE_SHA256) return archive;
  console.log("  downloading NSIS resources archive");
  await download(ARCHIVE_URL, archive);
  const hash = sha256File(archive);
  if (hash !== ARCHIVE_SHA256) {
    fs.rmSync(archive, { force: true });
    throw new Error(`NSIS resources checksum mismatch: ${hash}`);
  }
  return archive;
}

function extractWith7za(archive, dest) {
  const seven = find7za();
  if (!seven) return false;
  fs.mkdirSync(dest, { recursive: true });
  const result = spawnSync(seven, ["x", "-bd", archive, `-o${dest}`, "-y"], {
    stdio: "inherit",
    windowsHide: true,
  });
  return result.status === 0 && pluginsReady(dest);
}

function copyTree(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, force: true });
}

function hashedExtractDirs() {
  const cache = nsisCacheDir();
  if (!fs.existsSync(cache)) return [];
  const names = new Set();
  for (const name of fs.readdirSync(cache)) {
    const match = name.match(/^(nsis-resources-3\.4\.1-[^.]+)(\.tmp|\.state)?$/);
    if (match) names.add(match[1]);
  }
  return [...names].map((name) => path.join(cache, name));
}

async function ensureNsisResources() {
  if (process.platform !== "win32") return null;

  const dest = stableResourcesDir();
  const cache = nsisCacheDir();
  const tmpCandidates = hashedExtractDirs().map((d) => `${d}.tmp`).filter((d) => pluginsReady(d));

  if (!pluginsReady(dest)) {
    console.log("  preparing NSIS resources (skip Windows extract-rename)");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.rmSync(dest, { recursive: true, force: true });

    let ok = false;
    if (tmpCandidates.length) {
      try {
        copyTree(tmpCandidates[0], dest);
        ok = pluginsReady(dest);
      } catch (err) {
        console.log(`  copy of extracted cache failed: ${err.message}`);
      }
    }
    if (!ok) {
      const archive = await ensureArchive();
      ok = extractWith7za(archive, dest);
    }
    if (!ok) {
      throw new Error(
        "Could not prepare NSIS resources. Close File Explorer windows on dist\\electron-installer and retry."
      );
    }
  }

  for (const extractDir of hashedExtractDirs()) {
    try {
      if (!pluginsReady(extractDir)) {
        fs.rmSync(extractDir, { recursive: true, force: true });
        copyTree(dest, extractDir);
      }
      writeCompleteState(extractDir);
      fs.rmSync(`${extractDir}.tmp`, { recursive: true, force: true });
    } catch (err) {
      console.log(`  cache finalize skipped for ${path.basename(extractDir)}: ${err.message}`);
    }
  }

  if (!hashedExtractDirs().length) {
    fs.mkdirSync(cache, { recursive: true });
  }

  return dest;
}

function runBuilder(resourcesDir) {
  const args = process.argv.slice(2);
  if (resourcesDir) {
    process.env.ELECTRON_BUILDER_NSIS_RESOURCES_DIR = resourcesDir;
  }
  const cli = require.resolve("electron-builder/cli.js");
  const result = spawnSync(process.execPath, [cli, ...args], {
    stdio: "inherit",
    cwd: ROOT,
    env: process.env,
  });
  const code = result.status == null ? 1 : result.status;
  if (code === 0) {
    const outDir = path.join(ROOT, "dist", "electron-installer");
    if (fs.existsSync(outDir)) {
      for (const name of fs.readdirSync(outDir)) {
        if (name.endsWith(".nsis.7z")) {
          fs.rmSync(path.join(outDir, name), { force: true });
        }
      }
    }
  }
  process.exit(code);
}

ensureNsisResources()
  .then(runBuilder)
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
