/**
 * PAPER TJR model — primary source: https://www.youtube.com/watch?v=yiuFUp0kFz8
 * (Path to Profitability ~6h). Toolbox, not a 100% discretionary clone.
 *
 * Thought process TJR teaches:
 *   1) Daily bias  — HTF structure (HH/HL vs LH/LL) + where DOL sits
 *   2) Liquidity   — reversal confluence (sweep of swing / session / PDH-PDL / equal H-L)
 *   3) Confirmation — BOS close *or* inverse FVG close (orders actually filled)
 *   4) Continuation — FVG tap + equilibrium (longs in discount, shorts in premium)
 *   5) Time         — NY manip 9:30–9:50 ET, entries 9:50–10:10, done ~10:30 (indexes)
 *   6) SMT          — SPY vs QQQ divergence at DOL (optional boost / veto)
 *
 * Stop = beyond the swept swing (invalidation). TP = next DOL, min ~2R.
 * Crypto spot: no shorts — sit out HTF down. Equity: both sides, flat EOD.
 */

function n(v) {
  return Number(v);
}

export function closedBars(bars) {
  if (!bars?.length) return [];
  return bars.length >= 2 ? bars.slice(0, -1) : bars;
}

const ET_MIN_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const ET_DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const etMinCache = new Map();
const etDayCache = new Map();

function etCacheKey(d) {
  return Math.floor(new Date(d).getTime() / 60000);
}

export function etMinutes(d) {
  const key = etCacheKey(d);
  if (etMinCache.has(key)) return etMinCache.get(key);
  const parts = Object.fromEntries(ET_MIN_FMT.formatToParts(d).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour === "24" ? 0 : parts.hour);
  const mins = hour * 60 + Number(parts.minute);
  etMinCache.set(key, mins);
  if (etMinCache.size > 4000) etMinCache.clear();
  return mins;
}

export function etDayKey(d) {
  const key = etCacheKey(d);
  if (etDayCache.has(key)) return etDayCache.get(key);
  const day = ET_DAY_FMT.format(d);
  etDayCache.set(key, day);
  if (etDayCache.size > 4000) etDayCache.clear();
  return day;
}

function prevEtDayKey(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  // 16:00 UTC is noon EDT / 11:00 EST — always that ET calendar day.
  return etDayKey(new Date(Date.UTC(y, m - 1, d, 16, 0, 0) - 24 * 3600 * 1000));
}

/** TJR "time in the market" — Eastern. Asia 18:00–03:00, London 03:00–08:30, NY pre 08:30. */
export const SESSIONS = {
  asia: [18 * 60, 3 * 60],
  london: [3 * 60, 8 * 60 + 30],
  ny_pre: [8 * 60 + 30, 9 * 60 + 30],
  ny_am: [9 * 60 + 30, 12 * 60],
  ny_pm: [13 * 60, 16 * 60],
};

/** NY index killzone (TJR). Crypto ignores this. */
export const NY_KILLZONE = {
  open: 9 * 60 + 30,
  manipEnd: 9 * 60 + 50,
  entryEnd: 10 * 60 + 30,
  lateEnd: 11 * 60 + 30,
  pmStart: 13 * 60,
  rthEnd: 16 * 60,
};

export function inSession(mins, [a, b]) {
  if (a < b) return mins >= a && mins < b;
  return mins >= a || mins < b;
}

function sessionInstanceKey(t, span) {
  const m = etMinutes(t);
  const day = etDayKey(t);
  if (!inSession(m, span)) return null;
  if (span[0] > span[1]) {
    return m >= span[0] ? day : prevEtDayKey(day);
  }
  return day;
}

