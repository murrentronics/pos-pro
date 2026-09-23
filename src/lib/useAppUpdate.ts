/**
 * useAppUpdate
 *
 * Checks the public GitHub Releases repo (and pospro-web version.json)
 * for a newer build. Android uses the .apk; Electron uses the .exe installer.
 * Web never shows the banner.
 *
 * Convention for GitHub releases:
 *   - Tag name:  v1.2.0  (semver, must start with "v")
 *   - Assets:    pos-pro.apk  and  POS-Pro-Setup.exe
 */

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";

const GITHUB_OWNER = "murrentronics";
const GITHUB_REPO  = "pos-pro";
const RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=10`;
const VERSION_JSON_URL = "https://pospro-web.pages.dev/downloads/version.json";
const BAKED_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "1.0.0";

type GhAsset = { name: string; browser_download_url: string };
type GhRelease = { tag_name?: string; body?: string; draft?: boolean; prerelease?: boolean; assets?: GhAsset[] };

export type UpdateInfo = {
  latestVersion: string;
  apkUrl: string;
  releaseNotes: string;
};

function parseSemver(tag: string): number[] {
  return tag.replace(/^v/, "").split(".").map(Number);
}

function isNewer(current: string, latest: string): boolean {
  const c = parseSemver(current);
  const l = parseSemver(latest);
  for (let i = 0; i < 3; i++) {
    const cv = c[i] ?? 0;
    const lv = l[i] ?? 0;
    if (Number.isNaN(cv) || Number.isNaN(lv)) return false;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

function isElectronApp() {
  return (
    (typeof window !== "undefined" && window.electronAPI?.isElectron === true) ||
    import.meta.env.VITE_IS_ELECTRON === "true"
  );
}

function pickAsset(assets: GhAsset[] | undefined, ext: ".apk" | ".exe") {
  return assets?.find((a) => a.name.toLowerCase().endsWith(ext));
}

async function currentAppVersion(electron: boolean): Promise<string> {
  if (electron && window.electronAPI?.getVersion) {
    try {
      const v = await window.electronAPI.getVersion();
      if (v && v !== "web") return v;
    } catch {
      /* use baked version */
    }
  }
  return BAKED_VERSION === "web" ? "0.0.0" : BAKED_VERSION;
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function useAppUpdate() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const android = Capacitor.isNativePlatform();
    const electron = isElectronApp();
    if (!android && !electron) return;

    const check = async () => {
      const current = await currentAppVersion(electron);
      const ext = electron ? ".exe" : ".apk";

      const releases = (await fetchJson<GhRelease[]>(RELEASES_API, 12000)) ?? [];
      let best: { version: string; url: string; notes: string } | null = null;
      for (const rel of releases) {
        if (rel.draft || rel.prerelease) continue;
        const version = (rel.tag_name ?? "").replace(/^v/, "");
        const asset = pickAsset(rel.assets, ext);
        if (!version || !asset) continue;
        if (!isNewer(current, version)) continue;
        if (!best || isNewer(best.version, version)) {
          best = { version, url: asset.browser_download_url, notes: rel.body ?? "" };
        }
      }

      if (!best) {
        const site = await fetchJson<{ exe?: string; apk?: string }>(VERSION_JSON_URL, 8000);
        const siteVer = electron ? site?.exe : site?.apk;
        if (siteVer && isNewer(current, siteVer)) {
          const file = electron
            ? `POS-Pro-Setup-${siteVer}.exe`
            : `pos-pro-${siteVer}.apk`;
          best = {
            version: siteVer,
            url: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v${siteVer}/${file}`,
            notes: "",
          };
        }
      }

      if (!best) return;

      setUpdate({
        latestVersion: best.version,
        apkUrl: best.url,
        releaseNotes: best.notes,
      });
    };

    check();
    const interval = setInterval(check, 4 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return {
    update: dismissed ? null : update,
    dismiss: () => setDismissed(true),
  };
}
