# Lane 2 — Meta Integration Realism

**Auditor scope:** Will the DataProvider/LiveProvider seam, the domain types, the insights pull, and the write path map *cleanly* onto the real Meta Marketing API when the operator plugs in tokens — or are there latent mismatches that will bite?

**Files read end-to-end:** `src/lib/provider/{liveProvider,demoProvider,types,index}.ts`, `src/lib/types.ts`, `src/lib/demo/{generate,catalog}.ts`, `src/lib/metrics.ts`, `src/lib/selectors.ts`, `src/lib/ai/{engine,creative,report,llm}.ts`, `src/app/store.ts`, `src/screens/SettingsScreen.tsx`, `docs/META_INTEGRATION.md`, `docs/research/meta-marketing-api.md`, `docs/LEDGER.md`.

**Verdict in one line:** The seam is a genuinely *correct scaffold* — the hard, easy-to-get-wrong parts (action_type extraction, omni_purchase + fallback, cursor pagination with a throw-on-overflow, per-account token routing, currency_offset minor-units, attribution caveat) are right and match the research doc. But the "last-mile" the ledger casually labels as remaining is **substantially larger and riskier than advertised**, and there are **3–4 latent data-correctness mismatches** that will silently produce *wrong* numbers (not just throw) once wired. Distinguishing the two is the point of this lane.

---

## A. What is genuinely right (so the operator can trust these)

These I verified by reading the code against `docs/research/meta-marketing-api.md`:

1. **No-scalar-purchases extraction is correct.** `actionVal()` (`liveProvider.ts:132-135`) pulls `omni_purchase` from `actions`/`action_values` with `offsite_conversion.fct.purchase` fallback (`liveProvider.ts:200-201`). This matches the research doc §3.3 recommendation verbatim, including "do not sum them; they overlap/double-count" — the code never sums purchase action types, it picks one with `||` fallback. Correct.
2. **Pagination is sound and fail-loud.** `graphGet` (`liveProvider.ts:106-130`) follows `paging.cursors.after` only when `paging.next` also exists, and **throws** past `MAX_PAGES=1000` rather than silently truncating (this was a Round-1 fix; it holds). Good — silent truncation would understate summed KPIs.
3. **Per-account token routing is real.** `resolveAccount()` (`liveProvider.ts:244-253`) maps a write's entity → owning client → `LiveAccountConfig`, so multi-BM partner tokens route correctly. Not `accounts[0]`. Verified.
4. **currency_offset minor-units for writes.** `currencyOffset()` (`liveProvider.ts:261-266`) handles zero/two/three-decimal currencies and is the only multiplier on `daily_budget` writes (`liveProvider.ts:236`). Matches research §gotcha-3.
5. **Attribution-window removal is documented** (`META_INTEGRATION.md:96-98`) and matches the Jan 12 2026 change in the research doc §3.5.
6. **The version pin** `v25.0` (`liveProvider.ts:27`) matches the research doc's current-GA.

These are not "looks plausible" — they line up field-for-field with the grounding doc. The scaffold author clearly read their own research.

---

## B. The findings that will bite — ranked

### B1 [HIGH] `reach` is treated as additive, but live Meta `reach` is de-duplicated — frequency roll-ups will be wrong live

`Insight.reach` is summed in `aggregate()` (`metrics.ts:24`) and `frequency` is then derived as `impressions / reach` (`metrics.ts:41`). The demo generator explicitly *constructs* reach to be additive (`generate.ts:491`, and the type comment at `types.ts:180` says "additive approximation for demo aggregation").

But live Meta `reach` is **unique de-duplicated people** (research doc §3.2: "Unique people (de-duplicated)"). It is **not additive** across ads, ad sets, or days. When `LiveProvider` stores per-ad/day reach rows and the app sums them up the tree (ad→adset→campaign→client→portfolio) and across the date window, the summed "reach" will be **massively inflated** (the same person counted once per ad per day), which makes derived **`frequency` collapse toward ~1.0** at every aggregate level.

