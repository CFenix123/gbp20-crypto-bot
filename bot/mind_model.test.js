import { detectMorningEveningStar, detectPiercingDarkCloud, priorTrend } from "./mind_patterns.js";
import { evaluateMindEntry } from "./mind_model.js";

function bar(t, o, h, l, c) {
  return { t: new Date(t).toISOString(), o, h, l, c, v: 1 };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

{
  const t0 = Date.parse("2026-09-21T10:00:00Z");
  const down = [];
  for (let i = 0; i < 8; i++) down.push(bar(t0 + i * 900000, 110 - i, 110.2 - i, 109.6 - i, 109.7 - i));
  down.push(bar(t0 + 8 * 900000, 102, 102.1, 100.2, 100.4));
  down.push(bar(t0 + 9 * 900000, 100.3, 100.6, 100.1, 100.35));
  down.push(bar(t0 + 10 * 900000, 100.4, 102.4, 100.3, 102.2));
  const star = detectMorningEveningStar(down);
  assert(star?.name === "morning_star" && star.direction === "long", `morning ${JSON.stringify(star)}`);
  assert(priorTrend(down) === "down", `trend ${priorTrend(down)}`);
}

{
  const t0 = Date.parse("2026-09-21T12:00:00Z");
  const bars = [
    bar(t0, 100.8, 100.9, 99.4, 99.5),
    bar(t0 + 900000, 99.4, 100.4, 99.3, 100.25),
  ];
  const p = detectPiercingDarkCloud(bars);
  assert(p?.name === "piercing" && p.direction === "long", `piercing ${JSON.stringify(p)}`);
}

{
  const t0 = Date.parse("2026-09-21T08:00:00Z");
  const htf = [];
  for (let i = 0; i < 20; i++) {
    const px = 108 - i * 0.15;
    htf.push(bar(t0 + i * 900000, px + 0.05, px + 0.12, px - 0.08, px));
  }
  htf.push(bar(t0 + 21 * 900000, 104.5, 104.6, 103.2, 103.3));
  htf.push(bar(t0 + 22 * 900000, 103.25, 103.5, 103.1, 103.3));
  htf.push(bar(t0 + 23 * 900000, 103.4, 104.8, 103.3, 104.7));
  htf.push(bar(t0 + 24 * 900000, 104.7, 104.72, 104.68, 104.7));
  const cfg = {
    allow_shorts: true,
    min_rr: 2,
    min_stop_pct: 0.012,
    max_stop_pct: 0.03,
    sr_tol_pct: 0.05,
    pattern_tf: "htf",
    max_spread_pct: 0.01,
  };
  const sig = evaluateMindEntry(htf, htf, { last: 104.7, spreadPct: 0.0002 }, cfg, new Date("2026-09-21T14:00:00Z"));
  assert(sig.take === true || sig.reason === "mind_stop_too_tight" || sig.reason === "mind_no_context", `mind ${sig.reason}`);
}

console.log("mind_model.test.js ok");
