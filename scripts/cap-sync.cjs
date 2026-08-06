/**
 * cap-sync.cjs
 *
 * 1. Copies all static public files (manifest.json, sw.js, download.html,
 *    version.json, _headers, _redirects, logo.*) into dist/client so
 *    Capacitor picks them all up during sync.
 * 2. Swaps index.html to the Capacitor app HTML for cap sync.
 * 3. Runs `npx cap sync android`.
 * 4. ALWAYS restores index.html to the download page afterwards.
 */

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const root       = path.join(__dirname, '..');
const dist       = path.join(root, 'dist', 'client');
const publicDir  = path.join(root, 'public');
const appHtml    = path.join(dist, 'index.capacitor.html');
const indexHtml  = path.join(dist, 'index.html');
const downloadSrc = path.join(publicDir, 'download.html');

// ── Restore: always put download page back as index.html ─────────────────────
function restore() {
  try {
    if (fs.existsSync(downloadSrc)) {
      fs.copyFileSync(downloadSrc, indexHtml);
      console.log('✓ Restored index.html → download page');
    }
  } catch (e) {
    console.error('✗ Failed to restore index.html:', e.message);
  }
}

process.on('exit',              restore);
process.on('SIGINT',            () => process.exit(1));
process.on('SIGTERM',           () => process.exit(1));
process.on('uncaughtException', (e) => { console.error(e); process.exit(1); });

// ── Validate ──────────────────────────────────────────────────────────────────
if (!fs.existsSync(appHtml)) {
  console.error('✗ dist/client/index.capacitor.html not found — run npm run build:android first');
  process.exit(1);
}
if (!fs.existsSync(downloadSrc)) {
  console.error('✗ public/download.html not found');
  process.exit(1);
}

// ── Copy all static public files into dist/client ────────────────────────────
// These are files that should live alongside the app JS in the APK assets
// and also be served by Cloudflare when the download page deploys.

const staticFiles = [
  'manifest.json',
  'version.json',
  'sw.js',
  '_headers',
  '_redirects',
  'download.html',
  'logo.png',
  'logo.svg',
  'logo-preview.html',
  'cordova.js',
  'cordova_plugins.js',
];

for (const file of staticFiles) {
  const src  = path.join(publicDir, file);
  const dest = path.join(dist, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`✓ Copied public/${file} → dist/client/${file}`);
  }
}

// Copy public/assets folder (screenshots, etc.) into dist/client/assets
const publicAssets = path.join(publicDir, 'assets');
const distAssets   = path.join(dist, 'assets');
if (fs.existsSync(publicAssets)) {
  fs.cpSync(publicAssets, distAssets, { recursive: true });
  console.log('✓ Merged public/assets → dist/client/assets');
}

// Write _redirects so Cloudflare routes everything to index.html
fs.writeFileSync(
  path.join(dist, '_redirects'),
  `/flyer /flyer.html 200\n/* /index.html 200\n`
);
console.log('✓ Wrote _redirects');

// ── Swap in the Capacitor app HTML ────────────────────────────────────────────
fs.copyFileSync(appHtml, indexHtml);
console.log('✓ Swapped index.html → Capacitor app (for cap sync)');

// ── Run cap sync — restore() fires automatically on process exit ──────────────
execSync('npx cap sync android', { stdio: 'inherit' });
