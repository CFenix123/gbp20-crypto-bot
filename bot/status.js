import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, loadState } from "./trader.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfg = loadConfig(root);
const state = loadState(cfg, root);

console.log("### PAPER — GBP20 CRYPTO STATUS");
console.log(`- **Regime:** ${state.kill_switch ? "HALTED" : "PAPER running"}`);
console.log(`- **Venue:** Kraken public data + local paper ledger`);
console.log(`- **Equity:** £${Number(state.equity ?? state.cash_gbp).toFixed(2)} / start £${Number(state.starting_equity).toFixed(2)}`);
console.log(`- **Peak:** £${Number(state.peak_equity).toFixed(2)}`);
console.log(`- **Drawdown:** ${((Number(state.drawdown_pct) || 0) * 100).toFixed(2)}% vs 55% halt | kill switch ${state.kill_switch ? "ON" : "OFF"}`);
console.log(`- **Cash:** £${Number(state.cash_gbp).toFixed(4)}`);
console.log(`- **Trades today:** ${state.trades_today} (cap ${cfg.max_trades_per_day}) | losses ${state.losses_today}`);
if (state.position) {
  const p = state.position;
  console.log(`- **Position:** ${String(p.side || "long").toUpperCase()} ${p.symbol} qty ${p.qty} entry ${p.entry}`);
  console.log(`- **Stop:** ${p.stop}`);
  console.log(`- **Targets:** ${p.tp} (plan ${p.rr}R)`);
  console.log(`- **Setup:** ${p.setup} grade ${p.grade}`);
} else if (state.working) {
  console.log(`- **Working:** maker ${state.working.side || "buy"} ${state.working.symbol} limit ${state.working.limit} until ${state.working.expires_at}`);
} else {
  console.log(`- **Position:** flat`);
}
console.log(`- **Last skip:** ${state.last_skip || "none"}`);
console.log("- **Notes:** Not financial advice. PAPER only.");
