import path from "node:path";
import { fileURLToPath } from "node:url";
import { isRateLimitError } from "./kraken.js";
import { loadConfig, loadState, saveState, step } from "./trader.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

console.log("PAPER Kraken crypto bot — £20 start. Not financial advice.");
console.log("20% of balance risked per trade is aggressive. This is a max, and spot size is also capped by cash.");
console.log("Kill switch at 55% drawdown from peak. Mode=PAPER until you explicitly say go live.");

const cfg = loadConfig(root);
if (cfg.mode !== "PAPER") {
  console.error("Refusing to start: config.mode must be PAPER.");
  process.exit(1);
}

let state = loadState(cfg, root);
saveState(cfg, root, state);

const once = process.argv.includes("--once");
let ticks = 0;
do {
  try {
    const out = await step(cfg, state, root);
    state = out.state;
    saveState(cfg, root, state);
    ticks += 1;
    if (once || ticks === 1 || ticks % 15 === 0) {
      const pos = state.position
        ? `${state.position.side} ${state.position.symbol} ${state.position.qty.toFixed(8)} @ ${state.position.entry}`
        : state.working
          ? `working ${state.working.side || "buy"} ${state.working.symbol} @ ${state.working.limit}`
          : "flat";
      console.log(
        `[PAPER] eq=£${Number(state.equity).toFixed(2)} dd=${(Number(state.drawdown_pct || 0) * 100).toFixed(1)}% kill=${state.kill_switch ? "ON" : "OFF"} ${pos} skip=${state.last_skip || "-"}`
      );
    }
  } catch (err) {
    if (isRateLimitError(err)) {
      const wait = Number(cfg.rate_limit_backoff_seconds || 25);
      console.error(`[PAPER] Kraken rate limit — backing off ${wait}s`);
      if (once) process.exit(1);
      await sleep(wait * 1000);
      continue;
    }
    console.error("[PAPER] step error", err.message || err);
    if (once) process.exit(1);
  }
  if (!once) await sleep(Number(cfg.poll_seconds || 15) * 1000);
} while (!once);
