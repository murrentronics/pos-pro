/**
 * Electron printer adapter — native serialport via IPC.
 * Browser/Capacitor builds never call these; they fall through to Web Serial.
 */

export function isElectronApp(): boolean {
  return (
    (typeof window !== "undefined" && window.electronAPI?.isElectron === true) ||
    import.meta.env.VITE_IS_ELECTRON === "true"
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function listElectronPrinters() {
  if (!isElectronApp() || !window.electronAPI?.printer.list) {
    return { success: false, error: "Not running in Electron" };
  }
  return await window.electronAPI.printer.list();
}

export async function printBytesElectron(portPath: string, bytes: Uint8Array) {
  if (!isElectronApp() || !window.electronAPI?.printer.print) {
    return { success: false, error: "Not running in Electron" };
  }
  return await window.electronAPI.printer.print(portPath, bytesToHex(bytes));
}

/** Both drawer pins. Epson and most USB printers kick on pin 2 or pin 5. */
export const DRAWER_PULSE_HEX = "1b700019191b70011919";

export async function openCashDrawerElectron(portPath: string, pulseHex = DRAWER_PULSE_HEX) {
  if (!isElectronApp() || !window.electronAPI?.drawer.open) {
    return { success: false, error: "Not running in Electron" };
  }
  return await window.electronAPI.drawer.open(portPath, pulseHex);
}

export async function printAndOpenDrawerElectron(
  portPath: string,
  bytes: Uint8Array,
  pulseHex = DRAWER_PULSE_HEX,
) {
  if (!isElectronApp() || !window.electronAPI?.printer.printAndOpenDrawer) {
    return { success: false, error: "Not running in Electron" };
  }
  return await window.electronAPI.printer.printAndOpenDrawer(portPath, bytesToHex(bytes), pulseHex);
}

export function getSavedPrinterPort(): string | null {
  try {
    return localStorage.getItem("pospro-electron-printer-port");
  } catch {
    return null;
  }
}

export function savePrinterConnection(portPath: string) {
  try {
    localStorage.setItem("pospro-electron-printer-port", portPath);
    window.electronAPI?.persistSet?.("pospro-electron-printer-port", portPath);
  } catch { /* ignore */ }
}

export function clearPrinterConnection() {
  try {
    localStorage.removeItem("pospro-electron-printer-port");
  } catch { /* ignore */ }
}
