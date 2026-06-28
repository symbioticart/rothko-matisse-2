# Rothko Matisse 2 — Project Context

> Successor to **Rothko Matisse v1.0**. v1.0 was a static viewer over a frozen
> 97-day snapshot. v2 closes the symbiotic loop: live Oura sync, opens on the
> present day, and renders the silence when the signal stops. This file is the
> single source of truth — `CONTEXT.md` in v1.0 is stale (it described a variable
> background and a stochastic palette that the code no longer uses).

---

## What this is

A generative oil painting driven by the artist's own Oura Ring biometrics. One
body-state → one deterministic painting. Good days = airy, bright Matisse strokes;
bad days = dense, dark Rothko strokes. Both on a fixed warm-ivory ground.

It is a **personal** symbiotic work — "about myself, for myself". The off-limits
ethics constraint (no mapping of temperature / sensitive signals) is intentionally
**lifted** here because the only subject is the author (see data-room §7). It returns
when this feeds a Collective layer.

---

## How it differs from v1.0 (the actual changes)

| Aspect | v1.0 | v2 |
|---|---|---|
| Data | static `data/daily-metrics.json` snapshot | **live Oura sync, in memory**, snapshot is cold-start fallback only |
| Opening view | random day | **latest day** (the present body) |
| Stopped signal | invisible | **visible silence** — frozen last day + growing void |
| Status | none | live / stable / silence indicator under canvas |
| About text | "portrait of a single day" | living loop + silence + correct palette logic |

`painter.js` and `p5.oil.js` are **unchanged** from v1.0 — the visual engine is the
same. All v2 work is in `server.js` and `index.html`.

---

## Architecture

### Server (`server.js`) — in-memory symbiotic sync
- Node, zero deps. Reads `process.env.PORT`.
- On boot: loads bundled snapshot as fallback, then calls `sync()`; re-syncs every 6h.
- `sync()` pulls a rolling **180-day** window from Oura v2 (`sleep`, `daily_sleep`,
  `daily_readiness`, `workout`), maps raw → daily metrics **in memory** (never writes
  to disk), computes stats + meta. Mapping mirrors `build_30d_summary.py:build_day`.
- Serves `GET /data/daily-metrics.json` from memory (`Cache-Control: no-store`).
  Payload = `{ stats, days, meta }`.
- `meta = { lastDataDay, serverDate, gapDays, status, live, syncedAt }`.
  `status`: `fresh` (gap ≤1d) / `stable` (≤7d) / `dormant` (>7d).
- `GET /health` → sync diagnostics.

### Secrets — env only, never committed
| Env var | Purpose |
|---|---|
| `OURA_TOKEN` | Bearer token. **PAT** (preferred, never expires) or an OAuth access token. |
| `OURA_REFRESH` | optional — OAuth refresh token; enables auto-refresh on 401 |
| `OURA_CLIENT_ID` / `OURA_CLIENT_SECRET` | optional — needed only for refresh flow |

The repo is public (`symbioticart` org). **No token or secret is ever in committed
code** — they live as Render environment variables. The current deploy uses a 30-day
OAuth access token; for permanence, create a Personal Access Token at
`cloud.ouraring.com/personal-access-tokens` and set it as `OURA_TOKEN`.

### Front end (`index.html`)
- Loads p5 (CDN) + `p5.oil.js` + `painter.js`. Canvas 980×700, WEBGL2.
- `loadData()` fetches `/data/daily-metrics.json`, stores `DATA` + `META`,
  sets `currentIdx` to the **last** day.
- `updateStatus()` renders the status line and the **silence veil**: a radial void
  whose opacity scales with `gapDays`, shown only on the latest (frozen) day when live.
  Full void at ~22 days of silence.
- Arrow keys / side zones / swipe navigate history. About overlay explains the loop.

---

## Biometric → visual mapping (engine, unchanged)

14 independent metrics, each → a distinct visual parameter. `moodT =
(readiness + sleep + hrv)/3` drives the palette boundary (spatial, not stochastic),
density, layers, axis tilt. Background is a **fixed** warm ivory
(`hslToRgb(42,0.35,0.90)`), not variable. Palette is sampled by a fractal field
(`pickColorField`), not by `rng < moodT`. Seed = hash of the body's metrics
(`hashMetrics`), so identical body ⇒ identical painting; the date is not in the seed.

See `painter.js` for the full 5-phase renderer (underpainting → mid-layer serpentines
→ drips → impasto → restless noise) and the per-metric parameter table.

---

## Reference days (in the v1.0 snapshot fallback)
- Best: `days[53]` = 2025-04-11 (airy Matisse)
- Worst: `days[96]` = 2025-06-13 (dense Rothko)

With live data these indices shift — test the extremes by readiness, not index.

---

## Run

```
OURA_TOKEN=<token> node server.js     # http://localhost:3457
```
Without a token it serves the bundled snapshot (status: ARCHIVE · NOT SYNCED).

## Deploy
GitHub `symbioticart` + Render (see `symbart-deploy` / `onrender-deploy` skills).
Set `OURA_TOKEN` (and optionally refresh creds) as Render env vars after the service
is created. Data lives only in memory — a redeploy/cold start re-syncs from Oura.

---

## Open next (toward full canon)
- personal-percentile normalization (replace hardcoded `norm()` ranges with the
  owner's own distribution from `DATA.stats`).
- Collective layer (discrete, self-recognizable contribution; off-limits returns).
- Certificate + loop provenance.
