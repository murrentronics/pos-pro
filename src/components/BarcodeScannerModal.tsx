import { useEffect, useRef, useState } from "react";
import { Loader2, X, CheckCircle2, Plus, Minus } from "lucide-react";
import { toast } from "sonner";
import { playBeep } from "@/lib/playBeep";
import { supabase } from "@/integrations/supabase/client";

type ScannedItem = {
  product: any;
  qty: number;
};

type BarcodeScannerModalProps = {
  open: boolean;
  onClose: () => void;
  onDone: (items: ScannedItem[]) => void;
};

export function BarcodeScannerModal({ open, onClose, onDone }: BarcodeScannerModalProps) {
  const [externalDetected, setExternalDetected] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const keyboardBufferRef = useRef<string>("");

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === "Enter") {
      const code = keyboardBufferRef.current.trim();
      if (code) {
        setLastScanned(code);
        playBeep();
        window.dispatchEvent(new CustomEvent("pospro-raw-barcode", { detail: code }));
        setTimeout(() => setLastScanned(null), 1500);
        keyboardBufferRef.current = "";
      }
      return;
    }
    if (e.key.length === 1) {
      keyboardBufferRef.current += e.key;
    }
  };

  const tryExternalScanner = async (): Promise<boolean> => {
    try {
      if ("hid" in navigator) {
        const devices = await (navigator as any).hid.getDevices();
        if (devices && devices.length > 0) {
          setExternalDetected(true);
          return true;
        }
      }
    } catch (e) {
      console.warn("WebHID not available:", e);
    }
    return false;
  };

  const requestHidPermission = async (): Promise<boolean> => {
    try {
      if ("hid" in navigator) {
        const devices = await (navigator as any).hid.requestDevice({ filters: [] });
        if (devices && devices.length > 0) {
          setExternalDetected(true);
          return true;
        }
      }
    } catch (e) {
      console.warn("HID permission denied:", e);
    }
    return false;
  };

  useEffect(() => {
    if (!open) {
      setExternalDetected(false);
      setLastScanned(null);
      setScannedItems([]);
      keyboardBufferRef.current = "";
      return;
    }

    const initScanner = async () => {
      const hasExternal = await tryExternalScanner();
      if (!hasExternal) {
        const granted = await requestHidPermission();
        if (!granted) {
          toast.error("No external scanner detected. Please connect a POS scanner.");
          onClose();
          return;
        }
      }
    };

    initScanner();
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      keyboardBufferRef.current = "";
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const handler = async (e: Event) => {
      const barcode = (e as CustomEvent).detail;
      if (!barcode) return;
      const { data: product } = await (supabase as any)
        .from("products")
        .select("*")
        .eq("barcode", barcode)
        .maybeSingle();
      if (!product) {
        toast.error("Product not found for barcode: " + barcode);
        return;
      }
      setScannedItems((prev) => {
        const existing = prev.find((item) => item.product.id === product.id);
        if (existing) {
          return prev.map((item) =>
            item.product.id === product.id ? { ...item, qty: item.qty + 1 } : item
          );
        }
        return [...prev, { product, qty: 1 }];
      });
    };
    window.addEventListener("pospro-raw-barcode", handler);
    return () => window.removeEventListener("pospro-raw-barcode", handler);
  }, [open]);

  const incrementQty = (productId: string) => {
    setScannedItems((prev) =>
      prev.map((item) => (item.product.id === productId ? { ...item, qty: item.qty + 1 } : item))
    );
    playBeep();
  };

  const decrementQty = (productId: string) => {
    setScannedItems((prev) =>
      prev
        .map((item) => (item.product.id === productId ? { ...item, qty: item.qty - 1 } : item))
        .filter((item) => item.qty > 0)
    );
  };

  const handleDone = () => {
    if (scannedItems.length === 0) {
      onClose();
      return;
    }
    onDone(scannedItems);
    onClose();
  };

  const handleChangeDevice = async () => {
    setExternalDetected(false);
    const granted = await requestHidPermission();
    if (!granted) {
      toast.error("No scanner selected. Please connect a POS scanner.");
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 bg-black/80 backdrop-blur shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-white font-black text-sm">
            {externalDetected ? "Scanner Ready" : "Waiting for Scanner..."}
          </span>
          {externalDetected && (
            <span className="flex items-center gap-1 text-[10px] text-green-400 font-bold">
              <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
              Connected
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {externalDetected && (
            <button
              onClick={handleChangeDevice}
              className="h-8 px-3 rounded-lg bg-white/10 text-white text-[11px] font-black hover:bg-white/20 transition"
            >
              Change Device
            </button>
          )}
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Scanner Area */}
      <div className="flex-1 relative bg-black flex flex-col items-center justify-center overflow-hidden">
        <div className="flex flex-col items-center justify-center gap-4 p-6 text-center w-full max-w-sm">
          {externalDetected ? (
            <>
              <div className="h-16 w-16 rounded-full bg-green-500/20 border-2 border-green-500/40 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-400" />
              </div>
              <p className="text-white font-black text-lg">External Scanner Ready</p>
              <p className="text-white/60 text-sm">Scan barcodes now — items will appear below</p>
            </>
          ) : (
            <>
              <div className="h-16 w-16 rounded-full bg-amber-500/20 border-2 border-amber-500/40 flex items-center justify-center">
                <Loader2 className="h-8 w-8 text-amber-400 animate-spin" />
              </div>
              <p className="text-white font-black text-lg">Looking for Scanner...</p>
              <p className="text-white/60 text-sm">Please connect your external barcode scanner</p>
              <p className="text-white/40 text-xs">Or scan any barcode to auto-connect</p>
            </>
          )}

          {lastScanned && (
            <div className="bg-green-500 text-white px-4 py-2 rounded-xl font-black text-sm shadow-lg">
              Scanned: {lastScanned}
            </div>
          )}
        </div>

        {/* Scanned Items List */}
        {scannedItems.length > 0 && (
          <div className="w-full max-w-sm px-4 pb-4 space-y-2 overflow-y-auto max-h-[40vh]">
            {scannedItems.map((item) => (
              <div
                key={item.product.id}
                className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl p-3"
              >
                <div className="h-12 w-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0 overflow-hidden">
                  {item.product.image_url ? (
                    <img
                      src={item.product.image_url}
                      alt={item.product.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-xl">📷</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-black text-sm truncate">{item.product.name}</p>
                  <p className="text-white/60 text-xs">${Number(item.product.price).toFixed(2)} each</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => decrementQty(item.product.id)}
                    className="h-8 w-8 rounded-lg bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="text-white font-black text-sm w-6 text-center">{item.qty}</span>
                  <button
                    onClick={() => incrementQty(item.product.id)}
                    className="h-8 w-8 rounded-lg bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Controls */}
      <div className="shrink-0 bg-black/90 backdrop-blur border-t border-white/10 px-4 py-3 space-y-3">
        {scannedItems.length > 0 && (
          <div className="text-center">
            <span className="text-white/60 text-xs font-bold">
              {scannedItems.length} item{scannedItems.length !== 1 ? "s" : ""} scanned
            </span>
          </div>
        )}
        <button
          onClick={handleDone}
          disabled={scannedItems.length === 0}
          className="w-full h-12 rounded-2xl bg-white/10 font-black text-sm text-white hover:bg-white/20 transition active:scale-95 disabled:opacity-50"
        >
          Done
        </button>
      </div>
    </div>
  );
}