/** Most recent completed/active H/L per session (does not merge two days). */
export function sessionLevels(bars, now = new Date()) {
  const out = {};
  for (const [name, span] of Object.entries(SESSIONS)) {
    const groups = new Map();
    for (const b of bars || []) {
      const t = new Date(b.t);
      const inst = sessionInstanceKey(t, span);
      if (!inst) continue;
      if (!groups.has(inst)) groups.set(inst, { high: -Infinity, low: Infinity });
      const g = groups.get(inst);
      g.high = Math.max(g.high, n(b.h));
      g.low = Math.min(g.low, n(b.l));
    }
    const latest = [...groups.keys()].sort().at(-1);
    if (!latest) continue;
    const g = groups.get(latest);
    if (Number.isFinite(g.high) && Number.isFinite(g.low) && g.high > g.low) {
      out[name] = { high: g.high, low: g.low, day: latest };
    }
  }
  return out;
}

/** Previous ET calendar-day high/low + close (PDH/PDL + NDOG anchor). */
export function previousDayLevels(bars, now = new Date()) {
  const today = etDayKey(now);
  const byDay = new Map();
  for (const b of bars || []) {
    const day = etDayKey(new Date(b.t));
    if (day >= today) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(b);
  }
  const prev = [...byDay.keys()].sort().at(-1);
  if (!prev) return null;
  const dayBars = byDay.get(prev);
  const high = Math.max(...dayBars.map((b) => n(b.h)));
  const low = Math.min(...dayBars.map((b) => n(b.l)));
  const close = n(dayBars.at(-1).c);
  const todayBars = (bars || []).filter((b) => etDayKey(new Date(b.t)) === today);
  const open = todayBars.length ? n(todayBars[0].o ?? todayBars[0].c) : null;
  let ndog = null;
  if (open > 0 && close > 0 && Math.abs(open - close) / close > 0.0004) {
    ndog = { low: Math.min(close, open), high: Math.max(close, open) };
  }
  return { day: prev, high, low, close, open, ndog };
}

export function findSwings(bars, left = 2, right = 2) {
  const closed = closedBars(bars);
  const highs = [];
  const lows = [];
  for (let i = left; i < closed.length - right; i++) {
    const h = n(closed[i].h);
    const l = n(closed[i].l);
    let isH = true;
    let isL = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (n(closed[j].h) >= h) isH = false;
      if (n(closed[j].l) <= l) isL = false;
    }
    if (isH) highs.push({ i, px: h, t: closed[i].t });
    if (isL) lows.push({ i, px: l, t: closed[i].t });
  }
  return { highs, lows, closed };
}

/**
 * Relative equal highs/lows — TJR "low-resistance / equal" DOL (stops stacked).
 */
export function equalLiquidityLevels(swings, tol = 0.0006) {
  const out = [];
  const used = new Set();
  for (let i = 0; i < swings.length; i++) {
    if (used.has(i)) continue;
    const group = [swings[i]];
    for (let j = i + 1; j < swings.length; j++) {
      if (used.has(j)) continue;
      if (Math.abs(swings[j].px - swings[i].px) / swings[i].px <= tol) {
        group.push(swings[j]);
        used.add(j);
      }
    }
    if (group.length >= 2) {
      used.add(i);
      const px = group.reduce((s, x) => s + x.px, 0) / group.length;
      out.push({ px, count: group.length });
    }
  }
  return out;
}

/**
 * Walk 15m closes → last BOS. BOS = candle CLOSE beyond most recent swing (TJR emphasis).
 */
export function structureBias(bars) {
  const { highs, lows, closed } = findSwings(bars);
  if (closed.length < 12 || highs.length < 2 || lows.length < 2) {
    return {
      bias: "chop",
      lastBos: null,
      lastHigh: highs.at(-1) || null,
      lastLow: lows.at(-1) || null,
      highs,
      lows,
      closed,
    };
  }
  let lastHigh = highs[0];
  let lastLow = lows[0];
  let bias = "chop";
  let lastBos = null;
  let hiPtr = 1;
  let loPtr = 1;
  for (let i = Math.min(lastHigh.i, lastLow.i) + 1; i < closed.length; i++) {
    while (hiPtr < highs.length && highs[hiPtr].i <= i) {
      lastHigh = highs[hiPtr];
      hiPtr++;
    }
    while (loPtr < lows.length && lows[loPtr].i <= i) {
      lastLow = lows[loPtr];
      loPtr++;
    }
    const c = n(closed[i].c);
    if (lastHigh && c > lastHigh.px) {
      bias = "up";
      lastBos = { direction: "long", i, px: c, broken: lastHigh.px, t: closed[i].t };
    } else if (lastLow && c < lastLow.px) {
      bias = "down";
      lastBos = { direction: "short", i, px: c, broken: lastLow.px, t: closed[i].t };
    }
  }
  return {
    bias,
    lastBos,
    lastHigh: highs.at(-1) || lastHigh,
    lastLow: lows.at(-1) || lastLow,
    highs,
    lows,
    closed,
  };
}

