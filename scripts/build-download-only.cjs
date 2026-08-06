const fs = require('fs');
const path = require('path');

// Create dist/client directory
const distDir = path.join(__dirname, '..', 'dist', 'client');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy download.html as index.html
const downloadSrc = path.join(__dirname, '..', 'public', 'download.html');
const indexDest = path.join(distDir, 'index.html');

if (fs.existsSync(downloadSrc)) {
  fs.copyFileSync(downloadSrc, indexDest);
  console.log('✓ Copied download.html as index.html');
} else {
  console.error('✗ download.html not found in public/');
  process.exit(1);
}

// Copy flyer.html so /flyer route works
const flyerSrc = path.join(__dirname, '..', 'public', 'flyer.html');
const flyerDest = path.join(distDir, 'flyer.html');
if (fs.existsSync(flyerSrc)) {
  fs.copyFileSync(flyerSrc, flyerDest);
  console.log('✓ Copied flyer.html');
}

// Copy assets folder if it exists
const assetsSrc = path.join(__dirname, '..', 'public', 'assets');
const assetsDest = path.join(distDir, 'assets');

if (fs.existsSync(assetsSrc)) {
  fs.cpSync(assetsSrc, assetsDest, { recursive: true });
  console.log('✓ Copied assets folder');
}

// Copy manifest.json
const manifestSrc = path.join(__dirname, '..', 'public', 'manifest.json');
const manifestDest = path.join(distDir, 'manifest.json');
if (fs.existsSync(manifestSrc)) {
  fs.copyFileSync(manifestSrc, manifestDest);
  console.log('✓ Copied manifest.json');
}

// Copy version.json — used by the in-app updater to detect new APK releases
const versionSrc = path.join(__dirname, '..', 'public', 'version.json');
const versionDest = path.join(distDir, 'version.json');
if (fs.existsSync(versionSrc)) {
  fs.copyFileSync(versionSrc, versionDest);
  console.log('✓ Copied version.json');
}
fs.writeFileSync(
  path.join(distDir, '_redirects'),
  `/flyer /flyer.html 200\n/* /index.html 200\n`
);

console.log('✓ Build complete');
