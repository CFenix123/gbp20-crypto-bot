import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchOhlc } from "./kraken.js";
import { loadConfig, step } from "./trader.js";
import { defaultState, processQuotes } from "./paper.js";
import { ensureJournal } from "./journal.js";
import { sessionGate } from "./risk.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LTF_MS = 5 * 60 * 1000;
const HTF_MS = 15 * 60 * 1000;

function withForming(bars, intervalMs, nowMs) {
  const done = (bars || []).filter((b) => Date.parse(b.t) + intervalMs <= nowMs);
  if (!done.length) return [];
  const last = done.at(-1);
  return [
    ...done,
    {
      ...last,
      t: new Date(nowMs).toISOString(),
      o: last.c,
      h: last.c,
      l: last.c,
      c: last.c,
      v: 0,
    },
  ];
}

function quoteFrom(bar, symbol) {
  const last = Number(bar.c);
  return {
    symbol,
    last,
    bid: Number(bar.l),
    ask: Number(bar.h),
    spread: Number(bar.h) - Number(bar.l),
    spreadPct: 0.0003,
  };
}

function clockTimes(byPair, fromMs, toMs) {
  const set = new Set();
  for (const series of Object.values(byPair)) {
    for (const b of series.ltf || []) {
      const close = Date.parse(b.t) + LTF_MS;
      if (close >= fromMs && close <= toMs) set.add(close);
    }
  }
  return [...set].sort((a, b) => a - b);
}

async function replayBook(cfgFile, feed, fromMs, toMs) {
  const cfg = { ...loadConfig(root, cfgFile) };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `gbp20-${cfg.book || "book"}-`));
  cfg.journal_path = "journal.csv";
  cfg.state_path = "state.json";
  cfg.maker_wait_seconds = Math.max(Number(cfg.maker_wait_seconds || 180), 400);
  ensureJournal(path.join(tmp, cfg.journal_path));
  let state = defaultState(cfg, new Date(fromMs));
  const fills = [];
  const times = clockTimes(feed.byPair, fromMs, toMs);

  for (const nowMs of times) {
    const now = new Date(nowMs);
    const inWindow = sessionGate(now, cfg, "A").ok;
    if (!inWindow && !state.position && !state.working) continue;
    const market = {};
    for (const [id, series] of Object.entries(feed.byPair)) {
      const htf = withForming(series.htf, HTF_MS, nowMs);
      const ltf = withForming(series.ltf, LTF_MS, nowMs);
      const last = (series.ltf || []).findLast((b) => Date.parse(b.t) + LTF_MS <= nowMs) || ltf.at(-2);
      if (!last) continue;
      market[id] = {
        id,
        pair: series.pair,
        peer: series.peer,
        htf,
        ltf,
        quote: quoteFrom(last, id),
      };
    }
    const out = await step(cfg, state, tmp, now, market);
    state = out.state;
    if (state.working) {
      const q = market[state.working.symbol]?.quote;
      if (q) {
        const extra = processQuotes(state, q, cfg, new Date(nowMs + 1000));
        (out.events || []).push(...extra);
      }
    }
    for (const ev of out.events || []) {
      if (ev.type === "exit" && ev.closed) {
        fills.push({
          ts: ev.closed.closed_at,
          symbol: ev.closed.symbol,
          side: ev.closed.side,
          setup: ev.closed.setup,
          pnl: Number(ev.closed.pnl),
          reason: ev.closed.exit_reason,
          equity: Number(state.equity),
        });
      }
    }
  }

  const closed = fills.reduce((s, f) => s + Number(f.pnl || 0), 0);
  const openMtm = Number(state.equity) - Number(cfg.starting_gbp) - closed;
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  return { cfg, state, fills, closed, openMtm };
}

const to = Date.now();
const from = to - 24 * 60 * 60 * 1000;
const pairs = [
  { id: "BTC/GBP", pair: "XBTGBP", peer: "ETH/GBP" },
  { id: "ETH/GBP", pair: "ETHGBP", peer: "BTC/GBP" },
];

const byPair = {};
for (const p of pairs) {
  const htf = await fetchOhlc(p.pair, 15, 0);
  const ltf = await fetchOhlc(p.pair, 5, 0);
  byPair[p.id] = { ...p, htf, ltf };
}

const feed = { byPair };
const books = [
  ["config.json", "TJR"],
  ["config.alpha.json", "ALPHA"],
  ["config.mind.json", "MIND"],
  ["config.scalp.json", "SCALP"],
];

console.log("PAPER 24h replay — each book isolated. Not financial advice.");
console.log(`Window ${new Date(from).toISOString()} → ${new Date(to).toISOString()}`);
console.log("5m clock, 15m HTF. Session gates still apply. 1m LTF proxied by 5m.\n");

const report = [];
for (const [file, label] of books) {
  const out = await replayBook(file, feed, from, to);
  const wins = out.fills.filter((f) => f.pnl > 0);
  const losses = out.fills.filter((f) => f.pnl <= 0);
  const end = Number(out.state.equity);
  const vsStart = end - Number(out.cfg.starting_gbp);
  console.log(`### ${label}`);
  console.log(`closed PnL  £${out.closed.toFixed(4)}`);
  console.log(`open MTM    £${out.openMtm.toFixed(4)}`);
  console.log(`end mark    £${end.toFixed(2)}  vs start ${vsStart >= 0 ? "+" : ""}£${vsStart.toFixed(2)}  pos=${out.state.position ? `${out.state.position.side} ${out.state.position.symbol}` : "flat"}`);
  console.log(`fills       ${out.fills.length}  W ${wins.length}  L ${losses.length}`);
  if (!out.fills.length) console.log("  (no closed trades)");
  for (const f of out.fills) {
    console.log(
      `  ${f.ts}  ${String(f.side || "").toUpperCase()} ${f.symbol}  ${f.reason}  £${Number(f.pnl).toFixed(4)}  ${f.setup}`
    );
  }
  console.log("");
  report.push({
    label,
    closed: out.closed,
    openMtm: out.openMtm,
    equity: end,
    vsStart,
    fills: out.fills,
    position: out.state.position,
  });
}

const outFile = path.join(root, "data", "replay24.json");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ from, to, books: report }, null, 2));
