/**
 * cap-sync.cjs
 * 1. Loads signing credentials from .env.local (gitignored)
 * 2. Validates credentials exist BEFORE spending time building
 * 3. Swaps index.html to the Capacitor build for cap sync
 * 4. Runs `npx cap sync android`
 * 5. Restores index.html to the web app
 * 6. Builds a signed release APK via Gradle (assembleRelease)
 *    Output: android/app/build/outputs/apk/release/pos-pro.apk
 */

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT       = path.join(__dirname, '..');
const dist       = path.join(ROOT, 'dist', 'client');
const appHtml    = path.join(dist, 'index.capacitor.html');
const indexHtml  = path.join(dist, 'index.html');
const webHtml    = path.join(ROOT, 'dist', 'web', 'index.html');
const androidDir = path.join(ROOT, 'android');

// ── Step 1: Load signing credentials from .env.local ─────────────────────────
// Create .env.local in the project root (already gitignored via *.local) with:
//   KEYSTORE_PASSWORD=your-keystore-password
//   KEY_ALIAS=your-key-alias
//   KEY_PASSWORD=your-key-password
const envLocalPath = path.join(ROOT, '.env.local');
if (fs.existsSync(envLocalPath)) {
  const lines = fs.readFileSync(envLocalPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    // .env.local always wins — Windows User env vars otherwise shadow it
    // and Gradle signs with the wrong password.
    if (key) {
      process.env[key] = val;
    }
  }
  console.log('✓ Loaded signing credentials from .env.local');
} else {
  console.warn('⚠  .env.local not found — will use existing environment variables');
  console.warn('   To auto-load credentials, create .env.local in the project root:');
  console.warn('     KEYSTORE_PASSWORD=your-keystore-password');
  console.warn('     KEY_ALIAS=your-key-alias');
  console.warn('     KEY_PASSWORD=your-key-password\n');
}

// ── Step 2: Validate credentials BEFORE building ─────────────────────────────
const missing = ['KEYSTORE_PASSWORD', 'KEY_ALIAS', 'KEY_PASSWORD'].filter(
  (k) => !process.env[k]
);
if (missing.length > 0) {
  console.error(`\n✗ Cannot build APK — missing signing credentials: ${missing.join(', ')}`);
  console.error('  Set them in .env.local or as environment variables before running cap:sync.\n');
  process.exit(1);
}
console.log('✓ Signing credentials found');

// ── Restore index.html to web app (runs on every exit) ───────────────────────
function restore() {
  try {
    if (fs.existsSync(webHtml)) {
      fs.copyFileSync(webHtml, indexHtml);
      console.log('✓ Restored index.html to web app');
    } else if (fs.existsSync(appHtml)) {
      fs.copyFileSync(appHtml, indexHtml);
      console.log('✓ Restored index.html (capacitor fallback)');
    }
  } catch (e) {
    console.error('✗ Failed to restore index.html:', e.message);
  }
}

process.on('exit', restore);
process.on('SIGINT',  () => process.exit(1));
process.on('SIGTERM', () => process.exit(1));
process.on('uncaughtException', (e) => { console.error(e); process.exit(1); });

// ── Step 3: Validate build output exists ─────────────────────────────────────
if (!fs.existsSync(appHtml)) {
  console.error('✗ index.capacitor.html not found — run build:android first');
  process.exit(1);
}

// ── Step 4: Cap sync ──────────────────────────────────────────────────────────
fs.copyFileSync(appHtml, indexHtml);
console.log('✓ Swapped in index.capacitor.html for cap sync');
execSync('npx cap sync android', { stdio: 'inherit' });
// restore() fires automatically via process.on('exit')

// ── Step 5: Gradle release APK build ─────────────────────────────────────────
console.log('\n📦  Building release APK (assembleRelease)…\n');

const gradlew = process.platform === 'win32'
  ? path.join(androidDir, 'gradlew.bat')
  : path.join(androidDir, 'gradlew');

if (!fs.existsSync(gradlew)) {
  console.error('✗ gradlew not found in android/ — is the Android project initialised?');
  process.exit(1);
}

try {
  execSync(`"${gradlew}" assembleRelease --no-daemon`, {
    cwd: androidDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      KEYSTORE_PASSWORD: process.env.KEYSTORE_PASSWORD,
      KEY_ALIAS:         process.env.KEY_ALIAS,
      KEY_PASSWORD:      process.env.KEY_PASSWORD,
    },
  });
} catch {
  console.error('\n✗ Gradle build failed. Check the output above.');
  process.exit(1);
}

// ── Step 6: Rename APK ───────────────────────────────────────────────────────
const apkDir = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release');
const apkFiles = fs.existsSync(apkDir)
  ? fs.readdirSync(apkDir).filter((f) => f.endsWith('.apk'))
  : [];

if (apkFiles.length === 0) {
  console.error('✗ No APK found in', apkDir);
  process.exit(1);
}

const apkSrc  = path.join(apkDir, apkFiles[0]);
const apkDest = path.join(apkDir, 'pos-pro.apk');
if (apkSrc !== apkDest) fs.renameSync(apkSrc, apkDest);

// ── Done ─────────────────────────────────────────────────────────────────────
let version = '';
try {
  const envContent = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  const m = envContent.match(/^VITE_APP_VERSION="([^"]+)"/m);
  if (m) version = ` v${m[1]}`;
} catch { /* ignore */ }

console.log(`\n✅  APK ready${version}`);
console.log(`   ${apkDest}`);
