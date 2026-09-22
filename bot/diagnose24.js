import { fetchOhlc } from "./kraken.js";
import { closedBars } from "./video_model.js";
import { detectPatterns, geometry } from "./candle_patterns.js";
import { detectMindPatterns } from "./mind_patterns.js";
import { detectScalpPatterns } from "./scalp_patterns.js";
import { evaluateQuantEntry } from "./quant_model.js";
import { evaluateMindEntry } from "./mind_model.js";
import { evaluateScalpEntry } from "./scalp_model.js";
import { evaluateVideoEntry } from "./video_model.js";
import { sessionGate, feesKillEdge } from "./risk.js";
import { loadConfig } from "./trader.js";
import { evaluateSymbol } from "./strategy.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LTF_MS = 5 * 60 * 1000;
const HTF_MS = 15 * 60 * 1000;
const to = Date.now();
const from = to - 24 * 60 * 60 * 1000;

function quoteFrom(bar) {
  return { last: Number(bar.c), bid: Number(bar.l), ask: Number(bar.h), spreadPct: 0.0003 };
}

function sliceDone(bars, intervalMs, nowMs) {
  const done = (bars || []).filter((b) => Date.parse(b.t) + intervalMs <= nowMs);
  if (!done.length) return [];
  const last = done.at(-1);
  return [...done, { ...last, t: new Date(nowMs).toISOString(), o: last.c, h: last.c, l: last.c, c: last.c, v: 0 }];
}

const pairs = [
  { id: "BTC/GBP", pair: "XBTGBP" },
  { id: "ETH/GBP", pair: "ETHGBP" },
];
const byPair = {};
for (const p of pairs) {
  byPair[p.id] = {
    ...p,
    htf: await fetchOhlc(p.pair, 15, 0),
    ltf: await fetchOhlc(p.pair, 5, 0),
  };
}

const cfgs = {
  TJR: loadConfig(root, "config.json"),
  ALPHA: loadConfig(root, "config.alpha.json"),
  MIND: loadConfig(root, "config.mind.json"),
  SCALP: loadConfig(root, "config.scalp.json"),
};

const times = new Set();
for (const s of Object.values(byPair)) {
  for (const b of s.ltf) {
    const close = Date.parse(b.t) + LTF_MS;
    if (close >= from && close <= to) times.add(close);
  }
}
const clock = [...times].sort((a, b) => a - b);

const patternHits = { ALPHA: {}, MIND: {}, SCALP: {} };
const bump = (bag, name) => {
  bag[name] = (bag[name] || 0) + 1;
};

const reasons = { TJR: {}, ALPHA: {}, MIND: {}, SCALP: {} };
const rawTakes = { TJR: 0, ALPHA: 0, MIND: 0, SCALP: 0 };
const sessTakes = { TJR: 0, ALPHA: 0, MIND: 0, SCALP: 0 };
const feeKills = { TJR: 0, ALPHA: 0, MIND: 0, SCALP: 0 };
const inSessBars = { n: 0 };
const samples = [];

