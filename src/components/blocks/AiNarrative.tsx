import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { SectionHeader } from '../ui/primitives'
import { breakevenRoas } from '../../lib/metrics'
import { isLlmEnabled, narrate, NARRATIVE_MODEL, type NarrativeContext } from '../../lib/ai/llm'
import type { Client, MetricsBundle, Suggestion } from '../../lib/types'

/* The LLM-enriched analyst read (P6). Strictly ADDITIVE: renders nothing until
   the operator enables enrichment in Settings AND the proxy (with an Anthropic
   key) answers. The numbers and the engine's findings are computed upstream —
   the model only writes the prose. On any failure narrate() resolves null and
   this card silently disappears; the heuristic surfaces carry the product. */

export function AiNarrative({
  client,
  metrics,
  previous,
  suggestions,
  rangeLabel,
}: {
  client: Client
  metrics: MetricsBundle
  previous?: MetricsBundle
  suggestions: Suggestion[]
  rangeLabel: string
}) {
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isLlmEnabled()) {
      setText(null)
      return
    }
    let cancelled = false
    setLoading(true)
    const ctx: NarrativeContext = {
      scope: client.name,
      rangeLabel,
      metrics,
      previous,
      suggestions,
      targetCPA: client.targetCPA,
      targetROAS: client.targetROAS,
      breakevenRoas: breakevenRoas(client.contributionMargin),
      contributionMargin: client.contributionMargin,
    }
    narrate(ctx).then((t) => {
      if (!cancelled) {
        setText(t)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
    // metrics/suggestions are derived from snapshot+range upstream — keying on
    // the primitives avoids re-narrating on referentially-new-but-equal objects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id, rangeLabel, metrics.spend, metrics.purchases, suggestions.length])

  if (!isLlmEnabled() || (!text && !loading)) return null

  return (
    <section className="card p-6">
      <SectionHeader
        eyebrow="AI analyst"
        title="Strategist read"
        subtitle={`Narrative by ${NARRATIVE_MODEL} from the engine's findings — the numbers are computed, not generated.`}
      />
      {loading ? (
        <div className="mt-4 space-y-2">
          <div className="h-3 w-4/5 animate-pulse rounded bg-surface-3" />
          <div className="h-3 w-3/5 animate-pulse rounded bg-surface-3" />
        </div>
      ) : (
        <div className="mt-4 flex items-start gap-3">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink-muted">{text}</p>
        </div>
      )}
    </section>
  )
}
