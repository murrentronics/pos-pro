/**
 * Electron Main Process
 * Provides native desktop capabilities for P.O.S. Pro
 * Handles USB printer/cash drawer communication
 */

const { app, BrowserWindow, BrowserView, ipcMain, nativeImage, protocol, net, session } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { spawn, execFile } = require('child_process');
const os = require('os');
const { pathToFileURL } = require('url');

let SerialPort = null;
try {
  SerialPort = require('serialport').SerialPort;
} catch (err) {
  console.error('[printer] serialport native module unavailable:', err?.message || err);
}

if (process.platform === 'win32') {
  app.setAppUserModelId('com.pospro.app');
}

// YouTube autoplay + embed cookies (Chromium 3PCD otherwise blanks the player).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch(
  'disable-features',
  'ThirdPartyStoragePartitioning,TrackingProtection3pcd',
);

// Keep app:// so we can copy login/settings off the previous EXE origin.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function appIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icon.png');
  }
  return path.join(__dirname, 'build', 'icon.png');
}

let mainWindow;
let desktopServer = null;
let desktopPort = 18765;
let persistCache = {};
let persistTimer = null;
let youtubeView = null;
let youtubeLoadedUrl = '';
let youtubeVisible = false;
let youtubeBounds = { x: 0, y: 0, width: 0, height: 0 };

function persistFile() {
  return path.join(app.getPath('userData'), 'bartap-persist.json');
}

function migratedFlagFile() {
  return path.join(app.getPath('userData'), 'migrated-https-localhost');
}

function loadPersist() {
  try {
    const parsed = JSON.parse(fs.readFileSync(persistFile(), 'utf8'));
    persistCache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    persistCache = {};
  }
}

function savePersistNow() {
  try {
    fs.writeFileSync(persistFile(), JSON.stringify(persistCache));
  } catch {
    /* ignore */
  }
}

function scheduleSavePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(savePersistNow, 200);
}

function mergePersist(obj) {
  if (!obj || typeof obj !== 'object') return;
  let changed = false;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== 'string' || persistCache[key] === value) continue;
    persistCache[key] = value;
    changed = true;
  }
  if (changed) scheduleSavePersist();
}

function hasAuthSession(store) {
  return Object.keys(store).some(
    (key) => key.includes('auth-token') || key.startsWith('sb-'),
  );
}

function distRoot() {
  return path.resolve(path.join(__dirname, 'dist', 'electron'));
}

function serveDistPath(pathname) {
  const root = distRoot();
  if (pathname === '/__empty' || pathname === '/__empty.html') {
    return new Response('<!doctype html><title></title>', {
      headers: { 'content-type': 'text/html' },
    });
  }
  let rel = decodeURIComponent(pathname || '');
  if (rel.startsWith('/')) rel = rel.slice(1);
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  const filePath = path.resolve(path.join(root, rel));
  const inside = filePath === root || filePath.startsWith(root + path.sep);
  if (!inside) return new Response('Forbidden', { status: 403 });
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return net.fetch(pathToFileURL(path.join(root, 'index.html')).href);
  }
  return net.fetch(pathToFileURL(filePath).href);
}

function dumpStorageFrom(url) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (win && !win.isDestroyed()) win.destroy();
      resolve(data && typeof data === 'object' ? data : {});
    };
    const win = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      width: 0,
      height: 0,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    const timer = setTimeout(() => done({}), 6000);
    win.webContents.on('did-finish-load', async () => {
      try {
        const data = await win.webContents.executeJavaScript(`(() => {
          const o = {};
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k) o[k] = localStorage.getItem(k);
          }
          return o;
        })()`);
        done(data);
      } catch {
        done({});
      }
    });
    win.webContents.on('did-fail-load', () => done({}));
    win.loadURL(url).catch(() => done({}));
  });
}

async function migrateOldOriginsOnce() {
  if (fs.existsSync(migratedFlagFile())) return;
  try {
    const fromApp = await dumpStorageFrom('app://localhost/__empty.html');
    mergePersist(fromApp);
    if (!hasAuthSession(persistCache)) {
      const indexPath = path.join(distRoot(), 'index.html');
      if (fs.existsSync(indexPath)) {
        const fromFile = await dumpStorageFrom(pathToFileURL(indexPath).href);
        mergePersist(fromFile);
      }
    }
  } catch {
    /* keep going — empty persist still lets them sign in */
  }
  try {
    fs.writeFileSync(migratedFlagFile(), '1');
  } catch {
    /* ignore */
  }
  savePersistNow();
}

