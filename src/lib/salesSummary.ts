/**
 * Shared sales / cost aggregation used by Summary and Wallet session/today cards.
 * Bar sales always use the discounted order.total — never the pre-discount item list prices.
 */
import { supabase } from "@/integrations/supabase/client";

export type SummaryOrderItem = {
  id?: string;
  name: string;
  qty: number;
  price: number;
  units_consumed?: number | null;
  discount?: number;
  original_price?: number;
  /** Cost of one qty, saved at sale time so a later product delete still has a cost. */
  unit_cost?: number | null;
};

export type SummaryOrder = {
  total?: number;
  discount_amount?: number | null;
  original_total?: number | null;
  items?: SummaryOrderItem[] | null;
};

export type SummaryProductCost = {
  id: string;
  name: string;
  cost_price: number;
  units_per_item: number;
  category?: string | null;
};

export type AggregatedItem = {
  name: string;
  qty: number;
  revenue: number;
  costTotal: number;
  category: string;
};

const POUR_PREFIXES = ["shot", "2oz", "1oz", "retail", "pack", "drink", "half", "nip", "pq", "double", "quarter"];
const isSynthId = (id: string) => id.startsWith("shot-") || id.startsWith("pack-");

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Retail sticks and bottle pours are stored as "Label: Product Name" with a shot-/pack- id. */
export function isPourLine(id: string | undefined, name: string): boolean {
  if (isSynthId(id ?? "")) return true;
  const ci = name.indexOf(": ");
  if (ci === -1) return false;
  const prefix = name.slice(0, ci).trim().toLowerCase();
  return POUR_PREFIXES.some((p) => prefix === p || prefix.startsWith(p));
}

/** Product name after a retail/shot prefix. Whole-bottle lines keep their own name. */
export function resolvedProductName(name: string, id?: string): string {
  const ci = name.indexOf(": ");
  if (ci !== -1 && isPourLine(id, name)) return name.slice(ci + 2).trim();
  return name.trim();
}

function findCostProduct(
  it: SummaryOrderItem,
  products: SummaryProductCost[],
): SummaryProductCost | undefined {
  const id = it.id ?? "";
  if (id && !isSynthId(id)) {
    const byId = products.find((p) => p.id === id);
    if (byId) return byId;
  }
  const resolved = normName(resolvedProductName(it.name, id));
  return (
    products.find((p) => normName(p.name) === resolved) ??
    products.find((p) => normName(p.name) === normName(it.name))
  );
}

/**
 * Stock cost for one order line.
 * Whole items use the product cost price.
 * Retail sticks and rum/shot pours use cost price ÷ units in the pack or bottle,
 * times the units actually poured (or qty, for one-stick retail).
 * If the product was deleted, the unit_cost saved on the line is used.
 */
export function lineStockCost(it: SummaryOrderItem, products: SummaryProductCost[]): number {
  const qty = Number(it.qty) || 0;
  const product = findCostProduct(it, products);
  if (product) {
    const packCost = Number(product.cost_price) || 0;
    const unitsPer = Number(product.units_per_item) || 0;
    if (isPourLine(it.id, it.name)) {
      const perUnit = unitsPer > 0 ? packCost / unitsPer : packCost;
      const units =
        it.units_consumed != null && Number(it.units_consumed) > 0
          ? Number(it.units_consumed)
          : qty;
      return units * perUnit;
    }
    return qty * packCost;
  }
  const stored = Number(it.unit_cost ?? 0);
  return stored > 0 ? stored * qty : 0;
}

/** Cost of a single qty, for saving onto a new order line. */
export function orderItemUnitCost(it: SummaryOrderItem, products: SummaryProductCost[]): number {
  const qty = Number(it.qty) || 0;
  if (qty <= 0) return 0;
  return roundCents(lineStockCost({ ...it, unit_cost: null }, products) / qty);
}