for (const nowMs of clock) {
  const now = new Date(nowMs);
  const inSess = sessionGate(now, cfgs.ALPHA, "A").ok;
  if (inSess) inSessBars.n += 1;
  for (const p of pairs) {
    const htf = sliceDone(byPair[p.id].htf, HTF_MS, nowMs);
    const ltf = sliceDone(byPair[p.id].ltf, LTF_MS, nowMs);
    const ltfClosed = closedBars(ltf);
    const htfClosed = closedBars(htf);
    const quote = quoteFrom(ltfClosed.at(-1) || ltf.at(-1));
    if (!ltfClosed.length) continue;

    for (const pat of detectPatterns(ltfClosed, cfgs.ALPHA)) bump(patternHits.ALPHA, `${p.id}:${pat.name}:${pat.direction}`);
    for (const pat of detectMindPatterns(htfClosed)) bump(patternHits.MIND, `${p.id}:${pat.name}:${pat.direction}`);
    for (const pat of detectScalpPatterns(ltfClosed, cfgs.SCALP)) bump(patternHits.SCALP, `${p.id}:${pat.name}:${pat.direction}`);

    const g = geometry(ltfClosed.at(-1));
    if (g.body / g.range >= 0.55 && (g.bull || g.bear) && samples.length < 8) {
      const prev = ltfClosed.at(-2);
      samples.push({
        t: ltfClosed.at(-1).t,
        pair: p.id,
        o: g.o,
        h: g.h,
        l: g.l,
        c: g.c,
        bodyPct: Number((g.body / g.range).toFixed(2)),
        dir: g.bull ? "bull" : "bear",
        prevC: prev ? Number(prev.c) : null,
      });
    }

    const evals = {
      TJR: evaluateVideoEntry(htf, ltf, cfgs.TJR, { canShort: true, now, peerHtf: sliceDone(byPair[p.id === "BTC/GBP" ? "ETH/GBP" : "BTC/GBP"].htf, HTF_MS, nowMs) }),
      ALPHA: evaluateQuantEntry(htf, ltf, quote, cfgs.ALPHA, now),
      MIND: evaluateMindEntry(htf, htf, quote, cfgs.MIND, now),
      SCALP: evaluateScalpEntry(htf, ltf, quote, cfgs.SCALP, now),
    };
    for (const [book, sig] of Object.entries(evals)) {
      const key = sig.take ? "TAKE" : sig.reason || "none";
      reasons[book][key] = (reasons[book][key] || 0) + 1;
      if (sig.take) {
        rawTakes[book] += 1;
        const fee = feesKillEdge({
          stopPct: Math.abs(sig.trigger - sig.stop) / sig.trigger,
          rr: sig.video?.rr || cfgs[book].min_rr || 2,
          cfg: cfgs[book],
          makerIn: true,
          makerOut: true,
        });
        if (!fee.ok) feeKills[book] += 1;
        if (inSess) sessTakes[book] += 1;
      }
    }

    if (inSess) {
      for (const [book, cfg] of Object.entries(cfgs)) {
        const peerId = p.id === "BTC/GBP" ? "ETH/GBP" : "BTC/GBP";
        const sig = evaluateSymbol({
          id: p.id,
          htf,
          ltf,
          peerHtf: sliceDone(byPair[peerId].htf, HTF_MS, nowMs),
          quote,
          cfg,
          now,
        });
        if (sig.take) reasons[book].FULL_PASS = (reasons[book].FULL_PASS || 0) + 1;
      }
    }
  }
}

function top(bag, n = 8) {
  return Object.entries(bag)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k}×${v}`)
    .join(" | ");
}

console.log("PAPER candle diagnose — last 24h. Not financial advice.");
console.log(`Window ${new Date(from).toISOString()} → ${new Date(to).toISOString()}`);
console.log(`5m steps ${clock.length}  in London/NY ${inSessBars.n}  (~${((inSessBars.n / clock.length) * 100).toFixed(0)}% of the day)`);
console.log("");
console.log("Pattern hits (detectors ran on every 5m close, session ignored):");
console.log("  ALPHA", top(patternHits.ALPHA) || "(none)");
console.log("  MIND ", top(patternHits.MIND) || "(none)");
console.log("  SCALP", top(patternHits.SCALP) || "(none)");
console.log("");
console.log("Model TAKE before session/fees (count of bar×pair):");
for (const book of Object.keys(rawTakes)) {
  console.log(`  ${book} rawTake=${rawTakes[book]}  duringSession=${sessTakes[book]}  feeKill=${feeKills[book]}  fullPass=${reasons[book].FULL_PASS || 0}`);
}
console.log("");
for (const book of Object.keys(reasons)) {
  console.log(`### ${book} reject reasons`);
  console.log(" ", top(reasons[book], 10) || "(none)");
}
console.log("\nSample closed 5m candles the geometry reader saw:");
for (const s of samples) {
  console.log(`  ${s.t} ${s.pair} ${s.dir} o=${s.o} h=${s.h} l=${s.l} c=${s.c} body=${s.bodyPct}`);
}
