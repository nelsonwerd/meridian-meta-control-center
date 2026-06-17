# Lane 4 — UX & Information Architecture Audit

**Auditor:** UX/IA specialist (only lane driving the live app)
**Date:** 2026-06-17
**App state:** DEMO mode, live preview @ 1440×900 (plus tablet 768 / mobile 375 responsive tests)
**Method:** Read every screen + component source; navigated all 7 routes + a single-client (Atlas) dashboard live; verified colors/sizes via `preview_inspect` and computed WCAG contrast ratios in-page; measured mobile overflow in px. Ground truth strongly favored over judgment.

---

## Verdict in one line

This is **genuinely premium, top-decile work that clears the "good" bar with room to spare — but it is not yet at the Linear/Vercel/Stripe award-winning bar**, held back by (1) a hard responsive failure below tablet, (2) a light-theme contrast regression that fails WCAG AA on all tertiary text, (3) a triage IA where 81% of recommendations are "priority" so severity stops sorting, (4) a dead-end daily-loop on the Campaigns screen, and (5) an apply-with-no-confirm/no-undo action model that is dangerous once live. The dark-theme desktop experience, the design-system primitives, the weekly client report, and the Creative Lab are excellent and should be left alone.

Is the UX **seamless** for the two core jobs?
- **(a) Daily optimization** — *Seamless where actions are surfaced* (Overview priority panel and `/recommendations` are 1-click from "problem" to "applied"). *Broken where the buyer scans structure* — the Campaigns table flags problems but offers no action and no deep-link, and `/recommendations` has no per-entity filter/search to land on the flagged entity. The loop has a gap in the middle.
- **(b) Weekly review** — *Excellent.* The Monday digest → per-client designed report is the strongest flow in the app and is client-presentable. Gaps: the report's "Export" is simulated (known), and you can't switch between clients' reports without leaving (see finding U7).

---

## What is EXCELLENT — leave it alone

