import { etDayKey } from "./video_model.js";

function round(n, d = 8) {
  return Number(Number(n).toFixed(d));
}

export function defaultState(cfg, now = new Date()) {
  const start = Number(cfg.starting_gbp);
  return {
    mode: "PAPER",
    venue: "kraken",
    quote: "GBP",
    starting_equity: start,
    cash_gbp: start,
    peak_equity: start,
    equity: start,
    kill_switch: false,
    day_key: etDayKey(now),
    trades_today: 0,
    losses_today: 0,
    last_trade_at: null,
    symbol_cooldown_until: {},
    position: null,
    working: null,
    last_skip: null,
    updated_at: now.toISOString(),
  };
}

export function markToMarket(state, lastPx) {
  const pos = state.position;
  if (!pos) return Number(state.cash_gbp);
  if (pos.side === "short") {
    return Number(state.cash_gbp) + Number(pos.margin) + (Number(pos.entry) - Number(lastPx)) * Number(pos.qty);
  }
  return Number(state.cash_gbp) + Number(pos.qty) * Number(lastPx);
}

export function updateEquity(state, lastPx, cfg, now = new Date()) {
  const eq = markToMarket(state, lastPx);
  state.equity = round(eq, 4);
  if (eq > Number(state.peak_equity)) state.peak_equity = round(eq, 4);
  const peak = Number(state.peak_equity);
  const dd = peak > 0 ? (peak - eq) / peak : 0;
  state.drawdown_pct = round(dd, 4);
  if (dd >= Number(cfg.kill_switch_drawdown_pct || 0.55)) {
    state.kill_switch = true;
  }
  const day = etDayKey(now);
  if (state.day_key !== day) {
    state.day_key = day;
    state.trades_today = 0;
    state.losses_today = 0;
  }
  state.updated_at = now.toISOString();
  return state;
}

export function feeOn(notional, rate) {
  return Number(notional) * Number(rate);
}

export function openLong(state, { symbol, qty, price, feeRate, stop, tp, setup, grade, rr, reason }, now = new Date()) {
  const notional = qty * price;
  const fee = feeOn(notional, feeRate);
  const cost = notional + fee;
  if (cost > state.cash_gbp + 1e-8) return { ok: false, reason: "insufficient_cash" };
  state.cash_gbp = round(state.cash_gbp - cost, 6);
  state.position = {
    symbol,
    side: "long",
    qty,
    entry: price,
    stop,
    tp,
    setup,
    grade,
    rr,
    reason,
    fee_in: fee,
    fee_rate_in: feeRate,
    opened_at: now.toISOString(),
    initial_stop: stop,
  };
  state.working = null;
  state.trades_today = Number(state.trades_today || 0) + 1;
  state.last_trade_at = now.toISOString();
  return { ok: true, fee, cost };
}

export function openShort(state, { symbol, qty, price, feeRate, stop, tp, setup, grade, rr, reason }, now = new Date()) {
  const notional = qty * price;
  const fee = feeOn(notional, feeRate);
  const cost = notional + fee;
  if (cost > state.cash_gbp + 1e-8) return { ok: false, reason: "insufficient_cash" };
  state.cash_gbp = round(state.cash_gbp - cost, 6);
  state.position = {
    symbol,
    side: "short",
    qty,
    entry: price,
    margin: notional,
    stop,
    tp,
    setup,
    grade,
    rr,
    reason,
    fee_in: fee,
    fee_rate_in: feeRate,
    opened_at: now.toISOString(),
    initial_stop: stop,
  };
  state.working = null;
  state.trades_today = Number(state.trades_today || 0) + 1;
  state.last_trade_at = now.toISOString();
  return { ok: true, fee, cost };
}

