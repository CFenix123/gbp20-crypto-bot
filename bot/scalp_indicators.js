import { closedBars } from "./video_model.js";
import { emaSeries, atr, atrMedian, rsi } from "./quant_model.js";

function n(v) {
  return Number(v);
}

export { emaSeries, atr, rsi };

export function lastEma(bars, period) {
  const closes = closedBars(bars).map((b) => n(b.c));
  const series = emaSeries(closes, period);
  return series.at(-1) ?? null;
}

export function volumeSma(bars, period = 20) {
  const src = closedBars(bars);
  if (src.length < period) return null;
  const slice = src.slice(-period);
  return slice.reduce((s, b) => s + n(b.v), 0) / period;
}

export function relativeVolume(bars, period = 20) {
  const src = closedBars(bars);
  const last = n(src.at(-1)?.v);
  const avg = volumeSma(bars, period);
  if (!(avg > 0) || !(last >= 0)) return null;
  return last / avg;
}

export function vwap(bars, look = 40) {
  const src = closedBars(bars).slice(-look);
  let pv = 0;
  let vol = 0;
  for (const b of src) {
    const typical = (n(b.h) + n(b.l) + n(b.c)) / 3;
    const v = n(b.v);
    pv += typical * v;
    vol += v;
  }
  if (!(vol > 0)) return null;
  return pv / vol;
}

export function macd(bars, fast = 12, slow = 26, signal = 9) {
  const closes = closedBars(bars).map((b) => n(b.c));
  if (closes.length < slow + signal + 2) return null;
  const f = emaSeries(closes, fast);
  const s = emaSeries(closes, slow);
  const line = f.map((v, i) => v - s[i]);
  const sig = emaSeries(line.slice(slow - 1), signal);
  const lastLine = line.at(-1);
  const lastSig = sig.at(-1);
  return { line: lastLine, signal: lastSig, hist: lastLine - lastSig };
}

export function snapshot(ltf, htf, cfg = {}) {
  const emaFast = Number(cfg.ema_fast || 9);
  const emaMid = Number(cfg.ema_mid || 21);
  const emaSlow = Number(cfg.ema_slow || 50);
  const rsiP = Number(cfg.rsi_period || 14);
  const atrP = Number(cfg.atr_period || 14);
  return {
    ema9: lastEma(ltf, emaFast),
    ema21: lastEma(ltf, emaMid),
    ema50: lastEma(ltf, emaSlow),
    rsi: rsi(ltf, rsiP),
    atr: atr(ltf, atrP),
    atrMedian: atrMedian(ltf, atrP),
    atrHtf: atr(htf, atrP),
    relVol: relativeVolume(ltf, Number(cfg.volume_sma || 20)),
    vwap: vwap(ltf),
    macd: macd(ltf),
    htfEma9: lastEma(htf, emaFast),
    htfEma21: lastEma(htf, emaMid),
  };
}