Why this bites hard: **frequency is load-bearing in the engine.** The creative-fatigue rule (`engine.ts:121`) gates on `m7.frequency > T.fatigueFrequency`, the scale rule gates on `m7.frequency < T.scaleMaxFrequency` (`engine.ts:146`), and the creative diagnosis uses it (`creative.ts:67`). With real (non-additive) reach summed additively over a 7-day window across multiple ads, aggregate frequency will read far too low → **fatigue suggestions essentially stop firing live, and the scale rule's frequency guard becomes a no-op.** This is the textbook "correct scaffold that produces wrong data when wired" case. The single-ad/single-day grain is the only place the demo's reach is even approximately meaningful; the moment you roll up, it's wrong — and the whole app is built on rolling up.

**Recommendation:** Frequency cannot be reconstructed from summed reach. Either (a) at the live grain, do not sum reach — pull `frequency` per ad/day directly from Insights (it's a returned field, research §3.2) and store impressions+frequency, deriving reach only when single-grain; or (b) accept that any multi-entity/multi-day "reach"/"frequency" aggregate is an approximation and stop gating engine rules on aggregate frequency, gating instead on per-ad/day frequency. The honest fix is to add a `frequency` field to `Insight` for the live path and compute aggregate frequency as impression-weighted average, never as `Σimpr/Σreach`.

### B2 [HIGH] The "last-mile" is the entire structure layer plus all 13 index Maps plus 5 derived-status passes — not a small mapping

`Snapshot extends Dataset` (`provider/types.ts:18`), and `Dataset` (`generate.ts:69-91`) is **not** just the six entity arrays. It requires:
- the six arrays (`businessManagers, clients, accounts, campaigns, adSets, ads, creatives, insights`), AND
- **13 prebuilt index Maps** (`clientById, accountByClient, campaignsByClient, adSetsByCampaign, adsByAdSet, adsByClient, adById, adSetById, campaignById, creativeById, creativesByClient, insightsByAd`), AND
- **derived statuses** computed in a post-pass: ad-set `LEARNING_LIMITED` from 7-day purchases (`generate.ts:570-585`) and campaign status rolled up from ad-set status (`generate.ts:586-589`).

`LiveProvider.loadSnapshot()` builds *none* of these — it only partially fills `accounts` and `insights`, leaves `campaigns/adSets/ads/creatives` as a `void rawCampaigns` stub (`liveProvider.ts:182-209`), builds zero index Maps, and then throws (`liveProvider.ts:214-216`). The entire app — selectors (`selectors.ts`), the engine (`engine.ts` reads `ds.campaignById`, `ds.adSetsByCampaign`, `ds.adsByAdSet`, `ds.adsByClient`, `ds.creativeById`), creative analysis, the report, and the Settings ad-account-mapping table (`SettingsScreen.tsx:130-131` reads `accountByClient`) — depends on these Maps existing. The comment "Indexes are rebuilt by buildIndexes() — shared with demo" (`liveProvider.ts:212`) refers to a function that **does not exist** in the codebase (no `buildIndexes` export anywhere; the index construction is inline inside `generateDataset()` and not factored out). So the live path can't even call the thing the comment promises.

This is the gap between the ledger's framing ("the remaining last-mile") and reality. The last-mile is: map 4 entity types from Graph JSON (with the internal-vs-UI node-name trap, research §0), extract the index-builder out of `generateDataset` into a shared `buildIndexes()`, and re-implement the two derived-status passes — **and** source the business inputs (targets/AOV/margin) that aren't on any entity. It's a meaningful slice of work, not a fill-in-the-blank.

**Recommendation:** Refactor the index construction + derived-status passes out of `generateDataset()` (`generate.ts:544-589`) into an exported `assembleDataset(arrays) → Dataset` that both providers call. That single refactor turns B2 from "rewrite" into "map arrays, call assembler." Update the ledger to stop calling this a small mapping; it is the integration.

### B3 [HIGH] `LEARNING` / `LEARNING_LIMITED` statuses cannot be derived from the Graph `status` field — and the demo fakes them in a way live cannot reproduce

The domain folds the learning phase into `EntityStatus` (`types.ts:74-76`: `ACTIVE | PAUSED | LEARNING | LEARNING_LIMITED | ARCHIVED`), and the comment says "Meta surfaces delivery state; we fold the learning phase into the same enum." The engine and consolidation logic depend heavily on this — `analyzeAdSets` treats `LEARNING_LIMITED` as a primary consolidation trigger (`engine.ts:189-203`), the SCALE rule excludes `LEARNING` ads (`engine.ts:142`), and the WATCH rule keys on `LEARNING` (`engine.ts:171`).

The problem: the Graph API's writable `status` field is only `ACTIVE/PAUSED/DELETED/ARCHIVED` (research §2.1). There is **no `LEARNING` or `LEARNING_LIMITED` value in `status` or even in `effective_status`** (effective_status adds review/in-process states like `WITH_ISSUES`, `PENDING_REVIEW`, `CAMPAIGN_PAUSED` — research §2.3, but *not* learning state). Learning-phase information is exposed via a **separate field on the ad set delivery — `learning_stage_info` / `configured_status` + delivery insights — not the `status` enum.** The demo manufactures `LEARNING_LIMITED` heuristically from a 7-day purchase count (`generate.ts:583`: `purchases7 < 13`) and `LEARNING` from a `new` archetype (`generate.ts:372`).

So when `LiveProvider` maps the real Graph `status` onto `EntityStatus`, **every ad set will be `ACTIVE` or `PAUSED` — never `LEARNING_LIMITED`** unless the live mapper re-implements the demo's heuristic (which is not in the scaffold and not mentioned in the docs). Result: **the consolidation suggestion type goes nearly silent live** (it leans on the `LEARNING_LIMITED` status as well as the purchase-count fallback at `engine.ts:195`; the fallback partly saves it, but the status-driven half and all the evidence strings — `engine.ts:203` — break). And `effective_status` rollup states (`CAMPAIGN_PAUSED`, `ADSET_PAUSED`, `WITH_ISSUES`, `DISAPPROVED`) have **no home in the type at all**, so an ad that's actually `DISAPPROVED` or `WITH_ISSUES` will be read as whatever its writable `status` says (often `ACTIVE`) — the engine will happily recommend scaling a disapproved ad.

**Recommendation:** (1) Add `effectiveStatus` to `Ad`/`AdSet`/`Campaign` and pull `effective_status` in the structure call — the engine should never scale/judge an entity whose `effective_status` is `DISAPPROVED/WITH_ISSUES/PENDING_REVIEW`. (2) Pull the ad-set `learning_stage_info` (or derive learning-limited from a live conversions-per-week query) explicitly in the live mapper, and document that `LEARNING_LIMITED` is a *derived* state, not a Graph status — the demo does this in a post-pass that the live path must replicate. Right now the docs imply `status` maps 1:1, which is false.

### B4 [MEDIUM] The insights pull omits `effective_status`, creative asset URLs, and the per-row attribution param — three things the live UI/engine need

- **`effective_status`** (see B3) — not in `INSIGHT_FIELDS` and not in the structure field list (`liveProvider.ts:182` requests only `name,objective,status,daily_budget,bid_strategy`).
- **Creative asset URLs.** The `Creative` type (`types.ts:140-156`) has `thumbnailGradient: [string,string]` and is explicitly "demo-only ... placeholder thumbnail" (`types.ts:146`). There is **no field for a real image/video URL, image_hash, video_id, object_story_spec, or asset_feed_spec.** The Creative Lab screen (`creative.ts`, and the gallery noted in the ledger) renders gradients. Live, the operator will expect to *see the actual ad* — but the type has nowhere to put `image_url`/`thumbnail_url`/`video_id`, and the structure call (`liveProvider.ts`) never requests `/adcreatives` at all (the scaffold's structure pull is a single `/campaigns` call). So the Creative Lab will render gradient placeholders against real creative names — visually broken/confusing on live data.
- **`action_attribution_windows`** is never sent on the insights call (`liveProvider.ts:185-189` passes `level, time_increment, fields, time_range` only). That's *defensible* (default 7d-click+1d-view is the recommended DTC setting, research §3.5), but the doc's go-live checklist says "Attribution windows set intentionally" (`META_INTEGRATION.md:149`) while the code provides no parameter or config field to set them. There's a `windowDays` in `LiveConfig` but no `attributionWindows`. So "set intentionally" is not actually wireable without a code change.

**Recommendation:** Add to `Creative`: `thumbnailUrl?`, `videoId?`, `assetUrl?` (and request `creative{id,thumbnail_url,object_story_spec,asset_feed_spec,effective_object_story_id}` per research §1.2). Add `effectiveStatus` to the three entity types and to the structure field lists. Add `attributionWindows?: string[]` to `LiveConfig` and thread it into the insights params.

### B5 [MEDIUM] Synchronous per-account day-loop will exceed sync limits and trip CPU rate-limits for large accounts; async report jobs are documented but not wired

`loadSnapshot` loops accounts and, per account, fires one `/insights` call with `level=ad, time_increment=1` over `windowDays` (default **90**, per `META_INTEGRATION.md:70` example and demo `WINDOW_DAYS=90`). For a real DTC account with hundreds of ads × 90 daily rows, that's tens of thousands of rows paged 200 at a time through a **synchronous fetch loop** (`graphGet`). The research doc is explicit (§6.2) that wide ranges / many rows should use **async insight report jobs** and that sync pulls "would time out." The error message at `liveProvider.ts:124-126` even *tells the user* to "use async insight report jobs" — but **no async-job code path exists.** Same for rate limits: the doc stresses parsing `X-Business-Use-Case-Usage` on every response and backing off (§6.1); `graphGet` reads **no response headers at all** (`liveProvider.ts:115-121` only checks `res.ok`). So the very first large-account live pull risks (a) timing out, and (b) blowing the `ads_insights` CPU bucket with no backoff, getting throttled for `estimated_time_to_regain_access` minutes with no graceful handling.

This is "correct scaffold, unfinished" rather than "wrong data" — but it's the unfinished piece most likely to make the *first* live load fail for the operator's bigger clients (Forge at $240k/mo, Lumière at $180k/mo per `catalog.ts`).

**Recommendation:** Before go-live on any account with >~50 active ads or >30-day windows, implement the async job path (POST → poll `async_status` until `Job Completed` → GET `/insights`, research §6.2) and add a `parseBucUsage(headers)` backoff in `graphGet`. At minimum, chunk the time_range and cap concurrency. The scaffold should not be flipped to live on the large accounts as-is.

### B6 [MEDIUM] currency_offset is hard-coded from a static list, but the research doc says source it per-account — and `TWD`/`HUF` are placed in the wrong bucket here

`currencyOffset()` (`liveProvider.ts:259-266`) is a static map: `ZERO_DECIMAL` includes `TWD` and `HUF`. But the research doc explicitly flags (§gotcha-3 and §8) that **"TWD/HUF diverge from raw ISO-4217 — prefer per-account `currency_offset`"** over a hand-maintained list. ISO-4217 has TWD and HUF as 2-decimal currencies, yet Meta's `currency_offset` for them historically diverges — which is *exactly why the doc says don't hand-maintain the list.* The code's own comment (`liveProvider.ts:257-258`) admits "Source from the account in production; this map is the documented fallback" — but `loadSnapshot` pulls `name,currency,timezone_name` (`liveProvider.ts:170`) and **never requests `currency_offset`**, so the per-account source the comment promises is not available, and the fallback list is the only path — with TWD/HUF in a bucket the research doc warns is wrong. For a US-only book (all 7 demo clients are USD, `catalog.ts`) this never bites; the moment a non-USD client is added it can mis-scale a budget write by 100×.

**Recommendation:** Add `currency_offset` to the account fields request and store it on `AdAccount`; use the live value, falling back to the static map only if absent. Drop TWD/HUF from `ZERO_DECIMAL` (they are not zero-decimal) — keeping them there is an active bug for those currencies, not a conservative default.

### B7 [MEDIUM] In-browser token + CORS: the documented backend proxy is *necessary but the code can't use it without an edit*, and `checkConnection` will CORS-fail from the browser

The docs are honest that the browser must not hold the token and that a backend proxy is required (`META_INTEGRATION.md:50-54, 116-126`; `llm.ts:11-14`). Good. But two concrete gaps:
1. **`GRAPH_BASE` is a hard-coded constant** (`liveProvider.ts:25`) pointing at `graph.facebook.com`. The doc says "point `GRAPH_BASE` at your proxy" (`META_INTEGRATION.md:124-126`) — but it's not configurable (not in `LiveConfig`, not an env read). Repointing requires editing source. Minor, but it means the proxy story is "edit the code," not "configure it."
2. **`graph.facebook.com` does not send permissive CORS headers for browser `fetch`.** The Settings "Test connection" button (`SettingsScreen.tsx:19-25`) calls `LiveProvider.checkConnection()` which `fetch`es `graph.facebook.com` directly (`liveProvider.ts:146`). Run from the browser against the real Graph base, this will **fail with a CORS error**, not a clean "bad token" — so the operator testing a token in the UI before standing up the proxy will get a confusing failure, and the friendly `checkConnection` detail string will be a CORS message. The whole live path only works *through the proxy*; the UI affords entering a token and testing it directly, which can't work. The token input field (`SettingsScreen.tsx:66-72`) reinforces the "paste a token in the browser" mental model the docs correctly warn against.

**Recommendation:** Make `GRAPH_BASE` come from `LiveConfig`/env (default to the proxy path `/api/meta`). Gate the "Test connection" button on a configured proxy, or make `checkConnection` hit the proxy health route, so the UX matches the only architecture that works. Consider removing the in-browser token input entirely (the field invites the anti-pattern the docs forbid).

### B8 [LOW] `clicks` semantics differ (broad clicks vs link clicks) but the app never trusts the wrong one — non-issue, flagged for completeness

`INSIGHT_FIELDS` pulls both `clicks` and `inline_link_clicks` (`liveProvider.ts:46, 48`), maps `clicks`→`clicks` and `inline_link_clicks`→`linkClicks` (`liveProvider.ts:197-199`). Research §3.2 warns `clicks` is "broad — includes reactions, comments, page-likes." The engine derives CTR from **`linkClicks/impressions`** (`metrics.ts:35`) and CVR from `purchases/linkClicks` (`metrics.ts:42`), never from `clicks`. So the broad-vs-link distinction is handled correctly; `clicks` is only stored, not used in any rate. No action needed beyond confirming `clicks` stays out of rate math.

### B9 [LOW] Timezone is hard-coded to `America/New_York` on fallback; account TZ governs Insights date ranges

`loadSnapshot` defaults `timezone: 'America/New_York'` if the node lacks one (`liveProvider.ts:178`), and `isoDaysAgo` builds the `since`/`until` window in **UTC** (`liveProvider.ts:268-272`). Research §gotcha-5 is explicit that `date_preset`/`time_range` are interpreted in the **account's timezone**, and that mixing UTC windows shifts daily totals vs Ads Manager. With a UTC-built window against an account on PST/JST, day boundaries will be off by hours — the per-day rows will be slightly misattributed at the edges. For roll-ups over a window the totals are nearly right; for the single-day presets (`today`/`yesterday`, which the UI offers, `metrics.ts:136-141`) the boundary error is material and will disagree with Ads Manager.

**Recommendation:** Build the insights `time_range` in the account timezone (the field is already pulled as `timezone_name`), not UTC. Document that single-day views are account-TZ.

### B10 [NOTE] `account_status` vs `account_status` field, and `act_` prefix handling — verified fine

`checkConnection` requests `name,currency,account_status` (`liveProvider.ts:146`) — valid fields. The `LiveAccountConfig.adAccountId` is documented as `act_<id>` (`liveProvider.ts:60`) and used directly in paths (`liveProvider.ts:146, 168, 182, 185`), consistent with research §1.3 (only the ad account carries the `act_` prefix; it's required in paths). Write POSTs target bare entity IDs (`liveProvider.ts:238`) — correct, since campaign/adset/ad IDs are unprefixed. No prefix bug. Note only: there's no validation that a configured `adAccountId` actually starts with `act_`; a fat-fingered bare ID in Settings would 400 with a raw Graph error.

---

## C. Field-name / action_type / metric cross-check (the specific things asked for)

| Concern | Status | Evidence |
|---|---|---|
| `omni_purchase` + fallback | ✅ correct | `liveProvider.ts:31-32, 200-201` |
| `action_values` for revenue | ✅ correct | `liveProvider.ts:201` |
| `purchase_roas` requested but **unused** | ⚠️ pulled in `INSIGHT_FIELDS` (`:48`) but never read in the mapper; ROAS is re-derived from revenue/spend in `metrics.ts:39`. Fine (re-derivation is more robust), but the field is dead weight in the request. |
| `website_purchase_roas` | ➖ not used; acceptable (omni is the standard) |
| video metrics (`video_play_actions`, `video_3_sec_watched_actions`, `video_thruplay_watched_actions`) | ✅ field names match research §3.2; extracted via `actionVal(..., 'video_view')` (`liveProvider.ts:204-206`) — ⚠️ **verify the inner `action_type` key**: these arrays are keyed, and the key for `video_play_actions` is typically `video_view`, but `video_thruplay_watched_actions`/`video_3_sec_watched_actions` inner action_type is also commonly `video_view` — this is plausible but is the kind of thing that returns 0 if the key is actually e.g. `video_view` vs a variant. Worth a one-row live spot-check; if wrong, hook/hold rates read 0 and all video diagnoses (`creative.ts:72-79`) break silently. |
| `cost_per_action_type` requested but unused | ➖ CPA re-derived in `metrics.ts:38`. Fine. |
| `outbound_clicks` requested but unused | ➖ dead field in request |
| attribution-window config | ❌ not wireable (B4) |
| currency_offset sourcing | ⚠️ static + TWD/HUF mis-bucketed (B6) |
| multi-BM token routing | ✅ correct (B-A3) |
| pagination | ✅ correct, fail-loud (B-A2) |
| async report jobs | ❌ not implemented (B5) |
| rate-limit headers | ❌ not read (B5) |

The single highest-leverage live-correctness risk in this table is the **video `action_type` inner-key assumption** (silent-zero) plus the **reach-additivity bug (B1)** — both produce plausible-looking-but-wrong numbers rather than errors.

---

## D. Correct-scaffold vs will-produce-wrong-data summary

**Correct scaffold, just unfinished** (won't lie, will error or no-op until built): B2 (structure mapping + indexes), B5 (async/rate-limit), B7 (proxy/CORS wiring), B4-attribution-param. These are honest gaps the ledger broadly acknowledges (though it understates B2/B5's size).

**Will produce *wrong data* once wired** (the dangerous class — looks fine, is incorrect): **B1 (reach additivity → frequency wrong → fatigue/scale rules misfire)**, **B3 (no LEARNING/effective_status from Graph → consolidation goes quiet, disapproved ads judged as active)**, **B6 for non-USD (100× budget mis-scale on TWD/HUF)**, **C-video-action-key (silent-zero hook/hold rate)**, **B9 single-day TZ boundary**. None of these throw; all silently degrade the product's core judgments. These are *not* surfaced in the ledger and are the real contribution of this lane.

**Net:** the seam architecture is right and the author understood the API. But "plug in tokens and it maps cleanly" is **not** true today — between the unfinished structure layer and ~5 silent data-correctness mismatches, the operator should treat live mode as needing a focused engineering pass (est. the structure/index assembler + reach/frequency rethink + effective_status/learning + async jobs), not a config flip. The demo is a faithful *shape*; it is not a faithful *semantics* of live Meta data in two specific places (reach, learning state) that the engine leans on.
