import { useCallback, useEffect, useState } from "react";
import { Bluetooth, Loader2, Printer, RefreshCw, Usb, X } from "lucide-react";
import { toast } from "sonner";
import { isElectronApp, listElectronPrinters } from "@/lib/electronPrinter";
import {
  connectElectronPrinter,
  isPrinterPaired,
  pairBluetoothPrinter,
  pairUsbPrinter,
  printReceiptAndOpenDrawer,
  resolvePrinterConnectDialog,
  type ReceiptData,
} from "@/lib/receiptPrinter";

type ListedPrinter = {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
  kind?: "serial" | "windows";
  label?: string;
};

function printerScore(p: ListedPrinter): number {
  const hay = `${p.label ?? ""} ${p.manufacturer ?? ""} ${p.path ?? ""}`.toLowerCase();
  if (/epson/.test(hay)) return 50;
  if (/star|citizen|bixolon|xprinter|pos|thermal|receipt|tm-t/.test(hay)) return 40;
  if (p.kind === "windows") return 20;
  if (/ch340|ftdi|prolific|silicon|wch|usb.?serial/.test(hay)) return 10;
  return 0;
}

function printerTitle(p: ListedPrinter): string {
  if (p.label && !p.label.startsWith("win32:")) return p.label;
  if (p.kind === "windows") return p.path.replace(/^win32:/, "");
  return p.path;
}

function printerSubtitle(p: ListedPrinter): string {
  if (p.kind === "windows") return "Windows USB printer · cash drawer via DK port";
  const bits = [p.path, p.manufacturer].filter(Boolean);
  return bits.length ? `Serial ${bits.join(" · ")}` : "Serial port";
}

const TEST_RECEIPT: ReceiptData = {
  storeName: "P.O.S. Pro",
  items: [{ name: "Printer test", qty: 1, price: 0 }],
  subtotal: 0,
  total: 0,
  paid: 0,
  change: 0,
  payMode: "cash",
  orderNumber: "TEST",
};

