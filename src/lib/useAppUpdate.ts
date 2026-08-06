/**
 * useAppUpdate
 *
 * Fetches /version.json from the download page and compares it to the
 * version baked into the current APK bundle (VITE_APP_VERSION).
 *
 * If the remote version is newer, returns an UpdateInfo object that
 * triggers the UpdateBanner modal in App.tsx.
 */

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";

export interface UpdateInfo {
  latestVersion: string;
  apkUrl: string;
  downloadPage: string;
  releaseNotes?: string;
  releaseDate?: string;
}

interface VersionJson {
  version: string;
  apkUrl: string;
  downloadPage: string;
  releaseNotes?: string;
  releaseDate?: string;
}

const VERSION_URL = "https://raw.githubusercontent.com/murrentronics/pos-pro/main/public/version.json";
const CURRENT_VERSION: string = import.meta.env.VITE_APP_VERSION ?? "0.0.0";

/** Returns true when remote > local using semver integer comparison */
function isNewer(remote: string, local: string): boolean {
  const parse = (v: string) =>
    v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [rMaj, rMin, rPat] = parse(remote);
  const [lMaj, lMin, lPat] = parse(local);
  if (rMaj !== lMaj) return rMaj > lMaj;
  if (rMin !== lMin) return rMin > lMin;
  return rPat > lPat;
}

export function useAppUpdate() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    // Only check for updates inside the native Android APK.
    // Skip on web — there is nothing to update there.
    if (!Capacitor.isNativePlatform()) return;

    // Don't check if the version wasn't baked in (dev mode)
    if (!CURRENT_VERSION || CURRENT_VERSION === "0.0.0" || CURRENT_VERSION === "web") return;

    const check = async () => {
      try {
        const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return;
        const data: VersionJson = await res.json();
        if (!data?.version) return;

        if (isNewer(data.version, CURRENT_VERSION)) {
          setUpdate({
            latestVersion: data.version,
            apkUrl: data.apkUrl,
            downloadPage: data.downloadPage,
            releaseNotes: data.releaseNotes,
            releaseDate: data.releaseDate,
          });
        }
      } catch {
        // Offline or network error — silently ignore, try again next session
      }
    };

    // Check after a short delay so the app finishes loading first
    const t = setTimeout(check, 4000);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => setUpdate(null);

  return { update, dismiss };
}