export function closeShort(state, { price, feeRate, exitReason }, now = new Date()) {
  const pos = state.position;
  if (!pos || pos.side !== "short") return { ok: false, reason: "flat" };
  const fee = feeOn(pos.qty * price, feeRate);
  const pnl = (pos.entry - price) * pos.qty - pos.fee_in - fee;
  state.cash_gbp = round(state.cash_gbp + pos.margin + (pos.entry - price) * pos.qty - fee, 6);
  const closed = {
    ...pos,
    exit: price,
    fee_out: fee,
    pnl: round(pnl, 6),
    exit_reason: exitReason,
    closed_at: now.toISOString(),
  };
  state.position = null;
  state.working = null;
  if (pnl < 0) state.losses_today = Number(state.losses_today || 0) + 1;
  return { ok: true, closed };
}

export function closePosition(state, args, now = new Date()) {
  if (state.position?.side === "short") return closeShort(state, args, now);
  return closeLong(state, args, now);
}

export function closeLong(state, { price, feeRate, exitReason }, now = new Date()) {
  const pos = state.position;
  if (!pos) return { ok: false, reason: "flat" };
  const notional = pos.qty * price;
  const fee = feeOn(notional, feeRate);
  const proceeds = notional - fee;
  const pnl = proceeds - (pos.qty * pos.entry + pos.fee_in);
  state.cash_gbp = round(state.cash_gbp + proceeds, 6);
  const closed = {
    ...pos,
    exit: price,
    fee_out: fee,
    pnl: round(pnl, 6),
    exit_reason: exitReason,
    closed_at: now.toISOString(),
  };
  state.position = null;
  state.working = null;
  if (pnl < 0) state.losses_today = Number(state.losses_today || 0) + 1;
  return { ok: true, closed };
}

export function placeWorking(state, order, now = new Date()) {
  state.working = {
    ...order,
    placed_at: now.toISOString(),
    expires_at: new Date(now.getTime() + Number(order.wait_seconds || 180) * 1000).toISOString(),
  };
}

export function expireWorking(state, now = new Date()) {
  if (!state.working) return false;
  if (new Date(state.working.expires_at).getTime() <= now.getTime()) {
    state.working = null;
    return true;
  }
  return false;
}

function fillWorking(state, quote, cfg, now) {
  const working = state.working;
  const limit = Number(working.limit);
  const short = working.side === "sell" || working.side === "short";
  if (short) {
    const hit = quote.last >= limit || quote.ask >= limit;
    if (!hit) return null;
    return openShort(
      state,
      {
        symbol: quote.symbol,
        qty: working.qty,
        price: Math.max(limit, quote.ask || limit),
        feeRate: cfg.maker_fee,
        stop: working.stop,
        tp: working.tp,
        setup: working.setup,
        grade: working.grade,
        rr: working.rr,
        reason: working.reason,
      },
      now
    );
  }
  const hit = quote.last <= limit || quote.bid <= limit;
  if (!hit) return null;
  return openLong(
    state,
    {
      symbol: quote.symbol,
      qty: working.qty,
      price: Math.min(limit, quote.bid || limit),
      feeRate: cfg.maker_fee,
      stop: working.stop,
      tp: working.tp,
      setup: working.setup,
      grade: working.grade,
      rr: working.rr,
      reason: working.reason,
    },
    now
  );
}

function applyScalpManagement(pos, quote, cfg, now) {
  if (cfg.entry_model !== "scalp") return null;
  const maxMin = Number(cfg.max_trade_duration_minutes || 0);
  if (maxMin > 0 && pos.opened_at) {
    const age = now.getTime() - Date.parse(pos.opened_at);
    if (age >= maxMin * 60 * 1000) return "time_exit";
  }
  const initial = Number(pos.initial_stop || pos.stop);
  const risk = Math.abs(Number(pos.entry) - initial);
  if (!(risk > 0)) return null;
  const last = Number(quote.last);
  const beAt = Number(cfg.break_even_at_r || 0);
  const trailAt = Number(cfg.trail_at_r || 0);
  const rNow = pos.side === "short" ? (Number(pos.entry) - last) / risk : (last - Number(pos.entry)) / risk;
  if (beAt > 0 && rNow >= beAt) {
    if (pos.side === "short") pos.stop = Math.min(Number(pos.stop), Number(pos.entry) * 0.9997);
    else pos.stop = Math.max(Number(pos.stop), Number(pos.entry) * 1.0003);
  }
  if (trailAt > 0 && rNow >= trailAt) {
    if (pos.side === "short") pos.stop = Math.min(Number(pos.stop), last + risk * 0.8);
    else pos.stop = Math.max(Number(pos.stop), last - risk * 0.8);
  }
  return null;
}

