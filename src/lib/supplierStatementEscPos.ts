export type SupplierStatement = {
  supplier: string;
  rows: { when: string; note: string; amount: number; paid: boolean; reverted?: boolean }[];
  spent: number;
  owed: number;
};

function esc(b: number): string {
  return String.fromCharCode(b);
}

function padRight(text: string, width: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length >= width) return clean.slice(0, Math.max(0, width));
  return clean + " ".repeat(width - clean.length);
}

export function buildSupplierStatementEscPos(opts: {
  storeName: string;
  date: string;
  statement: SupplierStatement;
  logoEscPos?: string;
}): Uint8Array {
  const COL = 48;
  const money = (n: number) => `$${n.toFixed(2)}`;
  const line = (left: string, right: string) => {
    const r = right.slice(0, 12);
    return `${padRight(left, COL - r.length)}${r}`;
  };
  const cmds: string[] = [];
  cmds.push(esc(0x1b) + esc(0x40));
  cmds.push(esc(0x1b) + esc(0x61) + esc(0x01));
  if (opts.logoEscPos) cmds.push(opts.logoEscPos);
  cmds.push(esc(0x1b) + esc(0x45) + esc(0x01));
  cmds.push(opts.storeName || "POS Pro");
  cmds.push(esc(0x1b) + esc(0x45) + esc(0x00));
  cmds.push("SUPPLIER STATEMENT");
  cmds.push(opts.statement.supplier);
  cmds.push(opts.date);
  cmds.push(esc(0x1b) + esc(0x61) + esc(0x00));
  cmds.push("-".repeat(COL));
  for (const row of opts.statement.rows) {
    const badge = row.reverted ? "REVERT" : row.paid ? "PAID" : "UNPAID";
    cmds.push(line(`${row.when} ${badge}`, money(row.amount)));
    if (row.note) cmds.push(padRight(row.note, COL));
  }
  cmds.push("-".repeat(COL));
  cmds.push(esc(0x1b) + esc(0x45) + esc(0x01));
  cmds.push(line("Total spent", money(opts.statement.spent)));
  cmds.push(line("Balance owed", money(opts.statement.owed)));
  cmds.push(esc(0x1b) + esc(0x45) + esc(0x00));
  cmds.push(esc(0x1b) + esc(0x64) + esc(0x03));
  cmds.push(esc(0x1d) + esc(0x56) + esc(0x42) + esc(0x00));
  return new Uint8Array([...cmds.join("\n")].map((c) => c.charCodeAt(0)));
}
