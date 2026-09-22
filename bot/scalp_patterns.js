/**
 * SCALP candle list from the short-term Kraken prompt.
 * Patterns never fire a trade alone — scoring + S/R + fees decide.
 */
import { geometry, detectPatterns } from "./candle_patterns.js";
import { detectMorningEveningStar, detectInvertedHammerHanging } from "./mind_patterns.js";

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

export function detectThreeSoldiersCrows(closed) {
  if (closed.length < 3) return null;
  const a = geometry(closed.at(-3));
  const b = geometry(closed.at(-2));
  const c = geometry(closed.at(-1));
  const rising = a.bull && b.bull && c.bull && b.c > a.c && c.c > b.c;
  const falling = a.bear && b.bear && c.bear && b.c < a.c && c.c < b.c;
  const bodies = [a, b, c].every((g) => g.body / g.range >= 0.5);
  if (rising && bodies) return hit("three_soldiers", "long", closed.slice(-3), { score: 8 });
  if (falling && bodies) return hit("three_crows", "short", closed.slice(-3), { score: 8 });
  return null;
}

export function detectInsideOutside(closed) {
  if (closed.length < 2) return null;
  const a = geometry(closed.at(-2));
  const b = geometry(closed.at(-1));
  if (b.h < a.h && b.l > a.l) {
    return hit(b.bull ? "inside_bar" : "inside_bar", b.bull ? "long" : "short", closed.slice(-2), {
      score: 5,
    });
  }
  if (b.h > a.h && b.l < a.l) {
    return hit("outside_bar", b.bull ? "long" : "short", closed.slice(-2), { score: 7 });
  }
  return null;
}

export function detectPinBar(closed) {
  if (closed.length < 1) return null;
  const curr = closed.at(-1);
  const g = geometry(curr);
  const bullPin = g.lower >= 2 * Math.max(g.body, g.range * 0.08) && g.lower >= 0.5 * g.range && g.upper <= 0.2 * g.range;
  const bearPin = g.upper >= 2 * Math.max(g.body, g.range * 0.08) && g.upper >= 0.5 * g.range && g.lower <= 0.2 * g.range;
  if (bullPin) return hit("bull_pin", "long", [curr], { score: 7 });
  if (bearPin) return hit("bear_pin", "short", [curr], { score: 7 });
  return null;
}

export function detectScalpPatterns(closed, cfg = {}) {
  const out = detectPatterns(closed, cfg);
  const add = (p) => {
    if (p) out.push(p);
  };
  add(detectMorningEveningStar(closed));
  add(detectInvertedHammerHanging(closed));
  add(detectThreeSoldiersCrows(closed));
  add(detectInsideOutside(closed));
  add(detectPinBar(closed));
  return out;
}
