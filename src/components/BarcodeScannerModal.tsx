import { useEffect, useRef, useState } from "react";
import { Loader2, X, Camera, RefreshCw, Flashlight, FlashlightOff, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

type BarcodeScannerModalProps = {
  open: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
};

export function BarcodeScannerModal({ open, onClose, onScan }: BarcodeScannerModalProps) {
  const [mode, setMode] = useState<"external" | "camera">("external");
  const [scanning, setScanning] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<"environment" | "user">("user");
  const [torchOn, setTorchOn] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [externalDetected, setExternalDetected] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const readerRef = useRef<any>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const torchTrackRef = useRef<MediaStreamTrack | null>(null);
  const keyboardBufferRef = useRef<string>("");

  const stopScan = () => {
    if (controlsRef.current) {
      try { controlsRef.current.stop(); } catch {}
      controlsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    readerRef.current = null;
    setTorchOn(false);
    torchTrackRef.current = null;
  };

  const startCamera = async () => {
    stopScan();
    setScanning(true);
    setTorchOn(false);
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: cameraFacing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      torchTrackRef.current = track;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      try {
        const controls = await reader.decodeFromStream(stream, videoRef.current!, (result, err) => {
          if (result) {
            const text = result.getText();
            if (text && text !== lastScanned) {
              setLastScanned(text);
              onScan(text);
              window.dispatchEvent(new CustomEvent("pospro-raw-barcode", { detail: text }));
              setTimeout(() => setLastScanned(null), 1500);
            }
          }
        });
        controlsRef.current = controls;
      } catch (e) {
        console.warn("ZXing decodeFromStream error:", e);
      }
    } catch (e) {
      console.error("Camera error:", e);
      toast.error("Cannot access camera");
      setScanning(false);
    }
  };

  const toggleTorch = async () => {
    if (!torchTrackRef.current) return;
      try {
        const newState = !torchOn;
        await (torchTrackRef.current as MediaStreamTrack).applyConstraints({ advanced: [{ torch: newState } as any] });
        setTorchOn(newState);
    } catch (e) {
      console.warn("Torch not supported:", e);
      toast.error("Flashlight not available on this device");
    }
  };

  const switchCamera = () => {
    const newFacing = cameraFacing === "user" ? "environment" : "user";
    setCameraFacing(newFacing);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (mode !== "external" || !open) return;
    if (e.key === "Enter") {
      const code = keyboardBufferRef.current.trim();
      if (code) {
        setLastScanned(code);
        onScan(code);
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
      stopScan();
      setScanning(false);
      setMode("external");
      setExternalDetected(false);
      setLastScanned(null);
      setTorchOn(false);
      return;
    }

    const initScanner = async () => {
      const hasExternal = await tryExternalScanner();
      if (hasExternal) {
        setMode("external");
        setScanning(false);
      } else {
        const granted = await requestHidPermission();
        if (granted) {
          const hasExt = await tryExternalScanner();
          if (hasExt) {
            setMode("external");
          } else {
            setMode("camera");
            await startCamera();
          }
        } else {
          setMode("camera");
          await startCamera();
        }
      }
    };

    initScanner();
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      stopScan();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (mode === "camera" && !streamRef.current) {
      startCamera();
    }
  }, [mode, open, cameraFacing]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 bg-black/80 backdrop-blur shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-white font-black text-sm">
            {mode === "external" ? (externalDetected ? "Scanner Ready" : "No Scanner Detected") : "Camera Scanner"}
          </span>
          {mode === "camera" && scanning && (
            <span className="flex items-center gap-1 text-[10px] text-green-400 font-bold">
              <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
              Scanning
            </span>
          )}
        </div>
        <button
          onClick={() => { stopScan(); onClose(); }}
          className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Scanner Area */}
      <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
        {mode === "camera" ? (
          <>
            <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
            {/* Scan overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-64 border-2 border-white/60 rounded-2xl relative">
                <div className="absolute inset-0 border-4 border-primary/80 rounded-2xl" />
                <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-primary rounded-tl-lg" />
                <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-primary rounded-tr-lg" />
                <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-primary rounded-bl-lg" />
                <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-primary rounded-br-lg" />
              </div>
            </div>
            {lastScanned && (
              <div className="absolute bottom-8 left-0 right-0 flex justify-center">
                <div className="bg-green-500 text-white px-4 py-2 rounded-xl font-black text-sm shadow-lg">
                  Scanned: {lastScanned}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 p-6 text-center">
            {externalDetected ? (
              <>
                <div className="h-16 w-16 rounded-full bg-green-500/20 border-2 border-green-500/40 flex items-center justify-center">
                  <CheckCircle2 className="h-8 w-8 text-green-400" />
                </div>
                <p className="text-white font-black text-lg">External Scanner Detected</p>
                <p className="text-white/60 text-sm">Scan a barcode now using your terminal scanner</p>
              </>
            ) : (
              <>
                <div className="h-16 w-16 rounded-full bg-amber-500/20 border-2 border-amber-500/40 flex items-center justify-center">
                  <span className="text-3xl">📷</span>
                </div>
                <p className="text-white font-black text-lg">No External Scanner</p>
                <p className="text-white/60 text-sm">Use camera to scan barcodes</p>
                <button
                  onClick={async () => { setMode("camera"); await startCamera(); }}
                  className="mt-2 px-6 h-12 rounded-2xl font-black text-sm text-primary-foreground transition active:scale-95"
                  style={{ background: "var(--gradient-hero)" }}
                >
                  Open Camera Scanner
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Bottom Controls */}
      <div className="shrink-0 bg-black/90 backdrop-blur border-t border-white/10 px-4 py-3 space-y-3">
        {mode === "camera" && (
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={switchCamera}
              className="h-12 w-12 rounded-xl bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition active:scale-95"
              title="Switch camera"
            >
              <RefreshCw className="h-5 w-5" />
            </button>
            <button
              onClick={toggleTorch}
              className={`h-12 w-12 rounded-xl flex items-center justify-center transition active:scale-95 ${
                torchOn ? "bg-amber-500 text-black" : "bg-white/10 text-white hover:bg-white/20"
              }`}
              title={torchOn ? "Turn off flashlight" : "Turn on flashlight"}
            >
              {torchOn ? <Flashlight className="h-5 w-5" /> : <FlashlightOff className="h-5 w-5" />}
            </button>
          </div>
        )}

        {/* Mode toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              const hasExt = await tryExternalScanner();
              if (hasExt || await requestHidPermission()) {
                setMode("external");
                stopScan();
              } else {
                setMode("camera");
                await startCamera();
              }
            }}
            className={`flex-1 h-11 rounded-xl font-black text-xs transition active:scale-95 ${
              mode === "external"
                ? "bg-primary text-primary-foreground"
                : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            External Scanner
          </button>
          <button
            onClick={async () => { setMode("camera"); await startCamera(); }}
            className={`flex-1 h-11 rounded-xl font-black text-xs transition active:scale-95 ${
              mode === "camera"
                ? "bg-primary text-primary-foreground"
                : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            Camera
          </button>
        </div>

        <button
          onClick={() => { stopScan(); onClose(); }}
          className="w-full h-12 rounded-2xl bg-white/10 font-black text-sm text-white hover:bg-white/20 transition active:scale-95"
        >
          Done
        </button>
      </div>
    </div>
  );
}
