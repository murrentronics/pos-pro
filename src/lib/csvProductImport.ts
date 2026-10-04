/** Parse a POS product CSV for title, image, unit CP, SP, and qty. */

export type CsvImportRow = {
  name: string;
  imageUrl: string | null;
  /** Unit cost price from CSV (not batch/total). */
  costPrice: number;
  /** Sell / retail price from CSV. */
  sellPrice: number;
  /** Current on-hand qty from CSV. */
  qty: number;
};

const NAME_HEADERS = [
  "name", "title", "product", "product name", "product_name", "productname",
  "description", "item", "item name", "item_name", "itemname", "product title",
  "product_title", "nombre", "titulo", "título",
];

const IMAGE_HEADERS = [
  "image", "image_url", "image url", "imageurl", "img", "photo", "picture",
  "product image", "product_image", "product image url", "product_image_url",
  "images", "imagen", "foto",
];

const COST_HEADERS = [
  "cp", "cost", "cost price", "cost_price", "unit cost", "unit_cost",
  "purchase price", "purchase_price", "wholesale", "wholesale price",
  "cost per unit", "precio costo", "precio de costo",
];

const SELL_HEADERS = [
  "sp", "sell", "sell price", "sell_price", "selling price", "selling_price",
  "retail", "retail price", "retail_price", "price", "precio", "precio venta",
  "precio de venta",
];

const QTY_HEADERS = [
  "qty", "quantity", "stock", "stock qty", "stock_qty", "on hand", "onhand",
  "inventory", "current qty", "current_qty", "cantidad", "existencia",
];

function normalizeHeader(h: string): string {
  return h.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

/** Minimal RFC4180-ish CSV parse (comma + quoted fields). */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      if (ch === "\r" && src[i + 1] === "\n") i += 2;
      else i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

function findColumnIndex(
  headers: string[],
  candidates: string[],
  opts?: { exclude?: RegExp },
): number {
  const normalized = headers.map(normalizeHeader);
  for (const cand of candidates) {
    const idx = normalized.findIndex((h) => h === cand && (!opts?.exclude || !opts.exclude.test(h)));
    if (idx >= 0) return idx;
  }
  for (let i = 0; i < normalized.length; i++) {
    const h = normalized[i];
    if (opts?.exclude && opts.exclude.test(h)) continue;
    // Skip batch/total columns — Total Cost is derived as qty × unit CP
    if (/\b(total|batch|extended)\b/.test(h)) continue;
    if (candidates.some((c) => h === c || h.includes(c))) return i;
  }
  return -1;
}

function firstImageUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/[|;]/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    if (/^https?:\/\//i.test(part)) return part;
  }
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

function parseMoney(raw: string): number {
  const cleaned = raw.replace(/[^0-9.-]/g, "").trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseQty(raw: string): number {
  const cleaned = raw.replace(/[^0-9.-]/g, "").trim();
  if (!cleaned) return 0;
  const n = Math.floor(Number(cleaned));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Batch / total cost for Bulk Edit = qty × unit CP (CSV-only reverse calc). */
export function csvBatchTotal(qty: number, unitCost: number): number {
  if (qty <= 0 || unitCost <= 0) return 0;
  return Math.round(qty * unitCost * 100) / 100;
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Build a re-importable products CSV (Name, Image URL, Cost Price, Sell Price, Quantity, …). */
export function buildProductsExportCsv(
  products: Array<{
    name: string;
    image_url?: string | null;
    cost_price?: number | null;
    price?: number | null;
    stock_qty?: number | null;
    barcode?: string | null;
    supplier_name?: string | null;
    category?: string | null;
  }>,
  categoryNameById?: Record<string, string>,
): string {
  const headers = [
    "Name",
    "Image URL",
    "Cost Price",
    "Sell Price",
    "Quantity",
    "Barcode",
    "Category",
    "Supplier",
  ];
  const lines = [headers.join(",")];
  const sorted = [...products].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  for (const p of sorted) {
    const catId = (p.category ?? "").trim();
    const catName = (categoryNameById?.[catId] ?? catId).trim();
    lines.push([
      csvEscape(p.name ?? ""),
      csvEscape((p.image_url ?? "").trim()),
      csvEscape(Number(p.cost_price ?? 0) > 0 ? Number(p.cost_price).toFixed(2) : ""),
      csvEscape(Number(p.price ?? 0) > 0 ? Number(p.price).toFixed(2) : ""),
      csvEscape(Number(p.stock_qty ?? 0) > 0 ? String(Math.floor(Number(p.stock_qty))) : ""),
      csvEscape((p.barcode ?? "").trim()),
      csvEscape(catName),
      csvEscape((p.supplier_name ?? "").trim()),
    ].join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export function extractProductsFromCsv(text: string): { rows: CsvImportRow[]; error?: string } {
  const table = parseCsvText(text);
  if (table.length < 2) {
    return { rows: [], error: "CSV needs a header row and at least one product row" };
  }

  const headers = table[0];
  const nameIdx = findColumnIndex(headers, NAME_HEADERS);
  if (nameIdx < 0) {
    return {
      rows: [],
      error: "Could not find a product name/title column. Add a column like Name, Title, or Description.",
    };
  }
  const imageIdx = findColumnIndex(headers, IMAGE_HEADERS);
  const costIdx = findColumnIndex(headers, COST_HEADERS, { exclude: /\b(sell|retail|venta)\b/ });
  const sellIdx = findColumnIndex(headers, SELL_HEADERS, { exclude: /\b(cost|purchase|wholesale|cp)\b/ });
  const qtyIdx = findColumnIndex(headers, QTY_HEADERS);

  const seen = new Set<string>();
  const rows: CsvImportRow[] = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const name = (cells[nameIdx] ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      name,
      imageUrl: imageIdx >= 0 ? firstImageUrl(cells[imageIdx] ?? "") : null,
      costPrice: costIdx >= 0 ? parseMoney(cells[costIdx] ?? "") : 0,
      sellPrice: sellIdx >= 0 ? parseMoney(cells[sellIdx] ?? "") : 0,
      qty: qtyIdx >= 0 ? parseQty(cells[qtyIdx] ?? "") : 0,
    });
  }

  if (rows.length === 0) {
    return { rows: [], error: "No product titles found in that CSV" };
  }
  return { rows };
}
