import { supabase } from "@/integrations/supabase/client";

export type PurchaseOrderLine = {
  productId: string;
  qty: number;
  batchCost: number;
  sellPrice: number;
};

export type PurchaseOrderTemplate = {
  id: string;
  name: string;
  supplierName: string;
  lines: PurchaseOrderLine[];
};

function asLines(value: unknown): PurchaseOrderLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    const productId = String(r.productId ?? "").trim();
    if (!productId) return [];
    return [{
      productId,
      qty: Number(r.qty) || 0,
      batchCost: Number(r.batchCost) || 0,
      sellPrice: Number(r.sellPrice) || 0,
    }];
  });
}

export async function listPurchaseOrders(ownerId: string): Promise<PurchaseOrderTemplate[]> {
  const { data, error } = await (supabase as any)
    .from("purchase_order_templates")
    .select("id, name, supplier_name, lines")
    .eq("owner_id", ownerId)
    .order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; name: string; supplier_name: string | null; lines: unknown }[])
    .map((row) => ({
      id: row.id,
      name: (row.name ?? "").trim(),
      supplierName: (row.supplier_name ?? "").trim(),
      lines: asLines(row.lines),
    }))
    .filter((row) => row.name)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export async function savePurchaseOrder(
  ownerId: string,
  name: string,
  supplierName: string,
  lines: PurchaseOrderLine[],
): Promise<void> {
  const trimmed = name.trim();
  if (!ownerId || !trimmed) throw new Error("Enter a template name");
  if (lines.length === 0) throw new Error("Add a quantity before saving a template");
  const { error } = await (supabase as any).from("purchase_order_templates").insert({
    owner_id: ownerId,
    name: trimmed,
    supplier_name: supplierName.trim() || null,
    lines,
  });
  if (error) {
    if (error.code === "23505") throw new Error("A template with that name already exists");
    throw new Error(error.message);
  }
}
