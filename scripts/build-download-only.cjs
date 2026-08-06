/**
 * build-download-only.cjs
 *
 * Cloudflare Pages build command: `npm run build`
 *
 * Produces dist/client/ with:
 *   index.html      ← the download/marketing page
 *   version.json    ← consumed by the in-app updater
 *   manifest.json   ← PWA manifest
 *   sw.js           ← service worker
 *   _redirects      ← Cloudflare routing rules
 *   _headers        ← security / cache headers
 *   assets/         ← screenshots and static assets
 *   logo.*          ← branding files
 *   download.html   ← kept as named page too
 */

const fs   = require('fs');
const path = require('path');

const root      = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const distDir   = path.join(root, 'dist', 'client');

// Ensure dist/client exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// ── Helper: copy a file if it exists ─────────────────────────────────────────
function copy(filename, destName) {
  const src  = path.join(publicDir, filename);
  const dest = path.join(distDir, destName || filename);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`✓ ${filename}${destName ? ' → ' + destName : ''}`);
  }
}

// ── Copy download.html as both index.html and download.html ──────────────────
const downloadSrc = path.join(publicDir, 'download.html');
if (!fs.existsSync(downloadSrc)) {
  console.error('✗ public/download.html not found');
  process.exit(1);
}
fs.copyFileSync(downloadSrc, path.join(distDir, 'index.html'));
console.log('✓ download.html → index.html');
fs.copyFileSync(downloadSrc, path.join(distDir, 'download.html'));
console.log('✓ download.html (named copy)');

// ── Copy all static files ─────────────────────────────────────────────────────
copy('version.json');      // in-app updater reads this
copy('manifest.json');     // PWA manifest
copy('sw.js');             // service worker
copy('_headers');          // Cloudflare cache/security headers
copy('logo.png');
copy('logo.svg');
copy('logo-preview.html');
copy('flyer.html');
copy('admin-launcher.html');

// ── Write _redirects ──────────────────────────────────────────────────────────
fs.writeFileSync(
  path.join(distDir, '_redirects'),
  `/flyer /flyer.html 200\n/admin /admin-launcher.html 200\n/* /index.html 200\n`
);
console.log('✓ _redirects written');

// ── Copy public/assets (screenshots, images) ──────────────────────────────────
const assetsSrc  = path.join(publicDir, 'assets');
const assetsDest = path.join(distDir, 'assets');
if (fs.existsSync(assetsSrc)) {
  fs.cpSync(assetsSrc, assetsDest, { recursive: true });
  console.log('✓ assets/');
}

console.log('\n✅  Download-page build complete → dist/client/');
