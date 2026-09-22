const BASE = "https://api.kraken.com/0/public";
const cache = new Map();
let nextSlot = 0;
let cooldownUntil = 0;

export class KrakenRateLimitError extends Error {
  constructor(message = "Kraken API EGeneral:Too many requests") {
    super(message);
    this.name = "KrakenRateLimitError";
    this.code = "KRAKEN_RATE_LIMIT";
  }
}

export function isRateLimitError(err) {
  const msg = String(err?.message || err || "");
  return err?.code === "KRAKEN_RATE_LIMIT" || /too many requests/i.test(msg);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cached(key, ttlMs) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttlMs) return null;
  return hit.value;
}

function store(key, value) {
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function getJson(path) {
  const wait = Math.max(0, nextSlot - Date.now(), cooldownUntil - Date.now());
  if (wait) await sleep(wait);
  nextSlot = Date.now() + 1200;

  const res = await fetch(`${BASE}/${path}`, {
    headers: { "User-Agent": "gbp20-crypto-bot/1.0 PAPER" },
  });
  if (res.status === 429) {
    cooldownUntil = Date.now() + 25000;
    throw new KrakenRateLimitError();
  }
  if (!res.ok) throw new Error(`Kraken HTTP ${res.status} ${path}`);
  const body = await res.json();
  if (body.error?.length) {
    const text = body.error.join(", ");
    if (/too many requests/i.test(text)) {
      cooldownUntil = Date.now() + 25000;
      throw new KrakenRateLimitError(text);
    }
    throw new Error(`Kraken API ${text}`);
  }
  return body.result;
}

function firstResult(result) {
  const keys = Object.keys(result || {}).filter((k) => k !== "last");
  if (!keys.length) throw new Error("Kraken empty result");
  return result[keys[0]];
}

export function toBars(rows) {
  return (rows || []).map((row) => ({
    t: new Date(Number(row[0]) * 1000).toISOString(),
    o: Number(row[1]),
    h: Number(row[2]),
    l: Number(row[3]),
    c: Number(row[4]),
    v: Number(row[6]),
  }));
}

export async function fetchOhlc(pair, interval, ttlMs = interval >= 15 ? 90000 : 45000) {
  const key = `ohlc:${pair}:${interval}`;
  const hit = cached(key, ttlMs);
  if (hit) return hit;
  const result = await getJson(`OHLC?pair=${encodeURIComponent(pair)}&interval=${interval}`);
  return store(key, toBars(firstResult(result)));
}

export async function fetchTicker(pair) {
  const result = await getJson(`Ticker?pair=${encodeURIComponent(pair)}`);
  const t = firstResult(result);
  const ask = Number(t.a[0]);
  const bid = Number(t.b[0]);
  const last = Number(t.c[0]);
  return { pair, ask, bid, last, spread: ask - bid, spreadPct: ask > 0 ? (ask - bid) / ask : 0 };
}

export async function fetchTickers(pairs, ttlMs = 8000) {
  const key = `tick:${pairs.join(",")}`;
  const hit = cached(key, ttlMs);
  if (hit) return hit;
  const q = pairs.join(",");
  const result = await getJson(`Ticker?pair=${encodeURIComponent(q)}`);
  const out = {};
  for (const [k, t] of Object.entries(result)) {
    const ask = Number(t.a[0]);
    const bid = Number(t.b[0]);
    const last = Number(t.c[0]);
    out[k] = {
      key: k,
      ask,
      bid,
      last,
      spread: ask - bid,
      spreadPct: ask > 0 ? (ask - bid) / ask : 0,
    };
  }
  return store(key, out);
}

export async function fetchAssetPairs(pairs) {
  const q = pairs.join(",");
  return getJson(`AssetPairs?pair=${encodeURIComponent(q)}`);
}

export function tickerForPair(tickers, pair) {
  const want = String(pair).replace("/", "");
  for (const [key, t] of Object.entries(tickers || {})) {
    if (key === pair || key.includes(want) || key.replace(/^X/, "").includes(want)) return t;
    if (pair === "XBTGBP" && /XXBTZGBP|XBTGBP/.test(key)) return t;
    if (pair === "ETHGBP" && /XETHZGBP|ETHGBP/.test(key)) return t;
  }
  return null;
}
