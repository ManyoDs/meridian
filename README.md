# Meridian — ManyoDs Fork

> **This is a personal fork** of [yunus-0x/meridian](https://github.com/yunus-0x/meridian) with custom infrastructure improvements and risk-parameter tuning for production Meteora DLMM liquidity management.
>
> All original credit goes to the upstream maintainer. This fork adds operator-facing features (multi-key Helius rotation, tighter risk defaults) and ships a single commit on top of `main`.

**Links:** [Upstream Website](https://agentmeridian.xyz) · [Telegram](https://t.me/agentmeridian) · [X](https://x.com/meridian_agent) · [This Fork](https://github.com/ManyoDs/meridian)

---

## What this fork adds

This fork is identical to upstream in **scope and architecture**. The differences are operational:

| Area | Upstream | This fork |
|---|---|---|
| **Helius API key handling** | Single `HELIUS_API_KEY` + `RPC_URL` with key in URL | **Round-robin pool** via `HELIUS_API_KEYS=***,*** — auto-builds RPC URL per call |
| **Screening filters** | Defaults suitable for moderate testing | Tighter: `blockPvpSymbols: true`, `minTokenAgeHours: 24` |
| **Risk management** | `stopLossPct: -50`, generous for paper trading | `stopLossPct: -15`, tighter for live capital |
| **Take profit** | Absolute `takeProfitPct: 5` + trailing `3 / 0.5` | Absolute `takeProfitPct: 10` + trailing `5 / 2` (more room) |
| **Position sizing** | `positionSizePct: 0.35` (dynamic) | `positionSizePct: 0` (fixed per-position) |
| **PnL polling** | `pnlPollIntervalSec: 3` (realtime) | `pnlPollIntervalSec: 10` (~70% fewer RPC calls) |
| **PnL source** | `rpc` (Helius raw) | `meteora` (Meteora portfolio API, more accurate) |
| **LLM model** | `openrouter/healer-alpha` (paid) | `minimax/minimax-m3:free` (free tier) |

All changes are **backwards compatible** — a fresh `npm install` with empty `.env` still works the upstream way.

---

## What it does (unchanged from upstream)

- **Screens pools** — scans Meteora DLMM pools against configurable thresholds
- **Manages positions** — monitors, claims fees, closes LP positions autonomously
- **Learns from performance** — studies top LPers, saves lessons, evolves thresholds
- **Telegram chat** — full agent chat via Telegram + cycle reports + OOR alerts
- **Discord signals** — optional Discord listener watches channels for token calls

---

## How it works (unchanged from upstream)

Meridian runs a **ReAct agent loop** — each cycle the LLM reasons over live data, calls tools, and acts. Two specialized agents run on independent cron schedules:

| Agent | Default interval | Role |
|---|---|---|
| **Screening Agent** | Every 30 min | Pool screening — finds and deploys into the best candidate |
| **Management Agent** | Every 10 min | Position management — evaluates each open position and acts |

Powered via **OpenRouter** (default) or any OpenAI-compatible endpoint.

---

## Setup

### 1. Clone & install

```bash
git clone https://github.com/ManyoDs/meridian.git
cd meridian
npm install
```

### 2. Configure `.env`

Create `.env` from `.env.example`. **Recommended for this fork**:

```env
# ── Wallet ───────────────────────────────────────────────────
WALLET_PRIVATE_KEY=your_base58_private_key_here

# ── Solana RPC (multi-key round-robin) ───────────────────────
# Comma-separated list of Helius API keys (no spaces).
# All RPC + balance-lookup calls rotate through this pool.
HELIUS_API_KEYS=key1,key2,key3

# Legacy single-key still works:
# HELIUS_API_KEY=your_helius_api_key
# RPC_URL=https://mainnet.helius-rpc.com/?api-key=your_key

# ── LLM Provider (OpenRouter) ───────────────────────────────
OPENROUTER_API_KEY=sk-or-v1-...
LLM_MODEL=minimax/minimax-m3:free

# ── Telegram (optional) ─────────────────────────────────────
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_ALLOWED_USER_IDS=

# ── Safety ──────────────────────────────────────────────────
ALLOW_SELF_UPDATE=false
DRY_RUN=false
```

Generate the **maximum number of Helius keys** you can manage (one per email, free tier). More keys = higher effective quota, better resilience against rate limits and key revocation.

### 3. Configure `user-config.json`

Copy from `user-config.example.json`. **Recommended starting values** for live trading with this fork:

```json
{
  "deployAmountSol": 0.5,
  "maxPositions": 3,
  "minSolToOpen": 0.55,
  "maxDeployAmount": 50,
  "gasReserve": 0.15,
  "positionSizePct": 0,
  "stopLossPct": -15,
  "takeProfitPct": 10,
  "trailingTakeProfit": true,
  "trailingTriggerPct": 5,
  "trailingDropPct": 2,
  "pnlSource": "meteora",
  "pnlPollIntervalSec": 10,
  "pnlConfirmTicks": 10,
  "blockPvpSymbols": true,
  "minTokenAgeHours": 24,
  "minTvl": 10000,
  "maxTvl": 150000,
  "minOrganic": 60,
  "managementIntervalMin": 10,
  "screeningIntervalMin": 30
}
```

### 4. Run

```bash
# Dry run (no on-chain transactions, recommended for first 24h)
npm run dev

# Live (real capital)
npm start
```

### 5. PM2 (VPS / always-on)

```bash
npm install
npm run pm2:start    # uses ecosystem.config.cjs
pm2 save
```

Restart on config changes: `npm run pm2:restart`

---

## Helius multi-key rotation

The fork's main infrastructure change. See `tools/helius-keys.js` for the implementation.

**Behavior:**
- `HELIUS_API_KEYS=key1,key2,key3` parsed once at startup
- `getNextKey()` returns the next key in round-robin order, advances the counter
- `buildRpcUrl()` produces a per-call `https://mainnet.helius-rpc.com/?api-key=KEY`
- `buildEnhancedUrl(path)` produces a per-call `https://api.helius.xyz/{path}?api-key=KEY`
- `callWithFallback(urlBuilder, options)` tries each key in order before throwing

**Effective quota**: 3 free-tier Helius accounts = 150,000 RPC calls/day (3× the single-key limit).

**Backward compatibility**: if `HELIUS_API_KEYS` is empty and `HELIUS_API_KEY` is set, the single key is used.

**Failure behavior**: if one key is revoked or rate-limited, requests still succeed via the next key in the pool.

---

## Tuned risk defaults

The fork ships tighter defaults suitable for live capital rather than paper testing. Key differences:

| Setting | Value | Why |
|---|---|---|
| `stopLossPct` | -15 | Standard Meteora LP positions can lose 5-15% to IL in normal volatility. -50% lets too much damage accumulate before exit. |
| `takeProfitPct` | +10 | Combined with trailing TP, captures larger moves before exit. |
| `trailingTriggerPct` | 5 | Trailing activates after a +5% move, giving positions room to develop. |
| `trailingDropPct` | 2 | Exits only when price drops 2% from peak — avoids noise-triggered exits at 0.5%. |
| `positionSizePct` | 0 | Fixed per-position deploy (uses `deployAmountSol` as the constant). Removes wallet-balance scaling. |
| `pnlPollIntervalSec` | 10 | 70% fewer Helius calls vs the 3s default. Slightly less real-time PnL tracking. |
| `pnlConfirmTicks` | 10 | 10 consecutive ticks (~30s) at -15% before stop-loss fires. Filters single-tick noise. |
| `pnlSource` | meteora | PnL from Meteora portfolio API includes fee accrual and IL; RPC raw reads are noisier. |
| `blockPvpSymbols` | true | Hard-skip pools with PvP-rival symbols (pump.fun sniper wars) instead of just downranking. |
| `minTokenAgeHours` | 24 | Skip tokens < 24h old. Most rugs happen in the first day. |
| `gasReserve` | 0.15 | Slightly more capital deployed per cycle; safe on Solana (~5000 free tier tx fees per "reserve"). |

**Recommended entry capital**: 2+ SOL for 3 positions @ 0.5 SOL each + 0.5 SOL buffer.

---

## What this fork does NOT change

- **Agent logic** (`agent.js`, `tools/executor.js`, `tools/screening.js`) — same ReAct loop
- **Meteora SDK usage** — same `@meteora-ag/dlmm` calls
- **Discord listener** — same selfbot-style architecture
- **Hivemind** — same optional, networked learning system
- **Telegram bot** — same command set, polling, buttons

---

## Operational notes

### Helius dashboard
- Free tier: 50,000 credits/day per API key
- Recommended: 3+ accounts = 150k+ credits/day effective
- Monitor usage: https://dashboard.helius.dev

### Rotation strategy
- 3-5 keys is the sweet spot for a single bot
- More than 10 keys adds setup complexity without meaningful quota gain at this scale
- Rotate keys quarterly to avoid stale-account issues

### Risk monitoring
- Set conservative `stopLossPct` (-15 to -25) for memecoin pools
- Increase `minTvl` and `minOrganic` in volatile markets
- Lower `positionSizePct` or `maxPositions` when deploying in uncertain conditions

---

## Upstream sync

This fork tracks `upstream/main`. To pull new changes:

```bash
git fetch upstream
git merge upstream/main
# Resolve any conflicts in config.js or tools/wallet.js (the patched files)
```

Likely-conflicting files when merging upstream:
- `config.js` (we added Helius pool init)
- `tools/wallet.js` (we replaced single key with round-robin)
- `tools/dlmm.js` (we changed `getConnection()`)
- `.env.example` (we documented `HELIUS_API_KEYS`)

---

## Changelog vs upstream

### Added
- `tools/helius-keys.js` — round-robin Helius key manager (1..N keys)
- `HELIUS_API_KEYS` env var (comma-separated multi-key format)
- `pnlConfirmTicks` config (default 10) for stop-loss noise filtering
- `pnlSource: "meteora"` config option
- `blockPvpSymbols: true` default for screening
- `minTokenAgeHours: 24` default for screening

### Changed (defaults, all configurable)
- `gasReserve` 0.2 → 0.15
- `stopLossPct` -50 → -15
- `takeProfitPct` 5 → 10
- `trailingTriggerPct` 3 → 5
- `trailingDropPct` 0.5 → 2
- `pnlPollIntervalSec` 3 → 10
- `positionSizePct` 0.35 → 0
- LLM model `openrouter/healer-alpha` → `minimax/minimax-m3:free`

### Backwards compatible
- `HELIUS_API_KEY` + `RPC_URL` (single key) still works
- All other config keys unchanged
- Same CLI commands, Telegram commands, and PM2 setup

---

## License

Same as upstream — see upstream repo for terms.

## Credits

- Original project: [yunus-0x/meridian](https://github.com/yunus-0x/meridian) and contributors
- This fork: [@ManyoDs](https://github.com/ManyoDs)

---

## Support

For issues specific to this fork, open a GitHub issue. For upstream issues, use the upstream repo.