function chromeUserAgent() {
  const raw = session.defaultSession.getUserAgent();
  const chrome = raw.match(/Chrome\/[\d.]+/)?.[0] || 'Chrome/134.0.0.0';
  const osPart =
    process.platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : process.platform === 'darwin'
        ? 'Macintosh; Intel Mac OS X 10_15_7'
        : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${osPart}) AppleWebKit/537.36 (KHTML, like Gecko) ${chrome} Safari/537.36`;
}

// Same origin Capacitor uses (https://localhost). YouTube rejects file:// and app://.
function registerAppProtocol() {
  protocol.handle('app', (request) => {
    try {
      const { pathname } = new URL(request.url);
      return serveDistPath(pathname);
    } catch (err) {
      return new Response(String(err), { status: 500 });
    }
  });
}

const DESKTOP_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
};

function startDesktopServer() {
  const root = distRoot();
  desktopServer = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      });
      res.end();
      return;
    }
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      let rel = decodeURIComponent(url.pathname);
      if (rel.includes('\0') || rel.includes('..')) {
        res.writeHead(400);
        res.end();
        return;
      }
      if (rel.startsWith('/')) rel = rel.slice(1);
      if (!rel || rel.endsWith('/')) rel += 'index.html';
      let filePath = path.resolve(path.join(root, rel));
      if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(root, 'index.html');
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': DESKTOP_MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(500);
      res.end(String(err));
    }
  });
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const onError = (err) => {
        desktopServer.removeListener('error', onError);
        if (err.code === 'EADDRINUSE' && port < 18770) {
          tryPort(port + 1);
        } else {
          reject(err);
        }
      };
      desktopServer.once('error', onError);
      desktopServer.listen(port, '127.0.0.1', () => {
        desktopServer.removeListener('error', onError);
        desktopPort = port;
        resolve(port);
      });
    };
    tryPort(18765);
  });
}

function youtubePageUrl(videoId, isPlaylist) {
  if (isPlaylist) {
    return `https://www.youtube.com/playlist?list=${encodeURIComponent(videoId)}`;
  }
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&autoplay=1`;
}

function applyYouTubeBounds() {
  if (!youtubeView || !mainWindow || mainWindow.isDestroyed()) return;
  if (!youtubeVisible || youtubeBounds.width < 8 || youtubeBounds.height < 8) {
    youtubeView.setBounds({ x: -10000, y: -10000, width: 1, height: 1 });
    return;
  }
  youtubeView.setBounds({
    x: Math.max(0, Math.round(youtubeBounds.x)),
    y: Math.max(0, Math.round(youtubeBounds.y)),
    width: Math.round(youtubeBounds.width),
    height: Math.round(youtubeBounds.height),
  });
}

function ensureYouTubeView() {
  if (youtubeView) return youtubeView;
  youtubeView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  youtubeView.setBackgroundColor('#000000');
  youtubeView.webContents.setUserAgent(chromeUserAgent());
  youtubeView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  youtubeView.webContents.on('did-finish-load', () => {
    youtubeView.webContents.executeJavaScript(`(() => {
      const hook = () => {
        const v = document.querySelector('video');
        if (!v || v.dataset.btHooked) return;
        v.dataset.btHooked = '1';
        v.addEventListener('ended', () => console.log('BT_YT_ENDED'));
        v.addEventListener('play', () => console.log('BT_YT_PLAY'));
        v.addEventListener('pause', () => console.log('BT_YT_PAUSE'));
      };
      hook();
      new MutationObserver(hook).observe(document.documentElement, { childList: true, subtree: true });
    })();`).catch(() => {});
  });
  youtubeView.webContents.on('console-message', (_e, _level, message) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (message === 'BT_YT_ENDED') mainWindow.webContents.send('youtube:ended');
    if (message === 'BT_YT_PLAY') mainWindow.webContents.send('youtube:state', true);
    if (message === 'BT_YT_PAUSE') mainWindow.webContents.send('youtube:state', false);
  });
  return youtubeView;
}

function createWindow(loadUrl) {
  const icon = nativeImage.createFromPath(appIconPath());
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#000000',
    icon: icon.isEmpty() ? undefined : icon,
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  const ua = chromeUserAgent();
  session.defaultSession.setUserAgent(ua);
  mainWindow.webContents.setUserAgent(ua);
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(true);
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('did-fail-load', code, desc, url);
  });
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error('[renderer]', message, sourceId, line);
  });
  mainWindow.loadURL(loadUrl);
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    if (youtubeView) {
      try { youtubeView.webContents.destroy(); } catch { /* ignore */ }
      youtubeView = null;
      youtubeLoadedUrl = '';
    }
    mainWindow = null;
  });
}

function desktopStartUrl() {
  return process.env.NODE_ENV === 'development'
    ? 'http://localhost:5173'
    : `http://127.0.0.1:${desktopPort}/index.html`;
}

