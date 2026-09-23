import { supabase } from "@/integrations/supabase/client";
import type { ReceiptData } from "@/lib/receiptPrinter";

export type ReceiptSettings = {
  ownerId: string;
  barName: string;
  tagline: string;
  logoData: string | null;
};

const PAPER_DOTS = 576;

let cache: { ownerId: string; settings: ReceiptSettings | null; at: number } | null = null;

export function clearReceiptSettingsCache() {
  cache = null;
}

export async function loadReceiptSettings(ownerId: string): Promise<ReceiptSettings | null> {
  if (!ownerId) return null;
  if (cache?.ownerId === ownerId && Date.now() - cache.at < 60_000) return cache.settings;
  const { data, error } = await (supabase as any)
    .from("receipt_settings")
    .select("bar_name, tagline, logo_data")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) return cache?.ownerId === ownerId ? cache.settings : null;
  const settings: ReceiptSettings | null = data
    ? {
        ownerId,
        barName: String(data.bar_name ?? "").trim(),
        tagline: String(data.tagline ?? "").trim(),
        logoData: data.logo_data ? String(data.logo_data) : null,
      }
    : null;
  cache = { ownerId, settings, at: Date.now() };
  return settings;
}

export async function saveReceiptSettings(settings: ReceiptSettings): Promise<string | null> {
  const { error } = await (supabase as any).from("receipt_settings").upsert({
    owner_id: settings.ownerId,
    bar_name: settings.barName.trim(),
    tagline: settings.tagline.trim(),
    logo_data: settings.logoData,
    updated_at: new Date().toISOString(),
  });
  clearReceiptSettingsCache();
  return error?.message ?? null;
}

/** Keep the uploaded picture as-is. Only shrink very large files so they can be stored. */
export function prepareLogoFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that image"));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const img = new Image();
      img.onload = () => {
        const max = 640;
        if (img.width <= max && img.height <= max) {
          resolve(dataUrl);
          return;
        }
        const scale = Math.min(max / img.width, max / img.height);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(dataUrl); return; }
        ctx.drawImage(img, 0, 0, w, h);
        const mime = file.type === "image/jpeg" || file.type === "image/webp" ? file.type : "image/png";
        resolve(canvas.toDataURL(mime));
      };
      img.onerror = () => reject(new Error("Could not read that image"));
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

/** Thermal heads only accept black or white dots. Dither the color image so the picture survives. */
function rasterFromRgba(rgba: Uint8ClampedArray, width: number, height: number): string {
  const lum = new Float32Array(width * height);
  const opaque = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    opaque[i] = rgba[o + 3] > 128 ? 1 : 0;
    lum[i] = opaque[i] ? rgba[o] * 0.299 + rgba[o + 1] * 0.587 + rgba[o + 2] * 0.114 : 255;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!opaque[i]) continue;
      const old = lum[i];
      const bw = old < 128 ? 0 : 255;
      const err = old - bw;
      lum[i] = bw;
      const spread = (dx: number, dy: number, factor: number) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
        const ni = ny * width + nx;
        if (opaque[ni]) lum[ni] += err * factor;
      };
      spread(1, 0, 7 / 16);
      spread(-1, 1, 3 / 16);
      spread(0, 1, 5 / 16);
      spread(1, 1, 1 / 16);
    }
  }

  const bytesPerRow = Math.ceil(width / 8);
  const parts: number[] = [
    0x1d, 0x76, 0x30, 0x00,
    bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
  ];
  for (let y = 0; y < height; y++) {
    for (let xb = 0; xb < bytesPerRow; xb++) {
      let b = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = xb * 8 + bit;
        if (x >= width) continue;
        const i = y * width + x;
        if (opaque[i] && lum[i] < 128) b |= 0x80 >> bit;
      }
      parts.push(b);
    }
  }
  return parts.map((n) => String.fromCharCode(n)).join("");
}

/** Center the logo on an 80mm (576-dot) raster so it sits above the bar name. */
export function logoDataUrlToEscPos(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const maxW = 320;
      const maxH = 160;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const lw = Math.max(8, Math.round(img.width * scale));
      const lh = Math.max(8, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = PAPER_DOTS;
      canvas.height = lh;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("canvas")); return; }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, PAPER_DOTS, lh);
      ctx.drawImage(img, Math.floor((PAPER_DOTS - lw) / 2), 0, lw, lh);
      const pixels = ctx.getImageData(0, 0, PAPER_DOTS, lh).data;
      resolve(rasterFromRgba(pixels, PAPER_DOTS, lh));
    };
    img.onerror = () => reject(new Error("logo"));
    img.src = dataUrl;
  });
}

async function currentUser(): Promise<{ ownerId: string; username: string; firstName: string } | null> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, username, first_name, role, parent_id")
    .eq("id", uid)
    .maybeSingle();
  if (!data) return null;
  const ownerId = data.role === "owner" || !data.parent_id ? data.id : data.parent_id;
  if (!ownerId) return null;
  const firstName = (data.first_name ?? "").trim();
  return { ownerId, username: data.username, firstName: firstName || data.username };
}

/** Apply the owner's receipt header: bar name, logo, footer tagline, and the cashier on "Served by". */
export async function brandReceipt(data: ReceiptData): Promise<ReceiptData> {
  try {
    const me = await currentUser();
    if (!me) return data;
    const next: ReceiptData = { ...data };
    if (!next.serverName || next.serverName === "Staff" || next.serverName === me.username) next.serverName = me.firstName;
    const settings = await loadReceiptSettings(me.ownerId);
    if (settings?.barName) next.storeName = settings.barName;
    if (settings?.tagline) next.footerTagline = settings.tagline;
    if (settings?.logoData) {
      next.logoUrl = settings.logoData;
      if (!data.logoEscPos) {
        try { next.logoEscPos = await logoDataUrlToEscPos(settings.logoData); }
        catch { /* receipt still prints without the logo */ }
      }
    }
    return next;
  } catch {
    return data;
  }
}
