import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Cpu, KeyRound, Plug, RefreshCw, RotateCcw, Sliders, Workflow } from 'lucide-react'
import { PageHeader } from '../components/blocks/PageHeader'
import { Avatar, Chip, SectionHeader, Segmented } from '../components/ui/primitives'
import { useSnapshot } from '../app/hooks'
import { useStore } from '../app/store'
import { createProvider, getProviderMode, setProviderMode, type ProviderMode } from '../lib/provider'
import { API_VERSION } from '../lib/provider/liveProvider'
import { NARRATIVE_MODEL, PROXY_ENDPOINT, STRATEGY_MODEL, USE_LLM } from '../lib/ai/llm'
import { EDITABLE_THRESHOLDS, THRESHOLDS } from '../lib/ai/thresholds'
import { cn } from '../lib/cn'

export function SettingsScreen() {
  const snapshot = useSnapshot()!
  const setThreshold = useStore((s) => s.setThreshold)
  const resetThresholds = useStore((s) => s.resetThresholds)
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
    <div className="space-y-6">
      <PageHeader eyebrow="Configuration" title="Settings" subtitle="Connect the Meta Marketing API and tune the AI analyst. Demo mode runs entirely on seeded data." />

      <div className="grid gap-6 lg:grid-cols-[1.55fr_1fr]">
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

      {/* Integration checklist — fills the column, useful in both modes */}
      <aside className="card flex flex-col p-6">
        <SectionHeader eyebrow="Go-live" title="Turn the lights on" subtitle="The path from demo to live data." />
        <ol className="mt-4 space-y-2.5 text-sm">
          {[
            'Create the Meta app + System User (agency BM)',
            'Accept Partner access for client-owned BMs',
            'Map clients → ad accounts below',
            'Stand up a backend token proxy',
            'Finish LiveProvider structure mapping (last-mile)',
            'Flip to Live & reload',
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-2.5 text-ink-muted">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface-3 text-2xs font-semibold text-ink">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
        <p className="mt-4 border-t border-line pt-3 text-2xs leading-relaxed text-ink-subtle">
          Full guide: <span className="font-mono text-ink-muted">docs/META_INTEGRATION.md</span>. The AI engine already runs on heuristics — no keys required.
        </p>
      </aside>
      </div>

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

      {/* Optimization rules — live-editable */}
      <section className="card p-6">
        <SectionHeader
          eyebrow="Tuning"
          title="Optimization thresholds"
          subtitle="Tune the rules the recommendation engine reasons with — changes re-score every screen instantly."
          action={
            <button onClick={() => resetThresholds()} className="btn-ghost py-1.5 text-xs">
              <RotateCcw className="h-3.5 w-3.5" /> Reset defaults
            </button>
          }
        />
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          {EDITABLE_THRESHOLDS.map((t) => (
            <div key={t.key}>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-sm text-ink-muted">
                  <Sliders className="h-3.5 w-3.5 text-brand" /> {t.label}
                </label>
                <span className="font-mono text-sm font-semibold tabular-nums text-ink">{t.fmt(THRESHOLDS[t.key])}</span>
              </div>
              <input
                type="range"
                min={t.min}
                max={t.max}
                step={t.step}
                value={THRESHOLDS[t.key]}
                onChange={(e) => setThreshold(t.key, Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-3 accent-brand"
              />
            </div>
          ))}
        </div>
        <p className="mt-5 text-2xs leading-relaxed text-ink-subtle">
          Directional defaults from agency best-practice (see <span className="font-mono text-ink">docs/research/adops-kpis-playbook.md</span>). The engine's calls are a signal a buyer weighs — not a backtested guarantee. Overrides persist on this device.
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
