/**
 * Publishes the Windows installer and Android APK to the public
 * murrentronics/pos-pro GitHub release.
 *
 * Uploads versioned names and stable names so download buttons can use:
 *   .../releases/latest/download/POS-Pro-Setup.exe
 *
 * Auth (first match wins):
 *   1. GH_TOKEN / GITHUB_TOKEN from the environment or .env.local
 *   2. Git Credential Manager token for github.com
 *   3. GitHub CLI (`gh`) if it is installed and logged in
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const REPO = "murrentronics/pos-pro";
const API_HOST = "api.github.com";
const UPLOAD_HOST = "uploads.github.com";
const ELECTRON_DIST = path.join(ROOT, "dist", "electron-installer");
const ANDROID_DIST = path.join(ROOT, "android", "app", "build", "outputs", "apk", "release");
const DOWNLOADS_DIR = path.join(ROOT, "public-web", "downloads");
const UA = "pos-pro-release-publisher";

function loadEnvLocal() {
  const envLocalPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envLocalPath)) return;
  for (const line of fs.readFileSync(envLocalPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] == null) process.env[key] = val;
  }
}

function readAppVersion() {
  try {
    const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    const m = env.match(/^VITE_APP_VERSION="([^"]+)"/m);
    if (m) return m[1];
  } catch {
    /* fall through */
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  return pkg.version || "1.0.0";
}

function findFile(dir, ext, nameIncludes, preferName) {
  if (!fs.existsSync(dir)) return null;
  const matches = fs.readdirSync(dir).filter((f) => {
    if (!f.toLowerCase().endsWith(ext)) return false;
    if (nameIncludes && !f.toLowerCase().includes(nameIncludes)) return false;
    if (f.includes(".__uninstaller")) return false;
    return true;
  });
  if (!matches.length) return null;
  if (preferName) {
    const exact = matches.find((f) => f.toLowerCase() === preferName.toLowerCase());
    if (exact) return path.join(dir, exact);
  }
  matches.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
  return path.join(dir, matches[0]);
}

function commandExists(name) {
  const result = spawnSync(name, ["--version"], {
    encoding: "utf8",
    shell: true,
    windowsHide: true,
  });
  return result.status === 0;
}

function gh(args, inherit = true) {
  const result = spawnSync("gh", args, {
    cwd: ROOT,
    stdio: inherit ? "inherit" : "pipe",
    encoding: inherit ? undefined : "utf8",
    shell: true,
    windowsHide: true,
  });
  return {
    status: result.status == null ? 1 : result.status,
    stdout: inherit ? "" : (result.stdout || "").trim(),
  };
}

function gitHubTokenFromGit() {
  const result = spawnSync("git", ["credential", "fill"], {
    cwd: ROOT,
    encoding: "utf8",
    input: "protocol=https\nhost=github.com\n\n",
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  const match = (result.stdout || "").match(/^password=(.+)$/m);
  const token = match && match[1] ? match[1].trim() : "";
  return token || null;
}

function tokenFromEnv() {
  return process.env.GH_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_PAT || process.env.GH_RELEASE_TOKEN || "";
}

function requestJson(method, host, urlPath, token, body) {
  const payload = body == null ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        path: urlPath,
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": UA,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(payload
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = { message: text };
          }
          resolve({ status: res.statusCode || 0, json });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function uploadAsset(releaseId, filePath, token) {
  const name = path.basename(filePath);
  const size = fs.statSync(filePath).size;
  const encoded = encodeURIComponent(name);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: UPLOAD_HOST,
        path: `/repos/${REPO}/releases/${releaseId}/assets?name=${encoded}`,
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": UA,
          "Content-Type": "application/octet-stream",
          "Content-Length": size,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = { message: text };
          }
          resolve({ status: res.statusCode || 0, json });
        });
      }
    );
    req.on("error", reject);
    fs.createReadStream(filePath).pipe(req);
  });
}

function currentBranch() {
  const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  const branch = (result.stdout || "").trim();
  return result.status === 0 && branch && branch !== "HEAD" ? branch : "main";
}

async function ensureRelease(tag, token) {
  const existing = await requestJson("GET", API_HOST, `/repos/${REPO}/releases/tags/${tag}`, token);
  if (existing.status === 200 && existing.json && existing.json.id) return existing.json;
  const created = await requestJson("POST", API_HOST, `/repos/${REPO}/releases`, token, {
    tag_name: tag,
    target_commitish: currentBranch(),
    name: `P.O.S. Pro ${tag}`,
    body: `P.O.S. Pro ${tag}`,
    draft: false,
    prerelease: false,
  });
  if (created.status >= 200 && created.status < 300 && created.json && created.json.id) {
    return created.json;
  }
  throw new Error(created.json && created.json.message ? created.json.message : `Could not create ${tag}`);
}

