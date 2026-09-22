import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

export function loadOrCreateSecret(root) {
  const fromEnv = String(process.env.DASH_SECRET || "").trim();
  if (fromEnv) return fromEnv;
  const file = path.join(root, "data", "dash_secret.txt");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing) return existing;
  }
  const secret = crypto.randomBytes(18).toString("base64url");
  fs.writeFileSync(file, secret);
  return secret;
}

export function lanIPv4() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return null;
}

function authorized(url, secret) {
  return Boolean(secret) && url.searchParams.get("k") === secret;
}

export function startUiServer({ root, port = 8787, host = "0.0.0.0", secret, getSnapshot, getLedger }) {
  const uiDir = path.join(root, "ui");
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }
    if (!authorized(url, secret)) {
      res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Need the full dashboard link (it includes a key). Ask the PC chat for it.");
      return;
    }
    if (url.pathname === "/api/snapshot") {
      const body = JSON.stringify(getSnapshot());
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(body);
      return;
    }
    if (url.pathname === "/api/ledger" && getLedger) {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(getLedger()));
      return;
    }
    let file = url.pathname === "/" ? "/index.html" : url.pathname;
    const abs = path.normalize(path.join(uiDir, file));
    if (!abs.startsWith(uiDir)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const ext = path.extname(abs);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(fs.readFileSync(abs));
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const lan = lanIPv4();
      console.log(`[PAPER] dashboard http://127.0.0.1:${port}/?k=${secret}`);
      if (lan) console.log(`[PAPER] same Wi‑Fi http://${lan}:${port}/?k=${secret}`);
      resolve(server);
    });
  });
}