/**
 * FVG = 3-candle imbalance. Color of 1st/3rd ignored (TJR: "we do not see color").
 * Bullish: candle3 low > candle1 high. Bearish: candle3 high < candle1 low.
 */
export function findFvgs(bars, maxKeep = 24) {
  const src = Array.isArray(bars) ? bars : [];
  const out = [];
  for (let i = 2; i < src.length; i++) {
    const a = src[i - 2];
    const c = src[i];
    const bullLo = n(a.h);
    const bullHi = n(c.l);
    if (bullHi > bullLo) {
      out.push({ direction: "long", low: bullLo, high: bullHi, i, t: c.t });
    }
    const bearHi = n(a.l);
    const bearLo = n(c.h);
    if (bearHi > bearLo) {
      out.push({ direction: "short", low: bearLo, high: bearHi, i, t: c.t });
    }
  }
  return out.slice(-maxKeep);
}

function pxInFvg(px, fvg, pad = 0.001) {
  return px >= fvg.low * (1 - pad) && px <= fvg.high * (1 + pad);
}

export function recentFvgTap(bars, direction, px, lookbackBars = 8) {
  const closed = closedBars(bars);
  if (closed.length < 6 || !(px > 0)) return null;
  const fvgs = findFvgs(closed);
  const minI = Math.max(0, closed.length - 1 - lookbackBars);
  for (let k = fvgs.length - 1; k >= 0; k--) {
    const f = fvgs[k];
    if (f.direction !== direction) continue;
    if (f.i < minI) continue;
    if (pxInFvg(px, f)) return f;
  }
  return null;
}

/**
 * Inverse FVG — confirmation confluence. Close *through* the gap (wick alone is not enough).
 * Stacked FVGs: inverting only the nearest gap is NOT a trend change (TJR). Require close
 * through the far boundary of the recent same-direction stack.
 */
export function recentInverseFvg(bars, lookback = 20) {
  const closed = closedBars(bars);
  if (closed.length < 6) return null;
  const fvgs = findFvgs(closed, 40);
  const lastI = closed.length - 1;

  function scan(stackDir, confirmDir) {
    const stack = fvgs.filter((f) => f.direction === stackDir && lastI - f.i <= lookback + 6);
    if (!stack.length) return null;
    const recent = stack.slice(-5);
    const through = stackDir === "long" ? Math.min(...recent.map((f) => f.low)) : Math.max(...recent.map((f) => f.high));
    const stackStart = Math.min(...recent.map((f) => f.i));
    for (let i = closed.length - 1; i > stackStart; i--) {
      if (closed.length - 1 - i > lookback) break;
      const c = n(closed[i].c);
      const hit = stackDir === "long" ? c < through : c > through;
      if (hit) {
        return { direction: confirmDir, kind: "ifvg", through, i, t: closed[i].t, stack: recent.length };
      }
    }
    return null;
  }

  const bearish = scan("long", "short");
  const bullish = scan("short", "long");
  if (bearish && bullish) return bearish.i >= bullish.i ? bearish : bullish;
  return bearish || bullish;
}