export function PrinterConnectDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ports, setPorts] = useState<ListedPrinter[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const close = useCallback(async (ok: boolean) => {
    setOpen(false);
    if (ok) {
      resolvePrinterConnectDialog(true);
      return;
    }
    const paired = await isPrinterPaired();
    resolvePrinterConnectDialog(paired);
  }, []);

  const loadPorts = useCallback(async () => {
    if (!isElectronApp()) return;
    setLoading(true);
    setError(null);
    try {
      const listed = await listElectronPrinters();
      if (!listed.success) {
        setError(listed.error || "Could not list printers");
        setPorts([]);
        return;
      }
      const sorted = [...(listed.ports ?? [])].sort((a, b) => printerScore(b) - printerScore(a));
      setPorts(sorted);
      setSelected((prev) => {
        if (prev && sorted.some((p) => p.path === prev)) return prev;
        const best = sorted.find((p) => printerScore(p) >= 40) ?? sorted[0];
        return best?.path ?? null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not list printers");
      setPorts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      setConnecting(false);
      setTesting(false);
      void loadPorts();
    };
    window.addEventListener("pospro-open-printer-connect", onOpen);
    return () => window.removeEventListener("pospro-open-printer-connect", onOpen);
  }, [loadPorts]);

  const handleConnect = async () => {
    if (!isElectronApp()) {
      setConnecting(true);
      try {
        const ok = await pairUsbPrinter();
        if (ok) {
          toast.success("USB printer connected — cash drawer ready");
          close(true);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not connect USB printer");
      } finally {
        setConnecting(false);
      }
      return;
    }

    const chosen = ports.find((p) => p.path === selected);
    if (!chosen) {
      toast.error("Select a printer from the list");
      return;
    }
    setConnecting(true);
    try {
      connectElectronPrinter({
        path: chosen.path,
        label: printerTitle(chosen),
        vendorId: chosen.vendorId,
        productId: chosen.productId,
      });
      toast.success(`Connected to ${printerTitle(chosen)}`);
      close(true);
    } finally {
      setConnecting(false);
    }
  };

  const handleBluetooth = async () => {
    setConnecting(true);
    try {
      const ok = await pairBluetoothPrinter();
      if (ok) {
        toast.success("Bluetooth printer connected");
        close(true);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bluetooth pairing failed");
    } finally {
      setConnecting(false);
    }
  };

  const handleTest = async () => {
    const chosen = ports.find((p) => p.path === selected);
    if (!chosen) {
      toast.error("Select a printer first");
      return;
    }
    setTesting(true);
    try {
      connectElectronPrinter({
        path: chosen.path,
        label: printerTitle(chosen),
        vendorId: chosen.vendorId,
        productId: chosen.productId,
      });
      const result = await printReceiptAndOpenDrawer(TEST_RECEIPT);
      if (!result.printed) {
        toast.error(result.error || "Test print failed");
        return;
      }
      toast.success("Test sent — receipt should print and the drawer should kick");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test print failed");
    } finally {
      setTesting(false);
    }
  };

  if (!open) return null;

  const btAvailable = typeof navigator !== "undefined" && !!(navigator as unknown as { bluetooth?: unknown }).bluetooth;
  const electron = isElectronApp();

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      onClick={() => close(false)}
    >
      <div
        className="w-full max-w-md rounded-3xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]"
        style={{ background: "var(--gradient-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-2 shrink-0">
          <div>
            <h3 className="font-black text-base">Connect printer</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Choose the receipt printer. The cash drawer kicks through that USB cable.
            </p>
          </div>
          <button
            onClick={() => close(false)}
            className="h-8 w-8 rounded-full flex items-center justify-center bg-muted transition shrink-0 ml-3"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pb-4 overflow-y-auto flex-1 space-y-3">
          {electron ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
                  Devices on this PC
                </span>
                <button
                  onClick={() => void loadPorts()}
                  disabled={loading}
                  className="h-8 px-2 rounded-lg text-[11px] font-bold flex items-center gap-1 text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>

              {loading && ports.length === 0 && (
                <div className="h-24 flex items-center justify-center text-muted-foreground text-sm gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Looking for printers…
                </div>
              )}

              {!loading && ports.length === 0 && (
                <div className="rounded-2xl border border-border/70 p-4 text-[12px] text-muted-foreground leading-relaxed">
                  No printers found. Plug in the USB cable, turn the printer on, and make sure it appears in
                  Windows under Printers & scanners. Then tap Refresh.
                </div>
              )}

              <div className="space-y-2">
                {ports.map((p) => {
                  const active = selected === p.path;
                  const highlight = printerScore(p) >= 40;
                  return (
                    <button
                      key={p.path}
                      onClick={() => setSelected(p.path)}
                      className="w-full text-left rounded-2xl border-2 px-3 py-3 transition active:scale-[0.99]"
                      style={{
                        borderColor: active ? "rgba(99,102,241,0.7)" : "rgba(255,255,255,0.08)",
                        background: active ? "rgba(99,102,241,0.12)" : "rgba(255,255,255,0.03)",
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <Printer className="h-4 w-4 mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <div className="font-black text-sm truncate">
                            {printerTitle(p)}
                            {highlight && (
                              <span className="ml-2 text-[10px] font-bold text-indigo-700">Recommended</span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground">{printerSubtitle(p)}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {error && <p className="text-[11px] text-red-700">{error}</p>}
            </>
          ) : (
            <div className="space-y-2 pt-1">
              <p className="text-[12px] text-muted-foreground">
                Browser printing uses the USB or Bluetooth picker. For a USB receipt printer and cash drawer on this PC, use the P.O.S. Pro desktop app.
              </p>
              <button
                onClick={() => void handleConnect()}
                disabled={connecting}
                className="w-full h-11 rounded-2xl font-black text-xs flex items-center justify-center gap-1.5 border-2"
                style={{ background: "rgba(79,70,229,0.16)", color: "var(--foreground)", borderColor: "rgba(79,70,229,0.55)" }}
              >
                {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Usb className="h-4 w-4" />USB picker</>}
              </button>
            </div>
          )}

          {btAvailable && (
            <button
              onClick={() => void handleBluetooth()}
              disabled={connecting}
              className="w-full h-11 rounded-2xl font-black text-xs flex items-center justify-center gap-1.5 border-2"
              style={{ background: "rgba(37,99,235,0.16)", color: "var(--foreground)", borderColor: "rgba(37,99,235,0.55)" }}
            >
              {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Bluetooth className="h-4 w-4" />Bluetooth</>}
            </button>
          )}
        </div>

        <div className="px-5 pb-5 pt-2 flex flex-col gap-2 shrink-0">
          {electron && (
            <button
              onClick={() => void handleTest()}
              disabled={!selected || connecting || testing || loading}
              className="h-11 rounded-2xl font-black text-sm border border-border hover:bg-muted/30 transition disabled:opacity-50"
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Test print + drawer"}
            </button>
          )}
          <button
            onClick={() => void handleConnect()}
            disabled={connecting || testing || (electron && !selected)}
            className="h-12 rounded-2xl font-black text-sm flex items-center justify-center gap-2 text-primary-foreground shadow-lg disabled:opacity-50"
            style={{ background: "var(--gradient-hero)" }}
          >
            {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Connect this printer"}
          </button>
        </div>
      </div>
    </div>
  );
}
