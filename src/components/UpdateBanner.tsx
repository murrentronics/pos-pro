/**
 * UpdateBanner
 *
 * Shows a full-screen modal when a new APK version is available on GitHub.
 *
 * On native Android:
 *   1. Opens the direct APK URL via Capacitor Browser — Android intercepts
 *      the .apk MIME type and hands it to the system DownloadManager, which
 *      shows a progress notification and an "Open" tap when done.
 *   2. After a short delay, opens download.html in a second Browser tab so
 *      the install instructions are visible while the download runs.
 *
 * On web: opens the download page in a new tab as before.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, X, Sparkles } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import type { UpdateInfo } from "@/lib/useAppUpdate";

interface Props {
  update: UpdateInfo;
  onDismiss: () => void;
}

export function UpdateBanner({ update, onDismiss }: Props) {
  const [downloading, setDownloading] = useState(false);
  const [started, setStarted] = useState(false);

  const DOWNLOAD_PAGE = "https://pos-pro.pages.dev/download.html";

  const handleUpdate = async () => {
    if (downloading) return;
    setDownloading(true);

    try {
      if (Capacitor.isNativePlatform()) {
        const { Browser } = await import("@capacitor/browser");

        // Step 1: Open the direct APK URL.
        // Android intercepts .apk downloads and routes them through the
        // system DownloadManager — shows a status-bar progress notification
        // and an "Open / Install" action when the download finishes.
        await Browser.open({
          url: update.apkUrl,
          presentationStyle: "fullscreen",
          toolbarColor: "#000d1a",
        });

        setStarted(true);

        // Step 2: After a brief moment open the download/install guide page
        // so the user can read the install steps while the APK downloads.
        await new Promise((r) => setTimeout(r, 1800));
        await Browser.open({
          url: DOWNLOAD_PAGE,
          presentationStyle: "fullscreen",
          toolbarColor: "#000d1a",
        });
      } else {
        // Web fallback — direct APK link triggers a browser download
        window.open(update.apkUrl, "_blank");
      }
    } catch {
      // If anything fails fall back to the download page
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

  // Trim release notes to a reasonable length
  const notes = update.releaseNotes
    ? update.releaseNotes.slice(0, 300) + (update.releaseNotes.length > 300 ? "…" : "")
    : null;

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div
        className="w-full max-w-md rounded-3xl border border-border shadow-2xl overflow-hidden"
        style={{ background: "var(--gradient-card)" }}
      >
        {/* Header */}
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

        {/* Body */}
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

          {/* Status hint shown after download has kicked off */}
          {started && (
            <div className="rounded-xl px-4 py-3 text-sm text-green-300 font-semibold flex items-center gap-2"
              style={{ background: "oklch(0.18 0.08 145 / 0.7)", border: "1px solid oklch(0.4 0.12 145 / 0.5)" }}>
              <Download className="h-4 w-4 shrink-0" />
              Download started — check your notifications bar
            </div>
          )}

          <div className="space-y-2 pt-1">
            <Button
              className="w-full h-12 text-base font-black gap-2"
              style={{ background: "var(--gradient-hero)" }}
              onClick={handleUpdate}
              disabled={downloading}
            >
              <Download className="h-5 w-5" />
              {downloading ? "Starting download…" : started ? "Open again" : "Update Now"}
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
