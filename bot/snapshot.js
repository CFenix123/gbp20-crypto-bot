import fs from "node:fs";
import path from "node:path";
import { readJournal } from "./journal.js";
import { sessionGate } from "./risk.js";

function stats(rows, state, cfg) {
  const start = Number(state.starting_equity || cfg.starting_gbp);
  const pnl = rows.reduce((s, r) => s + (Number(r.pnl_gbp) || 0), 0);
  const wins = rows.filter((r) => r.pnl_gbp > 0);
  const losses = rows.filter((r) => r.pnl_gbp <= 0);
  return {
    book: cfg.book || cfg.name,
    name: cfg.name || cfg.book,
    model: cfg.entry_model,
    equity: Number(state.equity ?? state.cash_gbp ?? start),
    cash: Number(state.cash_gbp),
    start,
    peak: Number(state.peak_equity ?? start),
    drawdown_pct: Number(state.drawdown_pct || 0),
    kill_switch: Boolean(state.kill_switch),
    trades: rows.length,
    trades_today: Number(state.trades_today || 0),
    losses_today: Number(state.losses_today || 0),
    wins: wins.length,
    losses: losses.length,
    win_rate: rows.length ? wins.length / rows.length : 0,
    pnl,
    last_skip: state.last_skip || "",
    updated_at: state.updated_at || null,
    position: state.position
      ? {
          side: state.position.side,
          symbol: state.position.symbol,
          qty: state.position.qty,
          entry: state.position.entry,
          stop: state.position.stop,
          tp: state.position.tp,
          setup: state.position.setup,
          grade: state.position.grade,
        }
      : null,
    working: state.working
      ? {
          side: state.working.side,
          symbol: state.working.symbol,
          limit: state.working.limit,
          expires_at: state.working.expires_at,
        }
      : null,
    fills: rows.slice(-12),
  };
}

export function bookSnapshot(root, cfg, state) {
  const rows = readJournal(path.join(root, cfg.journal_path));
  return stats(rows, state, cfg);
}

export function dualSnapshot(root, books, now = new Date()) {
  const sess = sessionGate(now, books[0].cfg, "A");
  return {
    mode: "PAPER",
    venue: "kraken",
    now: now.toISOString(),
    session: sess.ok ? sess.window : sess.reason || "outside_london_ny",
    books: books.map((b) => bookSnapshot(root, b.cfg, b.state)),
  };
}

export function writeSnapshot(root, data) {
  const file = path.join(root, "data", "snapshot.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