async function publishWithToken(tag, files, token) {
  const release = await ensureRelease(tag, token);
  const existingAssets = Array.isArray(release.assets) ? release.assets : [];
  for (const filePath of files) {
    const name = path.basename(filePath);
    const prior = existingAssets.find((a) => a.name === name);
    if (prior) {
      const del = await requestJson("DELETE", API_HOST, `/repos/${REPO}/releases/assets/${prior.id}`, token);
      if (del.status !== 204) {
        throw new Error(`Could not replace ${name} on ${tag}`);
      }
    }
    const mb = (fs.statSync(filePath).size / (1024 * 1024)).toFixed(1);
    console.log(`  uploading ${name} (${mb} MB)`);
    const uploaded = await uploadAsset(release.id, filePath, token);
    if (uploaded.status < 200 || uploaded.status >= 300) {
      const msg = uploaded.json && uploaded.json.message ? uploaded.json.message : `HTTP ${uploaded.status}`;
      throw new Error(`Upload failed for ${name}: ${msg}`);
    }
  }
}

function printAuthHelp(ghMissing) {
  console.error("✗ Cannot publish the installer — GitHub auth is missing.");
  console.error("");
  if (ghMissing) {
    console.error("  GitHub CLI is not installed. In PowerShell run:");
    console.error("    winget install --id GitHub.cli");
    console.error("    gh auth login");
  } else {
    console.error("  GitHub CLI is installed but not logged in. Run:");
    console.error("    gh auth login");
  }
  console.error("");
  console.error("  Or create a GitHub token (repo scope) and add it to .env.local:");
  console.error("    GH_TOKEN=ghp_your_token");
}

async function main() {
  loadEnvLocal();

  const version = readAppVersion();
  const tag = `v${version}`;

  const exeSrc =
    findFile(ELECTRON_DIST, ".exe", "setup", `POS-Pro-Setup-${version}.exe`) ||
    findFile(DOWNLOADS_DIR, ".exe", "setup", `POS-Pro-Setup-${version}.exe`);
  const apkSrc =
    findFile(ANDROID_DIST, ".apk", null, "pos-pro.apk") ||
    findFile(ANDROID_DIST, ".apk") ||
    findFile(DOWNLOADS_DIR, ".apk", null, "pos-pro.apk");

  if (!exeSrc) {
    console.error("✗ No Windows .exe found. Run electron:build:win first.");
    process.exit(1);
  }
  if (!apkSrc) {
    console.error("✗ No Android .apk found. Run the Android release build first.");
    process.exit(1);
  }

  const staging = path.join(ROOT, "dist", "github-release");
  fs.mkdirSync(staging, { recursive: true });

  const files = [
    path.join(staging, `POS-Pro-Setup-${version}.exe`),
    path.join(staging, "POS-Pro-Setup.exe"),
    path.join(staging, `pos-pro-${version}.apk`),
    path.join(staging, "pos-pro.apk"),
  ];
  fs.copyFileSync(exeSrc, files[0]);
  fs.copyFileSync(exeSrc, files[1]);
  fs.copyFileSync(apkSrc, files[2]);
  fs.copyFileSync(apkSrc, files[3]);

  console.log(`\n📦 Publishing ${tag} to ${REPO}\n`);

  const token = tokenFromEnv() || gitHubTokenFromGit();
  if (token) {
    await publishWithToken(tag, files, token);
  } else if (commandExists("gh")) {
    const auth = gh(["auth", "status"], false);
    if (auth.status !== 0) {
      printAuthHelp(false);
      process.exit(1);
    }
    const existing = gh(["release", "view", tag, "--repo", REPO], false);
    if (existing.status !== 0) {
      const created = gh([
        "release",
        "create",
        tag,
        "--repo",
        REPO,
        "--target",
        currentBranch(),
        "--title",
        `P.O.S. Pro ${tag}`,
        "--notes",
        `P.O.S. Pro ${tag}`,
      ]);
      if (created.status !== 0) {
        console.error(`✗ Could not create GitHub release ${tag}`);
        process.exit(1);
      }
    }
    const uploaded = gh([
      "release",
      "upload",
      tag,
      ...files,
      "--repo",
      REPO,
      "--clobber",
    ]);
    if (uploaded.status !== 0) {
      console.error(`✗ Could not upload assets to ${tag}`);
      process.exit(1);
    }
  } else {
    printAuthHelp(true);
    process.exit(1);
  }

  console.log(`\n✅ GitHub release ${tag} updated`);
  console.log(`   https://github.com/${REPO}/releases/latest/download/POS-Pro-Setup.exe\n`);
}

main().catch((err) => {
  console.error(`✗ ${err.message || err}`);
  process.exit(1);
});
