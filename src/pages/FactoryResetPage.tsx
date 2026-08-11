import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, Trash2, RefreshCw } from "lucide-react";

type Mode = "soft" | "full" | null;

export default function FactoryResetPage() {
  const { profile, refreshProfile, signOut } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  if (!profile || profile.role !== "owner") {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <p className="text-muted-foreground text-sm">Owner access only.</p>
      </div>
    );
  }

  const CONFIRM_WORD = mode === "full" ? "WIPE EVERYTHING" : "RESET";

  const handleReset = async () => {
    if (confirm !== CONFIRM_WORD) {
      toast.error(`Type exactly: ${CONFIRM_WORD}`);
      return;
    }
    setBusy(true);
    try {
      const rpc = mode === "full" ? "full_wipe_owner" : "soft_reset_owner";
      const { error } = await (supabase.rpc as any)(rpc, { p_owner_id: profile.id });
      if (error) { toast.error(error.message); return; }

      toast.success(
        mode === "full"
          ? "Full wipe complete. All data has been cleared."
          : "Reset complete. Records cleared, stock set to 0."
      );

      await refreshProfile();
      nav("/register");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto py-6 px-1 space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)" }}>
          <AlertTriangle className="h-5 w-5 text-red-500" />
        </div>
        <div>
          <h1 className="text-xl font-black">Factory Reset</h1>
          <p className="text-xs text-muted-foreground">This cannot be undone.</p>
        </div>
      </div>

      {/* Option cards */}
      <div className="space-y-3">

        {/* Soft reset */}
        <button
          onClick={() => { setMode("soft"); setConfirm(""); }}
          className="w-full rounded-2xl border-2 p-5 text-left transition active:scale-[0.98]"
          style={{
            borderColor: mode === "soft" ? "#f97316" : "var(--border)",
            background: mode === "soft" ? "rgba(249,115,22,0.08)" : "var(--gradient-card)",
          }}
        >
          <div className="flex items-center gap-3 mb-2">
            <RefreshCw className="h-5 w-5 shrink-0" style={{ color: "#f97316" }} />
            <span className="font-black text-base">Clear Records & Reset Stock</span>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Clears all orders, wallet transactions, expenses, sessions, and credit history.
            Resets every product's stock quantity to 0.
          </p>
          <p className="text-xs font-bold mt-2" style={{ color: "#86efac" }}>
            ✓ Keeps all products (with prices), categories, staff, and customers.
          </p>
        </button>

        {/* Full wipe */}
        <button
          onClick={() => { setMode("full"); setConfirm(""); }}
          className="w-full rounded-2xl border-2 p-5 text-left transition active:scale-[0.98]"
          style={{
            borderColor: mode === "full" ? "#ef4444" : "var(--border)",
            background: mode === "full" ? "rgba(239,68,68,0.08)" : "var(--gradient-card)",
          }}
        >
          <div className="flex items-center gap-3 mb-2">
            <Trash2 className="h-5 w-5 shrink-0 text-red-500" />
            <span className="font-black text-base">Full Wipe</span>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Deletes absolutely everything — products, categories, staff, customers, all orders,
            all financial records, all sessions. Your account and subscription are preserved.
          </p>
          <p className="text-xs font-bold mt-2 text-red-400">
            ✗ This deletes all products, staff accounts, and customer data. Start from scratch.
          </p>
        </button>
      </div>

      {/* Confirm input */}
      {mode && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5 space-y-4">
          <p className="text-sm font-bold text-red-400">
            {mode === "full"
              ? "You are about to wipe everything. This is permanent."
              : "You are about to clear all records and zero out stock. This is permanent."}
          </p>
          <p className="text-xs text-muted-foreground">
            Type <span className="font-black text-foreground">{CONFIRM_WORD}</span> to confirm:
          </p>
          <input
            className="w-full h-11 rounded-xl border border-border bg-background text-foreground px-4 text-sm font-black tracking-wide"
            placeholder={CONFIRM_WORD}
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            autoCapitalize="characters"
          />
          <div className="flex gap-3">
            <button
              onClick={() => { setMode(null); setConfirm(""); }}
              className="flex-1 h-11 rounded-xl font-black text-sm border border-border transition active:scale-95"
              style={{ background: "var(--gradient-card)" }}
            >
              Cancel
            </button>
            <button
              onClick={handleReset}
              disabled={busy || confirm !== CONFIRM_WORD}
              className="flex-1 h-11 rounded-xl font-black text-sm text-white disabled:opacity-40 transition active:scale-95"
              style={{ background: "#ef4444" }}
            >
              {busy ? "Working…" : mode === "full" ? "Wipe Everything" : "Reset Now"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