app.whenReady().then(async () => {
  loadPersist();
  if (process.env.NODE_ENV !== 'development') {
    registerAppProtocol();
    await startDesktopServer();
    await migrateOldOriginsOnce();
  }
  createWindow(desktopStartUrl());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow(desktopStartUrl());
  }
});

// ─── IPC Handlers for Printer & Cash Drawer ──────────────────────────────────

ipcMain.on('persist:snapshot', (event) => {
  event.returnValue = persistCache;
});

ipcMain.on('persist:set', (_event, key, value) => {
  if (typeof key !== 'string' || typeof value !== 'string') return;
  persistCache[key] = value;
  scheduleSavePersist();
});

ipcMain.on('persist:remove', (_event, key) => {
  if (key === '*') {
    persistCache = {};
  } else if (typeof key === 'string') {
    delete persistCache[key];
  }
  scheduleSavePersist();
});

ipcMain.on('persist:all', (_event, obj) => {
  if (!obj || typeof obj !== 'object') return;
  persistCache = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') persistCache[key] = value;
  }
  scheduleSavePersist();
});

ipcMain.handle('youtube:open', async (_event, payload) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { success: false };
  const videoId = payload && payload.videoId;
  if (typeof videoId !== 'string' || !videoId) return { success: false };
  const view = ensureYouTubeView();
  const attached = mainWindow.getBrowserViews ? mainWindow.getBrowserViews() : [];
  if (!attached.includes(view)) {
    mainWindow.addBrowserView(view);
  }
  const url = youtubePageUrl(videoId, !!payload.isPlaylist);
  if (url !== youtubeLoadedUrl) {
    youtubeLoadedUrl = url;
    await view.webContents.loadURL(url);
  }
  applyYouTubeBounds();
  return { success: true };
});

ipcMain.on('youtube:bounds', (_event, bounds) => {
  if (!bounds || typeof bounds !== 'object') return;
  youtubeBounds = {
    x: Number(bounds.x) || 0,
    y: Number(bounds.y) || 0,
    width: Number(bounds.width) || 0,
    height: Number(bounds.height) || 0,
  };
  if (typeof bounds.visible === 'boolean') youtubeVisible = bounds.visible;
  applyYouTubeBounds();
});

ipcMain.on('youtube:visible', (_event, visible) => {
  youtubeVisible = !!visible;
  applyYouTubeBounds();
});

ipcMain.on('youtube:close', () => {
  youtubeLoadedUrl = '';
  youtubeVisible = false;
  if (youtubeView && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeBrowserView(youtubeView);
  }
  if (youtubeView) {
    youtubeView.webContents.loadURL('about:blank').catch(() => {});
  }
});

