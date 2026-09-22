import { speedBias, speedBreak, evaluateSpeedEntry } from "./speed_model.js";

function bar(t, o, h, l, c) {
  return { t: new Date(t).toISOString(), o, h, l, c, v: 2 };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

{
  const t0 = Date.parse("2026-09-22T10:00:00Z");
  const up = [];
  for (let i = 0; i < 30; i++) {
    const px = 100 + i * 0.15;
    up.push(bar(t0 + i * 60000, px - 0.04, px + 0.08, px - 0.06, px));
  }
  assert(speedBias(up, 9, 21) === "up", `bias ${speedBias(up, 9, 21)}`);
  const brkBars = up.slice();
  const lastHi = Math.max(...brkBars.slice(-9, -1).map((b) => b.h));
  brkBars[brkBars.length - 1] = bar(t0 + 31 * 60000, lastHi, lastHi + 0.4, lastHi - 0.05, lastHi + 0.35);
  const brk = speedBreak(brkBars, 8);
  assert(brk?.direction === "long", `break ${JSON.stringify(brk)}`);
}

{
  const t0 = Date.parse("2026-09-22T12:00:00Z");
  const flat = [];
  for (let i = 0; i < 30; i++) flat.push(bar(t0 + i * 60000, 100, 100.05, 99.95, 100));
  const cfg = {
    allow_shorts: true,
    min_rr: 1.5,
    min_stop_pct: 0.004,
    max_stop_pct: 0.02,
    max_spread_pct: 0.01,
  };
  const sig = evaluateSpeedEntry(flat, [...flat, bar(t0 + 31 * 60000, 100, 100.02, 99.98, 100)], { last: 100, spreadPct: 0.0002 }, cfg);
  assert(sig.take === false, `chop should be NO TRADE ${sig.reason}`);
}

console.log("speed_model.test.js ok");