export function roundCents(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Discounted amount actually collected for an order — never qty × list price. */
export function orderCollected(o: SummaryOrder): number {
  return roundCents(o.total ?? 0);
}

/** Page through PostgREST's 1000-row cap so day/session totals never go short. */
export async function fetchAllPaged<T>(
  run: (from: number, to: number) => PromiseLike<{ data: unknown }>,
): Promise<T[]> {
  const pageSize = 1000;
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data } = await run(from, from + pageSize - 1);
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

/** Trinidad & Tobago — used for Summary Day and Wallet Today. */
export const TT_TZ = "America/Port_of_Spain";

/** Calendar date in TT as YYYY-MM-DD. */
export function todayDateTT(date: Date = new Date()): string {
  return date.toLocaleDateString("en-CA", { timeZone: TT_TZ });
}

/**
 * Inclusive UTC bounds for a TT calendar day.
 * TT is UTC-4 year-round (no DST): 00:00 TT = 04:00 UTC.
 */
export function ttCalendarDayBounds(yyyyMmDd: string): { fromUTC: string; toUTC: string } {
  const fromMs = new Date(`${yyyyMmDd}T04:00:00.000Z`).getTime();
  return {
    fromUTC: new Date(fromMs).toISOString(),
    toUTC: new Date(fromMs + 86400000 - 1).toISOString(),
  };
}

/** Sum of discounted order totals — this is Bar Sales / Session Sales / Today's Sales. */
export function barSalesTotal(orders: SummaryOrder[]): number {
  return roundCents(orders.reduce((s, o) => s + orderCollected(o), 0));
}

function orderLevelDiscount(o: SummaryOrder, itemsGross: number): number {
  if (o.discount_amount != null && Number(o.discount_amount) > 0) {
    return Number(o.discount_amount);
  }
  const collected = orderCollected(o);
  if (itemsGross > 0 && collected < itemsGross - 0.009) {
    return itemsGross - collected;
  }
  return 0;
}

function itemLineGross(it: SummaryOrderItem): number {
  const line = Number(it.qty) * Number(it.price);
  const itemDisc = Number(it.discount ?? 0);
  return Math.max(0, line - (itemDisc > 0 ? itemDisc : 0));
}

export function aggregateItems(
  orders: SummaryOrder[],
  products: SummaryProductCost[],
): AggregatedItem[] {
  const categoryMap = new Map<string, string>(
    products.map((p) => [normName(p.name), p.category ?? "miscellaneous"]),
  );

  const map = new Map<string, { qty: number; revenue: number; costTotal: number; category: string }>();

  for (const o of orders) {
    const items = Array.isArray(o.items) ? o.items : [];
    const collectedRows = orderItemCollected(o);

    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      const existing = map.get(it.name) ?? { qty: 0, revenue: 0, costTotal: 0, category: "miscellaneous" };
      const resolved = resolvedProductName(it.name, it.id);
      const cat =
        categoryMap.get(normName(resolved)) ??
        categoryMap.get(normName(it.name)) ??
        existing.category;

      map.set(it.name, {
        qty: existing.qty + it.qty,
        revenue: existing.revenue + (collectedRows[idx]?.collected ?? 0),
        costTotal: existing.costTotal + lineStockCost(it, products),
        category: cat,
      });
    }
  }

  return Array.from(map.entries())
    .map(([name, v]) => ({
      name,
      qty: v.qty,
      revenue: roundCents(v.revenue),
      costTotal: roundCents(v.costTotal),
      category: v.category,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Per-line collected amounts (order discount / specials prorated). Sums to order.total. */
export function orderItemCollected(o: SummaryOrder): { name: string; qty: number; collected: number }[] {
  const items = Array.isArray(o.items) ? o.items : [];
  const itemsGross = items.reduce((s, it) => s + itemLineGross(it), 0);
  const discount = orderLevelDiscount(o, itemsGross);
  const rows = items.map((it) => {
    const lineGross = itemLineGross(it);
    const share = itemsGross > 0 ? lineGross / itemsGross : 0;
    return { name: it.name, qty: it.qty, collected: lineGross - discount * share };
  });
  const collected = orderCollected(o);
  const allocated = rows.reduce((s, r) => s + r.collected, 0);
  const drift = roundCents(collected - allocated);
  if (rows.length > 0 && Math.abs(drift) >= 0.005) {
    rows[rows.length - 1].collected += drift;
  }
  return rows.map((r) => ({ ...r, collected: roundCents(r.collected) }));
}

export function itemsCostTotal(items: AggregatedItem[]): number {
  return roundCents(items.reduce((s, it) => s + it.costTotal, 0));
}

export function isNonStockExpense(description: string | null | undefined): boolean {
  return (description ?? "").startsWith("Non-Stock Expense");
}

export function nonStockExpensesTotal(
  expenses: { amount: number; description?: string | null }[],
): number {
  return roundCents(
    expenses
      .filter((e) => isNonStockExpense(e.description) && Number(e.amount) > 0)
      .reduce((s, e) => s + Number(e.amount), 0),
  );
}

export type OwnerBookOrder = SummaryOrder & {
  cashier_id?: string | null;
  created_at?: string | null;
};

export type ManagerClear = {
  created_at: string;
  note?: string | null;
};

export type StaffRole = "manager" | "cashier";

/** Manager till handed to the owner. Cashier clears use a different note. */
export function isManagerClearNote(note: string | null | undefined): boolean {
  return (note ?? "").trim().toLowerCase().startsWith("cleared from manager");
}

/** Username after "Cleared from manager:". Older notes have no name. */
export function managerNameFromClearNote(note: string | null | undefined): string | null {
  const match = (note ?? "").trim().match(/^cleared from manager:\s*(.+)$/i);
  const name = match?.[1]?.trim().toLowerCase();
  return name || null;
}

export function isStaffClearNote(note: string | null | undefined): boolean {
  const text = (note ?? "").trim().toLowerCase();
  return text.startsWith("cleared from manager") || text.startsWith("cleared from cashier");
}

/** "manager" or "cashier" from a clear note. */
export function staffRoleFromClearNote(note: string | null | undefined): StaffRole | null {
  const text = (note ?? "").trim().toLowerCase();
  if (text.startsWith("cleared from manager")) return "manager";
  if (text.startsWith("cleared from cashier")) return "cashier";
  return null;
}

/** Username after "Cleared from manager:" or "Cleared from cashier:". */
export function staffNameFromClearNote(note: string | null | undefined): string | null {
  const match = (note ?? "").trim().match(/^cleared from (?:manager|cashier):\s*(.+)$/i);
  const name = match?.[1]?.trim().toLowerCase();
  return name || null;
}

/**
 * Summary keeps every sale and its amount.
 * A till clear is not added on top. Wallet All Time waits for the clear,
 * so Summary stays ahead until every balance is cleared, then the two match.
 */
export function ordersOnOwnerBooks<T extends OwnerBookOrder>(
  orders: T[],
  _managerIds?: Set<string>,
  _managerNames?: Map<string, string>,
  _clears?: ManagerClear[],
): T[] {
  return orders;
}

/**
 * All Time totals. The owner's own sales count immediately.
 * A manager or cashier sale counts only after that person has been cleared
 * at or after the sale. The clear is the gate, not a second sale.
 */
export function ordersSettledOnOwner<T extends OwnerBookOrder>(
  orders: T[],
  staffIds: Set<string>,
  staffNames: Map<string, string>,
  staffRoles: Map<string, StaffRole>,
  clears: ManagerClear[],
): T[] {
  if (staffIds.size === 0) return orders;

  const namedClears = new Map<string, number[]>();
  const unnamedManager: number[] = [];
  const unnamedCashier: number[] = [];
  for (const clear of clears) {
    const role = staffRoleFromClearNote(clear.note);
    if (!role) continue;
    const at = new Date(clear.created_at).getTime();
    if (!Number.isFinite(at)) continue;
    const name = staffNameFromClearNote(clear.note);
    if (!name) {
      (role === "manager" ? unnamedManager : unnamedCashier).push(at);
      continue;
    }
    const list = namedClears.get(name) ?? [];
    list.push(at);
    namedClears.set(name, list);
  }

  return orders.filter((order) => {
    const cashierId = order.cashier_id ?? "";
    if (!cashierId || !staffIds.has(cashierId)) return true;
    const saleAt = new Date(order.created_at ?? "").getTime();
    if (!Number.isFinite(saleAt)) return true;
    const name = staffNames.get(cashierId) ?? "";
    const named = name ? (namedClears.get(name) ?? []) : [];
    if (named.some((at) => at >= saleAt)) return true;
    const unnamed = staffRoles.get(cashierId) === "manager" ? unnamedManager : unnamedCashier;
    return unnamed.some((at) => at >= saleAt);
  });
}

/** One formula for Summary Day and Wallet Today / Session. */
export function barPeriodSummary(
  orders: SummaryOrder[],
  expenses: { amount: number; description?: string | null }[],
  products: SummaryProductCost[],
) {
  const sales = barSalesTotal(orders);
  const items = aggregateItems(orders, products);
  const stockCost = itemsCostTotal(items);
  const expenseTotal = nonStockExpensesTotal(expenses);
  const gross = roundCents(sales - stockCost);
  const net = roundCents(gross - expenseTotal);
  return { sales, items, stockCost, expenses: expenseTotal, gross, net };
}

export type OwnerBookContext = {
  managerIds: Set<string>;
  managerNames: Map<string, string>;
  staffIds: Set<string>;
  staffNames: Map<string, string>;
  staffRoles: Map<string, StaffRole>;
  clears: ManagerClear[];
};

/** Staff on this bar, and the clears that move their till onto the owner. */
export async function fetchOwnerBookContext(ownerId: string): Promise<OwnerBookContext> {
  const [staffRes, clears] = await Promise.all([
    supabase.from("profiles").select("id, username, role, job_title").eq("parent_id", ownerId),
    fetchAllPaged<{ note: string | null; created_at: string }>((from, to) =>
      supabase
        .from("wallet_transactions")
        .select("note, created_at")
        .eq("profile_id", ownerId)
        .eq("type", "transfer_in")
        .range(from, to),
    ),
  ]);

  const managerIds = new Set<string>();
  const managerNames = new Map<string, string>();
  const staffIds = new Set<string>();
  const staffNames = new Map<string, string>();
  const staffRoles = new Map<string, StaffRole>();
  for (const person of staffRes.data ?? []) {
    const isManager = person.role === "manager" || person.job_title === "manager";
    const isCashier = person.role === "cashier" || person.job_title === "cashier";
    if (!isManager && !isCashier) continue;
    const role: StaffRole = isManager ? "manager" : "cashier";
    staffIds.add(person.id);
    staffRoles.set(person.id, role);
    if (person.username) staffNames.set(person.id, person.username.trim().toLowerCase());
    if (!isManager) continue;
    managerIds.add(person.id);
    if (person.username) managerNames.set(person.id, person.username.trim().toLowerCase());
  }

  return {
    managerIds,
    managerNames,
    staffIds,
    staffNames,
    staffRoles,
    clears: clears.filter((row) => isStaffClearNote(row.note)),
  };
}
