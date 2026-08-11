<div align="center">

# Meridian

**An open-source AI command & control center for agency Meta advertising.**

One cockpit across every client and Business Manager · KPI dashboards down to the
creative · an AI analyst that scores the data and proposes one-click optimizations
· designed weekly Monday reports · demo mode out of the box, live mode for your
real ad accounts.

### ▶︎ [**Try the live demo**](https://nelsonwerd.github.io/meridian-meta-control-center/) — no signup, no keys

<sub>Runs entirely in your browser on a seeded, synthetic dataset. Click through
every screen; apply a recommendation and watch it flow into the activity ledger.</sub>

<br />

<img src="docs/screenshots/overview.png" alt="Meridian Command Overview — cross-client KPIs, the Watchtower anomaly feed, a blended performance trend, and spend allocation by client" width="900">

</div>

---

## Quick start (demo — zero keys)

Nothing to install if you just want to look: **[the hosted demo is
here](https://nelsonwerd.github.io/meridian-meta-control-center/)**. To run it
locally:

```bash
npm install
npm run dev      # → http://localhost:5173
```

Ships in **demo mode** — a deterministic, seeded dataset of 7 clients across 3
Business Managers, ~26 campaigns and 90 days of ad-level performance — so you can
poke around before any API is connected. No keys required.

```bash
npm run test:run # 134 tests, incl. a full fake-Graph live-pipeline run
npm run build    # typecheck (app + server) + production build
npm run lint     # eslint
```

## Going live with your Meta account

The live integration is **built end-to-end** (Graph API v26): a zero-dependency
Node token proxy, full structure→domain mapping, async insight report jobs,
true period reach/frequency for the AI engine, and guarded one-click writes.
The short version:

```bash
# 1. terminal A — the token proxy holds your credentials; the browser never sees them
META_SYSTEM_TOKEN=EAAB... npm run proxy

# 2. terminal B — the app (dev server forwards /api to the proxy)
npm run dev
```

3. In **Settings → Live ad account mapping**, enter each client's real `act_` ad
   account id + business id, save, then **Check proxy & token** → flip to
   **Live (Meta API)**.

**If the ad accounts belong to your own business, that's genuinely all** — Meta
requires **no App Review and no Business Verification** to use `ads_management` +
`ads_read` against accounts you own or admin (you're rate-limited, not blocked).
Agencies connecting *clients'* accounts need partner asset sharing and should
plan on App Review + Business Verification for the throughput.

Both paths — plus the System User setup, per-BM token routing, single-process
production deploys, and the optional Claude narrative layer — are in
**[`docs/META_INTEGRATION.md`](docs/META_INTEGRATION.md)** (audited against
Meta's docs 2026-08-11), along with the go-live checklist of the checks only a
real account can pass. Budget/pause writes always require an explicit in-app
confirm and are never auto-run.

## What's inside

| Area | Where |
|---|---|
| **Portfolio overview** — cross-client KPIs, spend allocation, priority actions | `/` |
| **Single-client dashboard** — KPIs vs targets, trends, campaigns, pacing | `/` (client scope) |
| **Recommendations** — AI suggestions, filterable, one-click apply | `/recommendations` |
| **Campaigns** — campaign → ad set → ad drill-down | `/campaigns` |
| **Creative Lab** — cohort analysis, funnel diagnosis, next test batch | `/creatives` |
| **Weekly Report** — designed Monday report per client + portfolio digest | `/report` |
| **Clients** — directory grouped by Business Manager | `/clients` |
| **Settings** — Meta connection, ad-account mapping, AI + thresholds | `/settings` |

## Screens

<sub>Shown in demo mode — the seeded dataset of fictional clients with deterministic numbers. Click any image for full resolution.</sub>

|  |  |
| :--: | :--: |
| <a href="docs/screenshots/recommendations.png"><img src="docs/screenshots/recommendations.png" alt="Recommendations — the AI analyst scores the last 7 days and proposes filterable, one-click actions" width="440"></a> | <a href="docs/screenshots/creative-lab.png"><img src="docs/screenshots/creative-lab.png" alt="Creative Lab — cohort performance by angle, a double-down / retire briefing, and the next test batch" width="440"></a> |
| **Recommendations** — the AI analyst scores delivery and proposes filterable, one-click actions | **Creative Lab** — cohort analysis by angle, funnel diagnosis, and the next test batch to brief |
| <a href="docs/screenshots/weekly-report.png"><img src="docs/screenshots/weekly-report.png" alt="Weekly Reports — one designed Monday digest per client, with a written headline and week-over-week deltas" width="440"></a> | <a href="docs/screenshots/clients.png"><img src="docs/screenshots/clients.png" alt="Clients — the book of business grouped by Business Manager, each with a spend sparkline and KPIs" width="440"></a> |
| **Weekly Reports** — a designed Monday digest per client, headline written from the data | **Clients** — the book of business, grouped by Business Manager |

## Architecture

The entire UI reads through one **`DataProvider`** seam, and both providers are
complete: `DemoProvider` serves the seeded dataset; `LiveProvider` pulls your
real accounts through the Meta Marketing API (v26) and assembles the exact same
snapshot shape — so every screen, chart, and engine rule works identically on
demo and live data. All Graph traffic routes through a **zero-dependency Node
proxy** (`server/proxy.mjs`) that holds the tokens; the browser never sees a
credential. The **AI engine** (`src/lib/ai/`) is deterministic heuristics —
encoded ad-ops thresholds, tunable per client in Settings — with an optional
Claude narrative layer that enriches the prose but never changes the math.

```
server/
  proxy.mjs             zero-dep token proxy: Graph forwarding, per-BM token
                        routing, rate-limit backoff, /healthz, static prod serving
src/
  lib/
    types.ts            domain model (mirrors the Meta object graph)
    demo/               deterministic seeded dataset generator
    dataset/            assembleDataset() — the one snapshot builder (demo + live)
    metrics.ts          KPI derivations + provider-owned date anchor
    selectors.ts        entity → insights → metrics (true period reach on live)
    provider/           DataProvider seam: demo · live (Graph v26 via the proxy)
    ai/                 engine (heuristics) · creative · report · llm (Claude, opt-in)
  components/           ui primitives · charts · blocks · shell
  screens/              the pages
  app/                  store (zustand) · router · shell
docs/                   see docs/README.md for the index — engineering guides
                        (META_INTEGRATION · LEDGER · live-integration pack),
                        API/ad-ops reference (research/), audit evidence (audit/),
                        and build-process artifacts
```

## Testing & verification

**134 Vitest tests across 17 suites**: demo-dataset goldens (byte-identical
through refactors), Graph→domain mapping fixtures, a full `loadSnapshot`
integration run against a faked Graph API (with the AI engine catching a seeded
losing ad on live-shaped data), async report-job polling semantics, period
reach/frequency math, transport (pagination, multi-account, failure paths,
throttle backoff), the write path's minor-unit currency traps, and 21 proxy
tests against an in-process mock upstream — token injection, redaction, CSRF
guard, path validation. CI runs the lot on every push. The build was also
adversarially reviewed by a multi-agent fleet; all confirmed findings are fixed
(see the `review:` commit).

**New here?** [`docs/README.md`](docs/README.md) indexes every doc by purpose.

## Honest status

Everything above is real, but honesty about the boundary matters: the live
pipeline is **machine-verified against a faked Graph API**, not yet proven
against a production ad account — the checks only real credentials can pass
(numbers reconciling with Ads Manager, a sandbox write landing) are tracked as
explicit human gates in [`docs/LEDGER.md`](docs/LEDGER.md), alongside every
known approximation. Read it before trusting any single claim. The AI's calls
are encoded best practice — a signal a buyer weighs, not a backtested edge.

Stack: React 18 · TypeScript · Vite · Tailwind · Recharts · Zustand · a
zero-dependency Node ≥20 proxy. Licensed [MIT](LICENSE) — use it, fork it,
point it at your own accounts.
