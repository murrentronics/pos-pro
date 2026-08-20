import { useEffect, useRef, useState } from "react";
import { Loader2, X, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { playBeep } from "@/lib/playBeep";

type BarcodeScannerModalProps = {
  open: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
};

export function BarcodeScannerModal({ open, onClose, onScan }: BarcodeScannerModalProps) {
  const [externalDetected, setExternalDetected] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const keyboardBufferRef = useRef<string>("");

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === "Enter") {
      const code = keyboardBufferRef.current.trim();
      if (code) {
        setLastScanned(code);
        onScan(code);
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
        <button
          onClick={onClose}
          className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Scanner Area */}
      <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
        <div className="flex flex-col items-center justify-center gap-4 p-6 text-center">
          {externalDetected ? (
            <>
              <div className="h-16 w-16 rounded-full bg-green-500/20 border-2 border-green-500/40 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-400" />
              </div>
              <p className="text-white font-black text-lg">External Scanner Ready</p>
              <p className="text-white/60 text-sm">Scan a barcode now using your terminal scanner</p>
              <p className="text-white/40 text-xs">The scanner will act as a keyboard input</p>
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
            <div className="mt-4 bg-green-500 text-white px-4 py-2 rounded-xl font-black text-sm shadow-lg">
              Scanned: {lastScanned}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Controls */}
      <div className="shrink-0 bg-black/90 backdrop-blur border-t border-white/10 px-4 py-3">
        <button
          onClick={onClose}
          className="w-full h-12 rounded-2xl bg-white/10 font-black text-sm text-white hover:bg-white/20 transition active:scale-95"
        >
          Done
        </button>
      </div>
    </div>
  );
}
