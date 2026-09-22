import { defaultState, processQuotes, placeWorking, openLong, openShort, closeLong, updateEquity } from "./paper.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const cfg = {
  starting_gbp: 20,
  maker_fee: 0.004,
  taker_fee: 0.008,
  slippage_pct: 0.0003,
  kill_switch_drawdown_pct: 0.55,
  use_maker_tp: true,
};

{
  const state = defaultState(cfg, new Date("2026-09-19T12:00:00Z"));
  assert(state.cash_gbp === 20, "start cash");
  placeWorking(state, {
    type: "entry_limit",
    symbol: "BTC/GBP",
    limit: 100,
    qty: 0.1,
    stop: 98,
    tp: 104,
    setup: "tjr+bos",
    grade: "B",
    rr: 2,
    wait_seconds: 180,
  }, new Date("2026-09-19T12:00:00Z"));
  const ev = processQuotes(
    state,
    { symbol: "BTC/GBP", last: 99.5, bid: 99.4, ask: 99.6 },
    cfg,
    new Date("2026-09-19T12:00:01Z")
  );
  assert(ev.some((e) => e.type === "entry" && e.ok), `entry ${JSON.stringify(ev)}`);
  assert(state.position?.qty === 0.1, "qty");
  const fee = 0.1 * 99.4 * 0.004;
  assert(Math.abs(state.cash_gbp - (20 - 0.1 * 99.4 - fee)) < 1e-6, `cash ${state.cash_gbp}`);
}

{
  const state = defaultState(cfg);
  const opened = openLong(state, {
    symbol: "ETH/GBP",
    qty: 0.009,
    price: 2000,
    feeRate: 0.004,
    stop: 1960,
    tp: 2080,
    setup: "tjr",
    grade: "A",
    rr: 2,
  });
  assert(opened.ok, `open ${opened.reason}`);
  const ev = processQuotes(
    state,
    { symbol: "ETH/GBP", last: 1950, bid: 1949, ask: 1951 },
    cfg,
    new Date()
  );
  const exit = ev.find((e) => e.type === "exit");
  assert(exit?.closed?.exit_reason === "stop", `stop ${JSON.stringify(exit)}`);
  assert(exit.closed.pnl < 0, "stop is a loss");
}

{
  const state = defaultState(cfg);
  const opened = openLong(state, {
    symbol: "ETH/GBP",
    qty: 0.009,
    price: 2000,
    feeRate: 0.004,
    stop: 1960,
    tp: 2080,
    setup: "tjr",
    grade: "A",
    rr: 2,
  });
  assert(opened.ok, `open2 ${opened.reason}`);
  const ev = processQuotes(state, { symbol: "ETH/GBP", last: 2081, bid: 2081, ask: 2082 }, cfg, new Date());
  assert(ev.find((e) => e.type === "exit")?.closed?.exit_reason === "target", "tp");
}

{
  const state = defaultState({ starting_gbp: 20, kill_switch_drawdown_pct: 0.55 });
  state.peak_equity = 20;
  state.cash_gbp = 8;
  updateEquity(state, 0, { kill_switch_drawdown_pct: 0.55 });
  assert(state.kill_switch === true, `kill ${state.drawdown_pct}`);
}

{
  const state = defaultState(cfg);
  const opened = openLong(state, {
    symbol: "BTC/GBP",
    qty: 0.0002,
    price: 60000,
    feeRate: 0.004,
    stop: 59000,
    tp: 62000,
    setup: "tjr",
    grade: "B",
    rr: 2,
  });
  assert(opened.ok, `open3 ${opened.reason}`);
  const closed = closeLong(state, { price: 62000, feeRate: 0.004, exitReason: "target" });
  assert(closed.ok && closed.closed.pnl > 0, "winner");
}

{
  const state = defaultState(cfg);
  placeWorking(state, {
    type: "entry_limit",
    side: "sell",
    symbol: "BTC/GBP",
    limit: 100,
    qty: 0.1,
    stop: 102,
    tp: 96,
    setup: "tjr+short",
    grade: "B",
    rr: 2,
    wait_seconds: 180,
  }, new Date("2026-09-19T12:00:00Z"));
  const ev = processQuotes(
    state,
    { symbol: "BTC/GBP", last: 100.2, bid: 100.1, ask: 100.3 },
    cfg,
    new Date("2026-09-19T12:00:01Z")
  );
  assert(ev.some((e) => e.type === "entry" && e.ok), `short entry ${JSON.stringify(ev)}`);
  assert(state.position?.side === "short", "short side");
}

{
  const state = defaultState(cfg);
  const opened = openShort(state, {
    symbol: "ETH/GBP",
    qty: 0.009,
    price: 2000,
    feeRate: 0.004,
    stop: 2040,
    tp: 1920,
    setup: "tjr",
    grade: "A",
    rr: 2,
  });
  assert(opened.ok, `short open ${opened.reason}`);
  const win = processQuotes(state, { symbol: "ETH/GBP", last: 1910, bid: 1909, ask: 1910 }, cfg, new Date());
  assert(win.find((e) => e.type === "exit")?.closed?.exit_reason === "target", `short tp ${JSON.stringify(win)}`);
  assert(win.find((e) => e.type === "exit").closed.pnl > 0, "short winner");
}

{
  const state = defaultState(cfg);
  const opened = openShort(state, {
    symbol: "ETH/GBP",
    qty: 0.009,
    price: 2000,
    feeRate: 0.004,
    stop: 2040,
    tp: 1920,
    setup: "tjr",
    grade: "A",
    rr: 2,
  });
  assert(opened.ok, `short open2 ${opened.reason}`);
  const loss = processQuotes(state, { symbol: "ETH/GBP", last: 2050, bid: 2049, ask: 2051 }, cfg, new Date());
  assert(loss.find((e) => e.type === "exit")?.closed?.exit_reason === "stop", `short sl ${JSON.stringify(loss)}`);
  assert(loss.find((e) => e.type === "exit").closed.pnl < 0, "short stop loss");
}

console.log("paper.test.js OK");
