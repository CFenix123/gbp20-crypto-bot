import { detectThreeSoldiersCrows, detectPinBar } from "./scalp_patterns.js";
import { marketStructure, scoreDirection, evaluateScalpEntry, regimeOf } from "./scalp_model.js";

function bar(t, o, h, l, c, v = 2) {
  return { t: new Date(t).toISOString(), o, h, l, c, v };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

{
  const t0 = Date.parse("2026-09-22T10:00:00Z");
  const bars = [
    bar(t0, 100, 101.2, 99.9, 101.1),
    bar(t0 + 60000, 101.1, 102.4, 101.0, 102.3),
    bar(t0 + 120000, 102.3, 103.6, 102.2, 103.5),
  ];
  const p = detectThreeSoldiersCrows(bars);
  assert(p?.name === "three_soldiers" && p.direction === "long", `soldiers ${JSON.stringify(p)}`);
}

{
  const pin = detectPinBar([bar(Date.parse("2026-09-22T11:00:00Z"), 100.2, 100.4, 98.4, 100.1)]);
  assert(pin?.name === "bull_pin" && pin.direction === "long", `pin ${JSON.stringify(pin)}`);
}

{
  const t0 = Date.parse("2026-09-22T08:00:00Z");
  const up = [];
  for (let i = 0; i < 40; i++) {
    const px = 100 + i * 0.2;
    up.push(bar(t0 + i * 60000, px - 0.05, px + 0.12, px - 0.1, px, 3));
  }
  const st = marketStructure(up);
  assert(st.bias === "up" || st.bias === "chop", `structure ${st.bias}`);
}

{
  const long = scoreDirection("long", {
    pattern: { name: "engulfing", direction: "long", score: 9, extreme: 99 },
    struct: { bias: "up", name: "hh_hl" },
    ind: { ema9: 102, ema21: 101, ema50: 100, rsi: 55, atr: 0.8, relVol: 1.4, macd: { hist: 0.1 }, htfEma9: 101, htfEma21: 100 },
    px: 102,
    sr: { supports: [99.5], resistances: [110] },
    quote: { spreadPct: 0.0002 },
    cfg: { sr_tol_pct: 0.02, max_spread_pct: 0.001 },
  });
  const short = scoreDirection("short", {
    pattern: null,
    struct: { bias: "up", name: "hh_hl" },
    ind: { ema9: 102, ema21: 101, ema50: 100, rsi: 55, atr: 0.8, relVol: 1.4, macd: { hist: 0.1 }, htfEma9: 101, htfEma21: 100 },
    px: 102,
    sr: { supports: [99.5], resistances: [110] },
    quote: { spreadPct: 0.0002 },
    cfg: { sr_tol_pct: 0.02, max_spread_pct: 0.001 },
  });
  assert(long.total > short.total, `scores L ${long.total} S ${short.total}`);
}

{
  const t0 = Date.parse("2026-09-22T12:00:00Z");
  const ltf = [];
  for (let i = 0; i < 40; i++) ltf.push(bar(t0 + i * 60000, 100, 100.1, 99.9, 100, 1));
  ltf.push(bar(t0 + 41 * 60000, 100, 100.05, 99.95, 100, 1));
  const cfg = {
    allow_shorts: true,
    min_trade_score: 70,
    min_rr: 2,
    min_stop_pct: 0.012,
    max_stop_pct: 0.03,
    max_spread_pct: 0.01,
  };
  const sig = evaluateScalpEntry(ltf, ltf, { last: 100, spreadPct: 0.0002 }, cfg, new Date("2026-09-22T14:00:00Z"));
  assert(sig.take === false, `flat tape should be NO TRADE, got ${sig.reason}`);
}

{
  const typicalBtc = regimeOf(
    { atr: 70, atrMedian: 80, ema9: 64000, ema21: 63800 },
    { bias: "up" },
    64000
  );
  assert(typicalBtc.regime !== "low_vol", `typical BTC 5m ATR marked ${typicalBtc.regime}`);
  const dead = regimeOf({ atr: 8, atrMedian: 80, ema9: 64000, ema21: 63800 }, { bias: "chop" }, 64000);
  assert(dead.regime === "low_vol", `dead tape ${dead.regime}`);
}

console.log("scalp_model.test.js ok");
