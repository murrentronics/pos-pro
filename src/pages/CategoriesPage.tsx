import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useChain } from "@/lib/ChainContext";
import { supabase } from "@/integrations/supabase/client";
import { Pencil, Trash2, Plus, Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";


const EMOJI_OPTIONS = [
  "🍺","🍾","🧃","🥃","🍸","🍹","🍷","🥂","🍶","🧋",
  "🚬","🍟","🍽️","🍕","🍔","🌮","🧁","🍰","🍫","📦",
  "🎲","💊","🧴","🛒","🥩","🥗","🍣","🍜","🍩","🍪",
];

type Category = {
  id: string;
  owner_id: string;
  name: string;
  icon: string;
  sort_order: number;
  created_at: string;
};

export default function CategoriesPage() {
  const { profile } = useAuth();
  const { effectiveOwnerId } = useChain();
  const ownerId = effectiveOwnerId(profile?.id ?? "");

  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  // Create/edit state
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formIcon, setFormIcon] = useState("📦");
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await sb
      .from("store_categories")
      .select("*")
      .eq("owner_id", ownerId)
      .order("sort_order", { ascending: true });
    setLoading(false);
    if (error) {
      toast.error("Could not load categories: " + error.message);
      return;
    }
    setCategories(data ?? []);
  };

  useEffect(() => {
    if (ownerId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  const openCreate = () => {
    setEditId(null);
    setFormName("");
    setFormIcon("📦");
    setShowForm(true);
  };

  const openEdit = (cat: Category) => {
    setEditId(cat.id);
    setFormName(cat.name);
    setFormIcon(cat.icon);
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditId(null);
    setFormName("");
    setFormIcon("📦");
  };

  const handleSave = async () => {
    const trimmed = formName.trim();
    if (!trimmed) { toast.error("Category name is required"); return; }

    setSaving(true);
    if (editId) {
      // Update
      const { error } = await sb
        .from("store_categories")
        .update({ name: trimmed, icon: formIcon })
        .eq("id", editId)
        .eq("owner_id", ownerId);
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      toast.success("Category updated");
    } else {
      // Insert
      const nextOrder = categories.length > 0
        ? Math.max(...categories.map((c) => c.sort_order)) + 1
        : 0;
      const { error } = await sb
        .from("store_categories")
        .insert({ owner_id: ownerId, name: trimmed, icon: formIcon, sort_order: nextOrder });
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      toast.success("Category created");
    }
    cancelForm();
    load();
  };

  const handleDelete = async (cat: Category) => {
    setDeletingId(cat.id);
    const { error } = await sb
      .from("store_categories")
      .delete()
      .eq("id", cat.id)
      .eq("owner_id", ownerId);
    setDeletingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`"${cat.name}" deleted`);
    setCategories((prev) => prev.filter((c) => c.id !== cat.id));
  };

  if (!profile) return null;

  return (
    <div className="space-y-5 pb-24">
      {/* Page title */}
      <div className="sticky top-0 z-20 -mx-3 px-3 pt-2 pb-2 bg-background/95 backdrop-blur border-b border-border">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-black leading-tight">Categories</h1>
          <Button
            onClick={openCreate}
            size="sm"
            className="gap-1.5 font-black"
            style={{ background: "var(--gradient-hero)", color: "var(--primary-foreground)" }}
          >
            <Plus className="h-4 w-4" /> Create Category
          </Button>
        </div>
      </div>

      {/* Create / Edit form */}
      {showForm && (
        <div className="rounded-2xl border border-border p-4 space-y-4"
          style={{ background: "var(--gradient-card)" }}>
          <p className="font-black text-sm">{editId ? "Edit Category" : "New Category"}</p>

          {/* Icon picker */}
          <div className="space-y-2">
            <label className="text-xs font-black text-muted-foreground uppercase tracking-wider">Icon</label>
            <div className="flex flex-wrap gap-2">
              {EMOJI_OPTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setFormIcon(e)}
                  className={`h-10 w-10 rounded-xl text-xl flex items-center justify-center transition border-2 ${
                    formIcon === e ? "border-primary" : "border-transparent bg-muted"
                  }`}
                  style={formIcon === e ? { background: "var(--gradient-hero)" } : {}}
                >
                  {e}
                </button>
              ))}
              {/* Custom emoji input */}
              <input
                type="text"
                value={formIcon}
                onChange={(e) => setFormIcon(e.target.value.slice(-2) || formIcon)}
                className="h-10 w-16 rounded-xl text-center text-xl bg-muted border border-border font-black outline-none focus:border-primary"
                placeholder="✏️"
                maxLength={2}
              />
            </div>
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-black text-muted-foreground uppercase tracking-wider">Name</label>
            <Input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="e.g. Beer, Rum, Snacks…"
              className="font-semibold"
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") cancelForm(); }}
              autoFocus
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={cancelForm} className="gap-1.5">
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || !formName.trim()}
              className="gap-1.5 font-black"
              style={{ background: "var(--gradient-hero)", color: "var(--primary-foreground)" }}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {editId ? "Save Changes" : "Create"}
            </Button>
          </div>
        </div>
      )}

      {/* Category list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : categories.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <span className="text-5xl">📂</span>
          <p className="text-sm font-semibold">No categories yet</p>
          <p className="text-xs text-center max-w-xs">
            Create categories to organise your items on the register screen.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {categories.map((cat) => (
            <div
              key={cat.id}
              className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-border"
              style={{ background: "var(--gradient-card)" }}
            >
              <span className="text-2xl w-9 text-center">{cat.icon}</span>
              <span className="flex-1 font-black text-sm">{cat.name}</span>

              {/* Edit */}
              <button
                onClick={() => openEdit(cat)}
                className="h-9 w-9 rounded-xl flex items-center justify-center transition hover:bg-muted active:scale-90"
                title="Edit"
              >
                <Pencil className="h-4 w-4 text-primary" />
              </button>

              {/* Delete */}
              <button
                onClick={() => handleDelete(cat)}
                disabled={deletingId === cat.id}
                className="h-9 w-9 rounded-xl flex items-center justify-center transition hover:bg-destructive/10 active:scale-90 disabled:opacity-40"
                title="Delete"
              >
                {deletingId === cat.id
                  ? <Loader2 className="h-4 w-4 animate-spin text-destructive" />
                  : <Trash2 className="h-4 w-4 text-destructive" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
