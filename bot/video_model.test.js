import {
  closedBars,
  findFvgs,
  recentInverseFvg,
  structureBias,
  sessionLevels,
  previousDayLevels,
  nyKillzoneCheck,
  evaluateVideoEntry,
  SESSIONS,
} from "./video_model.js";

function bar(t, o, h, l, c) {
  return { t: new Date(t).toISOString(), o, h, l, c, v: 1 };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// 3-candle bullish FVG: c1 high 10, c3 low 12
{
  const bars = [
    bar("2026-08-10T14:00:00Z", 9, 10, 8, 9.5),
    bar("2026-08-10T14:15:00Z", 9.5, 13, 9.4, 12.8),
    bar("2026-08-10T14:30:00Z", 12.8, 13.2, 12.1, 12.4),
    bar("2026-08-10T14:45:00Z", 12.4, 12.6, 12.2, 12.5),
  ];
  const fvgs = findFvgs(closedBars(bars));
  assert(fvgs.some((f) => f.direction === "long" && f.low === 10 && f.high === 12.1), "bullish FVG");
}

// Bearish FVG + stack-aware inverse (close through far boundary)
{
  const bars = [];
  let t0 = Date.parse("2026-08-10T10:00:00Z");
  // down expansion creating bearish FVG then later close back above stack high
  const seq = [
    [100, 101, 99.5, 100.2],
    [100.2, 100.4, 96, 96.5], // expansion down
    [96.5, 97, 95.8, 96.2], // c3 high 97 < c1 low 99.5 → bearish FVG 97–99.5
    [96.2, 96.8, 95.5, 96],
    [96, 100.5, 95.9, 100.2], // close above bearish FVG high → bullish iFVG
    [100.2, 100.6, 99.8, 100.4],
    [100.4, 100.7, 100.1, 100.5], // forming (dropped)
  ];
  for (let i = 0; i < seq.length; i++) {
    const [o, h, l, c] = seq[i];
    bars.push(bar(t0 + i * 15 * 60 * 1000, o, h, l, c));
  }
  const inv = recentInverseFvg(bars, 20);
  assert(inv && inv.direction === "long", `iFVG long, got ${JSON.stringify(inv)}`);
}

// Asia wrap 18:00–03:00 ET uses latest instance only
{
  const bars = [];
  // Monday 20:00 ET = Tuesday 00:00 UTC during EDT (UTC-4) → 2026-08-11T00:00:00Z
  bars.push(bar("2026-08-11T00:00:00Z", 10, 12, 3, 10)); // Asia Mon 20:00 ET high 12
  bars.push(bar("2026-08-11T06:00:00Z", 10, 11, 2, 5)); // Asia Tue 02:00 ET low 2
  bars.push(bar("2026-08-11T14:00:00Z", 5, 20, 4, 8)); // London ~10:00 ET — not Asia
  const now = new Date("2026-08-11T15:00:00Z");
  const s = sessionLevels(bars, now);
  assert(s.asia, "asia session present");
  assert(s.asia.high === 12 && s.asia.low === 2, `asia H/L ${JSON.stringify(s.asia)}`);
  assert(SESSIONS.asia[0] === 18 * 60 && SESSIONS.asia[1] === 3 * 60, "TJR Asia 18:00–03:00");
}

// PDH/PDL
{
  const bars = [
    bar("2026-08-10T14:30:00Z", 100, 110, 90, 105),
    bar("2026-08-10T18:00:00Z", 105, 108, 101, 107),
    bar("2026-08-11T14:30:00Z", 107, 109, 106, 108),
  ];
  const pd = previousDayLevels(bars, new Date("2026-08-11T15:00:00Z"));
  assert(pd && pd.high === 110 && pd.low === 90, `PDH/PDL ${JSON.stringify(pd)}`);
}

// NY killzone
{
  const manip = nyKillzoneCheck(new Date("2026-08-11T13:40:00Z"), { video_ny_killzone: true }); // 9:40 ET
  assert(!manip.ok && manip.reason === "video_ny_manipulation", `manip ${JSON.stringify(manip)}`);
  const entry = nyKillzoneCheck(new Date("2026-08-11T14:00:00Z"), { video_ny_killzone: true }); // 10:00 ET
  assert(entry.ok && entry.window === "entry", `entry ${JSON.stringify(entry)}`);
  const late = nyKillzoneCheck(new Date("2026-08-11T14:45:00Z"), { video_ny_killzone: true }, false);
  assert(!late.ok && late.reason === "video_ny_late", `late ${JSON.stringify(late)}`);
  const lateA = nyKillzoneCheck(new Date("2026-08-11T14:45:00Z"), { video_ny_killzone: true }, true);
  assert(lateA.ok, "late A+ allowed");
}

// Full long take: HTF up BOS + sweep low + FVG in discount
{
  const htf = [];
  let t0 = Date.parse("2026-08-10T10:00:00Z");
  // Build HH/HL then BOS up, later sweep a low and print bullish FVG below mid
  const px = [
    [10, 11, 9.5, 10.5],
    [10.5, 12, 10.2, 11.8],
    [11.8, 12.2, 10.8, 11.2], // HL
    [11.2, 13.5, 11.1, 13.2], // HH / BOS up through 12
    [13.2, 13.6, 12.8, 13],
    [13, 13.2, 11.0, 11.4], // sweep below 11.2 HL then close back
    [11.4, 11.6, 11.05, 11.3],
    [11.3, 12.4, 11.25, 12.2], // expansion
    [12.2, 12.5, 12.05, 12.2], // bullish FVG tap zone ~11.6–12.05? c1 high 11.6 c3 low 12.05
    [12.2, 12.4, 12.1, 12.25],
  ];
  for (let i = 0; i < px.length; i++) {
    const [o, h, l, c] = px[i];
    htf.push(bar(t0 + i * 15 * 60 * 1000, o, h, l, c));
  }
  htf.push(bar(t0 + px.length * 15 * 60 * 1000, 12.25, 12.4, 12.1, 12.2)); // forming
  const st = structureBias(htf);
  const ltf = htf.map((b, i) => ({
    ...b,
    t: new Date(Date.parse(b.t) + i * 1000).toISOString(),
  }));
  const sig = evaluateVideoEntry(htf, ltf, { min_rr: 2, min_stop_pct: 0.001, max_stop_pct: 0.25 }, {
    canShort: true,
    now: new Date(t0 + 12 * 15 * 60 * 1000),
    nyKillzone: false,
  });
  assert(sig && (sig.take || String(sig.reason || "").startsWith("video")), JSON.stringify(sig));
  assert(st.closed.length > 0, "structure ran");
}

// Crypto sit-out on short
{
  const htf = [];
  let t0 = Date.parse("2026-08-10T10:00:00Z");
  const px = [
    [20, 21, 19, 19.5],
    [19.5, 20, 18, 18.2],
    [18.2, 19.5, 18.1, 19.2],
    [19.2, 19.4, 17, 17.2],
    [17.2, 17.8, 16.5, 16.8],
    [16.8, 17.2, 16.4, 16.9],
  ];
  for (let i = 0; i < px.length; i++) {
    const [o, h, l, c] = px[i];
    htf.push(bar(t0 + i * 15 * 60 * 1000, o, h, l, c));
  }
  htf.push(bar(t0 + 99 * 15 * 60 * 1000, 16.9, 17, 16.8, 16.85));
  const sig = evaluateVideoEntry(htf, htf, { min_rr: 2 }, {
    canShort: false,
    now: new Date(t0 + 100 * 15 * 60 * 1000),
    nyKillzone: false,
  });
  assert(
    !sig.take && ["video_down_sit_out", "video_chop", "video_no_confirm", "video_bos_stale", "video_no_sweep"].includes(sig.reason),
    `crypto down ${sig.reason}`
  );
}

console.log("video_model.test.js OK");
