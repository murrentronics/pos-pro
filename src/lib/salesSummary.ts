/**
 * Shared sales / cost aggregation used by Summary and Wallet session/today cards.
 * Bar sales always use the discounted order.total — never the pre-discount item list prices.
 */

export type SummaryOrderItem = {
  id?: string;
  name: string;
  qty: number;
  price: number;
  units_consumed?: number | null;
  discount?: number;
  original_price?: number;
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

const SYNTH = ["Shot", "2oz", "1oz", "Retail", "Pack"];
const isSynthId = (id: string) => id.startsWith("shot-") || id.startsWith("pack-");

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
  const costMap = new Map<string, number>(
    products.map((p) => [
      p.id,
      p.units_per_item > 0 ? p.cost_price / p.units_per_item : p.cost_price,
    ]),
  );
  const nameMap = new Map<string, number>(
    products.map((p) => [
      p.name,
      p.units_per_item > 0 ? p.cost_price / p.units_per_item : p.cost_price,
    ]),
  );
  const fullCostMap = new Map<string, number>(products.map((p) => [p.id, p.cost_price]));
  const fullNameMap = new Map<string, number>(products.map((p) => [p.name, p.cost_price]));
  const categoryMap = new Map<string, string>(
    products.map((p) => [p.name, p.category ?? "miscellaneous"]),
  );

  const map = new Map<string, { qty: number; revenue: number; costTotal: number; category: string }>();

  for (const o of orders) {
    const items = Array.isArray(o.items) ? o.items : [];
    const collectedRows = orderItemCollected(o);

    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      const existing = map.get(it.name) ?? { qty: 0, revenue: 0, costTotal: 0, category: "miscellaneous" };
      const itemId = it.id ?? "";
      const baseId = itemId.includes("__") ? itemId.split("__")[0] : itemId;
      const isSynth = isSynthId(itemId);

      let resolvedProductName = it.name;
      const ci = it.name.indexOf(": ");
      if (
        ci !== -1 &&
        (SYNTH.some((p) => it.name.slice(0, ci).toLowerCase().startsWith(p.toLowerCase())) || isSynth)
      ) {
        resolvedProductName = it.name.slice(ci + 2);
      }
      const cat = categoryMap.get(resolvedProductName) ?? categoryMap.get(it.name) ?? existing.category;

      let costEach = 0;
      let costUnits = it.qty;

      if (!isSynth && baseId && (fullCostMap.has(itemId) || fullCostMap.has(baseId))) {
        costEach = fullCostMap.get(fullCostMap.has(itemId) ? itemId : baseId)!;
        costUnits = it.qty;
      } else if (
        isSynth ||
        (ci !== -1 && SYNTH.some((p) => it.name.slice(0, ci).toLowerCase().startsWith(p.toLowerCase())))
      ) {
        if (it.id && costMap.has(it.id)) {
          costEach = costMap.get(it.id)!;
        } else if (nameMap.has(resolvedProductName)) {
          costEach = nameMap.get(resolvedProductName)!;
        }
        costUnits = it.units_consumed != null && it.units_consumed > 0 ? it.units_consumed : it.qty;
      } else if (fullNameMap.has(it.name)) {
        costEach = fullNameMap.get(it.name)!;
        costUnits = it.qty;
      } else if (nameMap.has(it.name)) {
        costEach = nameMap.get(it.name)!;
        costUnits = it.units_consumed != null && it.units_consumed > 0 ? it.units_consumed : it.qty;
      }

      if (it.units_consumed != null && Number(it.units_consumed) > 0) {
        costUnits = Number(it.units_consumed);
      }

      map.set(it.name, {
        qty: existing.qty + it.qty,
        revenue: existing.revenue + (collectedRows[idx]?.collected ?? 0),
        costTotal: existing.costTotal + costUnits * costEach,
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
