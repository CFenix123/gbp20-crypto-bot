/**
 * SPEED book — trade *as if* on XTrend Speed (CFD-style), still Kraken PAPER.
 * Instant market fill. Cost is a spread, not a 180s maker wait.
 * Isolated 1x longs/shorts. No XTrend API. No live orders. No 1:300 leverage.
 */
import { closedBars } from "./video_model.js";
import { lastEma, atr } from "./scalp_indicators.js";

function n(v) {
  return Number(v);
}

function fail(reason, extra = {}) {
  return { take: false, reason, ...extra };
}

export function speedBias(closed, emaFast, emaMid) {
  if (!closed || closed.length < emaMid + 3) return "chop";
  const px = n(closed.at(-1).c);
  const fast = lastEma(closed, emaFast);
  const mid = lastEma(closed, emaMid);
  if (!(px > 0) || !(fast > 0) || !(mid > 0)) return "chop";
  const gap = Math.abs(fast - mid) / px;
  if (gap < 0.00025) return "chop";
  if (fast > mid && px > mid) return "up";
  if (fast < mid && px < mid) return "down";
  return "chop";
}

export function speedBreak(closed, look = 8) {
  if (!closed || closed.length < look + 1) return null;
  const prior = closed.slice(-1 - look, -1);
  const last = closed.at(-1);
  const hi = Math.max(...prior.map((b) => n(b.h)));
  const lo = Math.min(...prior.map((b) => n(b.l)));
  const px = n(last.c);
  if (px > hi) return { direction: "long", level: hi, stopPx: lo, name: "break_high" };
  if (px < lo) return { direction: "short", level: lo, stopPx: hi, name: "break_low" };
  return null;
}

export function evaluateSpeedEntry(htf, ltf, quote, cfg) {
  const canShort = cfg.allow_shorts !== false;
  const minRr = Math.max(1.5, Number(cfg.min_rr || 1.5));
  const minStop = Number(cfg.min_stop_pct || 0.004);
  const maxStop = Number(cfg.max_stop_pct || 0.02);
  const look = Number(cfg.break_lookback || 8);
  const series = closedBars(ltf);
  const px = n(series.at(-1)?.c);
  if (!(px > 0) || series.length < 24) return fail("speed_no_price");
  if (quote?.spreadPct > Number(cfg.max_spread_pct || 0.0015)) {
    return fail("speed_spread", { spreadPct: quote.spreadPct });
  }

  const ltfBias = speedBias(series, Number(cfg.ema_fast || 9), Number(cfg.ema_mid || 21));
  const htfBias = speedBias(closedBars(htf), Number(cfg.ema_fast || 9), Number(cfg.ema_mid || 21));
  if (ltfBias === "chop") return fail("speed_chop", { ltfBias, htfBias });
  if (htfBias !== "chop" && htfBias !== ltfBias) return fail("speed_htf_against", { ltfBias, htfBias });

  const brk = speedBreak(series, look);
  if (!brk) return fail("speed_no_break", { ltfBias, htfBias });
  if (brk.direction === "long" && ltfBias !== "up") return fail("speed_break_against", { ltfBias });
  if (brk.direction === "short" && ltfBias !== "down") return fail("speed_break_against", { ltfBias });
  if (brk.direction === "short" && !canShort) return fail("speed_short_off");

  const atrNow = atr(ltf, Number(cfg.atr_period || 14));
  const atrMult = Number(cfg.atr_stop_multiplier || 1.2);
  let stop = brk.stopPx;
  if (atrNow > 0) {
    const atrStop = brk.direction === "long" ? px - atrMult * atrNow : px + atrMult * atrNow;
    stop = brk.direction === "long" ? Math.min(stop, atrStop) : Math.max(stop, atrStop);
  }
  const stopPct = Math.abs(px - stop) / px;
  if (stopPct < minStop) return fail("speed_stop_too_tight", { stopPct, ltfBias });
  if (stopPct > maxStop) return fail("speed_stop_too_wide", { stopPct, ltfBias });

  const risk = Math.abs(px - stop);
  const tp = brk.direction === "long" ? px + minRr * risk : px - minRr * risk;
  return {
    take: true,
    direction: brk.direction,
    side: brk.direction === "long" ? "buy" : "sell",
    setup: `speed+${brk.name}+${ltfBias}`,
    grade: htfBias === ltfBias ? "A" : "B",
    score: htfBias === ltfBias ? 8 : 6,
    stop,
    tp,
    trigger: px,
    reason: "speed_take",
    video: { rr: minRr, ltfBias, htfBias, mode: "speed", venue_style: "xtrend_speed" },
  };
}
