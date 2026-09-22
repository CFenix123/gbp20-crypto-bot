/**
 * MIND candle engine — https://www.youtube.com/watch?v=lEk4cSA7cqc
 * Mind Math Money: MASTER Candlestick Patterns in 125 Minutes.
 * Reversals need a prior move. Continuations need a trend. Mechanical encoding.
 */
import { geometry, avgRange } from "./candle_patterns.js";

function n(v) {
  return Number(v);
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

export function priorTrend(closed, look = 6) {
  if (!closed || closed.length < look + 1) return "chop";
  const a = n(closed.at(-1 - look).c);
  const b = n(closed.at(-2).c);
  if (!(a > 0)) return "chop";
  const pct = (b - a) / a;
  if (pct > 0.004) return "up";
  if (pct < -0.004) return "down";
  return "chop";
}

function strong(g, priorBody) {
  return g.body >= 0.55 * g.range && (priorBody <= 0 || g.body >= 0.7 * priorBody);
}

function smallBody(g) {
  return g.body / g.range <= 0.38;
}

export function detectMorningEveningStar(closed) {
  if (closed.length < 3) return null;
  const a = geometry(closed.at(-3));
  const b = geometry(closed.at(-2));
  const c = geometry(closed.at(-1));
  const midA = (a.o + a.c) / 2;
  if (a.bear && strong(a, 0) && smallBody(b) && c.bull && strong(c, a.body) && c.c >= midA) {
    return hit("morning_star", "long", closed.slice(-3), { score: 9 });
  }
  if (a.bull && strong(a, 0) && smallBody(b) && c.bear && strong(c, a.body) && c.c <= midA) {
    return hit("evening_star", "short", closed.slice(-3), { score: 9 });
  }
  return null;
}

export function detectPiercingDarkCloud(closed) {
  if (closed.length < 2) return null;
  const a = geometry(closed.at(-2));
  const b = geometry(closed.at(-1));
  const midA = (a.o + a.c) / 2;
  if (a.bear && strong(a, 0) && b.bull && b.o <= a.c && b.c >= midA && b.c < a.o) {
    return hit("piercing", "long", closed.slice(-2), { score: 8 });
  }
  if (a.bull && strong(a, 0) && b.bear && b.o >= a.c && b.c <= midA && b.c > a.o) {
    return hit("dark_cloud", "short", closed.slice(-2), { score: 8 });
  }
  return null;
}

export function detectInvertedHammerHanging(closed) {
  if (closed.length < 1) return null;
  const curr = closed.at(-1);
  const g = geometry(curr);
  const inv =
    g.upper >= 2 * Math.max(g.body, g.range * 0.08) &&
    g.upper >= 0.45 * g.range &&
    g.lower <= 0.2 * g.range;
  const hang =
    g.lower >= 2 * Math.max(g.body, g.range * 0.08) &&
    g.lower >= 0.45 * g.range &&
    g.upper <= 0.2 * g.range;
  if (inv) return hit("inverted_hammer", "long", [curr], { score: 7 });
  if (hang) return hit("hanging_man", "short", [curr], { score: 7 });
  return null;
}

export function detectThreeMethods(closed) {
  if (closed.length < 5) return null;
  const bars = closed.slice(-5);
  const g = bars.map(geometry);
  const first = g[0];
  const last = g[4];
  const mid = g.slice(1, 4);
  const inside = mid.every((m) => m.h <= first.h && m.l >= first.l && smallBody(m));
  if (!inside) return null;
  if (first.bull && strong(first, 0) && last.bull && last.c > first.c) {
    return hit("rising_three", "long", bars, { score: 8, continuation: true });
  }
  if (first.bear && strong(first, 0) && last.bear && last.c < first.c) {
    return hit("falling_three", "short", bars, { score: 8, continuation: true });
  }
  return null;
}

export function detectFlag(closed) {
  if (closed.length < 8) return null;
  const pole = closed.at(-6);
  const flag = closed.slice(-5, -1);
  const breakout = closed.at(-1);
  const pg = geometry(pole);
  const bg = geometry(breakout);
  const prior = avgRange(closed.slice(-12, -6), 6);
  if (!(prior > 0) || pg.range < 1.6 * prior) return null;
  const fh = Math.max(...flag.map((b) => n(b.h)));
  const fl = Math.min(...flag.map((b) => n(b.l)));
  const compact = (fh - fl) / n(breakout.c) <= 0.008;
  const small = flag.every((b) => smallBody(geometry(b)));
  if (!compact || !small) return null;
  if (pg.bull && bg.bull && bg.c > n(flag.at(-1).o) && bg.c > fh * 0.999) {
    return hit("bull_flag", "long", [pole, ...flag, breakout], { score: 8, continuation: true });
  }
  if (pg.bear && bg.bear && bg.c < n(flag.at(-1).o) && bg.c < fl * 1.001) {
    return hit("bear_flag", "short", [pole, ...flag, breakout], { score: 8, continuation: true });
  }
  return null;
}

export function detectMindMomentum(closed) {
  if (closed.length < 5) return null;
  const curr = closed.at(-1);
  const g = geometry(curr);
  const priorBodies = closed.slice(-5, -1).map((b) => geometry(b).body);
  const avg = priorBodies.reduce((s, x) => s + x, 0) / priorBodies.length;
  if (!(avg > 0) || g.body < 2 * avg) return null;
  if (g.body / g.range < 0.62) return null;
  if (g.bull) return hit("mind_momentum", "long", [curr], { score: 7, continuation: true });
  if (g.bear) return hit("mind_momentum", "short", [curr], { score: 7, continuation: true });
  return null;
}

export function detectMindPatterns(closed) {
  const out = [];
  const add = (p) => {
    if (p) out.push(p);
  };
  add(detectMorningEveningStar(closed));
  add(detectPiercingDarkCloud(closed));
  add(detectInvertedHammerHanging(closed));
  add(detectThreeMethods(closed));
  add(detectFlag(closed));
  add(detectMindMomentum(closed));
  return out;
}
