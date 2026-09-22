/**
 * SCALP book — short-term scan/score/long-or-short from the Kraken prompt.
 * PAPER only. Isolated 1x shorts. Patterns never trade alone.
 * NO TRADE is the default. Not financial advice.
 */
import { closedBars, findSwings } from "./video_model.js";
import { srLevels, atSupport, atResistance } from "./candle_patterns.js";
import { snapshot } from "./scalp_indicators.js";
import { detectScalpPatterns } from "./scalp_patterns.js";

function n(v) {
  return Number(v);
}

function fail(reason, extra = {}) {
  return { take: false, reason, ...extra };
}

export function marketStructure(closed) {
  const { highs, lows } = findSwings(closed, 2, 2);
  const h = highs.slice(-2);
  const l = lows.slice(-2);
  const hh = h.length >= 2 && h.at(-1).px > h.at(-2).px;
  const hl = l.length >= 2 && l.at(-1).px > l.at(-2).px;
  const lh = h.length >= 2 && h.at(-1).px < h.at(-2).px;
  const ll = l.length >= 2 && l.at(-1).px < l.at(-2).px;
  if (hh && hl) return { bias: "up", name: "hh_hl", bos: "bull" };
  if (lh && ll) return { bias: "down", name: "lh_ll", bos: "bear" };
  if (hh && ll) return { bias: "chop", name: "expand", bos: null };
  return { bias: "chop", name: "range", bos: null };
}

export function regimeOf(ind, struct, px) {
  const vol = ind.atr && px > 0 ? ind.atr / px : 0;
  let trend = struct.bias;
  if (ind.ema9 && ind.ema21) {
    if (ind.ema9 > ind.ema21 && px > ind.ema21) trend = trend === "down" ? "chop" : "up";
    if (ind.ema9 < ind.ema21 && px < ind.ema21) trend = trend === "up" ? "chop" : "down";
  }
  if (vol > 0 && vol < 0.002) return { regime: "low_vol", trend };
  if (vol > 0.02) return { regime: "high_vol", trend };
  if (trend === "up") return { regime: "bullish", trend };
  if (trend === "down") return { regime: "bearish", trend };
  return { regime: "sideways", trend };
}

const WEIGHTS = {
  candle: 20,
  structure: 15,
  trend: 15,
  volume: 15,
  momentum: 10,
  sr: 10,
  volatility: 5,
  liquidity: 5,
  htf: 5,
};

export function scoreDirection(direction, { pattern, struct, ind, px, sr, quote, cfg }) {
  const parts = {
    candle: 0,
    structure: 0,
    trend: 0,
    volume: 0,
    momentum: 0,
    sr: 0,
    volatility: 0,
    liquidity: 0,
    htf: 0,
  };
  const long = direction === "long";
  if (pattern && pattern.direction === direction) {
    parts.candle = Math.min(WEIGHTS.candle, 10 + (pattern.score || 6));
  }
  if (struct.bias === (long ? "up" : "down")) parts.structure = 15;
  else if (struct.bias === "chop") parts.structure = 6;
  if (ind.ema9 && ind.ema21) {
    const aligned = long ? ind.ema9 > ind.ema21 : ind.ema9 < ind.ema21;
    parts.trend = aligned ? 12 : 3;
    if (ind.ema50 && ((long && ind.ema21 > ind.ema50) || (!long && ind.ema21 < ind.ema50))) {
      parts.trend = Math.min(15, parts.trend + 3);
    }
  }
  if (ind.relVol != null) {
    if (ind.relVol >= 1.2) parts.volume = 13;
    else if (ind.relVol >= 0.9) parts.volume = 8;
    else parts.volume = 2;
  }
  if (ind.rsi != null) {
    if (long && ind.rsi >= 45 && ind.rsi <= 68) parts.momentum = 8;
    else if (!long && ind.rsi >= 32 && ind.rsi <= 55) parts.momentum = 8;
    else if (ind.rsi > 75 || ind.rsi < 25) parts.momentum = 2;
    else parts.momentum = 5;
    if (ind.macd) {
      const histOk = long ? ind.macd.hist > 0 : ind.macd.hist < 0;
      if (histOk) parts.momentum = Math.min(10, parts.momentum + 2);
    }
  }
  const near =
    long
      ? atSupport(px, pattern?.extreme || px, sr.supports, Number(cfg.sr_tol_pct || 0.0018))
      : atResistance(px, pattern?.extreme || px, sr.resistances, Number(cfg.sr_tol_pct || 0.0018));
  const blocked =
    long
      ? (sr.resistances || []).some((lv) => lv > px && (lv - px) / px < 0.004)
      : (sr.supports || []).some((lv) => lv < px && (px - lv) / px < 0.004);
  parts.sr = near && !blocked ? 10 : near ? 6 : blocked ? 1 : 4;
  const atrPct = ind.atr && px > 0 ? ind.atr / px : 0;
  if (atrPct >= 0.004 && atrPct <= 0.018) parts.volatility = 5;
  else if (atrPct > 0) parts.volatility = 2;
  const spread = Number(quote?.spreadPct || 0);
  parts.liquidity = spread > 0 && spread <= Number(cfg.max_spread_pct || 0.0008) ? 5 : 1;
  if (ind.htfEma9 && ind.htfEma21) {
    const htfOk = long ? ind.htfEma9 >= ind.htfEma21 : ind.htfEma9 <= ind.htfEma21;
    parts.htf = htfOk ? 5 : 1;
  }
  const total = Object.values(parts).reduce((s, x) => s + x, 0);
  return { total, parts, near, blocked };
}

