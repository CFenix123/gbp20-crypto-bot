import fs from "node:fs";
import path from "node:path";
import { fetchOhlc, fetchTickers, tickerForPair } from "./kraken.js";
import { appendFill } from "./journal.js";
import {
  defaultState,
  updateEquity,
  processQuotes,
  placeWorking,
  openLong,
  openShort,
} from "./paper.js";
import { canEnter, sizeQty, sessionGate, symbolCooling, armSymbolCooldown } from "./risk.js";
import { evaluateSymbol, pickBest } from "./strategy.js";

export function loadConfig(root, file = "config.json") {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

export function loadState(cfg, root) {
  const file = path.join(root, cfg.state_path);
  if (!fs.existsSync(file)) return defaultState(cfg);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function saveState(cfg, root, state) {
  const file = path.join(root, cfg.state_path);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

function lastPx(quote) {
  return quote?.last || quote?.bid || 0;
}

function quoteFor(sym, tickers) {
  const t = tickerForPair(tickers, sym.pair);
  if (!t) return null;
  return { symbol: sym.id, pair: sym.pair, ...t };
}

export async function loadMarket(cfg, { quotesOnly = false } = {}) {
  const pairs = cfg.symbols.map((s) => s.pair);
  const tickers = await fetchTickers(pairs);
  const market = {};
  for (const sym of cfg.symbols) {
    let htf = [];
    let ltf = [];
    if (!quotesOnly) {
      htf = await fetchOhlc(sym.pair, cfg.htf_interval, 90_000);
      ltf = await fetchOhlc(sym.pair, cfg.ltf_interval, 45_000);
    }
    market[sym.id] = {
      ...sym,
      htf,
      ltf,
      quote: quoteFor(sym, tickers),
    };
  }
  return market;
}

function log(cfg, line) {
  const book = String(cfg.book || cfg.name || "TJR").toUpperCase();
  console.log(`[PAPER:${book}] ${line}`);
}

export async function step(cfg, state, root, now = new Date(), sharedMarket = null) {
  const inWindow = sessionGate(now, cfg, "A").ok;
  const needManage = Boolean(state.position || state.working);
  if (!inWindow && !needManage) {
    const reason = "outside_london_ny";
    state.last_skip = cfg.symbols.map((s) => `${s.id}:${reason}`).join(" ");
    return { state, skip: state.last_skip, events: [], idle: true };
  }
  const market = sharedMarket || (await loadMarket(cfg, { quotesOnly: needManage && !inWindow }));
  const marks = Object.fromEntries(
    Object.values(market)
      .filter((m) => m.quote)
      .map((m) => [m.id, lastPx(m.quote)])
  );
  const mark =
    (state.position && marks[state.position.symbol]) ||
    Object.values(marks)[0] ||
    0;
  updateEquity(state, mark, cfg, now);

  const events = [];
  for (const m of Object.values(market)) {
    if (!m.quote) continue;
    if (state.position && state.position.symbol !== m.id && !state.working) continue;
    if (state.working && state.working.symbol !== m.id) continue;
    events.push(...processQuotes(state, m.quote, cfg, now));
  }

  for (const ev of events) {
    if (ev.type === "entry" && ev.ok) {
      const p = state.position;
      log(cfg, `ENTRY ${p.side.toUpperCase()} ${p.symbol} qty=${p.qty.toFixed(8)} @ ${p.entry} SL ${p.stop} TP ${p.tp} ${p.setup}`);
    }
    if (ev.type === "exit" && ev.closed) {
      const c = ev.closed;
      updateEquity(state, lastPx(market[c.symbol]?.quote) || c.exit, cfg, now);
      appendFill(path.join(root, cfg.journal_path), {
        ts: c.closed_at,
        symbol: c.symbol,
        side: c.side === "short" ? "SHORT" : "LONG",
        setup: c.setup,
        grade: c.grade,
        entry: c.entry,
        stop: c.stop,
        exit: c.exit,
        qty: c.qty,
        rr_plan: c.rr,
        pnl_gbp: c.pnl,
        equity_after: state.equity,
        exit_reason: c.exit_reason,
        notes: `${ev.fill} ${c.reason || ""}`.trim(),
      });
      log(cfg, `EXIT ${c.side} ${c.symbol} ${c.exit_reason} pnl=£${c.pnl.toFixed(4)} equity=£${Number(state.equity).toFixed(2)}`);
      if (c.exit_reason === "stop") armSymbolCooldown(state, c.symbol, cfg, now);
    }
    if (ev.type === "cancel") log(cfg, `CANCEL working (${ev.reason})`);
  }

  const gate = canEnter(state, cfg, now);
  if (!gate.ok) {
    state.last_skip = gate.reason;
    return { state, skip: gate.reason, events };
  }

  const signals = cfg.symbols.map((sym) => {
    const me = market[sym.id];
    const peer = market[sym.peer];
    if (!me?.htf?.length) return { take: false, reason: "no_bars", symbol: sym.id };
    if (symbolCooling(state, sym.id, now)) return { take: false, reason: "symbol_cooldown", symbol: sym.id };
    return evaluateSymbol({
      id: sym.id,
      htf: me.htf,
      ltf: me.ltf,
      peerHtf: peer?.htf,
      quote: me.quote,
      cfg,
      now,
    });
  });

  const best = pickBest(signals);
  if (!best) {
    const reasons = signals.map((s) => `${s.symbol}:${s.reason}`).join(" ");
    state.last_skip = reasons.slice(0, 240);
    return { state, skip: state.last_skip, events, signals };
  }

  const quote = market[best.symbol].quote;
  const pair = market[best.symbol].pair;
  const short = best.direction === "short" || best.side === "sell";
  const makerIn = cfg.use_maker_entry !== false;
  const slip = Number(cfg.slippage_pct || 0);
  const entryPx = short
    ? makerIn
      ? quote.ask
      : quote.bid * (1 - slip)
    : makerIn
      ? quote.bid
      : quote.ask * (1 + slip);
  const stopScale = entryPx / best.trigger;
  const stop = best.stop * stopScale;
  const tp = best.tp * stopScale;
  const sized = sizeQty({
    cash: state.cash_gbp,
    equity: state.equity,
    entry: entryPx,
    stop,
    cfg,
    pair,
    makerIn,
  });
  if (!sized.ok) {
    state.last_skip = `${best.symbol}:${sized.reason}`;
    return { state, skip: state.last_skip, events, signals };
  }

  const order = {
    symbol: best.symbol,
    qty: sized.qty,
    stop,
    tp,
    setup: best.setup,
    grade: best.grade,
    rr: best.video?.rr,
    reason: best.reason,
  };

  if (makerIn) {
    placeWorking(
      state,
      {
        type: "entry_limit",
        side: short ? "sell" : "buy",
        limit: entryPx,
        wait_seconds: cfg.maker_wait_seconds,
        ...order,
      },
      now
    );
    log(
      cfg,
      `WORKING maker ${short ? "SHORT" : "LONG"} ${best.symbol} ${best.grade} ${best.setup} limit=${entryPx} qty=${sized.qty.toFixed(8)} SL=${stop.toFixed(2)} TP=${tp.toFixed(2)} session=${best.session}`
    );
  } else {
    const opened = short
      ? openShort(state, { ...order, price: entryPx, feeRate: cfg.taker_fee }, now)
      : openLong(state, { ...order, price: entryPx, feeRate: cfg.taker_fee }, now);
    if (opened.ok) {
      log(cfg, `ENTRY taker ${short ? "SHORT" : "LONG"} ${best.symbol} @ ${entryPx} ${best.setup}`);
    } else {
      state.last_skip = opened.reason;
    }
  }

  return { state, skip: null, events, signals, best };
}
