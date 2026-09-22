import fs from "node:fs";
import path from "node:path";

const HEADER = [
  "ts",
  "mode",
  "symbol",
  "side",
  "setup",
  "grade",
  "entry",
  "stop",
  "exit",
  "qty",
  "rr_plan",
  "pnl_gbp",
  "equity_after",
  "exit_reason",
  "notes",
].join(",");

export function ensureJournal(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, HEADER + "\n");
}

function csv(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function appendFill(file, row) {
  ensureJournal(file);
  const line = [
    row.ts,
    row.mode || "PAPER",
    row.symbol,
    row.side || "LONG",
    row.setup,
    row.grade,
    row.entry,
    row.stop,
    row.exit,
    row.qty,
    row.rr_plan,
    row.pnl_gbp,
    row.equity_after,
    row.exit_reason,
    row.notes,
  ]
    .map(csv)
    .join(",");
  fs.appendFileSync(file, line + "\n");
}

export function readJournal(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/).slice(1);
  return lines.filter(Boolean).map((line) => {
    const cols = [];
    let cur = "";
    let q = false;
    for (const ch of line) {
      if (ch === '"') {
        q = !q;
        continue;
      }
      if (ch === "," && !q) {
        cols.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    cols.push(cur);
    const [
      ts,
      mode,
      symbol,
      side,
      setup,
      grade,
      entry,
      stop,
      exit,
      qty,
      rr_plan,
      pnl_gbp,
      equity_after,
      exit_reason,
      notes,
    ] = cols;
    return {
      ts,
      mode,
      symbol,
      side,
      setup,
      grade,
      entry: Number(entry),
      stop: Number(stop),
      exit: Number(exit),
      qty: Number(qty),
      rr_plan: Number(rr_plan),
      pnl_gbp: Number(pnl_gbp),
      equity_after: Number(equity_after),
      exit_reason,
      notes,
    };
  });
}
