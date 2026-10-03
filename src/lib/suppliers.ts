import { supabase } from "@/integrations/supabase/client";

export async function listSupplierNames(ownerId: string): Promise<string[]> {
  const sb = supabase as any;
  const { data, error } = await sb
    .from("owner_suppliers")
    .select("name")
    .eq("owner_id", ownerId)
    .order("name");
  if (!error && data) {
    return (data as { name: string }[])
      .map((r) => (r.name ?? "").trim())
      .filter(Boolean);
  }
  const [products, expenses] = await Promise.all([
    supabase.from("products").select("supplier_name").eq("owner_id", ownerId),
    supabase.from("owner_expenses").select("supplier_name").eq("owner_id", ownerId),
  ]);
  const names = new Set<string>();
  for (const row of [...(products.data ?? []), ...(expenses.data ?? [])] as { supplier_name?: string | null }[]) {
    const name = (row.supplier_name ?? "").trim();
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export async function rememberSupplier(ownerId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!ownerId || !trimmed) return;
  await (supabase as any)
    .from("owner_suppliers")
    .upsert({ owner_id: ownerId, name: trimmed }, { onConflict: "owner_id,name", ignoreDuplicates: true });
}