function recentSweep(struct, poolsHi, poolsLo, lookback = 12) {
  const { closed } = struct;
  if (!closed.length) return null;
  const start = Math.max(0, closed.length - lookback);
  const hi = [...new Set(poolsHi.filter((v) => v > 0))];
  const lo = [...new Set(poolsLo.filter((v) => v > 0))];
  for (let i = closed.length - 1; i >= start; i--) {
    const b = closed[i];
    const h = n(b.h);
    const l = n(b.l);
    const c = n(b.c);
    for (const lvl of hi) {
      if (h > lvl * 1.00012 && c < lvl) {
        return { side: "high", level: lvl, bar: b, i, px: h };
      }
    }
    for (const lvl of lo) {
      if (l < lvl * 0.99988 && c > lvl) {
        return { side: "low", level: lvl, bar: b, i, px: l };
      }
    }
  }
  return null;
}

export function equilibrium(struct) {
  const hi = struct.lastHigh?.px;
  const lo = struct.lastLow?.px;
  if (!(hi > 0) || !(lo > 0) || hi <= lo) return null;
  return { high: hi, low: lo, mid: (hi + lo) / 2 };
}

function dolPools(struct, sessions, pd, extras = {}) {
  const eqHi = equalLiquidityLevels(struct.highs || [], extras.relEqTol || 0.0006);
  const eqLo = equalLiquidityLevels(struct.lows || [], extras.relEqTol || 0.0006);
  const highs = [
    ...(struct.highs || []).map((s) => s.px),
    ...eqHi.map((e) => e.px),
    ...Object.values(sessions || {}).map((s) => s.high),
    pd?.high,
    pd?.ndog?.high,
  ].filter((v) => v > 0);
  const lows = [
    ...(struct.lows || []).map((s) => s.px),
    ...eqLo.map((e) => e.px),
    ...Object.values(sessions || {}).map((s) => s.low),
    pd?.low,
    pd?.ndog?.low,
  ].filter((v) => v > 0);
  return { highs, lows, eqHi, eqLo };
}

export function nextDrawOnLiquidity(direction, px, struct, sessions, pd, extras = {}) {
  const { highs, lows } = dolPools(struct, sessions, pd, extras);
  if (direction === "long") {
    const above = highs.filter((v) => v > px * 1.0008);
    return above.length ? Math.min(...above) : null;
  }
  const below = lows.filter((v) => v < px * 0.9992);
  return below.length ? Math.max(...below) : null;
}

/**
 * SPY vs QQQ SMT. Form 1: one prints a new extreme, the other does not.
 * Form 2: last two swings diverge (HH vs LH / LL vs HL) — TJR ES/NQ example.
 */
export function smtDivergence(aBars, bBars) {
  const A = structureBias(aBars);
  const B = structureBias(bBars);
  const aC = A.closed.at(-1);
  const bC = B.closed.at(-1);
  if (!aC || !bC || !A.lastHigh || !B.lastHigh || !A.lastLow || !B.lastLow) {
    return { smt: null };
  }
  const aNewHigh = n(aC.h) > A.lastHigh.px;
  const bNewHigh = n(bC.h) > B.lastHigh.px;
  const aNewLow = n(aC.l) < A.lastLow.px;
  const bNewLow = n(bC.l) < B.lastLow.px;
  if (aNewHigh !== bNewHigh) {
    return { smt: "bearish", form: "sweep", aNewHigh, bNewHigh };
  }
  if (aNewLow !== bNewLow) {
    return { smt: "bullish", form: "sweep", aNewLow, bNewLow };
  }
  const aH = A.highs.slice(-2);
  const bH = B.highs.slice(-2);
  if (aH.length >= 2 && bH.length >= 2) {
    const aHH = aH[1].px > aH[0].px;
    const bHH = bH[1].px > bH[0].px;
    if (aHH !== bHH) return { smt: aHH ? "bullish" : "bearish", form: "swing_high" };
  }
  const aL = A.lows.slice(-2);
  const bL = B.lows.slice(-2);
  if (aL.length >= 2 && bL.length >= 2) {
    const aHL = aL[1].px > aL[0].px;
    const bHL = bL[1].px > bL[0].px;
    if (aHL !== bHL) return { smt: aHL ? "bullish" : "bearish", form: "swing_low" };
  }
  return { smt: null };
}

