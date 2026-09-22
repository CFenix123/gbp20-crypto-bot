/**
 * ALPHA candle engine — https://www.youtube.com/watch?v=tW13N4Hll88
 * Patterns are hints. Video: do not trade them alone; pair with S/R (or a
 * momentum break of a sideways range). Mechanical encoding, not a clone.
 */
import { findSwings, sessionLevels, previousDayLevels } from "./video_model.js";

function n(v) {
  return Number(v);
}

export function geometry(b) {
  const o = n(b.o);
  const h = n(b.h);
  const l = n(b.l);
  const c = n(b.c);
  const body = Math.abs(c - o);
  const range = Math.max(h - l, 1e-12);
  return {
    o,
    h,
    l,
    c,
    body,
    range,
    upper: h - Math.max(o, c),
    lower: Math.min(o, c) - l,
    bull: c > o,
    bear: c < o,
  };
}

export function avgRange(bars, look = 6) {
  const src = (bars || []).slice(-look);
  if (!src.length) return 0;
  return src.reduce((s, b) => s + geometry(b).range, 0) / src.length;
}

export function srLevels(htf, now = new Date()) {
  const { highs, lows } = findSwings(htf, 2, 2);
  const sess = sessionLevels(htf, now);
  const pd = previousDayLevels(htf, now);
  const supports = [
    ...lows.slice(-16).map((s) => s.px),
    ...Object.values(sess || {}).map((s) => s.low),
    pd?.low,
    pd?.ndog?.low,
  ].filter((v) => v > 0);
  const resistances = [
    ...highs.slice(-16).map((s) => s.px),
    ...Object.values(sess || {}).map((s) => s.high),
    pd?.high,
    pd?.ndog?.high,
  ].filter((v) => v > 0);
  return { supports, resistances, sess, pd };
}

export function atSupport(px, extreme, supports, tol = 0.0018) {
  if (!(px > 0) || !supports?.length) return false;
  return supports.some((lv) => {
    const near = Math.abs(extreme - lv) / px <= tol;
    const swept = extreme <= lv && n(px) >= lv * (1 - tol);
    return near || swept;
  });
}

export function atResistance(px, extreme, resistances, tol = 0.0018) {
  if (!(px > 0) || !resistances?.length) return false;
  return resistances.some((lv) => {
    const near = Math.abs(extreme - lv) / px <= tol;
    const swept = extreme >= lv && n(px) <= lv * (1 + tol);
    return near || swept;
  });
}

function hit(name, direction, bars, extra = {}) {
  const lows = bars.map((b) => n(b.l));
  const highs = bars.map((b) => n(b.h));
  return {
    name,
    direction,
    bars,
    stopPx: direction === "long" ? Math.min(...lows) : Math.max(...highs),
    extreme: direction === "long" ? Math.min(...lows) : Math.max(...highs),
    ...extra,
  };
}

export function detectEngulfing(closed) {
  if (closed.length < 2) return null;
  const prev = closed.at(-2);
  const curr = closed.at(-1);
  const a = geometry(prev);
  const b = geometry(curr);
  const full = b.l <= a.l && b.h >= a.h;
  const bodyEngulf = b.o <= a.c && b.c >= a.o;
  if (a.bear && b.bull && (full || bodyEngulf) && b.range >= a.range * 0.98) {
    return hit("engulfing", "long", [prev, curr], { full, score: full ? 9 : 8 });
  }
  const bodyEngulfShort = b.o >= a.c && b.c <= a.o;
  const fullShort = b.h >= a.h && b.l <= a.l;
  if (a.bull && b.bear && (fullShort || bodyEngulfShort) && b.range >= a.range * 0.98) {
    return hit("engulfing", "short", [prev, curr], { full: fullShort, score: fullShort ? 9 : 8 });
  }
  return null;
}

export function detectMomentum(closed, mult = 2) {
  if (closed.length < 8) return null;
  const curr = closed.at(-1);
  const g = geometry(curr);
  const prior = avgRange(closed.slice(-7, -1), 6);
  if (!(prior > 0) || g.range < Number(mult) * prior) return null;
  const look = closed.slice(-9, -1);
  const hi = Math.max(...look.map((b) => n(b.h)));
  const lo = Math.min(...look.map((b) => n(b.l)));
  const rangeBox = hi - lo;
  const choppy = rangeBox > 0 && rangeBox / curr.c <= 0.012;
  if (g.bull && n(curr.c) > hi) {
    return hit("momentum", "long", [curr], { score: choppy ? 8 : 6, choppy, prior });
  }
  if (g.bear && n(curr.c) < lo) {
    return hit("momentum", "short", [curr], { score: choppy ? 8 : 6, choppy, prior });
  }
  return null;
}

