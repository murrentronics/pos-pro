/**
 * UpdateBanner
 *
 * Android: opens the APK URL via Capacitor Browser.
 * Electron: downloads and runs the Windows installer via installUpdate.
 * Web: should not show (useAppUpdate skips web).
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, X, Sparkles } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import type { UpdateInfo } from "@/lib/useAppUpdate";

interface Props {
  update: UpdateInfo;
  onDismiss: () => void;
}

export function UpdateBanner({ update, onDismiss }: Props) {
  const [downloading, setDownloading] = useState(false);

  const isElectron = window.electronAPI?.isElectron === true || import.meta.env.VITE_IS_ELECTRON === "true";
  const DOWNLOAD_PAGE = "https://pospro-web.pages.dev/#/download";

  const handleUpdate = async () => {
    setDownloading(true);
    try {
      if (window.electronAPI?.installUpdate) {
        const result = await window.electronAPI.installUpdate(update.apkUrl);
        if (!result.success) throw new Error(result.error || "Update failed");
        return;
      }
      if (Capacitor.isNativePlatform()) {
        const { Browser } = await import("@capacitor/browser");
        await Browser.open({
          url: update.apkUrl,
          presentationStyle: "fullscreen",
          toolbarColor: "#000d1a",
        });
      } else {
        window.open(update.apkUrl, "_blank");
        toast.success("Check your Downloads folder for the installer.");
      }
    } catch {
      try {
        const { Browser } = await import("@capacitor/browser");
        await Browser.open({ url: DOWNLOAD_PAGE, presentationStyle: "fullscreen", toolbarColor: "#000d1a" });
      } catch {
        window.open(DOWNLOAD_PAGE, "_blank");
      }
    } finally {
      setDownloading(false);
    }
  };

  const notes = update.releaseNotes
    ? update.releaseNotes.slice(0, 300) + (update.releaseNotes.length > 300 ? "…" : "")
    : null;

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div
        className="w-full max-w-md rounded-3xl border border-border shadow-2xl overflow-hidden"
        style={{ background: "var(--gradient-card)" }}
      >
        <div
          className="px-6 pt-6 pb-4 relative"
          style={{ background: "var(--gradient-hero)" }}
        >
          <button
            onClick={onDismiss}
            className="absolute top-4 right-4 h-8 w-8 rounded-full bg-white/20 flex items-center justify-center"
          >
            <X className="h-4 w-4 text-white" />
          </button>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-white/20 flex items-center justify-center">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-white/80 text-sm font-medium">New version available</p>
              <h2 className="text-white text-2xl font-black">v{update.latestVersion}</h2>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          {notes && (
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                What's new
              </p>
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">
                {notes}
              </p>
            </div>
          )}

          {isElectron && (
            <p className="text-sm text-muted-foreground">
              Update Now downloads the installer, closes this app, then runs Setup. Close any other P.O.S. Pro windows first.
            </p>
          )}

          <div className="space-y-2 pt-1">
            <Button
              className="w-full h-12 text-base font-black gap-2"
              style={{ background: "var(--gradient-hero)" }}
              onClick={handleUpdate}
              disabled={downloading}
            >
              <Download className="h-5 w-5" />
              {downloading
                ? (isElectron ? "Downloading — app will close…" : "Downloading…")
                : "Update Now"}
            </Button>
            <Button
              variant="ghost"
              className="w-full h-10 text-sm text-muted-foreground"
              onClick={onDismiss}
            >
              Remind me later
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
