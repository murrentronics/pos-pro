import type { ReceiptData } from "@/lib/receiptPrinter";

function money(n: unknown) {
  const v = Number(n);
  return (Number.isFinite(v) ? v : 0).toFixed(2);
}

/** On-screen receipt. Same header as the sale screen: logo, store name, Served by, discount. */
export function ReceiptPaper({ sale }: { sale: ReceiptData }) {
  const server = sale.serverName || "Staff";
  const items = Array.isArray(sale.items) ? sale.items : [];
  const discount = Number(sale.discount) || 0;
  const originalTotal = sale.originalTotal != null ? Number(sale.originalTotal) : null;
  const tax = Number(sale.tax) || 0;
  return (
    <div className="bg-white text-zinc-900 rounded-xl p-4 shadow-inner text-left font-mono text-xs leading-tight border border-zinc-300 select-none">
      {sale.logoUrl && <img src={sale.logoUrl} alt="" className="mx-auto mb-1 max-h-16 object-contain" />}
      <div className="text-center font-black text-zinc-950 text-base font-sans tracking-tight uppercase mb-0.5">
        {sale.storeName || "My Business"}
      </div>
      {sale.locationName && (
        <div className="text-center text-[11px] text-zinc-700">{sale.locationName}</div>
      )}
      <div className="text-center text-[10px] text-zinc-600">{sale.date || ""}</div>
      <div className="text-center text-[10px] text-zinc-600">Served by {server}</div>
      {sale.customerName && (
        <div className="text-center text-[10px] text-zinc-700">Customer: {sale.customerName}</div>
      )}
      <div className="border-t border-dashed border-zinc-400 my-2" />
      <div className="text-center font-black text-base tracking-wide text-zinc-950 my-1">
        ORDER #{sale.orderNumber || "—"}
      </div>
      <div className="border-t border-dashed border-zinc-400 my-2" />
      <div className="space-y-1 my-2">
        {items.map((it, idx) => (
          <div key={idx} className="flex justify-between items-start">
            <span className="font-semibold text-zinc-900 pr-2 break-all">{Number(it.qty) || 0}x {it.name}</span>
            <span className="font-bold text-zinc-950 whitespace-nowrap">${money((Number(it.qty) || 0) * (Number(it.price) || 0))}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-dashed border-zinc-400 my-2" />
      <div className="space-y-1">
        <div className="flex justify-between text-zinc-700">
          <span>Subtotal</span><span>${money(sale.subtotal)}</span>
        </div>
        {discount > 0 && (
          <div className="flex justify-between font-black" style={{ color: "#d97706" }}>
            <span>Discount{originalTotal != null && Number.isFinite(originalTotal) ? ` (was $${money(originalTotal)})` : ""}</span>
            <span>-${money(discount)}</span>
          </div>
        )}
        {tax > 0 && (
          <div className="flex justify-between text-zinc-700">
            <span>Tax</span><span>${money(tax)}</span>
          </div>
        )}
        <div className="flex justify-between font-black text-sm text-zinc-950 pt-0.5">
          <span>Total</span><span>${money(sale.total)}</span>
        </div>
      </div>
      <div className="border-t border-dashed border-zinc-400 my-2" />
      <div className="space-y-1">
        <div className="flex justify-between text-zinc-700">
          <span>{sale.payMode === "credit" ? "Credit" : "Cash Tendered"}</span>
          <span>${money(sale.paid)}</span>
        </div>
        <div className="flex justify-between font-bold text-zinc-900">
          <span>Change</span><span>${money(sale.change)}</span>
        </div>
      </div>
      <div className="text-center text-[10px] text-zinc-500 mt-2">
        {sale.footerTagline || "Thank you for your purchase!"}
      </div>
    </div>
  );
}