function planStop(direction, px, pattern, ind, sr, cfg) {
  const atrMult = Number(cfg.atr_stop_multiplier || 1.2);
  const atrStop = ind.atr > 0 ? (direction === "long" ? px - atrMult * ind.atr : px + atrMult * ind.atr) : null;
  let stop = pattern?.stopPx || atrStop;
  if (direction === "long") {
    const floor = px * (1 - Number(cfg.max_stop_pct || 0.03));
    const cands = (sr.supports || []).filter((lv) => lv < px && lv >= floor);
    if (cands.length) stop = Math.min(stop || px, Math.max(...cands));
    if (atrStop) stop = Math.min(stop, atrStop);
  } else {
    const ceil = px * (1 + Number(cfg.max_stop_pct || 0.03));
    const cands = (sr.resistances || []).filter((lv) => lv > px && lv <= ceil);
    if (cands.length) stop = Math.max(stop || px, Math.min(...cands));
    if (atrStop) stop = Math.max(stop, atrStop);
  }
  return stop;
}

/**
 * Independent LONG vs SHORT scores. Both must not qualify at once.
 */
export function evaluateScalpEntry(htf, ltf, quote, cfg, now = new Date()) {
  const canShort = cfg.allow_shorts !== false;
  const minScore = Number(cfg.min_trade_score || 70);
  const minRr = Math.max(1.5, Number(cfg.min_rr || 2));
  const minStop = Number(cfg.min_stop_pct || 0.012);
  const maxStop = Number(cfg.max_stop_pct || 0.03);
  const series = closedBars(ltf);
  const px = n(series.at(-1)?.c);
  if (!(px > 0) || series.length < 30) return fail("scalp_no_price");
  if (quote?.spreadPct > Number(cfg.max_spread_pct || 0.0008)) {
    return fail("scalp_spread", { spreadPct: quote.spreadPct });
  }

  const patterns = detectScalpPatterns(series, cfg);
  const struct = marketStructure(series);
  const ind = snapshot(ltf, htf, cfg);
  const sr = srLevels(htf, now);
  const regime = regimeOf(ind, struct, px);
  if (regime.regime === "low_vol") return fail("scalp_low_vol", { regime: regime.regime });
  if (regime.regime === "high_vol") return fail("scalp_high_vol", { regime: regime.regime });

  const longPat = patterns.filter((p) => p.direction === "long").sort((a, b) => (b.score || 0) - (a.score || 0))[0] || null;
  const shortPat = patterns.filter((p) => p.direction === "short").sort((a, b) => (b.score || 0) - (a.score || 0))[0] || null;

  const long = scoreDirection("long", { pattern: longPat, struct, ind, px, sr, quote, cfg });
  const short = scoreDirection("short", { pattern: shortPat, struct, ind, px, sr, quote, cfg });
  const lastBar = series.at(-1);
  const explain = {
    long: long.total,
    short: short.total,
    long_parts: long.parts,
    short_parts: short.parts,
    regime: regime.regime,
    structure: struct.name,
    patterns: patterns.map((p) => p.name).join(","),
  };

  if (long.total >= minScore && short.total >= minScore) {
    return fail("scalp_both_qualify", explain);
  }
  const pick =
    long.total >= minScore && long.total > short.total
      ? { direction: "long", scored: long, pattern: longPat }
      : short.total >= minScore && canShort && short.total > long.total
        ? { direction: "short", scored: short, pattern: shortPat }
        : null;
  if (!pick) {
    return fail(
      long.total >= short.total ? `scalp_long_${long.total.toFixed(0)}_lt_${minScore}` : `scalp_short_${short.total.toFixed(0)}_lt_${minScore}`,
      explain
    );
  }
  if (!pick.pattern) return fail("scalp_no_pattern", explain);

  const stop = planStop(pick.direction, px, pick.pattern, ind, sr, cfg);
  const stopPct = Math.abs(px - stop) / px;
  if (stopPct < minStop) return fail("scalp_stop_too_tight", { ...explain, stopPct });
  if (stopPct > maxStop) return fail("scalp_stop_too_wide", { ...explain, stopPct });
  const risk = Math.abs(px - stop);
  const tp = pick.direction === "long" ? px + minRr * risk : px - minRr * risk;
  const signalId = `${lastBar.t}:${pick.direction}:${pick.pattern.name}`;
  const grade = pick.scored.total >= 82 ? "A" : "B";
  return {
    take: true,
    direction: pick.direction,
    side: pick.direction === "long" ? "buy" : "sell",
    setup: `scalp+${pick.pattern.name}+${pick.scored.near ? "sr" : "score"}`,
    grade,
    score: pick.scored.total,
    stop,
    tp,
    trigger: px,
    reason: "scalp_take",
    signal_id: signalId,
    video: { rr: minRr, ...explain, mode: "scalp" },
  };
}
