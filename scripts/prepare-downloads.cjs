/**
 * Copies the built Windows installer and Android APK into public-web/downloads
 * so the web build (publicDir: public-web) ships them at /downloads/.
 *
 * Must run AFTER gradle assembleRelease and electron-builder, and BEFORE build:web.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOWNLOADS_DIR = path.join(ROOT, 'public-web', 'downloads');
const ELECTRON_DIST = path.join(ROOT, 'dist', 'electron-installer');
const ANDROID_DIST = path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'release');

function readAppVersion() {
  try {
    const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const m = env.match(/^VITE_APP_VERSION="([^"]+)"/m);
    if (m) return m[1];
  } catch { /* fall through */ }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return pkg.version || '1.0.0';
}

function findFile(dir, ext, nameIncludes) {
  if (!fs.existsSync(dir)) return null;
  const name = fs.readdirSync(dir).find((f) => {
    if (!f.toLowerCase().endsWith(ext)) return false;
    if (nameIncludes && !f.toLowerCase().includes(nameIncludes)) return false;
    if (f.includes('.__uninstaller')) return false;
    return true;
  });
  return name ? path.join(dir, name) : null;
}

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

const version = readAppVersion();
console.log(`\n📦 Preparing downloads for version ${version}\n`);

const exeSrc = findFile(ELECTRON_DIST, '.exe', 'setup');
if (!exeSrc) {
  console.error('✗ No Windows .exe in dist/electron-installer');
  console.error('  electron:build:win must succeed before prepare:downloads');
  process.exit(1);
}

const apkSrc = findFile(ANDROID_DIST, '.apk');
if (!apkSrc) {
  console.error('✗ No Android .apk in android/app/build/outputs/apk/release');
  console.error('  Gradle assembleRelease must succeed before prepare:downloads');
  process.exit(1);
}

const PAGES_MAX_MB = 24;
const exeMbNum = fs.statSync(exeSrc).size / (1024 * 1024);
const exeVersioned = path.join(DOWNLOADS_DIR, `POS-Pro-Setup-${version}.exe`);
const exeStable = path.join(DOWNLOADS_DIR, 'POS-Pro-Setup.exe');
const githubExe = `https://github.com/murrentronics/pos-pro/releases/download/v${version}/POS-Pro-Setup-${version}.exe`;
if (exeMbNum <= PAGES_MAX_MB) {
  fs.copyFileSync(exeSrc, exeVersioned);
  fs.copyFileSync(exeSrc, exeStable);
} else {
  // Never ship a truncated Pages copy — Windows then says the file is corrupted.
  for (const stale of [exeVersioned, exeStable]) {
    try { fs.rmSync(stale, { force: true }); } catch { /* ignore */ }
  }
  console.log(`⚠ Windows installer is ${exeMbNum.toFixed(1)} MB — too large for Cloudflare Pages (25 MB).`);
  console.log(`  Upload these two files to the pos-pro GitHub release:`);
  console.log(`    ${exeSrc}`);
  console.log(`    ${apkSrc}`);
}

const apkVersioned = path.join(DOWNLOADS_DIR, `pos-pro-${version}.apk`);
const apkStable = path.join(DOWNLOADS_DIR, 'pos-pro.apk');
fs.copyFileSync(apkSrc, apkVersioned);
fs.copyFileSync(apkSrc, apkStable);

fs.writeFileSync(
  path.join(DOWNLOADS_DIR, 'version.json'),
  JSON.stringify({
    exe: version,
    apk: version,
    exeUrl: githubExe,
    exeLatestUrl: githubExe,
  }, null, 2)
);

const apkMb = (fs.statSync(apkStable).size / (1024 * 1024)).toFixed(1);
if (exeMbNum <= PAGES_MAX_MB) {
  console.log(`✓ Windows installer  ${exeMbNum.toFixed(1)} MB  → /downloads/POS-Pro-Setup.exe`);
}
console.log(`✓ Android APK        ${apkMb} MB  → /downloads/pos-pro.apk`);
console.log(`✓ Windows download   ${githubExe}`);
console.log('\n✅ Downloads ready for the web build\n');