ipcMain.handle('youtube:command', async (_event, cmd) => {
  if (!youtubeView) return { success: false };
  const play = cmd === 'play';
  try {
    await youtubeView.webContents.executeJavaScript(
      play
        ? `document.querySelector('video')?.play()`
        : `document.querySelector('video')?.pause()`,
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

function isVirtualWindowsPrinter(name) {
  const n = String(name || '').toLowerCase();
  return /pdf|fax|onenote|xps|microsoft print to pdf|adobe pdf|send to|onenote/.test(n);
}

function listSerialPorts() {
  if (!SerialPort?.list) return Promise.resolve([]);
  return SerialPort.list()
    .then((ports) =>
      (ports || []).map((port) => ({
        path: port.path,
        manufacturer: port.manufacturer,
        serialNumber: port.serialNumber,
        vendorId: port.vendorId,
        productId: port.productId,
        kind: 'serial',
        label: [port.path, port.manufacturer].filter(Boolean).join(' · '),
      })),
    )
    .catch(() => []);
}

function listChromiumPrinters() {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve([]);
  return mainWindow.webContents
    .getPrintersAsync()
    .then((printers) =>
      (printers || [])
        .filter((p) => p?.name && !isVirtualWindowsPrinter(p.name) && !isVirtualWindowsPrinter(p.displayName))
        .map((p) => ({
          path: `win32:${p.name}`,
          manufacturer: p.displayName || p.name,
          serialNumber: p.isDefault ? 'default' : undefined,
          kind: 'windows',
          label: p.displayName || p.name,
        })),
    )
    .catch(() => []);
}

function listWin32PrintersViaPowershell() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'Get-CimInstance Win32_Printer | Select-Object Name, DriverName, Default | ConvertTo-Json -Compress',
      ],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) {
          resolve([]);
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          resolve(
            arr
              .filter((p) => p?.Name && !isVirtualWindowsPrinter(p.Name))
              .map((p) => ({
                path: `win32:${p.Name}`,
                manufacturer: p.DriverName || p.Name,
                serialNumber: p.Default ? 'default' : undefined,
                kind: 'windows',
                label: p.Name,
              })),
          );
        } catch {
          resolve([]);
        }
      },
    );
  });
}

ipcMain.handle('printer:list', async () => {
  try {
    const [serial, chromium, win32] = await Promise.all([
      listSerialPorts(),
      listChromiumPrinters(),
      listWin32PrintersViaPowershell(),
    ]);
    const seen = new Set();
    const ports = [];
    for (const port of [...serial, ...chromium, ...win32]) {
      if (!port?.path || seen.has(port.path)) continue;
      seen.add(port.path);
      ports.push(port);
    }
    return { success: true, ports };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

function writeRawWin32(printerName, buffer) {
  return new Promise((resolve) => {
    if (!printerName) {
      resolve({ success: false, error: 'No Windows printer selected' });
      return;
    }
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const binPath = path.join(os.tmpdir(), `pospro-print-${stamp}.bin`);
    const psPath = path.join(os.tmpdir(), `pospro-print-${stamp}.ps1`);
    try {
      fs.writeFileSync(binPath, buffer);
      const ps = `
$ErrorActionPreference = 'Stop'
$printerName = ${JSON.stringify(printerName)}
$filePath = ${JSON.stringify(binPath)}
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PosProRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
  public static bool SendBytes(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;
    DOCINFOA di = new DOCINFOA();
    di.pDocName = "P.O.S. Pro Receipt";
    di.pDataType = "RAW";
    if (!StartDocPrinter(hPrinter, 1, di)) { ClosePrinter(hPrinter); return false; }
    if (!StartPagePrinter(hPrinter)) { EndDocPrinter(hPrinter); ClosePrinter(hPrinter); return false; }
    IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
    Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
    int written;
    bool ok = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out written);
    Marshal.FreeCoTaskMem(pUnmanagedBytes);
    EndPagePrinter(hPrinter);
    EndDocPrinter(hPrinter);
    ClosePrinter(hPrinter);
    return ok && written == bytes.Length;
  }
}
"@
$bytes = [System.IO.File]::ReadAllBytes($filePath)
$ok = [PosProRawPrinter]::SendBytes($printerName, $bytes)
if (-not $ok) { throw "RAW print failed for $printerName" }
`;
      fs.writeFileSync(psPath, ps, 'utf8');
    } catch (error) {
      resolve({ success: false, error: error.message });
      return;
    }
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psPath],
      { timeout: 15000, windowsHide: true },
      (err, _stdout, stderr) => {
        try { fs.unlinkSync(psPath); } catch { /* ignore */ }
        if (!err) {
          try { fs.unlinkSync(binPath); } catch { /* ignore */ }
          resolve({ success: true, opened: true });
          return;
        }
        const dest = `\\\\localhost\\${printerName}`;
        execFile(
          'cmd.exe',
          ['/c', 'copy', '/b', binPath, dest],
          { timeout: 10000, windowsHide: true },
          (copyErr) => {
            try { fs.unlinkSync(binPath); } catch { /* ignore */ }
            if (copyErr) {
              resolve({
                success: false,
                error: (stderr && String(stderr).trim()) || err.message,
              });
              return;
            }
            resolve({ success: true, opened: true });
          },
        );
      },
    );
  });
}

function writeToSerialPort(portPath, buffer, settleMs = 200, baudRate = 9600) {
  return new Promise((resolve) => {
    if (!SerialPort) {
      resolve({ success: false, error: 'Serial port support is not available in this app build' });
      return;
    }
    if (!portPath) {
      resolve({ success: false, error: 'No printer port selected' });
      return;
    }
    let port;
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (port && port.isOpen) port.close(); } catch { /* ignore */ }
      resolve(result);
    };
    const timer = setTimeout(() => done({ success: false, error: 'Printer port timed out' }), 4000);
    try {
      port = new SerialPort({
        path: portPath,
        baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
      });
    } catch (error) {
      done({ success: false, error: error.message });
      return;
    }
    port.on('open', () => {
      port.write(buffer, (err) => {
        if (err) {
          done({ success: false, error: err.message });
        } else {
          setTimeout(() => done({ success: true, opened: true }), settleMs);
        }
      });
    });
    port.on('error', (err) => done({ success: false, error: err.message }));
  });
}

