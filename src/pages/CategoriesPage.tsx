import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useChain } from "@/lib/ChainContext";
import { supabase } from "@/integrations/supabase/client";
import { Pencil, Trash2, Plus, Loader2, Check, X, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Drag state ────────────────────────────────────────────────────────────
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("store_categories")
      .select("*")
      .eq("owner_id", ownerId)
      .order("sort_order", { ascending: true });
    setLoading(false);
    if (error) { toast.error("Could not load categories: " + error.message); return; }
    setCategories(data ?? []);
  };

  useEffect(() => {
    if (ownerId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  const openCreate = () => { setEditId(null); setFormName(""); setShowForm(true); };
  const openEdit = (cat: Category) => { setEditId(cat.id); setFormName(cat.name); setShowForm(true); };
  const cancelForm = () => { setShowForm(false); setEditId(null); setFormName(""); };

  const handleSave = async () => {
    const trimmed = formName.trim();
    if (!trimmed) { toast.error("Category name is required"); return; }
    setSaving(true);
    if (editId) {
      const { error } = await supabase
        .from("store_categories").update({ name: trimmed }).eq("id", editId).eq("owner_id", ownerId);
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      toast.success("Category updated");
    } else {
      const nextOrder = categories.length > 0
        ? Math.max(...categories.map((c) => c.sort_order)) + 1 : 0;
      const { error } = await supabase
        .from("store_categories")
        .insert({ owner_id: ownerId, name: trimmed, icon: "", sort_order: nextOrder });
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      toast.success("Category created");
    }
    cancelForm();
    load();
  };

  const handleDelete = async (cat: Category) => {
    setDeletingId(cat.id);
    const { error } = await supabase
      .from("store_categories").delete().eq("id", cat.id).eq("owner_id", ownerId);
    setDeletingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`"${cat.name}" deleted`);
    setCategories((prev) => prev.filter((c) => c.id !== cat.id));
  };

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, index: number) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = "move";
    // Transparent drag ghost
    const ghost = document.createElement("div");
    ghost.style.position = "absolute";
    ghost.style.top = "-9999px";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => document.body.removeChild(ghost), 0);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const fromIndex = dragIndexRef.current;
    if (fromIndex === null || fromIndex === dropIndex) {
      setDragOverIndex(null);
      dragIndexRef.current = null;
      return;
    }

    // Reorder locally
    const reordered = [...categories];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(dropIndex, 0, moved);
    // Assign new sort_order values
    const updated = reordered.map((c, i) => ({ ...c, sort_order: i }));
    setCategories(updated);
    setDragOverIndex(null);
    dragIndexRef.current = null;

    // Persist to DB
    setSavingOrder(true);
    const updates = updated.map((c) =>
      supabase.from("store_categories")
        .update({ sort_order: c.sort_order })
        .eq("id", c.id)
        .eq("owner_id", ownerId)
    );
    const results = await Promise.all(updates);
    setSavingOrder(false);
    if (results.some((r) => r.error)) {
      toast.error("Failed to save order — reload and try again");
    }
  };

  const handleDragEnd = () => {
    dragIndexRef.current = null;
    setDragOverIndex(null);
  };

  // Touch drag (mobile) ─────────────────────────────────────────────────────
  const touchDragIndex = useRef<number | null>(null);
  const touchStartY = useRef<number>(0);

  const handleTouchStart = (e: React.TouchEvent, index: number) => {
    touchDragIndex.current = index;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchDragIndex.current === null) return;
    const y = e.touches[0].clientY;
    // Find the element under the touch point
    const el = document.elementFromPoint(e.touches[0].clientX, y);
    const row = el?.closest("[data-cat-index]");
    if (row) {
      const idx = parseInt(row.getAttribute("data-cat-index") ?? "-1", 10);
      if (idx >= 0) setDragOverIndex(idx);
    }
  };

  const handleTouchEnd = async () => {
    const fromIndex = touchDragIndex.current;
    const toIndex = dragOverIndex;
    touchDragIndex.current = null;
    setDragOverIndex(null);
    if (fromIndex === null || toIndex === null || fromIndex === toIndex) return;

    const reordered = [...categories];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const updated = reordered.map((c, i) => ({ ...c, sort_order: i }));
    setCategories(updated);

    setSavingOrder(true);
    const updates = updated.map((c) =>
      supabase.from("store_categories")
        .update({ sort_order: c.sort_order })
        .eq("id", c.id)
        .eq("owner_id", ownerId)
    );
    await Promise.all(updates);
    setSavingOrder(false);
  };

  if (!profile) return null;

  return (
    <div className="space-y-5 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 -mx-3 px-3 pt-2 pb-2 bg-background/95 backdrop-blur border-b border-border">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-black leading-tight">Categories</h1>
            {savingOrder && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          </div>
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
          <div className="space-y-1.5">
            <label className="text-xs font-black text-muted-foreground uppercase tracking-wider">Name</label>
            <Input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="e.g. Beverages, Snacks, Electronics…"
              className="font-semibold"
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") cancelForm(); }}
              autoFocus
            />
          </div>
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

      {/* Hint */}
      {!loading && categories.length > 1 && (
        <p className="text-xs text-muted-foreground px-1">
          Hold and drag the <GripVertical className="inline h-3 w-3 mb-0.5" /> handle to reorder. Order here is the tab order on the register.
        </p>
      )}

      {/* List */}
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
          {categories.map((cat, index) => {
            const isDragOver = dragOverIndex === index;
            return (
              <div
                key={cat.id}
                data-cat-index={index}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                className="flex items-center gap-3 px-3 py-3 rounded-2xl border transition-all"
                style={{
                  background: isDragOver ? "rgba(var(--primary-rgb,251 146 60)/0.12)" : "var(--gradient-card)",
                  borderColor: isDragOver ? "var(--primary)" : "var(--border)",
                  transform: isDragOver ? "scale(1.01)" : "scale(1)",
                  boxShadow: isDragOver ? "0 4px 20px rgba(0,0,0,0.3)" : undefined,
                }}
              >
                {/* Drag handle */}
                <div
                  className="h-9 w-7 flex items-center justify-center shrink-0 cursor-grab active:cursor-grabbing touch-none select-none"
                  onTouchStart={(e) => handleTouchStart(e, index)}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  title="Drag to reorder"
                >
                  <GripVertical className="h-5 w-5 text-muted-foreground/50" />
                </div>

                <span className="flex-1 font-black text-sm">{cat.name}</span>

                <button
                  onClick={() => openEdit(cat)}
                  className="h-9 w-9 rounded-xl flex items-center justify-center transition hover:bg-muted active:scale-90"
                  title="Edit"
                >
                  <Pencil className="h-4 w-4 text-primary" />
                </button>

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
            );
          })}
        </div>
      )}
    </div>
  );
}
