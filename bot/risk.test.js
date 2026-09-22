import { feesKillEdge, sizeQty, sessionGate, riskBudget, canEnter } from "./risk.js";
import { defaultState } from "./paper.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const cfg = {
  risk_pct_per_trade: 0.2,
  maker_fee: 0.004,
  taker_fee: 0.008,
  use_maker_entry: true,
  use_maker_tp: true,
  crypto_sessions_only: true,
  allow_ny_pm_if_a: true,
  ordermin: { XBTGBP: 0.00005, ETHGBP: 0.001 },
  costmin: 0.43,
  max_trades_per_day: 3,
  max_full_losses_per_day: 2,
};

assert(riskBudget(20, cfg) === 4, "20% of £20 is £4");

{
  const skip = feesKillEdge({ stopPct: 0.005, rr: 2, cfg, makerIn: false, makerOut: false });
  assert(!skip.ok, "tight stop vs taker fees should skip");
}

{
  const ok = feesKillEdge({ stopPct: 0.012, rr: 2, cfg, makerIn: true, makerOut: true });
  assert(ok.ok, `maker 1.2% stop 2R should pass ${JSON.stringify(ok)}`);
}

{
  const s = sizeQty({
    cash: 20,
    equity: 20,
    entry: 60000,
    stop: 60000 * 0.988,
    cfg,
    pair: "XBTGBP",
    makerIn: true,
  });
  assert(s.ok, JSON.stringify(s));
  assert(s.cash_capped, "£20 cannot take full £4 risk at 1.2% stop without leverage");
  assert(s.qty * 60000 <= 20, "spot cannot exceed cash");
  assert(s.qty >= cfg.ordermin.XBTGBP, "meets BTC min");
}

{
  const london = sessionGate(new Date("2026-09-18T08:00:00Z"), cfg, "B"); // 04:00 ET
  assert(london.ok && london.window === "london", JSON.stringify(london));
  const asia = sessionGate(new Date("2026-09-18T00:00:00Z"), cfg, "B"); // 20:00 ET
  assert(!asia.ok, JSON.stringify(asia));
  const nyPmB = sessionGate(new Date("2026-09-18T18:30:00Z"), cfg, "B"); // 14:30 ET
  assert(!nyPmB.ok, "B grade blocked in NY PM");
  const nyPmA = sessionGate(new Date("2026-09-18T18:30:00Z"), cfg, "A");
  assert(nyPmA.ok, "A allowed NY PM");
}

{
  const state = defaultState({ starting_gbp: 20 });
  state.kill_switch = true;
  assert(canEnter(state, cfg).reason === "kill_switch", "kill blocks");
}

console.log("risk.test.js OK");