async function writeToPrinter(portPath, buffer, settleMs = 200) {
  if (!portPath) return { success: false, error: 'No printer selected' };
  if (String(portPath).startsWith('win32:')) {
    return writeRawWin32(String(portPath).slice(6), buffer);
  }
  const bauds = [9600, 19200, 38400, 115200];
  let last = { success: false, error: 'Could not open serial printer' };
  for (const baud of bauds) {
    last = await writeToSerialPort(portPath, buffer, settleMs, baud);
    if (last.success) return last;
  }
  return last;
}

ipcMain.handle('printer:print', async (event, { portPath, escPosHex }) => {
  return writeToPrinter(portPath, Buffer.from(escPosHex, 'hex'), 200);
});

ipcMain.handle('drawer:open', async (event, { portPath, pulseHex = '1b700019191b70011919' }) => {
  return writeToPrinter(portPath, Buffer.from(pulseHex, 'hex'), 150);
});

ipcMain.handle('printer:printAndOpenDrawer', async (event, { portPath, escPosHex, pulseHex = '1b700019191b70011919' }) => {
  const receiptBuffer = Buffer.from(escPosHex, 'hex');
  const pulseBuffer = Buffer.from(pulseHex, 'hex');
  return writeToPrinter(portPath, Buffer.concat([receiptBuffer, pulseBuffer]), 250);
});

// ─── Auto-update handlers (optional for future) ───────────────────────────────

ipcMain.handle('app:version', () => {
  return app.getVersion();
});

ipcMain.handle('app:platform', () => {
  return {
    platform: process.platform,
    isElectron: true,
    isWindows: process.platform === 'win32',
    isMac: process.platform === 'darwin',
    isLinux: process.platform === 'linux',
  };
});

function downloadToFile(url, dest, redirectsLeft = 8) {
  return new Promise((resolve, reject) => {
    const getter = url.startsWith('http://') ? http.get : https.get;
    const req = getter(url, {
      headers: { 'User-Agent': 'POS-Pro', Accept: '*/*' },
    }, (res) => {
      const loc = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && loc && redirectsLeft > 0) {
        const next = loc.startsWith('http') ? loc : new URL(loc, url).href;
        res.resume();
        downloadToFile(next, dest, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Download failed (${res.statusCode})`));
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });
    req.on('error', reject);
  });
}

ipcMain.handle('app:installUpdate', async (_event, url) => {
  try {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
      return { success: false, error: 'Invalid update URL' };
    }
    const dest = path.join(app.getPath('temp'), 'POS-Pro-Setup.exe');
    await downloadToFile(url, dest);
    // Quit first, then start the installer. If Setup.exe launches while this
    // process is still running, NSIS cannot replace files.
    const cmd = process.env.ComSpec || 'cmd.exe';
    spawn(cmd, ['/d', '/c', `timeout /t 2 /nobreak >nul & start "" "${dest}"`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }
    setTimeout(() => app.quit(), 200);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
