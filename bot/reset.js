import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultState } from "./paper.js";
import { ensureJournal } from "./journal.js";
import { loadConfig } from "./trader.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv.includes("--mind")
  ? "config.mind.json"
  : process.argv.includes("--alpha")
    ? "config.alpha.json"
    : "config.json";
const cfg = loadConfig(root, file);
const stateFile = path.join(root, cfg.state_path);
const journal = path.join(root, cfg.journal_path);

fs.mkdirSync(path.dirname(stateFile), { recursive: true });
fs.writeFileSync(stateFile, JSON.stringify(defaultState(cfg), null, 2));
if (fs.existsSync(journal)) fs.unlinkSync(journal);
ensureJournal(journal);
console.log(`PAPER reset ${cfg.name || cfg.book}: £${cfg.starting_gbp} cash, empty journal.`);