| Area | Why it's already at the bar | Evidence |
|---|---|---|
| **Design-system primitives** | A real, disciplined token system: raw `R G B` triplets → Tailwind alpha, semantic surfaces (canvas/surface/2/3), `.btn`/`.card`/`.chip`/`.skeleton` component layer, tabular-nums on every metric, Inter with `cv02/cv03/cv11/ss01` features on. This is how premium teams build. | `src/index.css:11-151`, `tailwind.config.js` |
| **Dark-theme desktop** | Coherent "cockpit black" (#08090C canvas), restrained violet→teal brand gradient used sparingly, real shadow ramp (`soft`/`card`/`pop`/`glow`), 2xl radii. Reads as a designed product, not a dashboard template. | Overview/ClientDashboard screenshots |
| **Weekly client report** (`/report`) | Narrative headline + brand-gradient hairline + KPI delta grid w/ prior values + top movers + pacing ring + creative leaderboard. Genuinely sendable to a client. The single best screen. | `WeeklyReportScreen.tsx:98-208`; live Atlas report |
| **Creative Lab** | Cohort HBars by angle/format/batch + a real ad-ops "Next test batch: double-down / retire / test-ideas" panel + diagnosis-filtered gallery. This is a workflow, not a chart dump. | `CreativeLab.tsx`; live screenshot |
| **Scope switcher** | The navigation pivot shows **live per-client CPA with on-target coloring inside the dropdown** — you triage before you even click. Premium touch. | `ScopeSwitcher.tsx:77-99` |
| **KPI tiles & deltas** | Arrow follows sign, color follows good/bad, negligible-move guard, targets shown inline (`Target $58.00 ✓`). The delta semantics are unusually well-thought-through. | `primitives.tsx:102-114`, `KpiRow.tsx:24-39` |
| **Loading / error states** | `BootScreen` handles both the assembling state (shimmer bar) and a real error with a recovery action ("Return to demo mode"). Empty states exist on every list. | `BootScreen.tsx`, `EmptyState` usage |
| **Dark-theme contrast** | Verified, not assumed: ink-subtle = **6.43:1** on canvas, ink-muted **8.13:1**, ink **17.29:1**. Comfortably AA/AAA. The "~5:1" code comment understates it. | computed in-page |

---

## Findings (highest-impact first)

### U1 — Mobile/narrow layout collapses: 300px horizontal overflow, KPI values clipped to "$9" — HIGH
At 375px the sidebar stays a **fixed 244px** (no responsive collapse or drawer), squeezing main content to a **131px column** with **300px of horizontal page overflow** (`scrollWidth 675` vs `clientWidth 375`). The first KPI card measures **39.5px wide** — values render as "Spe/$9", "Ord/21", "CPA/$4", "ROA/1.". The spend-allocation donut collapses to legend-only.
- **Verified:** `aside` computed `width:244px` at 375px viewport; `main` bounding width 131px; first `.card` 39.5px; `document.scrollWidth` 675 vs clientWidth 375.
- **Root cause:** `Sidebar.tsx:33-36` width is driven only by `collapsed` state — no `md:`/`lg:` breakpoint to hide or drawer it; `AppShell.tsx:26` renders it unconditionally.
- The ledger lists "mobile-native" as out of scope — fair — but this is the **responsive web** breaking, not native. It looks broken (sideways scroll, clipped text), not gracefully degraded. A buyer glancing on a phone or in a split-screen will see garbage.
- **Recommendation:** below `lg`, collapse the sidebar to icons automatically and/or move it to an off-canvas drawer behind a hamburger in the TopBar; make the KPI grid `grid-cols-1` under ~420px; let the donut stack above its legend. Even an icon-rail at <1024px would resolve most of it.

### U2 — Light theme fails WCAG AA on ALL tertiary text — HIGH
`--ink-subtle` in light theme is `rgb(134 142 156)`, giving **3.03:1 on canvas** and **3.30:1 on surface** — below the 4.5:1 AA threshold for normal text. `text-ink-subtle` is the workhorse for eyebrows, captions, table sub-labels, "prior" values, vertical labels, the secondary-stat strip, donut legend %, creative metric labels — it's everywhere.
- **Verified:** computed in-page against the light tokens in `index.css:43-45`. Dark-theme ink-subtle is fine (6.43:1); only the **light** counterpart regresses. Two prior rounds checked dark and missed this.
- **Recommendation:** darken light-theme `--ink-subtle` to ≥ `rgb(107 114 128)` (slate-500, ~4.6:1 on white) — or stop using ink-subtle for primary captions in light mode. Low-effort, high-coverage fix (one token).

### U3 — Severity tier is non-functional: 64 of 79 recommendations are "priority" — HIGH (IA / signal design)
`/recommendations` summary tiles read **Critical 3 · High 61 · Medium 9 · Low ~6**. So **77% of items are "High" and 81% are critical-or-high.** When nearly everything is top-priority, severity stops being a triage signal — the buyer cannot use it to decide what to do first, which defeats the purpose of a command center whose whole pitch is "scan → spot → act."
- **Verified:** live tile counts + Overview badge "64 priority actions" (=critical+high) computed in `PortfolioOverview.tsx:56`.
- This is a **UX/IA** problem (the distribution makes the control useless), distinct from whether each threshold is individually correct (AI-engine lane). Even if every "high" is defensible, presenting 61 of them flat is the failure.
- **Recommendation:** (1) re-tier so "High" is a genuine minority (e.g. reserve high for spend-at-risk above a $ threshold or confidence≥0.85); (2) default-sort by an **impact score** (projected $/day recovered or orders gained), not severity; (3) the Recommendations list currently offers **only filters, no sort** — add a sort and a "Top 10 by impact" default view. A buyer with 10 minutes should see the 10 that move the most money, not 79 cards in snapshot order.

### U4 — Campaigns screen is a daily-loop dead-end — HIGH (workflow)
The Campaigns table flags AI-touched rows with a sparkle icon + tooltip "N AI recommendations" (`Campaigns.tsx:226-230`) but the row is **not clickable to act**, there's **no inline action**, and there's **no link from the flag to the recommendation**. So the natural scan path — buyer drills into structure, sees a flagged campaign — terminates: to act they must memorize the entity, navigate to `/recommendations`, and **visually hunt 79 cards** (no entity search/filter there either).
- **Verified:** read full `Campaigns.tsx`; expanded a row live (drill-down works, but no action affordance anywhere in the row).
- **Recommendation:** make the sparkle a link that deep-links into `/recommendations?entity=<id>` (and add that filter), or render the entity's suggestion(s) in an expandable drawer on the row with the same inline Apply button used on the cards. This closes the loop where buyers actually look.

### U5 — Apply fires immediately: no confirmation, no undo — HIGH (safety, surfaces in live)
`applySuggestion` (`store.ts:113-144`) executes on a single click — including "Pause ad" and "Raise to $2990/day" (a 20% budget increase). There is **no confirm dialog and no undo**. The dismiss "X" is likewise irreversible. In demo this is harmless; in **live** mode this same one click is a real Meta write that pauses a campaign or moves budget, with no "are you sure" and no rollback.
- **Verified:** `store.ts:127` calls `provider.applyAction` straight from the card's `onClick`; no guard. `SuggestionCard.tsx:104-111` wires X→dismiss and the button→apply with no intermediate.
- **Recommendation:** for write actions (non-`none` kind), gate behind a lightweight confirm (inline "Confirm pause?" two-step, or a modal showing the exact change), and add an **Undo** affordance in the success toast (you already log to `applied[]` — you have the data to reverse). This is the difference between a demo and a tool a team trusts with budgets.

### U6 — No screen-reader announcement for applied actions; no skip-link; no focus move on route change — MEDIUM (accessibility)
A repo-wide grep for `aria-live | role="status" | role="alert" | sr-only | skip` returns **zero matches.** Consequences:
- **Toasts** (`Toasts.tsx`) are visual-only — "Pause applied" is never announced. The entire action-confirmation channel is invisible to SR users.
- **No skip-to-content** — keyboard/SR users tab the full 7-item sidebar on every page.
- **Route change** remounts `main` with `key={location.pathname}` + a fade (`AppShell.tsx:29`) but **does not move focus** to the new content, so keyboard users lose their place and SR users aren't told the page changed.
- **Recommendation:** wrap the Toasts container in `role="status" aria-live="polite"`; add a visually-hidden skip link as the first focusable element; on route change, move focus to the `<h1>`/main and reset scroll.

### U7 — Weekly report: can't switch clients without leaving; client dashboards aren't deep-linkable — MEDIUM (IA)
Two related IA gaps for the weekly-review job:
- On `/report`, the "Back to all reports" button only renders when `clients.length > 1` (`WeeklyReportScreen.tsx:30`). Under a **client scope**, `clientsForScope` returns 1, so a buyer reviewing client-by-client has **no in-screen way to jump to the next client's report** — they must reopen the scope switcher.
- Every client view lives at path `/` (clicking a client card calls `setScope` then `navigate('/')`, `ClientsDirectory.tsx:41-44`; router has no `/clients/:id`). So **a client dashboard or report can't be bookmarked, shared, or reached via browser back/forward** — which is exactly what you want for a weekly review you revisit and send.
- **Verified:** Atlas dashboard and report both rendered at `path:"/"`; router has only 7 static routes (`router.tsx`).
- **Recommendation:** add real client routes (`/clients/:id`, `/report/:id`) so views are linkable; always show a client picker on the report (prev/next or a dropdown) regardless of scope cardinality.

### U8 — CPA HBars are visually backwards: worst performer = longest bar — MEDIUM (chart legibility)
In Creative Lab cohort bars, width = `value/max` regardless of metric direction (`HBars.tsx:14,29`). For **CPA (lower is better)** the worst angle (highest CPA — "Social Proof $73.44") gets the **longest** bar. Color carries some of the message (amber when over target), but length is the dominant pre-attentive cue and it points the wrong way — a scanner reads "longest = most = best."
- **Verified:** read `HBars.tsx` + `CreativeLab.tsx:49-61`; confirmed in the live chart (Social Proof longest, Lifestyle/winner shortest).
- **Recommendation:** for lower-is-better metrics, invert (bar = headroom under target, or `1 − value/max`) so the best cohort is the longest/fullest bar, or switch CPA to a "distance from target" encoding. Keep CTR/Orders as-is.

### U9 — Dead `text-amber` class: "Fatigue" chip renders white instead of amber — LOW (polish, survived 2 rounds)
`SuggestionCard.tsx:26` sets `CREATIVE_FATIGUE` tone to `text-amber bg-warning/10`, but **`amber` is not a defined Tailwind color** (the config only exposes `warning/success/...`; `amber` lives in `palette.ts` as a JS constant, not a Tailwind token). So the class is a no-op and the chip text falls back to inherited ink.
- **Verified:** live computed color of the "Fatigue" chip is `rgb(236 239 245)` (ink white), not amber — every other suggestion-type chip uses a valid color token. Inconsistent.
- **Recommendation:** change to `text-warning` (or add an `amber` token). One-character class fix.

### U10 — Dropdowns lack ARIA state and full keyboard semantics — MEDIUM (accessibility)
ScopeSwitcher and DateRangeMenu close on outside-click and Escape (good, `useClickOutside.ts:11`) but the triggers have **no `aria-haspopup`/`aria-expanded`**, the popovers have **no `role="menu"`**, and there's **no arrow-key navigation or focus trapping**. Functional for mouse and basic tab, weak for assistive tech and power keyboard use.
- **Recommendation:** add `aria-haspopup="menu"` + `aria-expanded`, `role="menu"`/`menuitem`, and arrow-key roving focus. Or adopt a headless menu primitive (Radix/Headless UI) to get this for free.

### U11 — Native date inputs force dark color-scheme in light theme — LOW (polish)
`DateRangeMenu.tsx:71,80` hardcodes `[color-scheme:dark]` on both `<input type="date">`. In **light** theme the native calendar popup/icon render dark, clashing with the light UI.
- **Recommendation:** drive color-scheme from theme (`dark:[color-scheme:dark]` / `[color-scheme:light]`) or rely on the body `color-scheme` which already flips in `index.css`.

### U12 — No global search / command palette — LOW-to-MEDIUM (vs the premium bar)
For a tool spanning 7 clients / 26 campaigns / 250 ads, there is no ⌘K to jump to a client, campaign, or recommendation; the only keyboard affordance is Esc-to-close on menus. The Linear/Vercel reference bar treats ⌘K as table stakes. Not a defect, but it's the clearest single feature separating this from the "award-winning" tier for a power-user internal tool.
- **Recommendation:** add a ⌘K palette (jump-to-client, jump-to-recommendation, run an apply). High perceived-quality return for a daily-driver tool.

---

## Dimension-by-dimension scorecard

| Dimension | Grade | Note |
|---|---|---|
| Visual hierarchy | A | Eyebrow→title→subtitle rhythm consistent; clear primary action per page |
| Spacing rhythm | A− | Consistent 3/4/5/6 gap scale, 2xl card radii; tight and intentional |
| Typography | A | Inter + cv/ss features, tabular-nums everywhere, disciplined size ramp |
| Color/contrast (dark) | A | Verified 6.43–17.3:1; excellent |
| Color/contrast (light) | C | U2 — ink-subtle fails AA at 3.0–3.3:1 |
| Chart legibility | B | Trend/tooltip/donut excellent; U8 CPA-bar direction backwards |
| Density | A− | Drill-downs and stat strips dense but legible; good restraint |
| Motion | A− | Route fade, ring/shimmer easing tasteful; no focus move on transition (U6) |
| Empty/loading/error | A | BootScreen + EmptyState cover all three; recovery action present |
| Responsive | D | U1 — breaks hard below tablet, 300px overflow |
| Keyboard/a11y | C+ | Esc + aria-labels present; missing live regions, skip link, focus mgmt, menu ARIA |
| Daily-loop friction | B− | 1-click where surfaced; dead-ends on Campaigns; no impact sort; no confirm/undo |
| Weekly-review flow | A− | Best-in-app; held back only by no client-switcher + no deep-link + simulated export |

---

## Daily-optimization click-count (measured against the real UI)

- **Best path (Overview priority panel or `/recommendations`):** problem → fixed in **1 click** (inline Apply on the card). Excellent.
- **Scan-structure path (Campaigns):** spot flagged row → **dead end** (no action, no link) → manual nav to `/recommendations` → **visual hunt through 79 cards** (no entity filter). Effectively unbounded. This is the loop's weak link (U3 + U4).
- **Net:** the *mechanics* of acting are best-in-class; the *path to the right action when scanning* is where the friction lives. Fixing U3 (impact sort/top-N) and U4 (deep-link from flag) would make the whole loop seamless.

---

## Ground truth

10 of 12 load-bearing conclusions externally verified (code read AND/OR measured live); 2 are reasoned judgment (U3 "severity is non-functional" — counts verified, the *usability* claim is judgment; U12 — absence verified, the "premium bar" framing is judgment). Specifically verified: U1 (px-measured overflow/widths live), U2 (contrast computed in-page), U4 (source + live row), U5 (store source), U6 (repo-wide grep = 0), U7 (live paths + router), U8 (source + live chart), U9 (live computed chip color), U11 (source). Dark-theme contrast and the "what's excellent" claims were verified by inspect/computation, not screenshot color.