export function detectWickCluster(closed, minCount = 3) {
  if (closed.length < minCount) return null;
  const last = closed.slice(-Math.max(minCount, 4));
  const geos = last.map(geometry);
  const px = geos.at(-1).c;
  const down = geos.filter((g) => g.lower >= 0.38 * g.range);
  const up = geos.filter((g) => g.upper >= 0.38 * g.range);
  if (down.length >= minCount) {
    const lows = last.map((b) => n(b.l));
    const cluster = (Math.max(...lows) - Math.min(...lows)) / px <= 0.0022;
    if (cluster) return hit("wick_cluster", "long", last, { score: 8, count: down.length });
  }
  if (up.length >= minCount) {
    const highs = last.map((b) => n(b.h));
    const cluster = (Math.max(...highs) - Math.min(...highs)) / px <= 0.0022;
    if (cluster) return hit("wick_cluster", "short", last, { score: 8, count: up.length });
  }
  return null;
}

function isDoji(g) {
  if (g.range <= 0) return false;
  const thin = g.body / g.range <= 0.18;
  const dragonfly = g.lower >= 0.55 * g.range && g.upper <= 0.18 * g.range;
  const gravestone = g.upper >= 0.55 * g.range && g.lower <= 0.18 * g.range;
  const longLeg = thin && g.upper >= 0.28 * g.range && g.lower >= 0.28 * g.range;
  return thin || dragonfly || gravestone || longLeg;
}

export function detectDojiConfirm(closed) {
  if (closed.length < 4) return null;
  const dojiBar = closed.at(-3);
  const a = closed.at(-2);
  const b = closed.at(-1);
  if (!isDoji(geometry(dojiBar))) return null;
  const ga = geometry(a);
  const gb = geometry(b);
  if (ga.bull && gb.bull && gb.c > ga.c) {
    return hit("doji_confirm", "long", [dojiBar, a, b], { score: 7 });
  }
  if (ga.bear && gb.bear && gb.c < ga.c) {
    return hit("doji_confirm", "short", [dojiBar, a, b], { score: 7 });
  }
  return null;
}

export function detectHammerStar(closed) {
  if (closed.length < 1) return null;
  const curr = closed.at(-1);
  const g = geometry(curr);
  const hammer =
    g.lower >= 0.5 * g.range &&
    g.lower >= 1.4 * Math.max(g.body, g.range * 0.08) &&
    g.upper <= 0.25 * g.range;
  const star =
    g.upper >= 0.5 * g.range &&
    g.upper >= 1.4 * Math.max(g.body, g.range * 0.08) &&
    g.lower <= 0.25 * g.range;
  if (hammer) return hit("hammer", "long", [curr], { score: 8 });
  if (star) return hit("shooting_star", "short", [curr], { score: 8 });
  return null;
}

export function detectTweezer(closed) {
  if (closed.length < 2) return null;
  const prev = closed.at(-2);
  const curr = closed.at(-1);
  const a = geometry(prev);
  const b = geometry(curr);
  const px = b.c;
  const lowMatch = Math.abs(a.l - b.l) / px <= 0.0009;
  const highMatch = Math.abs(a.h - b.h) / px <= 0.0009;
  if (a.bear && b.bull && lowMatch && a.lower > 0 && b.lower > 0) {
    return hit("tweezer", "long", [prev, curr], { score: 8 });
  }
  if (a.bull && b.bear && highMatch && a.upper > 0 && b.upper > 0) {
    return hit("tweezer", "short", [prev, curr], { score: 8 });
  }
  return null;
}

export function detectMarubozu(closed) {
  if (closed.length < 5) return null;
  const curr = closed.at(-1);
  const g = geometry(curr);
  const prior = avgRange(closed.slice(-5, -1), 4);
  if (g.body / g.range < 0.88) return null;
  if (g.upper / g.range > 0.07 || g.lower / g.range > 0.07) return null;
  if (prior > 0 && g.range < 1.05 * prior) return null;
  if (g.bull) return hit("marubozu", "long", [curr], { score: 6, continuation: true });
  if (g.bear) return hit("marubozu", "short", [curr], { score: 6, continuation: true });
  return null;
}

export function detectPatterns(closed, cfg = {}) {
  const out = [];
  const add = (p) => {
    if (p) out.push(p);
  };
  add(detectEngulfing(closed));
  add(detectMomentum(closed, Number(cfg.momentum_mult || 2)));
  add(detectWickCluster(closed, Number(cfg.min_wick_cluster || 3)));
  add(detectDojiConfirm(closed));
  add(detectHammerStar(closed));
  add(detectTweezer(closed));
  add(detectMarubozu(closed));
  return out;
}

export function confluent(pattern, sr, px, tol) {
  if (!pattern) return null;
  if (pattern.name === "momentum") {
    return { ...pattern, sr: pattern.choppy ? "range_break" : "breakout", ok: Boolean(pattern.choppy || pattern.score >= 6) };
  }
  if (pattern.name === "marubozu") {
    return { ...pattern, sr: "continuation", ok: true };
  }
  const ok =
    pattern.direction === "long"
      ? atSupport(px, pattern.extreme, sr.supports, tol)
      : atResistance(px, pattern.extreme, sr.resistances, tol);
  return { ...pattern, sr: ok ? "level" : null, ok };
}
