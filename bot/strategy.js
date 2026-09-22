import { evaluateVideoEntry } from "./video_model.js";
import { evaluateQuantEntry } from "./quant_model.js";
import { feesKillEdge, gradeOk, sessionGate } from "./risk.js";

export function retagGrade(sig) {
  if (!sig?.take) return sig;
  const smt = sig.video?.smt;
  const ifvg = sig.video?.ifvg;
  const bos = String(sig.setup || "").includes("bos");
  const grade = smt && (ifvg || bos) ? "A" : "B";
  return { ...sig, grade };
}

export function evaluateSymbol({ id, htf, ltf, peerHtf, quote, cfg, now }) {
  const windowEvenForA = sessionGate(now, cfg, "A");
  if (!windowEvenForA.ok) {
    return { take: false, reason: windowEvenForA.reason, symbol: id };
  }
  const raw =
    cfg.entry_model === "quant"
      ? evaluateQuantEntry(htf, ltf, quote, cfg, now)
      : evaluateVideoEntry(htf, ltf, cfg, {
          canShort: Boolean(cfg.allow_shorts),
          now,
          nyKillzone: Boolean(cfg.video_ny_killzone),
          peerHtf,
        });
  const sig = cfg.entry_model === "quant" ? { ...raw, symbol: id, grade: raw.grade || "B" } : retagGrade({ ...raw, symbol: id });
  if (!sig.take) return sig;
  if (!gradeOk(sig.grade, cfg.min_grade)) {
    return { take: false, reason: "grade_too_low", grade: sig.grade, symbol: id };
  }
  const sess = sessionGate(now, cfg, sig.grade);
  if (!sess.ok) return { take: false, reason: sess.reason, symbol: id, grade: sig.grade };
  const stopPct = Math.abs(sig.trigger - sig.stop) / sig.trigger;
  const fee = feesKillEdge({
    stopPct,
    rr: sig.video?.rr || cfg.min_rr || 2,
    cfg,
    makerIn: cfg.use_maker_entry !== false,
    makerOut: cfg.use_maker_tp !== false,
  });
  if (!fee.ok) return { take: false, reason: fee.reason, symbol: id, video: sig.video, fee };
  return { ...sig, session: sess.window, stopPct, fee };
}

export function pickBest(signals) {
  const takes = signals.filter((s) => s.take);
  takes.sort((a, b) => {
    const g = (x) => (x.grade === "A" ? 2 : 1);
    return g(b) - g(a) || (b.score || 0) - (a.score || 0) || (b.video?.rr || 0) - (a.video?.rr || 0);
  });
  return takes[0] || null;
}
