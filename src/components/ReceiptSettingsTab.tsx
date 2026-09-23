import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  loadReceiptSettings,
  prepareLogoFile,
  saveReceiptSettings,
} from "@/lib/receiptSettings";

export function ReceiptSettingsTab({
  ownerId,
  defaultBarName,
}: {
  ownerId: string;
  defaultBarName: string;
}) {
  const [barName, setBarName] = useState(defaultBarName);
  const [tagline, setTagline] = useState("Thank you for your purchase!");
  const [logoData, setLogoData] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadReceiptSettings(ownerId).then((saved) => {
      if (cancelled) return;
      if (saved) {
        setBarName(saved.barName || defaultBarName);
        setTagline(saved.tagline || "Thank you for your purchase!");
        setLogoData(saved.logoData);
      } else {
        setBarName(defaultBarName);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [ownerId, defaultBarName]);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  const onPickLogo = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file");
      return;
    }
    try {
      const png = await prepareLogoFile(file);
      setLogoData(png);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not use that image");
    }
  };

  const onSave = async () => {
    const name = barName.trim();
    if (!name) { toast.error("Enter the bar name"); return; }
    setSaving(true);
    const error = await saveReceiptSettings({
      ownerId,
      barName: name,
      tagline: tagline.trim(),
      logoData,
    });
    setSaving(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Receipt settings saved");
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 5000);
  };

  if (loading) {
    return (
      <div className="py-16 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border p-4 space-y-4" style={{ background: "var(--gradient-card)" }}>
      <div>
        <p className="font-black text-base">Receipt</p>
        <p className="text-xs text-muted-foreground mt-1 leading-snug">
          This prints at the top of every receipt. The customer name is the last line of the header, and the tagline is the footer.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Logo</Label>
        <p className="text-[11px] text-muted-foreground">Shown as uploaded, above the bar name. The printer prints it in black and white.</p>
        {logoData ? (
          <div className="rounded-xl bg-white border border-zinc-300 p-3 flex flex-col items-center gap-2">
            <img src={logoData} alt="Receipt logo" className="max-h-24 object-contain" />
            <button
              type="button"
              onClick={() => setLogoData(null)}
              className="text-xs font-bold text-destructive inline-flex items-center gap-1"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove logo
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full h-24 rounded-xl border border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground active:scale-[0.99]"
          >
            <ImagePlus className="h-5 w-5" />
            <span className="text-xs font-bold">Add logo</span>
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            onPickLogo(file);
          }}
        />
        {logoData && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="text-xs font-bold text-primary"
          >
            Replace logo
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="receipt-bar-name" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Name of bar
        </Label>
        <Input
          id="receipt-bar-name"
          value={barName}
          onChange={(e) => setBarName(e.target.value)}
          className="h-12 font-bold"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="receipt-tagline" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Footer tagline
        </Label>
        <Input
          id="receipt-tagline"
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          placeholder="Thank you for your purchase!"
          className="h-12"
        />
      </div>

      <div className="rounded-xl bg-white text-zinc-900 p-3 font-mono text-[11px] leading-tight text-center border border-zinc-300">
        {logoData && <img src={logoData} alt="" className="mx-auto mb-1 max-h-14 object-contain" />}
        <div className="font-black uppercase">{barName.trim() || "Bar name"}</div>
        <div className="text-zinc-500">9/21/2026, 2:43 PM</div>
        <div className="text-zinc-500">Served by cashier</div>
        <div className="text-zinc-700">Customer: name</div>
        <div className="border-t border-dashed border-zinc-300 my-2" />
        <div className="text-zinc-500">{tagline.trim() || "Thank you for your purchase!"}</div>
      </div>

      <Button
        className="w-full h-12 font-black"
        disabled={saving}
        onClick={onSave}
        style={
          saved
            ? { background: "#16a34a", color: "#ffffff" }
            : { background: "var(--gradient-hero)", color: "var(--primary-foreground)" }
        }
      >
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : saved ? (
          <><Check className="h-4 w-4" /> Saved</>
        ) : (
          "Save receipt"
        )}
      </Button>
    </div>
  );
}
