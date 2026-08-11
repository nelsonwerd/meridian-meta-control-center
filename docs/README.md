# Meridian docs

Start with the root [`../README.md`](../README.md) (quick start + architecture).
The rest of this folder, grouped by what you need it for:

## 🔧 Engineering — read these to work on / ship the app
| Doc | What it's for |
|---|---|
| [`META_INTEGRATION.md`](META_INTEGRATION.md) | **The go-live guide** — running the token proxy, mapping your real ad accounts, multi-BM auth, the go-live checklist. Start here to use Meridian with your own Meta accounts. |
| [`PROMPT_PACK_live_integration.md`](PROMPT_PACK_live_integration.md) | The live-integration build plan (proxy → structure map → insights → fidelity → writes → LLM) — **executed 2026-08-11**; kept as the record of how the live mile was built and what was corrected along the way. |
| [`LEDGER.md`](LEDGER.md) | **Honest status** — what's verified-working vs machine-verified-awaiting-real-credentials vs simulated-in-demo, incl. the 🚪 human gates and known approximations. Read before trusting any claim. |

## 📚 Reference — the domain knowledge the engine encodes
| Doc | What it's for |
|---|---|
| [`research/meta-marketing-api.md`](research/meta-marketing-api.md) | Meta Marketing API reference (object graph, Insights fields, auth, writes, rate limits) the `LiveProvider` + types are built against. |
| [`research/adops-kpis-playbook.md`](research/adops-kpis-playbook.md) | The ad-ops KPIs + optimization thresholds the AI engine (`src/lib/ai/`) implements. |

## 🔍 Audit — independent review evidence
[`audit/`](audit/) — the deep-dive that hardened the build: 5 specialist lanes
(`01`–`05`), synthesis (`06`), red-team (`07`), and the plain-English
[`08-executive-briefing.md`](audit/08-executive-briefing.md).

## 🛠️ Build process — how this was made (context, not required to run it)
[`00_KICKOFF.md`](00_KICKOFF.md) · [`CONCEPT_BRIEF.md`](CONCEPT_BRIEF.md) ·
[`DEEP_DIVE.md`](DEEP_DIVE.md) · [`PROMPT_PACK.md`](PROMPT_PACK.md) — the
idea→ship pipeline artifacts. Useful background; safe to skip if you just want to
run or edit the app.