function managePosition(state, quote, cfg, now) {
  const pos = state.position;
  const short = pos.side === "short";
  const slip = Number(cfg.slippage_pct || 0);
  const timeExit = applyScalpManagement(pos, quote, cfg, now);
  if (timeExit) {
    const px = quote.last;
    return short
      ? { fill: "taker", ...closeShort(state, { price: px, feeRate: cfg.taker_fee, exitReason: timeExit }, now) }
      : { fill: "taker", ...closeLong(state, { price: px, feeRate: cfg.taker_fee, exitReason: timeExit }, now) };
  }
  if (short) {
    const stopHit = quote.last >= pos.stop || quote.ask >= pos.stop;
    if (stopHit) {
      const px = Math.max(pos.stop, quote.ask || pos.stop) * (1 + slip);
      return { fill: "taker", ...closeShort(state, { price: px, feeRate: cfg.taker_fee, exitReason: "stop" }, now) };
    }
    const tpHit = cfg.use_maker_tp !== false ? quote.ask <= pos.tp : quote.last <= pos.tp;
    if (tpHit) {
      const px = cfg.use_maker_tp !== false ? Math.min(pos.tp, quote.ask || pos.tp) : quote.last;
      const feeRate = cfg.use_maker_tp !== false ? cfg.maker_fee : cfg.taker_fee;
      return {
        fill: cfg.use_maker_tp !== false ? "maker" : "taker",
        ...closeShort(state, { price: px, feeRate, exitReason: "target" }, now),
      };
    }
    return null;
  }
  const stopHit = quote.last <= pos.stop || quote.bid <= pos.stop;
  if (stopHit) {
    const px = Math.min(pos.stop, quote.bid || pos.stop) * (1 - slip);
    return { fill: "taker", ...closeLong(state, { price: px, feeRate: cfg.taker_fee, exitReason: "stop" }, now) };
  }
  const tpHit = cfg.use_maker_tp !== false ? quote.bid >= pos.tp : quote.last >= pos.tp;
  if (tpHit) {
    const px = cfg.use_maker_tp !== false ? Math.max(pos.tp, quote.bid) : quote.last;
    const feeRate = cfg.use_maker_tp !== false ? cfg.maker_fee : cfg.taker_fee;
    return {
      fill: cfg.use_maker_tp !== false ? "maker" : "taker",
      ...closeLong(state, { price: px, feeRate, exitReason: "target" }, now),
    };
  }
  return null;
}

/**
 * PAPER fill engine. Longs and isolated 1x shorts.
 * Long maker entry: last/bid <= limit. Short maker entry: last/ask >= limit.
 * Stops are taker; take-profits prefer maker.
 */
export function processQuotes(state, quote, cfg, now = new Date()) {
  const events = [];
  if (!quote?.last) return events;
  updateEquity(state, quote.last, cfg, now);

  if (state.working?.type === "entry_limit" && state.working.symbol === quote.symbol) {
    if (expireWorking(state, now)) {
      events.push({ type: "cancel", reason: "maker_timeout" });
    } else {
      const opened = fillWorking(state, quote, cfg, now);
      if (opened) events.push({ type: "entry", fill: "maker", ...opened });
    }
  }

  const pos = state.position;
  if (pos && pos.symbol === quote.symbol) {
    const closed = managePosition(state, quote, cfg, now);
    if (closed) {
      events.push({ type: "exit", ...closed });
    }
  }

  updateEquity(state, quote.last, cfg, now);
  return events;
}
