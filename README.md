# PAPER £20 crypto day bot (Kraken)

Not financial advice. Simulated **PAPER** only until you explicitly say go live.

This bot follows [How To Start Day Trading In 2026](https://www.youtube.com/watch?v=yiuFUp0kFz8) (TJR, ~6h40m). That video is a discretionary NASDAQ / S&P course (TradingView, demo first, then prop firms for small capital). Bitcoin is a watchlist example, not a crypto-bot recipe. The rules below are a **mechanical encoding** of that toolbox, not a claim we can clone TJR’s discretion.

**20% of balance risked per trade is aggressive.** Pros typically risk ~0.25–1%. The 20% figure is a *ceiling*. On spot with £20 you usually cannot spend the full £4 because a 1.2% stop on £20 is only ~£0.24 of risk.

## Platform

| Role | Choice | Why |
|---|---|---|
| **PAPER venue (now)** | **Kraken public API** + local £20 ledger | Real BTC/GBP and ETH/GBP books, no keys, UK-native quote |
| **Live later (UK)** | **Kraken Pro** | FCA-visible, GBP pairs, API, BTC min ~0.00005 (~£3), ETH min 0.001 (~£2) |
| Charts (from the video) | TradingView | TJR’s charting platform |

Do **not** put £20 on Instant Buy / the consumer Kraken app. Live mode is **not wired**. Config `mode` must stay `PAPER` until you explicitly say go live.

When we do switch, the same long/short rules can map to **Kraken Pro margin** (BTC/GBP and ETH/GBP already allow 2–5× on the book; we would still size as 1x isolated). That needs a Kraken Pro account with **margin enabled**, API keys that can create orders, and a live adapter we have not written yet. Instant Buy cannot short.

Starter Kraken Pro fees (Tier 1, July 2026 schedule): **0.40% maker / 0.80% taker**. Round-trip taker is 1.60%, which would erase a tight day-trade. The bot therefore:

- prefers **maker** entries and take-profits
- skips stops so tight that fees kill the 2R plan
- caps at **3 trades/day** and **2 full losers**
- trades **BTC/GBP and ETH/GBP only** (spreads are tight; SMT uses the other coin like SPY vs QQQ)

## What it trades

TJR sequence, encoded in `bot/video_model.js`:

1. Higher-timeframe bias (15m close BOS) or inverse FVG through the stack  
2. Liquidity sweep (swing / session / PDH-PDL / equal highs-lows)  
3. Continuation: FVG tap + equilibrium (longs in discount)  
4. Stop beyond the sweep; target next draw on liquidity, **≥2R**  
5. Time: London + New York AM (NY PM only on A-grade). Sit out Asia and 17:00–18:00 ET spread hour  
6. Both sides: **long** in discount / HTF up, **short** in premium / HTF down (isolated 1x paper, no extra leverage)

Kill switch: **55%** drawdown from peak paper equity. No new risk until you reset / reactivate.

## Run (Windows)

```powershell
cd C:\Users\tom61\gbp20-crypto-bot
npm test
npm run reset
npm run once
npm run bot
```

- `npm run bot` — loop every 8s (leave the PC on)  
- `npm run status` / `npm run scorecard` — equity, drawdown, journal  
- `npm run reset` — back to £20, empty journal  

Judge edge only after **≥30** closed paper trades. If expectancy is ≤ 0 after fees, do not go live.

## Three-book paper test (TJR vs ALPHA vs MIND)

One process, one Kraken feed, three isolated £20 PAPER ledgers:

| Book | Rules |
|---|---|
| **TJR** | Video model (sweep / BOS / iFVG / FVG / SMT) from [yiuFUp0kFz8](https://www.youtube.com/watch?v=yiuFUp0kFz8) |
| **ALPHA** | Candlestick patterns from [tW13N4Hll88](https://www.youtube.com/watch?v=tW13N4Hll88) (engulfing, momentum, wick cluster, doji+confirm, hammer/star, tweezer, marubozu) at 15m support/resistance. Fees still skip stops under 1.2%. |
| **MIND** | Mind Math Money patterns from [lEk4cSA7cqc](https://www.youtube.com/watch?v=lEk4cSA7cqc) (morning/evening star, piercing/dark cloud, inverted hammer/hanging man, three methods, flags, 2×-body momentum). Reversals need a prior opposite trend + S/R; continuations need the same-direction trend. |

```powershell
cd C:\Users\tom61\gbp20-crypto-bot
npm test
npm run both
```

Dashboard: [http://127.0.0.1:8787](http://127.0.0.1:8787) — or the Render URL if deployed. Do not run a local `npm start` at the same time as the cloud app.

```powershell
npm run scorecard
npm run scorecard:alpha
npm run scorecard:mind
npm run replay24
```

## Trade card (every idea)

The bot only fires when the video model returns `take`. Status output uses the same fields: PAPER tag, regime/session, setup, entry, stop, targets, size from the 20% cap (cash-capped), drawdown vs 55% halt, confluence A/B, kill criteria. **Prefer no trade in chop.** Crypto is 24/7; this book still avoids dead sessions instead of forcing a “flat by NYSE close.”
