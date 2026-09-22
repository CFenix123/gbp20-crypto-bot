import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { isRateLimitError } from "./kraken.js";
import { loadConfig, loadState, saveState, step, loadMarket } from "./trader.js";
import { sessionGate } from "./risk.js";
import { dualSnapshot, writeSnapshot } from "./snapshot.js";
import { startUiServer, loadOrCreateSecret } from "./server.js";
import { defaultState } from "./paper.js";
import { ensureJournal } from "./journal.js";
import { pullLedgers, queuePushLedgers, readLedgerBundle } from "./persist.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function yieldLoop() {
  return new Promise((r) => setImmediate(r));
}

process.on("uncaughtException", (err) => {
  console.error("[PAPER] uncaught", err?.stack || err);
});
process.on("unhandledRejection", (err) => {
  console.error("[PAPER] rejection", err?.stack || err);
});

function bootBook(file) {
  const cfg = loadConfig(root, file);
  if (cfg.mode !== "PAPER") throw new Error(`${file} must stay PAPER`);
  ensureJournal(path.join(root, cfg.journal_path));
  const stateFile = path.join(root, cfg.state_path);
  if (!fs.existsSync(stateFile)) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(defaultState(cfg), null, 2));
  }
  return { cfg, state: loadState(cfg, root) };
}

const port = Number(process.env.PORT || process.env.DASH_PORT || 8787);
const secret = loadOrCreateSecret(root);
const publicHost =
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  (process.env.FLY_APP_NAME ? `https://${process.env.FLY_APP_NAME}.fly.dev` : "");

function placeholderSnapshot() {
  return {
    mode: "PAPER",
    venue: "kraken",
    now: new Date().toISOString(),
    session: "starting",
    books: [],
  };
}

let books = [];

await startUiServer({
  root,
  port,
  secret,
  getSnapshot: () => (books.length ? dualSnapshot(root, books) : placeholderSnapshot()),
  getLedger: () => readLedgerBundle(root),
});

if (publicHost) {
  const link = `${publicHost.replace(/\/$/, "")}/?k=${secret}`;
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "phone_url.txt"), link);
  console.log(`[PAPER] PHONE LINK  ${link}`);
}

await pullLedgers(root);

console.log("PAPER five books — TJR vs ALPHA vs MIND vs SCALP vs SPEED. Not financial advice.");
console.log("20% per trade is a ceiling. Shared Kraken feed so we do not double-hit the API.");

const tjr = bootBook("config.json");
const alpha = bootBook("config.alpha.json");
const mind = bootBook("config.mind.json");
const scalp = bootBook("config.scalp.json");
const speed = bootBook("config.speed.json");
books = [tjr, alpha, mind, scalp, speed];

const once = process.argv.includes("--once");

function startPhoneTunnel() {
  if (
    process.env.FLY_APP_NAME ||
    process.env.RENDER ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.SKIP_TUNNEL === "1"
  ) {
    const existing = path.join(root, "data", "phone_url.txt");
    const url = fs.existsSync(existing) ? fs.readFileSync(existing, "utf8").trim() : "";
    console.log(`[PAPER] SKIP_TUNNEL=1 — reuse phone link ${url || "(none saved)"}`);
    return;
  }
  const exe = path.join(root, "tools", "cloudflared.exe");
  if (!fs.existsSync(exe)) {
    console.log("[PAPER] no tools/cloudflared.exe — phone tunnel skipped");
    return;
  }
  const child = spawn(exe, ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: true,
  });
  const onData = (buf) => {
    const s = buf.toString();
    const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) {
      const link = `${m[0]}/?k=${secret}`;
      fs.writeFileSync(path.join(root, "data", "phone_url.txt"), link);
      console.log(`[PAPER] PHONE LINK  ${link}`);
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("exit", (code) => console.log(`[PAPER] phone tunnel exited ${code}`));
  child.unref();
}

if (!once) startPhoneTunnel();

function startKeepAlive(url) {
  const health = `${url.replace(/\/$/, "")}/health`;
  const ping = async () => {
    try {
      const r = await fetch(health, { headers: { "user-agent": "gbp20-keepalive" } });
      if (!r.ok) console.log(`[PAPER] keepalive ${r.status}`);
    } catch (err) {
      console.log(`[PAPER] keepalive ${err.message || err}`);
    }
  };
  setTimeout(ping, 20_000);
  setInterval(ping, 4 * 60 * 1000);
}

if (!once && publicHost) startKeepAlive(publicHost);

let ticks = 0;

do {
  const now = new Date();
  try {
    const inWindow = sessionGate(now, tjr.cfg, "A").ok;
    const needManage = books.some((b) => b.state.position || b.state.working);
    let market = null;
    if (inWindow || needManage) {
      market = await loadMarket(tjr.cfg, { quotesOnly: needManage && !inWindow });
    }
    await yieldLoop();
    let ledgerDirty = false;
    for (const book of books) {
      const before = JSON.stringify({
        p: book.state.position,
        w: book.state.working,
        e: book.state.equity,
        t: book.state.trades_today,
        k: book.state.kill_switch,
      });
      const out = await step(book.cfg, book.state, root, now, market);
      book.state = out.state;
      saveState(book.cfg, root, book.state);
      const after = JSON.stringify({
        p: book.state.position,
        w: book.state.working,
        e: book.state.equity,
        t: book.state.trades_today,
        k: book.state.kill_switch,
      });
      if (after !== before || out.events?.length) ledgerDirty = true;
      await yieldLoop();
    }
    if (ledgerDirty) queuePushLedgers(root);
    writeSnapshot(root, dualSnapshot(root, books, now));
    ticks += 1;
    if (once || ticks === 1 || ticks % 8 === 0) {
      const line = books
        .map((b) => {
          const n = b.cfg.name;
          const p = b.state.position
            ? `${b.state.position.side} ${b.state.position.symbol}`
            : b.state.working
              ? `working ${b.state.working.symbol}`
              : "flat";
          return `${n} £${Number(b.state.equity ?? 20).toFixed(2)} ${p}`;
        })
        .join(" | ");
      console.log(`[PAPER] ${line} sess=${inWindow ? "open" : "idle"}`);
    }
  } catch (err) {
    if (isRateLimitError(err)) {
      const wait = Number(tjr.cfg.rate_limit_backoff_seconds || 25);
      console.error(`[PAPER] Kraken rate limit — backing off ${wait}s`);
      if (once) process.exit(1);
      await sleep(wait * 1000);
      continue;
    }
    console.error("[PAPER] step error", err.message || err);
    if (once) process.exit(1);
  }
  if (!once) await sleep(Number(tjr.cfg.poll_seconds || 15) * 1000);
} while (!once);
