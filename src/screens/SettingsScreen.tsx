import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Cpu, KeyRound, Plug, RefreshCw, Sliders, Workflow } from 'lucide-react'
import { PageHeader } from '../components/blocks/PageHeader'
import { Avatar, Chip, SectionHeader, Segmented } from '../components/ui/primitives'
import { useSnapshot } from '../app/hooks'
import { createProvider, getProviderMode, setProviderMode, type ProviderMode } from '../lib/provider'
import { API_VERSION } from '../lib/provider/liveProvider'
import { NARRATIVE_MODEL, PROXY_ENDPOINT, STRATEGY_MODEL, USE_LLM } from '../lib/ai/llm'
import { THRESHOLDS } from '../lib/ai/thresholds'
import { cn } from '../lib/cn'

export function SettingsScreen() {
  const snapshot = useSnapshot()!
  const [mode, setMode] = useState<ProviderMode>(getProviderMode())
  const [token, setToken] = useState('')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null)

  const test = async () => {
    setTesting(true)
    setResult(null)
    const res = await createProvider(mode).checkConnection()
    setResult(res)
    setTesting(false)
  }

  const apply = () => {
    setProviderMode(mode)
    location.reload()
  }

  const dirty = mode !== getProviderMode()

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader eyebrow="Configuration" title="Settings" subtitle="Connect the Meta Marketing API and tune the AI analyst. Demo mode runs entirely on seeded data." />

      {/* Connection */}
      <section className="card p-6">
        <SectionHeader eyebrow="Data source" title="Connection" subtitle="Flip to Live once your Meta credentials are in place." />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Segmented<ProviderMode>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'demo', label: 'Demo data' },
              { value: 'live', label: 'Live (Meta API)' },
            ]}
          />
          <span className="text-xs text-ink-muted">
            Graph API <span className="font-mono text-ink">{API_VERSION}</span>
          </span>
          {dirty && (
            <button onClick={apply} className="btn-primary ml-auto py-1.5 text-xs">
              <RefreshCw className="h-3.5 w-3.5" /> Apply & reload
            </button>
          )}
        </div>

        {mode === 'live' && (
          <div className="mt-4 space-y-3 rounded-xl border border-line bg-surface-2 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-ink">
              <KeyRound className="h-4 w-4 text-ink-subtle" /> System-user access token
            </div>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="EAAB… (set in your deployment's secret store, not here in production)"
              className="input font-mono text-xs"
            />
            <p className="text-2xs leading-relaxed text-ink-subtle">
              One agency System User token fans out across every client — including clients on their own Business Managers via Partner access.
              In production, store this server-side; the browser never holds it. See <span className="font-mono text-ink">docs/META_INTEGRATION.md</span>.
            </p>
            <button onClick={test} disabled={testing} className="btn-outline py-1.5 text-xs">
              <Plug className="h-3.5 w-3.5" /> {testing ? 'Testing…' : 'Test connection'}
            </button>
            {result && (
              <div className={cn('flex items-start gap-2 rounded-lg p-2.5 text-xs', result.ok ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
                {result.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                {result.detail}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Ad account mapping */}
      <section className="card overflow-hidden">
        <div className="border-b border-line px-6 py-4">
          <SectionHeader eyebrow="Multi-BM" title="Ad account mapping" subtitle="Each client maps to a Meta ad account under a business manager." />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-2xs uppercase tracking-wide text-ink-subtle">
                <th className="px-6 py-2.5 font-medium">Client</th>
                <th className="px-3 py-2.5 font-medium">Business manager</th>
                <th className="px-3 py-2.5 font-medium">Ad account ID</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.clients.map((c) => {
                const acct = snapshot.accountByClient.get(c.id)
                const bm = snapshot.businessManagers.find((b) => b.id === c.bmId)
                return (
                  <tr key={c.id} className="border-b border-line/60 last:border-0">
                    <td className="px-6 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar monogram={c.monogram} color={c.accentColor} size={26} />
                        <span className="font-medium text-ink">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Chip tone={bm?.type === 'agency' ? 'brand' : 'info'} className="px-2 py-0.5 text-2xs">{bm?.name}</Chip>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-ink-muted">{acct?.id}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* AI analyst */}
      <section className="card p-6">
        <SectionHeader eyebrow="Intelligence" title="AI analyst" subtitle="Heuristics run with zero keys; an LLM enriches the narrative when a proxy is wired." />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field icon={<Cpu className="h-4 w-4" />} label="Narrative model" value={NARRATIVE_MODEL} />
          <Field icon={<Cpu className="h-4 w-4" />} label="Weekly strategy model" value={STRATEGY_MODEL} />
          <Field icon={<Workflow className="h-4 w-4" />} label="Proxy endpoint" value={PROXY_ENDPOINT} />
          <Field
            icon={<Plug className="h-4 w-4" />}
            label="LLM enrichment"
            value={USE_LLM ? 'Enabled' : 'Scaffolded (needs proxy)'}
            tone={USE_LLM ? 'text-success' : 'text-warning'}
          />
        </div>
      </section>

      {/* Optimization rules */}
      <section className="card p-6">
        <SectionHeader eyebrow="Tuning" title="Optimization thresholds" subtitle="The rules the recommendation engine reasons with. Centralized so they're tunable per account." />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Rule icon={<Sliders className="h-4 w-4 text-success" />} label="Scale when CPA ≤" value={`${Math.round(THRESHOLDS.scaleCpaRatio * 100)}% of target`} />
          <Rule icon={<Sliders className="h-4 w-4 text-warning" />} label="Cut when CPA >" value={`${Math.round(THRESHOLDS.cutCpaRatio * 100)}% of target`} />
          <Rule icon={<Sliders className="h-4 w-4 text-brand" />} label="Scale step" value={`+${Math.round(THRESHOLDS.scaleStepPct * 100)}% / edit`} />
          <Rule icon={<Sliders className="h-4 w-4 text-danger" />} label="Fatigue frequency" value={`> ${THRESHOLDS.fatigueFrequency.toFixed(1)}`} />
          <Rule icon={<Sliders className="h-4 w-4 text-info" />} label="Min orders to judge" value={`${THRESHOLDS.minPurchasesToJudge}`} />
          <Rule icon={<Sliders className="h-4 w-4 text-teal" />} label="Confident scale at" value={`${THRESHOLDS.confidentPurchases} orders`} />
        </div>
        <p className="mt-4 text-2xs leading-relaxed text-ink-subtle">
          Directional defaults from agency best-practice (see <span className="font-mono text-ink">docs/research/adops-kpis-playbook.md</span>). The engine's calls are a signal a buyer weighs — not a backtested guarantee.
        </p>
      </section>
    </div>
  )
}

function Field({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <div className="flex items-center gap-2 text-2xs uppercase tracking-wide text-ink-subtle">
        <span className="text-ink-subtle">{icon}</span>
        {label}
      </div>
      <div className={cn('mt-1.5 font-mono text-sm', tone ?? 'text-ink')}>{value}</div>
    </div>
  )
}

function Rule({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <div className="flex items-center gap-2">{icon}<span className="text-2xs text-ink-muted">{label}</span></div>
      <div className="mt-1.5 text-sm font-semibold tabular-nums text-ink">{value}</div>
    </div>
  )
}
