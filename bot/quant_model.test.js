import { emaSeries, atr, rsi, htfBias, evaluateQuantEntry } from "./quant_model.js";
import { detectEngulfing, detectHammerStar, detectTweezer, detectMomentum } from "./candle_patterns.js";

function bar(t, o, h, l, c, v = 1) {
  return { t: new Date(t).toISOString(), o, h, l, c, v };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

{
  const e = emaSeries([1, 2, 3, 4, 5], 3);
  assert(e.length === 5 && e.at(-1) > e[0], "ema rises");
}

{
  const bars = [];
  let t0 = Date.parse("2026-09-21T10:00:00Z");
  let px = 100;
  for (let i = 0; i < 40; i++) {
    px += 0.4;
    bars.push(bar(t0 + i * 15 * 60 * 1000, px - 0.2, px + 0.3, px - 0.4, px));
  }
  bars.push(bar(t0 + 99 * 15 * 60 * 1000, px, px + 0.1, px - 0.1, px));
  const h = htfBias(bars);
  assert(h.bias === "up" || h.bias === "chop", `bias ${h.bias} ${h.reason}`);
  assert(atr(bars, 14) > 0, "atr");
}

{
  const r = rsi(
    [
      bar("2026-09-21T10:00:00Z", 10, 11, 9, 10),
      ...Array.from({ length: 20 }, (_, i) => bar("2026-09-21T10:01:00Z", 10 + i, 11 + i, 9 + i, 10.5 + i)),
      bar("2026-09-21T11:00:00Z", 30, 31, 29, 30.5),
    ],
    14
  );
  assert(r == null || (r >= 0 && r <= 100), `rsi ${r}`);
}

{
  const engulf = detectEngulfing([
    bar("2026-09-21T10:00:00Z", 101, 101.2, 100.1, 100.3),
    bar("2026-09-21T10:01:00Z", 100.2, 101.5, 100.0, 101.4),
  ]);
  assert(engulf?.direction === "long", `engulf ${JSON.stringify(engulf)}`);
}

{
  const ham = detectHammerStar([bar("2026-09-21T10:00:00Z", 100.4, 100.5, 99.4, 100.45)]);
  assert(ham?.name === "hammer" && ham.direction === "long", `hammer ${JSON.stringify(ham)}`);
}

{
  const tw = detectTweezer([
    bar("2026-09-21T10:00:00Z", 100.8, 100.9, 100.0, 100.2),
    bar("2026-09-21T10:01:00Z", 100.15, 100.7, 100.0, 100.55),
  ]);
  assert(tw?.direction === "long", `tweezer ${JSON.stringify(tw)}`);
}

{
  const small = [];
  const t0 = Date.parse("2026-09-21T10:00:00Z");
  for (let i = 0; i < 8; i++) small.push(bar(t0 + i * 60000, 100, 100.2, 99.9, 100.05));
  small.push(bar(t0 + 9 * 60000, 100.1, 101.0, 100.05, 100.95));
  const m = detectMomentum(small, 2);
  assert(m?.direction === "long", `momentum ${JSON.stringify(m)}`);
}

{
  const t0 = Date.parse("2026-09-21T14:00:00Z");
  const htf = [];
  for (let i = 0; i < 48; i++) {
    const base = 102 + Math.sin(i / 5) * 0.35;
    if (i === 22) htf.push(bar(t0 + i * 15 * 60000, 101.2, 101.4, 100.0, 100.6));
    else htf.push(bar(t0 + i * 15 * 60000, base, base + 0.25, base - 0.25, base));
  }
  htf.push(bar(t0 + 80 * 15 * 60000, 101.1, 101.3, 100.9, 101.15));
  const ltf = [];
  for (let i = 0; i < 20; i++) {
    ltf.push(bar(t0 + i * 60000, 101.2, 101.35, 101.05, 101.18));
  }
  ltf.push(bar(t0 + 21 * 60000, 101.15, 101.2, 100.05, 100.25));
  ltf.push(bar(t0 + 22 * 60000, 100.2, 101.55, 100.0, 101.45));
  ltf.push(bar(t0 + 23 * 60000, 101.45, 101.5, 101.4, 101.48));
  const sig = evaluateQuantEntry(
    htf,
    ltf,
    { spreadPct: 0.0001 },
    { min_rr: 2, min_stop_pct: 0.012, max_stop_pct: 0.03, allow_shorts: true, sr_tol_pct: 0.02 }
  );
  assert(sig.take === true, `candle entry ${JSON.stringify(sig)}`);
  assert(sig.direction === "long", `dir ${sig.direction}`);
  assert(String(sig.setup).includes("engulfing"), `setup ${sig.setup}`);
}

{
  const t0 = Date.parse("2026-09-21T14:00:00Z");
  const htf = [];
  for (let i = 0; i < 40; i++) {
    const px = 110 + i * 0.05;
    htf.push(bar(t0 + i * 15 * 60000, px, px + 0.2, px - 0.2, px));
  }
  htf.push(bar(t0 + 90 * 15 * 60000, 112, 112.1, 111.9, 112));
  const ltf = [];
  for (let i = 0; i < 16; i++) {
    const px = 112 + i * 0.03;
    ltf.push(bar(t0 + i * 60000, px, px + 0.02, px - 0.004, px + 0.012));
  }
  ltf.push(bar(t0 + 20 * 60000, 112.5, 112.52, 112.49, 112.51));
  const none = evaluateQuantEntry(htf, ltf, { spreadPct: 0.0001 }, { min_rr: 2, min_stop_pct: 0.012, max_stop_pct: 0.03 });
  assert(none.take === false, `no candle ${JSON.stringify(none)}`);
}

console.log("quant_model.test.js OK");