export function nyKillzoneCheck(now, cfg = {}, extraOk = false) {
  if (cfg.video_ny_killzone === false) return { ok: true };
  const mins = etMinutes(now);
  const k = NY_KILLZONE;
  if (mins < k.open || mins >= k.rthEnd) return { ok: false, reason: "video_outside_rth" };
  if (mins < k.manipEnd) return { ok: false, reason: "video_ny_manipulation" };
  if (mins < k.entryEnd) return { ok: true, window: "entry" };
  if (mins < k.lateEnd) {
    return extraOk ? { ok: true, window: "late_a" } : { ok: false, reason: "video_ny_late" };
  }
  if (mins >= k.pmStart) {
    if (cfg.video_allow_pm) return { ok: true, window: "pm" };
    return extraOk ? { ok: true, window: "pm_a" } : { ok: false, reason: "video_ny_pm" };
  }
  return { ok: false, reason: "video_ny_midday" };
}

function fail(reason, extra = {}) {
  return { take: false, reason, ...extra };
}

/**
 * @param {object} htfBars 15m
 * @param {object} ltfBars 1m
 * @param {object} cfg
 * @param {{ peerHtf?: object, canShort?: boolean, now?: Date, nyKillzone?: boolean }} opts
 */
export function evaluateVideoEntry(htfBars, ltfBars, cfg, opts = {}) {
  const canShort = opts.canShort !== false;
  const now = opts.now || new Date();
  const minRr = Math.max(1.5, Number(cfg.min_rr || 2));
  const minStop = Number(cfg.min_stop_pct || 0.0015);
  const maxStop = Number(cfg.max_stop_pct || 0.02);
  const relEqTol = Number(cfg.video_rel_eq_tol || 0.0006);
  const struct = structureBias(htfBars);
  const levelBars = (htfBars?.length || 0) > 40 ? htfBars : ltfBars;
  const sessions = sessionLevels(levelBars, now);
  const pd = previousDayLevels(levelBars, now);
  const px = n(closedBars(ltfBars).at(-1)?.c || closedBars(htfBars).at(-1)?.c);
  if (!(px > 0)) return fail("video_no_price");

  const ifvg = recentInverseFvg(htfBars, Number(cfg.video_ifvg_lookback || 20));
  let direction = null;
  if (struct.bias === "up") direction = "long";
  else if (struct.bias === "down") direction = "short";
  else if (ifvg) direction = ifvg.direction;
  if (!direction) return fail("video_chop", { htf: struct.bias, ifvg: ifvg?.direction || null });

  const bosAge = struct.lastBos ? struct.closed.length - 1 - struct.lastBos.i : 999;
  const bosOk =
    struct.lastBos &&
    struct.lastBos.direction === direction &&
    bosAge <= Number(cfg.video_bos_max_bars || 24);
  const ifvgOk = ifvg && ifvg.direction === direction;
  if (!bosOk && !ifvgOk) {
    return fail(bosAge > 900 ? "video_no_confirm" : "video_bos_stale", {
      htf: struct.bias,
      bosAge,
      ifvg: ifvg?.direction || null,
    });
  }

  if (direction === "short" && !canShort) {
    return fail("video_down_sit_out", { htf: struct.bias, direction, ifvg: ifvgOk });
  }

  let smt = null;
  if (opts.peerHtf?.length) {
    smt = smtDivergence(htfBars, opts.peerHtf);
    if (cfg.require_smt && !smt.smt) return fail("video_no_smt", { htf: struct.bias });
    if (smt.smt === "bearish" && direction === "long") {
      return fail("video_smt_against", { smt: smt.smt });
    }
    if (smt.smt === "bullish" && direction === "short") {
      return fail("video_smt_against", { smt: smt.smt });
    }
  }

  const extraOk = Boolean(smt?.smt || ifvgOk);
  if (opts.nyKillzone) {
    const kz = nyKillzoneCheck(now, { ...cfg, video_ny_killzone: true }, extraOk);
    if (!kz.ok) return fail(kz.reason, { htf: struct.bias, direction });
  }

  const { highs: poolHi, lows: poolLo, eqHi, eqLo } = dolPools(struct, sessions, pd, { relEqTol });
  const sweep = recentSweep(struct, poolHi, poolLo, Number(cfg.video_sweep_lookback || 16));
  if (!sweep) return fail("video_no_sweep", { htf: struct.bias, direction });
  if (direction === "long" && sweep.side !== "low") {
    return fail("video_sweep_wrong_side", { sweep: sweep.side });
  }
  if (direction === "short" && sweep.side !== "high") {
    return fail("video_sweep_wrong_side", { sweep: sweep.side });
  }

  const eq = equilibrium(struct);
  if (eq) {
    if (direction === "long" && px > eq.mid) {
      return fail("video_not_discount", { htf: struct.bias, mid: eq.mid });
    }
    if (direction === "short" && px < eq.mid) {
      return fail("video_not_premium", { htf: struct.bias, mid: eq.mid });
    }
  }

  const fvgLtf = recentFvgTap(ltfBars, direction, px, 10);
  const fvgHtf = recentFvgTap(htfBars, direction, px, 8);
  const fvg = fvgLtf || fvgHtf;
  if (!fvg) return fail("video_no_fvg", { htf: struct.bias, direction, sweep: sweep.side });

  let stop =
    direction === "long"
      ? Math.min(sweep.px, struct.lastLow?.px || sweep.px) * 0.9994
      : Math.max(sweep.px, struct.lastHigh?.px || sweep.px) * 1.0006;
  const stopPct = Math.abs(px - stop) / px;
  if (stopPct < minStop) return fail("video_stop_too_tight", { stopPct });
  if (stopPct > maxStop) return fail("video_stop_too_wide", { stopPct });

  const risk = Math.abs(px - stop);
  const dol = nextDrawOnLiquidity(direction, px, struct, sessions, pd, { relEqTol });
  let tp = direction === "long" ? px + minRr * risk : px - minRr * risk;
  if (dol) {
    const dolR = Math.abs(dol - px) / risk;
    if (dolR >= minRr) tp = dol;
  }
  const rr = Math.abs(tp - px) / risk;
  if (rr < minRr * 0.98) return fail("video_rr_too_small", { rr });

  const parts = ["tjr"];
  if (bosOk) parts.push("bos");
  if (ifvgOk) parts.push("ifvg");
  parts.push(`sweep_${sweep.side}`);
  parts.push(fvgLtf ? "fvg1m" : "fvg15m");
  parts.push(direction === "long" ? "discount" : "premium");
  if (eqHi.length || eqLo.length) parts.push("eql");
  if (pd) parts.push("pdhl");
  if (smt?.smt) parts.push(`smt_${smt.smt}`);

  const grade = smt?.smt && ifvgOk ? "A" : extraOk ? "A" : "A";
  const score = (bosOk ? 3 : 0) + (ifvgOk ? 3 : 0) + (smt?.smt ? 2 : 0) + (fvgLtf && fvgHtf ? 2 : 1);

  return {
    take: true,
    direction,
    side: direction === "long" ? "buy" : "sell",
    setup: parts.join("+"),
    grade,
    score: Math.min(10, score),
    stop,
    tp,
    trigger: px,
    htf: struct.bias,
    reason: "video_take",
    video: {
      sweep: sweep.side,
      bosAge: struct.lastBos ? bosAge : null,
      ifvg: ifvgOk,
      fvgTf: fvgLtf ? "1m" : "15m",
      rr: Number(rr.toFixed(2)),
      smt: smt?.smt || null,
      dol,
      pd: pd ? { high: pd.high, low: pd.low } : null,
    },
  };
}
