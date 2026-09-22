import { closedBars, etMinutes } from "./video_model.js";
import { detectPatterns, confluent, srLevels } from "./candle_patterns.js";

function n(v) {
  return Number(v);
}

function sma(arr, period) {
  if (!arr?.length || arr.length < period) return null;
  const slice = arr.slice(-period);
  return slice.reduce((s, x) => s + x, 0) / period;
}

export function emaSeries(values, period) {
  if (!values?.length) return [];
  const k = 2 / (period + 1);
  let e = values[0];
  const out = [e];
  for (let i = 1; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

export function trueRanges(bars) {
  const src = closedBars(bars);
  const out = [];
  for (let i = 1; i < src.length; i++) {
    const h = n(src[i].h);
    const l = n(src[i].l);
    const pc = n(src[i - 1].c);
    out.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return out;
}

export function atr(bars, period = 14) {
  return sma(trueRanges(bars), period);
}

export function atrMedian(bars, period = 14, lookback = 40) {
  const trs = trueRanges(bars);
  if (trs.length < period + 5) return null;
  const vals = [];
  for (let i = period; i <= trs.length; i++) {
    vals.push(sma(trs.slice(0, i), period));
  }
  const window = vals.filter((v) => v > 0).slice(-lookback);
  if (!window.length) return null;
  const sorted = [...window].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function rsi(bars, period = 14) {
  const c = closedBars(bars).map((b) => n(b.c));
  if (c.length < period + 2) return null;
  let gain = 0;
  let loss = 0;
  for (let i = c.length - period; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

export function htfBias(htf, fast = 9, slow = 21) {
  const src = closedBars(htf);
  const closes = src.map((b) => n(b.c));
  if (closes.length < slow + 3) return { bias: "chop", reason: "quant_warmup" };
  const f = emaSeries(closes, fast);
  const s = emaSeries(closes, slow);
  const lastF = f.at(-1);
  const lastS = s.at(-1);
  const prevS = s.at(-2);
  const slope = lastS - prevS;
  const atrNow = atr(htf, 14);
  const med = atrMedian(htf, 14, 40);
  const sep = atrNow > 0 ? Math.abs(lastF - lastS) / atrNow : 0;
  const compressed = med > 0 && atrNow < 0.88 * med && sep < 0.22;
  if (compressed) return { bias: "chop", reason: "quant_chop", lastF, lastS, atrNow, med, sep };
  if (lastF > lastS && slope >= 0) return { bias: "up", lastF, lastS, atrNow, med, sep };
  if (lastF < lastS && slope <= 0) return { bias: "down", lastF, lastS, atrNow, med, sep };
  return { bias: "chop", reason: "quant_no_trend", lastF, lastS, atrNow, med, sep };
}

function fail(reason, extra = {}) {
  return { take: false, reason, ...extra };
}

function planTrade({ direction, px, stop, minRr, minStop, maxStop, setup, grade, score, extra }) {
  const stopPct = Math.abs(px - stop) / px;
  if (stopPct < minStop) return fail("quant_stop_too_tight", { stopPct });
  if (stopPct > maxStop) return fail("quant_stop_too_wide", { stopPct });
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
    reason: "quant_take",
    video: { rr: minRr, ...extra },
  };
}

function structuralStop(direction, px, patternStop, sr, minStop, maxStop) {
  let stop = patternStop;
  const stopPct = Math.abs(px - stop) / px;
  if (stopPct >= minStop && stopPct <= maxStop) return stop;
  if (direction === "long") {
    const floor = px * (1 - maxStop);
    const need = px * (1 - minStop);
    const cands = (sr.supports || []).filter((lv) => lv < px && lv >= floor && lv <= need);
    if (cands.length) stop = Math.max(...cands);
  } else {
    const ceil = px * (1 + maxStop);
    const need = px * (1 + minStop);
    const cands = (sr.resistances || []).filter((lv) => lv > px && lv <= ceil && lv >= need);
    if (cands.length) stop = Math.min(...cands);
  }
  return stop;
}

/**
 * ALPHA book — not TJR.
 * Primary: candlestick patterns from https://www.youtube.com/watch?v=tW13N4Hll88
 * (engulfing, momentum, wick cluster, doji+2 confirms, hammer/star, tweezer, marubozu)
 * at 15m S/R. EMA bias only grades A vs B — it does not block reversals.
 */
export function evaluateQuantEntry(htf, ltf, quote, cfg, now = new Date()) {
  const canShort = cfg.allow_shorts !== false;
  const minRr = Math.max(1.5, Number(cfg.min_rr || 2));
  const minStop = Number(cfg.min_stop_pct || 0.012);
  const maxStop = Number(cfg.max_stop_pct || 0.03);
  const tol = Number(cfg.sr_tol_pct || 0.0018);
  const ltfClosed = closedBars(ltf);
  const px = n(ltfClosed.at(-1)?.c);
  if (!(px > 0) || ltfClosed.length < 12) return fail("quant_no_price");

  if (quote?.spreadPct > Number(cfg.max_spread_pct || 0.0008)) {
    return fail("quant_spread", { spreadPct: quote.spreadPct });
  }

  const found = detectPatterns(ltfClosed, cfg);
  if (!found.length) return fail("candle_none", { et: etMinutes(now) });

  const sr = srLevels(htf, now);
  const ranked = found
    .map((p) => confluent(p, sr, px, tol))
    .filter((p) => p?.ok)
    .filter((p) => p.direction !== "short" || canShort)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  if (!ranked.length) {
    const names = found.map((p) => `${p.name}:${p.direction}`).join(",");
    return fail("candle_no_sr", { patterns: names });
  }

  const best = ranked[0];
  const h = htfBias(htf, Number(cfg.htf_ema_fast || 9), Number(cfg.htf_ema_slow || 21));
  const aligned =
    (best.direction === "long" && h.bias === "up") || (best.direction === "short" && h.bias === "down");
  const reversal = ["engulfing", "hammer", "shooting_star", "tweezer", "wick_cluster", "doji_confirm"].includes(
    best.name
  );
  const grade = reversal && best.sr === "level" ? (aligned ? "A" : "B") : aligned ? "B" : "B";
  const stop = structuralStop(best.direction, px, best.stopPx * (best.direction === "long" ? 0.9994 : 1.0006), sr, minStop, maxStop);

  return planTrade({
    direction: best.direction,
    px,
    stop,
    minRr,
    minStop,
    maxStop,
    setup: `alpha+${best.name}+${best.sr || "pattern"}`,
    grade,
    score: Math.min(10, (best.score || 6) + (aligned ? 1 : 0)),
    extra: { pattern: best.name, sr: best.sr, htf: h.bias, mode: "candle" },
  });
}
