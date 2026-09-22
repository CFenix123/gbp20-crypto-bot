import { etMinutes, inSession, SESSIONS, NY_KILLZONE } from "./video_model.js";

const GRADE_RANK = { A: 3, B: 2, C: 1 };

export function riskBudget(equity, cfg) {
  return Number(equity) * Number(cfg.risk_pct_per_trade || 0.2);
}

export function roundTripFeePct(cfg, { makerIn = false, makerOut = false } = {}) {
  const inn = makerIn ? Number(cfg.maker_fee) : Number(cfg.taker_fee);
  const out = makerOut ? Number(cfg.maker_fee) : Number(cfg.taker_fee);
  return inn + out;
}

/** Skip if fees would erase most of the planned 2R. */
export function feesKillEdge({ stopPct, rr, cfg, makerIn, makerOut }) {
  const fees = roundTripFeePct(cfg, { makerIn, makerOut });
  const gross = Number(stopPct) * Number(rr);
  const net = gross - fees;
  if (net <= 0) return { ok: false, reason: "fees_gt_target", fees, gross, net };
  if (net < Number(stopPct) * 0.5) return { ok: false, reason: "fees_kill_edge", fees, gross, net };
  return { ok: true, fees, gross, net };
}

export function sizeQty({ cash, equity, entry, stop, cfg, pair, makerIn }) {
  const risk = riskBudget(equity, cfg);
  const stopDist = Math.abs(entry - stop);
  if (!(entry > 0) || !(stopDist > 0) || !(cash > 0)) {
    return { ok: false, reason: "size_inputs" };
  }
  let qty = risk / stopDist;
  const fee = makerIn ? Number(cfg.maker_fee) : Number(cfg.taker_fee);
  const maxNotional = cash / (1 + fee);
  if (qty * entry > maxNotional) qty = maxNotional / entry;
  const minQty = Number(cfg.ordermin?.[pair] || 0);
  const costmin = Number(cfg.costmin || 0);
  if (qty < minQty) return { ok: false, reason: "below_ordermin", qty, minQty };
  if (qty * entry < costmin) return { ok: false, reason: "below_costmin", notional: qty * entry };
  const notional = qty * entry;
  const dollarRisk = qty * stopDist;
  if (dollarRisk > risk * 1.001) {
    qty = risk / stopDist;
  }
  return {
    ok: true,
    qty,
    notional,
    dollar_risk: Math.min(dollarRisk, risk),
    risk_budget: risk,
    cash_capped: notional >= maxNotional * 0.999,
  };
}

export function gradeOk(grade, minGrade = "B") {
  return (GRADE_RANK[grade] || 0) >= (GRADE_RANK[minGrade] || 0);
}

export function sessionGate(now, cfg, grade) {
  if (cfg.crypto_sessions_only === false) return { ok: true, window: "any" };
  const mins = etMinutes(now);
  if (inSession(mins, SESSIONS.london)) return { ok: true, window: "london" };
  if (inSession(mins, SESSIONS.ny_am)) return { ok: true, window: "ny_am" };
  if (inSession(mins, SESSIONS.ny_pm) && cfg.allow_ny_pm_if_a && grade === "A") {
    return { ok: true, window: "ny_pm_a" };
  }
  if (mins >= 17 * 60 && mins < 18 * 60) return { ok: false, reason: "spread_hour" };
  return { ok: false, reason: "outside_london_ny" };
}

export function canEnter(state, cfg, now = new Date()) {
  if (state.kill_switch) return { ok: false, reason: "kill_switch" };
  if (state.position) return { ok: false, reason: "already_in" };
  if (state.working) return { ok: false, reason: "working_order" };
  if (Number(state.trades_today) >= Number(cfg.max_trades_per_day || 3)) {
    return { ok: false, reason: "day_trade_cap" };
  }
  if (Number(state.losses_today) >= Number(cfg.max_full_losses_per_day || 2)) {
    return { ok: false, reason: "day_loss_cap" };
  }
  if (state.last_trade_at) {
    const wait = Number(cfg.min_seconds_between_trades || 0) * 1000;
    if (now.getTime() - new Date(state.last_trade_at).getTime() < wait) {
      return { ok: false, reason: "trade_cooldown" };
    }
  }
  return { ok: true };
}

export function symbolCooling(state, symbol, now = new Date()) {
  const until = state.symbol_cooldown_until?.[symbol];
  return until ? now.getTime() < new Date(until).getTime() : false;
}

export function armSymbolCooldown(state, symbol, cfg, now = new Date()) {
  const sec = Number(cfg.symbol_stop_cooldown_seconds || 900);
  state.symbol_cooldown_until = state.symbol_cooldown_until || {};
  state.symbol_cooldown_until[symbol] = new Date(now.getTime() + sec * 1000).toISOString();
}

export { NY_KILLZONE };
