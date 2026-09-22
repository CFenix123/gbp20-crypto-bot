import { closedBars, etMinutes } from "./video_model.js";
import { srLevels, atSupport, atResistance } from "./candle_patterns.js";
import { detectMindPatterns, priorTrend } from "./mind_patterns.js";

function n(v) {
  return Number(v);
}

function fail(reason, extra = {}) {
  return { take: false, reason, ...extra };
}

function planTrade({ direction, px, stop, minRr, minStop, maxStop, setup, grade, score, extra }) {
  const stopPct = Math.abs(px - stop) / px;
  if (stopPct < minStop) return fail("mind_stop_too_tight", { stopPct });
  if (stopPct > maxStop) return fail("mind_stop_too_wide", { stopPct });
  const risk = Math.abs(px - stop);
  const tp = direction === "long" ? px + minRr * risk : px - minRr * risk;
  return {
    take: true,
    direction,
    side: direction === "long" ? "buy" : "sell",
    setup,
    grade,
    score,
    stop,
    tp,
    trigger: px,
    reason: "mind_take",
    video: { rr: minRr, ...extra },
  };
}

/**
 * MIND book — Mind Math Money 125m candle course (lEk4cSA7cqc).
 * Not TJR. Not ALPHA. Reversal only after a prior move; continuation with trend.
 */
export function evaluateMindEntry(htf, ltf, quote, cfg, now = new Date()) {
  const canShort = cfg.allow_shorts !== false;
  const minRr = Math.max(1.5, Number(cfg.min_rr || 2));
  const minStop = Number(cfg.min_stop_pct || 0.012);
  const maxStop = Number(cfg.max_stop_pct || 0.03);
  const tol = Number(cfg.sr_tol_pct || 0.0018);
  const series = closedBars(cfg.pattern_tf === "htf" ? htf : ltf);
  const px = n(series.at(-1)?.c);
  if (!(px > 0) || series.length < 12) return fail("mind_no_price");
  if (quote?.spreadPct > Number(cfg.max_spread_pct || 0.0008)) {
    return fail("mind_spread", { spreadPct: quote.spreadPct });
  }

  const trend = priorTrend(series, Number(cfg.trend_lookback || 6));
  const found = detectMindPatterns(series);
  if (!found.length) return fail("mind_none", { et: etMinutes(now), trend });

  const sr = srLevels(htf, now);
  const ranked = found
    .filter((p) => p.direction !== "short" || canShort)
    .filter((p) => {
      if (p.continuation) return p.direction === "long" ? trend === "up" : trend === "down";
      return p.direction === "long" ? trend === "down" : trend === "up";
    })
    .map((p) => {
      if (p.continuation) return { ...p, sr: "trend", ok: true };
      const ok =
        p.direction === "long"
          ? atSupport(px, p.extreme, sr.supports, tol)
          : atResistance(px, p.extreme, sr.resistances, tol);
      return { ...p, sr: ok ? "level" : null, ok };
    })
    .filter((p) => p.ok)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  if (!ranked.length) {
    const names = found.map((p) => `${p.name}:${p.direction}`).join(",");
    return fail("mind_no_context", { patterns: names, trend });
  }

  const best = ranked[0];
  const grade = best.sr === "level" ? "A" : "B";
  const pad = best.direction === "long" ? 0.9994 : 1.0006;
  return planTrade({
    direction: best.direction,
    px,
    stop: best.stopPx * pad,
    minRr,
    minStop,
    maxStop,
    setup: `mind+${best.name}+${best.sr}`,
    grade,
    score: best.score || 7,
    extra: { pattern: best.name, sr: best.sr, trend, mode: "mind", video: "lEk4cSA7cqc" },
  });
}
