import type { MetricsBundle, Suggestion } from '../types'

/* ============================================================================
   LLM narrative layer.

   The numeric judgement (scale/cut/fatigue/etc.) is deterministic and lives in
   ai/engine.ts — it works with zero API keys. This layer is the OPTIONAL
   enrichment: a Claude model turning the structured findings into sharper,
   client-ready prose. The math is never LLM-derived.

   Transport: the browser POSTs to the backend proxy (server/proxy.mjs →
   /api/ai/narrate), which holds ANTHROPIC_API_KEY server-side and forwards to
   the Anthropic Messages API. Without the key (or with enrichment toggled
   off), narrate() returns null and every caller falls back to the heuristic
   prose — graceful, honest degradation.
   ========================================================================== */

// Current Claude models (verified 2026-08-11). Sonnet 5 is the cost/latency-
// balanced default for narrative; Opus 5 for the deepest weekly strategy read.
export const NARRATIVE_MODEL = 'claude-sonnet-5'
export const STRATEGY_MODEL = 'claude-opus-5'

export const PROXY_ENDPOINT = '/api/ai/narrate'

/** Operator toggle (Settings → AI analyst). Off by default: heuristics carry
 *  the product; enrichment is opt-in and requires the proxy + an Anthropic key. */
const LLM_ENABLED_KEY = 'meridian.llm.enabled'

export function isLlmEnabled(): boolean {
  try {
    return localStorage.getItem(LLM_ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

export function setLlmEnabled(on: boolean) {
  try {
    localStorage.setItem(LLM_ENABLED_KEY, on ? '1' : '0')
  } catch {
    /* storage unavailable — stays off */
  }
}

export interface NarrativeContext {
  scope: string
  rangeLabel: string
  metrics: MetricsBundle
  previous?: MetricsBundle
  suggestions: Suggestion[]
  targetCPA?: number
  targetROAS?: number
  /** breakeven ROAS = 1 / contribution margin — the bar the system prompt judges
   *  ROAS against (instead of a global 3x). */
  breakevenRoas?: number
  contributionMargin?: number
}

/** Build the system + user prompt the proxy forwards to the Anthropic API. */
export function buildNarrativePrompt(ctx: NarrativeContext): { system: string; user: string } {
  const system = [
    'You are a senior Meta performance strategist at a DTC agency.',
    'You write tight, specific, numbers-first analysis for media buyers — no fluff, no hedging.',
    'Most accounts optimize for orders at the lowest CPA. Judge ROAS against breakeven, not a global 3x.',
    'Bias recommendations toward creative iteration over audience tinkering. Always cite the number that drives each claim.',
  ].join(' ')

  const m = ctx.metrics
  const lines = [
    `Scope: ${ctx.scope} · Window: ${ctx.rangeLabel}`,
    ctx.targetCPA ? `Target CPA: $${ctx.targetCPA} · Target ROAS: ${ctx.targetROAS}×` : '',
    // Give the model the breakeven bar its system prompt is told to judge against.
    ctx.breakevenRoas
      ? `Breakeven ROAS: ${ctx.breakevenRoas.toFixed(2)}×${ctx.contributionMargin ? ` (contribution margin ${Math.round(ctx.contributionMargin * 100)}%)` : ''} — judge ROAS against THIS, not a global 3x`
      : '',
    `Current: spend $${Math.round(m.spend)}, ${m.purchases} orders, CPA $${m.cpa.toFixed(2)}, ROAS ${m.roas.toFixed(2)}×, CTR ${m.ctr.toFixed(2)}%, freq ${m.frequency.toFixed(1)}`,
    ctx.previous ? `Prior: CPA $${ctx.previous.cpa.toFixed(2)}, ROAS ${ctx.previous.roas.toFixed(2)}×, orders ${ctx.previous.purchases}` : '',
    '',
    'Engine findings (already computed — do not recompute, synthesize):',
    ...ctx.suggestions.slice(0, 8).map((s) => `- [${s.severity}] ${s.title} — ${s.rationale}`),
    '',
    'Write: (1) a 2-sentence executive read, (2) the single most important action this week and why, (3) one risk the numbers hint at. Be concrete.',
  ]
  return { system, user: lines.filter(Boolean).join('\n') }
}

/** Enrich findings with an LLM narrative. Returns null when not configured so
 *  callers fall back to the heuristic prose (graceful, honest degradation). */
export async function narrate(ctx: NarrativeContext): Promise<string | null> {
  if (!isLlmEnabled()) return null
  try {
    const { system, user } = buildNarrativePrompt(ctx)
    const res = await fetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: NARRATIVE_MODEL, system, messages: [{ role: 'user', content: user }], max_tokens: 600 }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { text?: string }
    return data.text ?? null
  } catch {
    return null
  }
}
