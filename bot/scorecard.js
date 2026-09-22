import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJournal } from "./journal.js";
import { loadConfig, loadState } from "./trader.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv.includes("--mind")
  ? "config.mind.json"
  : process.argv.includes("--alpha")
    ? "config.alpha.json"
    : "config.json";
const cfg = loadConfig(root, file);
const state = loadState(cfg, root);
const rows = readJournal(path.join(root, cfg.journal_path));
const start = Number(state.starting_equity || cfg.starting_gbp);
const pnl = rows.reduce((s, r) => s + (Number(r.pnl_gbp) || 0), 0);
const wins = rows.filter((r) => r.pnl_gbp > 0);
const losses = rows.filter((r) => r.pnl_gbp <= 0);
const avgWin = wins.length ? wins.reduce((s, r) => s + r.pnl_gbp, 0) / wins.length : 0;
const avgLoss = losses.length ? losses.reduce((s, r) => s + r.pnl_gbp, 0) / losses.length : 0;
const wr = rows.length ? wins.length / rows.length : 0;
const dd = (Number(state.drawdown_pct) || 0) * 100;

console.log(`### PAPER — ${(cfg.name || cfg.book || "TJR").toUpperCase()} SCORECARD`);
console.log(`- **Trades:** ${rows.length} (need ≥30 before judging edge)`);
console.log(`- **Win rate:** ${(wr * 100).toFixed(1)}%`);
console.log(`- **Net P&L:** £${pnl.toFixed(4)}`);
console.log(`- **Avg win / avg loss:** £${avgWin.toFixed(4)} / £${avgLoss.toFixed(4)}`);
console.log(`- **Equity:** £${Number(state.equity ?? start).toFixed(2)} from £${start.toFixed(2)}`);
console.log(`- **Drawdown:** ${dd.toFixed(2)}% vs 55% halt | kill ${state.kill_switch ? "ON" : "OFF"}`);
console.log("- **Kill criteria:** no new risk if kill is ON until you reactivate; flatten is manual via reset after review");
console.log("- **Notes:** Kraken Tier-1 paper fees (0.40% maker / 0.80% taker). Not financial advice.");
if (rows.length) {
  console.log("\nLast 8 fills:");
  for (const r of rows.slice(-8)) {
    console.log(
      `  ${r.ts} ${r.symbol} ${r.exit_reason} £${Number(r.pnl_gbp).toFixed(4)} ${r.setup}`
    );
  }
}
