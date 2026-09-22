import fs from "node:fs";
import path from "node:path";

const FILES = [
  "data/state.json",
  "data/alpha_state.json",
  "data/mind_state.json",
  "data/scalp_state.json",
  "data/speed_state.json",
  "data/journal.csv",
  "data/alpha_journal.csv",
  "data/mind_journal.csv",
  "data/scalp_journal.csv",
  "data/speed_journal.csv",
];

function creds() {
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
  const gist = String(process.env.GIST_ID || "").trim();
  return { token, gist };
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "gbp20-paper",
  };
}

export function readLedgerBundle(root) {
  const files = {};
  for (const rel of FILES) {
    const abs = path.join(root, rel);
    files[rel] = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
  }
  return files;
}

export async function pullLedgers(root) {
  const { token, gist } = creds();
  if (!token || !gist) return false;
  const res = await fetch(`https://api.github.com/gists/${gist}`, { headers: headers(token) });
  if (!res.ok) {
    console.log(`[PAPER] ledger pull ${res.status}`);
    return false;
  }
  const body = await res.json();
  let wrote = 0;
  for (const rel of FILES) {
    const name = path.basename(rel);
    const content = body.files?.[name]?.content;
    if (!content) continue;
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    wrote += 1;
  }
  if (wrote) console.log(`[PAPER] restored ${wrote} ledger files`);
  return wrote > 0;
}

let timer = null;
let lastHash = "";

export function queuePushLedgers(root) {
  const { token, gist } = creds();
  if (!token || !gist) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    pushLedgers(root).catch((err) => console.log(`[PAPER] ledger push ${err.message || err}`));
  }, 2500);
}

export async function pushLedgers(root) {
  const { token, gist } = creds();
  if (!token || !gist) return false;
  const files = {};
  const hashParts = [];
  for (const rel of FILES) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, "utf8");
    files[path.basename(rel)] = { content };
    hashParts.push(content);
  }
  const hash = hashParts.join("\n--\n");
  if (!Object.keys(files).length || hash === lastHash) return false;
  const res = await fetch(`https://api.github.com/gists/${gist}`, {
    method: "PATCH",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });
  if (!res.ok) {
    console.log(`[PAPER] ledger push ${res.status}`);
    return false;
  }
  lastHash = hash;
  return true;
}
