/**
 * Public download page — Windows EXE (USB printers / cash drawers) + Android APK.
 * Unauthenticated. Linked from the login "Download" button, same as Bartendaz Pro.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, Smartphone, Monitor, Box } from "lucide-react";
import { toast } from "sonner";

const GITHUB_RELEASES = "https://github.com/murrentronics/pos-pro/releases";

async function downloadBinary(url: string) {
  const sameOrigin = url.startsWith("/") || url.startsWith(window.location.origin);
  if (sameOrigin) {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    const type = (res.headers.get("content-type") || "").toLowerCase();
    if (!res.ok || type.includes("text/html")) {
      throw new Error("NOT_READY");
    }
  }
  // Real navigation download. Do not set the `download` attribute — that
  // renamed truncated Cloudflare files to POS-Pro-Setup.exe.
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function DownloadAppPage() {
  const [apkVersion, setApkVersion] = useState<string>("");
  const [exeVersion, setExeVersion] = useState<string>("");
  const [apkUrl, setApkUrl] = useState(
    "https://github.com/murrentronics/pos-pro/releases/latest/download/pos-pro.apk"
  );
  const [exeUrl, setExeUrl] = useState(
    `${GITHUB_RELEASES}/latest/download/POS-Pro-Setup.exe`
  );

  useEffect(() => {
    (async () => {
      let githubExe = false;
      try {
        const res = await fetch(
          "https://api.github.com/repos/murrentronics/pos-pro/releases/latest",
          { headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(8000) }
        );
        if (res.ok) {
          const data = await res.json() as {
            tag_name?: string;
            assets?: { name: string; browser_download_url: string }[];
          };
          if (data.tag_name) setApkVersion(data.tag_name.replace(/^v/, ""));
          const apk = data.assets?.find((a) => a.name.toLowerCase().endsWith(".apk"));
          if (apk) setApkUrl(apk.browser_download_url);
          const exes = (data.assets || []).filter((a) => a.name.toLowerCase().endsWith(".exe"));
          const versioned = data.tag_name
            ? exes.find((a) => a.name.includes(data.tag_name!.replace(/^v/, "")))
            : undefined;
          const exe = versioned || exes.find((a) => a.name === "POS-Pro-Setup.exe") || exes[0];
          if (exe) {
            githubExe = true;
            setExeUrl(exe.browser_download_url);
          }
        }
      } catch { /* keep fallbacks */ }

      try {
        const v = await fetch("/downloads/version.json", { signal: AbortSignal.timeout(5000) });
        if (v.ok) {
          const json = await v.json() as { exe?: string; apk?: string; exeUrl?: string; exeLatestUrl?: string };
          if (json.exe) setExeVersion(json.exe);
          if (json.apk) setApkVersion((prev) => prev || json.apk!);
          if (!githubExe && (json.exeUrl || json.exeLatestUrl)) {
            setExeUrl(json.exeUrl || json.exeLatestUrl!);
          }
        }
      } catch { /* version labels optional */ }
    })();
  }, []);

  return (
    <div
      className="h-screen overflow-y-scroll"
      style={{ background: "radial-gradient(circle at 20% 0%, oklch(0.22 0.08 240) 0%, oklch(0.08 0.04 240) 60%)" }}
    >
      <div className="max-w-4xl mx-auto p-4 md:p-8 pb-16">
        <div className="text-center mb-6">
          <h1 className="text-3xl md:text-4xl font-bold mb-2 text-white">
            Download P.O.S. Pro
          </h1>
          <p className="text-sm md:text-base text-white/70">
            The complete point-of-sale app for store owners and cashiers
          </p>
        </div>

        <Card className="shadow-lg mb-4 bg-card/90 border-border">
          <CardHeader className="text-center border-b py-4">
            <Monitor className="w-12 h-12 md:w-16 md:h-16 mb-3 text-primary mx-auto" />
            <CardTitle className="text-xl md:text-2xl">Download for Windows</CardTitle>
            <CardDescription className="text-sm md:text-base mt-2 text-center mx-auto max-w-xl">
              Native desktop app with full hardware support for USB printers and cash drawers.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 pb-4">
            <div className="bg-muted/50 rounded-lg p-3 md:p-4 mb-4 space-y-1 text-center">
              <p className="text-xs md:text-sm text-muted-foreground">✓ Full USB printer support (EPSON TM-T20II, Star, etc.)</p>
              <p className="text-xs md:text-sm text-muted-foreground">✓ Cash drawer control via printer DK port</p>
              <p className="text-xs md:text-sm text-muted-foreground">✓ Works offline — no internet required after setup</p>
              <p className="text-xs md:text-sm text-muted-foreground">✓ Faster performance than the browser version</p>
            </div>

            <div className="rounded-lg border p-3 md:p-4 mb-4 text-center" style={{ borderColor: "#92400e", background: "#fef3c7" }}>
              <p className="text-sm md:text-base font-black" style={{ color: "#451a03" }}>
                Already have P.O.S. Pro installed?
              </p>
              <p className="text-xs md:text-sm font-semibold mt-1" style={{ color: "#451a03" }}>
                Uninstall it first: Settings → Apps → P.O.S. Pro → Uninstall
                (or Control Panel → Programs and Features). Then run the new Setup.
              </p>
            </div>

            <div className="flex justify-center">
              <Button
                onClick={async () => {
                  try {
                    await downloadBinary(exeUrl);
                    toast.success("Download started. Uninstall the old P.O.S. Pro from Settings → Apps before running the new Setup.");
                  } catch {
                    toast.error("Windows installer is still publishing. Wait for the local Electron build to finish, then try again.");
                  }
                }}
                size="lg"
                className="text-sm md:text-lg py-4 md:py-6 px-6 md:px-8 w-full md:w-auto text-primary-foreground"
                style={{ background: "linear-gradient(135deg, #00b4ff 0%, #0047ab 100%)" }}
              >
                <Box className="mr-2 h-4 w-4 md:h-5 md:w-5" />
                <span className="truncate">Download for Windows{exeVersion ? ` (v${exeVersion})` : ""}</span>
              </Button>
            </div>

            <div className="text-center text-xs md:text-sm text-muted-foreground mt-3">
              <p>
                Windows 10 or later • 64-bit
                <br className="hidden md:block" />
                <span className="md:hidden">• </span>After download, open it from your Downloads folder. Close P.O.S. Pro before installing.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-lg mb-4 bg-card/90 border-border">
          <CardHeader className="text-center border-b py-4">
            <Smartphone className="w-12 h-12 md:w-16 md:h-16 mb-3 text-primary mx-auto" />
            <CardTitle className="text-xl md:text-2xl">Download for Android</CardTitle>
            <CardDescription className="text-sm md:text-base mt-2 text-center mx-auto max-w-xl">
              Android app with support for Bluetooth printers and USB-C OTG devices.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 pb-4">
            <div className="bg-muted/50 rounded-lg p-3 md:p-4 mb-4 space-y-1 text-center">
              <p className="text-xs md:text-sm text-muted-foreground">✓ Bluetooth printer support</p>
              <p className="text-xs md:text-sm text-muted-foreground">✓ USB-C OTG printer support</p>
              <p className="text-xs md:text-sm text-muted-foreground">✓ Cash drawer control via printer connection</p>
              <p className="text-xs md:text-sm text-muted-foreground">✓ Works on tablets and phones</p>
            </div>

            <div className="flex justify-center">
              <Button
                onClick={() => { window.location.assign(apkUrl); }}
                size="lg"
                className="text-sm md:text-lg py-4 md:py-6 px-6 md:px-8 w-full md:w-auto text-primary-foreground"
                style={{ background: "linear-gradient(135deg, #00b4ff 0%, #0047ab 100%)" }}
              >
                <Download className="mr-2 h-4 w-4 md:h-5 md:w-5" />
                <span className="truncate">Download Android APK{apkVersion ? ` (v${apkVersion})` : ""}</span>
              </Button>
            </div>

            <div className="text-center text-xs md:text-sm text-muted-foreground mt-3">
              <p>
                Android 8.0+
                <br className="hidden md:block" />
                <span className="md:hidden">• </span>Enable &quot;Unknown sources&quot; in settings
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="mt-4 text-center text-xs md:text-sm text-white/50">
          <p>
            Need help?{" "}
            <a href="https://wa.me/18687865811" className="text-primary hover:underline">
              WhatsApp
            </a>
            {" or "}
            <a href="mailto:support@pospro.app" className="text-primary hover:underline">
              support@pospro.app
            </a>
          </p>
        </div>

        <div className="mt-4 text-center">
          <Button variant="ghost" size="sm" className="text-white/70" onClick={() => { window.location.hash = "#/login"; }}>
            ← Back to login
          </Button>
        </div>
      </div>
    </div>
  );
}
