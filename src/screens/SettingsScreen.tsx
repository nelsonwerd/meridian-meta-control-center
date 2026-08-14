import { Fragment, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, Cpu, Minus, Plug, Plus, RefreshCw, RotateCcw, ServerCog, Sliders, Workflow } from 'lucide-react'
import { PageHeader } from '../components/blocks/PageHeader'
import { Avatar, SectionHeader, Segmented } from '../components/ui/primitives'
import { useSnapshot } from '../app/hooks'
import { useStore } from '../app/store'
import { createProvider, getProviderMode, type ProviderMode } from '../lib/provider'
import { API_VERSION, loadLiveConfig, saveLiveConfig, type LiveConfig } from '../lib/provider/liveProvider'
import { ensureClientCosmetics, normalizeAdAccountId } from '../lib/provider/liveMap'
import { WINDOW_DAYS } from '../lib/demo/generate'
import { isLlmEnabled, NARRATIVE_MODEL, PROXY_ENDPOINT, setLlmEnabled, STRATEGY_MODEL } from '../lib/ai/llm'
import { EDITABLE_THRESHOLDS, THRESHOLDS, effectiveThresholds, type Preset } from '../lib/ai/thresholds'
import { breakevenRoas } from '../lib/metrics'
import { fmtRoas } from '../lib/format'
import type { ClientConfig } from '../lib/config'
import { cn } from '../lib/cn'

/** One editable row of the live account mapping. All non-secret: the Graph
 *  token NEVER passes through the browser — it lives in the proxy's env. */
interface LiveRow {
  clientId: string
  clientName: string
  adAccountId: string
  businessId: string
  businessName: string
  businessType: 'agency' | 'partner'
  purchaseActionType: string
}

function initialRows(snapshot: ReturnType<typeof useSnapshot> & object): LiveRow[] {
  const saved = loadLiveConfig()
  if (saved && saved.accounts.length > 0) {
    return saved.accounts.map((a) => ({
      clientId: a.clientId,
      clientName: saved.clients.find((c) => c.id === a.clientId)?.name ?? a.clientId,
      adAccountId: a.adAccountId,
      businessId: a.businessId,
      businessName: a.businessName ?? '',
      businessType: a.businessType ?? 'agency',
      purchaseActionType: a.purchaseActionType ?? '',
    }))
  }
  // Template seeded from the demo roster — PLACEHOLDER ids the operator must
  // replace with real act_/business ids before live mode can connect.
  return snapshot.clients.map((c) => ({
    clientId: c.id,
    clientName: c.name,
    adAccountId: '',
    businessId: '',
    businessName: snapshot.businessManagers.find((b) => b.id === c.bmId)?.name ?? '',
    businessType: snapshot.businessManagers.find((b) => b.id === c.bmId)?.type ?? 'agency',
    purchaseActionType: '',
  }))
}

export function SettingsScreen() {
  const snapshot = useSnapshot()!
  const setThreshold = useStore((s) => s.setThreshold)
  const resetThresholds = useStore((s) => s.resetThresholds)
  const applyProviderMode = useStore((s) => s.applyProviderMode)
  const pushToast = useStore((s) => s.pushToast)
  const [mode, setMode] = useState<ProviderMode>(getProviderMode())
  const [rows, setRows] = useState<LiveRow[]>(() => initialRows(snapshot))
  const [windowDays, setWindowDays] = useState<number>(() => Math.max(56, loadLiveConfig()?.windowDays ?? WINDOW_DAYS))
  const [llmOn, setLlmOn] = useState(isLlmEnabled())
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null)
  const [proxyResult, setProxyResult] = useState<{ ok: boolean; detail: string } | null>(null)
  const [proxyTesting, setProxyTesting] = useState(false)

  /** Probe the backend token proxy (server/proxy.mjs → /healthz → Graph /me).
   *  This is the credential check now — the browser never holds a token. */
  const checkProxy = async () => {
    setProxyTesting(true)
    setProxyResult(null)
    try {
      const res = await fetch('/healthz')
      const body = (await res.json()) as { ok?: boolean; name?: string; error?: string }
      setProxyResult(
        body.ok
          ? { ok: true, detail: `Proxy up · Meta token valid — authenticated as ${body.name}.` }
          : { ok: false, detail: body.error ?? `Proxy responded ${res.status}.` },
      )
    } catch {
      setProxyResult({ ok: false, detail: 'Proxy unreachable — start it with `npm run proxy` (docs/META_INTEGRATION.md §5).' })
    }
    setProxyTesting(false)
  }

  const test = async () => {
    setTesting(true)
    setResult(null)
    const res = await createProvider(mode).checkConnection()
    setResult(res)
    setTesting(false)
  }

  const saveMapping = () => {
    // Validate BEFORE persisting: one blank act_/business id would brick live
    // boot with an opaque Graph error on the first node read. Only complete
    // rows are saved; incomplete ones are named loudly.
    const incomplete = rows.filter((r) => !r.adAccountId.trim() || !r.businessId.trim())
    if (incomplete.length > 0) {
      pushToast('error', `Not saved — ${incomplete.length} row(s) missing an ad account or business id: ${incomplete.map((r) => r.clientName || r.clientId).join(', ')}.`)
      return
    }
    // Catch a malformed ad account id HERE, with a clear message, rather than
    // 40 seconds into a live load as an opaque Graph "object does not exist".
    const badIds = rows.filter((r) => !normalizeAdAccountId(r.adAccountId))
    if (badIds.length > 0) {
      pushToast('error', `Not saved — ad account id must be digits (with or without the act_ prefix): ${badIds.map((r) => r.clientName || r.adAccountId).join(', ')}.`)
      return
    }
    if (rows.length === 0) {
      pushToast('error', 'Not saved — add at least one client row.')
      return
    }
    const prior = loadLiveConfig()
    const today = new Date().toISOString().slice(0, 10)
    const cfg: LiveConfig = {
      accounts: rows.map((r) => ({
        clientId: r.clientId,
        adAccountId: normalizeAdAccountId(r.adAccountId), // adds act_ if omitted
        businessId: r.businessId.trim(),
        businessName: r.businessName.trim() || undefined,
        businessType: r.businessType,
        purchaseActionType: r.purchaseActionType.trim() || undefined,
      })),
      // Client business inputs (targets/AOV/margin) keep their single editable
      // home (Targets & tuning below + ConfigStore); here we carry the roster
      // with names, merging any previously-saved or demo-known client rows.
      clients: rows.map((r) => {
        const known = prior?.clients.find((c) => c.id === r.clientId) ?? snapshot.clientById.get(r.clientId)
        return ensureClientCosmetics({ ...(known ?? {}), id: r.clientId, name: r.clientName || r.clientId }, today, windowDays, known?.currency ?? 'USD')
      }),
      windowDays,
    }
    saveLiveConfig(cfg)
    pushToast('success', 'Live mapping saved. Flip to Live (or reload) to use it.')
  }

  const apply = () => {
    if (mode === 'live') saveMapping()
    void applyProviderMode(mode)
  }

  const updateRow = (i: number, patch: Partial<LiveRow>) => {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  const addRow = () => {
    const n = rows.length + 1
    setRows((rs) => [...rs, { clientId: `client_${n}`, clientName: `Client ${n}`, adAccountId: '', businessId: '', businessName: '', businessType: 'agency', purchaseActionType: '' }])
  }
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i))

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
              <ServerCog className="h-4 w-4 text-ink-subtle" /> Backend token proxy
            </div>
            <p className="text-2xs leading-relaxed text-ink-subtle">
              The browser never holds a Meta token. All Graph traffic goes through the proxy
              (<span className="font-mono text-ink">npm run proxy</span>), which reads{' '}
              <span className="font-mono text-ink">META_SYSTEM_TOKEN</span> (and optional per-business{' '}
              <span className="font-mono text-ink">META_TOKENS</span>) from its environment.
              Setup: <span className="font-mono text-ink">docs/META_INTEGRATION.md</span>.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={checkProxy} disabled={proxyTesting} className="btn-outline py-1.5 text-xs">
                <ServerCog className="h-3.5 w-3.5" /> {proxyTesting ? 'Checking…' : 'Check proxy & token'}
              </button>
              <button onClick={test} disabled={testing} className="btn-outline py-1.5 text-xs">
                <Plug className="h-3.5 w-3.5" /> {testing ? 'Testing…' : 'Test Meta connection'}
              </button>
            </div>
            {proxyResult && (
              <div className={cn('flex items-start gap-2 rounded-lg p-2.5 text-xs', proxyResult.ok ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
                {proxyResult.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                {proxyResult.detail}
              </div>
            )}
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
            'Start the proxy with META_SYSTEM_TOKEN (npm run proxy)',
            'Enter real act_/business ids below & save the mapping',
            'Check proxy & test the Meta connection',
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

      {/* Live ad account mapping — EDITABLE (the live provider reads exactly this) */}
      <section className="card overflow-hidden">
        <div className="border-b border-line px-6 py-4">
          <SectionHeader
            eyebrow="Multi-BM"
            title="Live ad account mapping"
            subtitle="Real Meta ids for live mode: each client's act_ ad account + business manager id. Saved locally; tokens stay server-side in the proxy."
            action={
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-ink-muted" title="Minimum 56: the default 28-day view compares against the previous 28 days — a shorter pull would fabricate deltas and understate frequency/pacing.">
                  Window
                  <input
                    type="number"
                    min={56}
                    max={365}
                    value={windowDays}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (Number.isFinite(v) && v >= 56 && v <= 365) setWindowDays(v)
                    }}
                    className="input w-16 px-2 py-1 text-xs tabular-nums"
                  />
                  days
                </label>
                <button onClick={addRow} className="btn-ghost py-1.5 text-xs">
                  <Plus className="h-3.5 w-3.5" /> Add client
                </button>
                <button onClick={saveMapping} className="btn-outline py-1.5 text-xs">
                  Save mapping
                </button>
              </div>
            }
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-2xs uppercase tracking-wide text-ink-subtle">
                <th className="px-6 py-2.5 font-medium">Client</th>
                <th className="px-3 py-2.5 font-medium">Ad account ID</th>
                <th className="px-3 py-2.5 font-medium">Business ID</th>
                <th className="px-3 py-2.5 font-medium">Business name</th>
                <th className="px-3 py-2.5 font-medium">BM type</th>
                <th className="px-3 py-2.5 font-medium">Purchase event</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const known = snapshot.clientById.get(r.clientId)
                return (
                  <tr key={r.clientId + i} className="border-b border-line/60 last:border-0">
                    <td className="px-6 py-2">
                      <div className="flex items-center gap-2.5">
                        {known && <Avatar monogram={known.monogram} color={known.accentColor} size={26} />}
                        <input value={r.clientName} onChange={(e) => updateRow(i, { clientName: e.target.value })} className="input w-36 px-2 py-1 text-xs" />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <input value={r.adAccountId} onChange={(e) => updateRow(i, { adAccountId: e.target.value })} placeholder="act_1234567890" className="input w-36 px-2 py-1 font-mono text-xs" />
                    </td>
                    <td className="px-3 py-2">
                      <input value={r.businessId} onChange={(e) => updateRow(i, { businessId: e.target.value })} placeholder="123456789012345" className="input w-32 px-2 py-1 font-mono text-xs" />
                    </td>
                    <td className="px-3 py-2">
                      <input value={r.businessName} onChange={(e) => updateRow(i, { businessName: e.target.value })} placeholder="Agency BM" className="input w-32 px-2 py-1 text-xs" />
                    </td>
                    <td className="px-3 py-2">
                      <Segmented<'agency' | 'partner'>
                        size="sm"
                        value={r.businessType}
                        onChange={(t) => updateRow(i, { businessType: t })}
                        options={[
                          { value: 'agency', label: 'Agency' },
                          { value: 'partner', label: 'Partner' },
                        ]}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input value={r.purchaseActionType} onChange={(e) => updateRow(i, { purchaseActionType: e.target.value })} placeholder="omni_purchase" className="input w-36 px-2 py-1 font-mono text-xs" />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => removeRow(i)} aria-label="Remove client row" className="rounded-md p-1 text-ink-subtle hover:bg-surface-3 hover:text-ink">
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-6 py-3 text-2xs leading-relaxed text-ink-subtle">
          Partner-BM clients resolve their own token server-side via <span className="font-mono">META_TOKENS</span> keyed by business id;
          everything else uses the agency system-user token. Purchase event defaults to <span className="font-mono">omni_purchase</span>{' '}
          (pixel-only accounts: <span className="font-mono">offsite_conversion.fct.purchase</span>).
        </p>
      </section>

      <TargetsEditor />

      {/* AI analyst */}
      <section className="card p-6">
        <SectionHeader
          eyebrow="Intelligence"
          title="AI analyst"
          subtitle="Heuristics run with zero keys. LLM enrichment adds client-ready prose via the proxy (ANTHROPIC_API_KEY server-side) — it never changes the math."
          action={
            <Segmented<'on' | 'off'>
              size="sm"
              value={llmOn ? 'on' : 'off'}
              onChange={(v) => {
                const on = v === 'on'
                setLlmEnabled(on)
                setLlmOn(on)
              }}
              options={[
                { value: 'off', label: 'Heuristics only' },
                { value: 'on', label: 'LLM enriched' },
              ]}
            />
          }
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field icon={<Cpu className="h-4 w-4" />} label="Narrative model" value={NARRATIVE_MODEL} />
          <Field icon={<Cpu className="h-4 w-4" />} label="Weekly strategy model" value={STRATEGY_MODEL} />
          <Field icon={<Workflow className="h-4 w-4" />} label="Proxy endpoint" value={PROXY_ENDPOINT} />
          <Field
            icon={<Plug className="h-4 w-4" />}
            label="LLM enrichment"
            value={llmOn ? 'Enabled — needs proxy + key' : 'Off (heuristics only)'}
            tone={llmOn ? 'text-success' : undefined}
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

const clampMargin = (v: number) => Math.max(0.01, Math.min(0.99, v))

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'conservative', label: 'Cons' },
  { value: 'balanced', label: 'Bal' },
  { value: 'aggressive', label: 'Aggr' },
]

/** Per-client targets + engine tuning. Writes overrides through the store's
 *  ConfigStore — targets apply onto the snapshot Clients, thresholds/preset flow to
 *  the engine via effectiveThresholds — so Recommendations + Creative Lab re-score
 *  instantly for that client and persist. */
function TargetsEditor() {
  const snapshot = useSnapshot()!
  const clientConfig = useStore((s) => s.clientConfig)
  const setClientConfig = useStore((s) => s.setClientConfig)
  const resetClientConfig = useStore((s) => s.resetClientConfig)
  const [openTuning, setOpenTuning] = useState<string | null>(null)

  const update = (clientId: string, patch: Partial<ClientConfig>) => {
    const existing = clientConfig[clientId] ?? { clientId, updatedAt: '' }
    setClientConfig({ ...existing, ...patch, clientId, updatedAt: new Date().toISOString() })
  }
  const setOverride = (clientId: string, key: keyof typeof THRESHOLDS, value: number) => {
    update(clientId, { thresholdOverrides: { ...(clientConfig[clientId]?.thresholdOverrides ?? {}), [key]: value } })
  }

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line px-6 py-4">
        <SectionHeader
          eyebrow="Per client"
          title="Targets & tuning"
          subtitle="Each client's targets, economics, and engine aggressiveness. The engine scores every client against its OWN settings — edits re-derive every screen and persist."
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-2xs uppercase tracking-wide text-ink-subtle">
              <th className="px-6 py-2.5 font-medium">Client</th>
              <th className="px-3 py-2.5 font-medium">Target CPA</th>
              <th className="px-3 py-2.5 font-medium">Target ROAS</th>
              <th className="px-3 py-2.5 font-medium">Monthly budget</th>
              <th className="px-3 py-2.5 font-medium">AOV</th>
              <th className="px-3 py-2.5 font-medium">Margin</th>
              <th className="px-3 py-2.5 font-medium">Breakeven</th>
              <th className="px-3 py-2.5 font-medium">Engine preset</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {snapshot.clients.map((c) => {
              const cfg = clientConfig[c.id]
              const preset = cfg?.preset ?? 'balanced'
              const overrideCount = cfg?.thresholdOverrides ? Object.keys(cfg.thresholdOverrides).length : 0
              const open = openTuning === c.id
              return (
                <Fragment key={c.id}>
                  <tr className="border-b border-line/60">
                    <td className="px-6 py-2">
                      <div className="flex items-center gap-2.5">
                        <Avatar monogram={c.monogram} color={c.accentColor} size={26} />
                        <span className="font-medium text-ink">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2"><NumCell value={c.targetCPA} step={1} prefix="$" onCommit={(v) => update(c.id, { targetCPA: v })} /></td>
                    <td className="px-3 py-2"><NumCell value={c.targetROAS} step={0.1} suffix="×" onCommit={(v) => update(c.id, { targetROAS: v })} /></td>
                    <td className="px-3 py-2"><NumCell value={c.monthlyBudget} step={100} prefix="$" onCommit={(v) => update(c.id, { monthlyBudget: v })} /></td>
                    <td className="px-3 py-2"><NumCell value={c.avgOrderValue} step={1} prefix="$" onCommit={(v) => update(c.id, { avgOrderValue: v })} /></td>
                    <td className="px-3 py-2"><NumCell value={Math.round(c.contributionMargin * 100)} step={1} suffix="%" onCommit={(v) => update(c.id, { contributionMargin: clampMargin(v / 100) })} /></td>
                    <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-ink-muted">{fmtRoas(breakevenRoas(c.contributionMargin))}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Segmented<Preset> size="sm" value={preset} onChange={(p) => update(c.id, { preset: p })} options={PRESETS} />
                        <button
                          onClick={() => setOpenTuning(open ? null : c.id)}
                          aria-expanded={open}
                          title="Advanced threshold overrides"
                          className={cn('flex items-center gap-1 rounded-md px-1.5 py-1 text-2xs font-medium transition-colors', open ? 'bg-surface-3 text-ink' : 'text-ink-subtle hover:text-ink')}
                        >
                          <Sliders className="h-3 w-3" />
                          {overrideCount > 0 && <span className="text-brand">{overrideCount}</span>}
                          <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {cfg && (
                        <button
                          onClick={() => { resetClientConfig(c.id); if (open) setOpenTuning(null) }}
                          className="rounded-md px-2 py-1 text-2xs font-medium text-ink-subtle transition-colors hover:bg-surface-3 hover:text-ink"
                        >
                          Reset
                        </button>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-b border-line/60 bg-surface-2/40">
                      <td colSpan={9} className="px-6 py-4">
                        <div className="mb-3 text-2xs uppercase tracking-wide text-ink-subtle">
                          Advanced thresholds for {c.name} — override only what differs; blank/base falls through to the global default (and the preset)
                        </div>
                        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                          {EDITABLE_THRESHOLDS.map((t) => {
                            const overridden = cfg?.thresholdOverrides?.[t.key] !== undefined
                            return (
                              <div key={t.key} className="flex items-center justify-between gap-2">
                                <span className={cn('text-xs', overridden ? 'text-brand' : 'text-ink-muted')}>{t.label}</span>
                                <div className="flex items-center gap-2">
                                  <NumCell value={effectiveThresholds(c.id)[t.key]} step={t.step} onCommit={(v) => setOverride(c.id, t.key, v)} />
                                  <span className="w-20 text-right text-2xs text-ink-subtle">base {t.fmt(THRESHOLDS[t.key])}</span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-6 py-3 text-2xs leading-relaxed text-ink-subtle">
        A preset shifts the engine's aggression as a bundle; advanced overrides tune individual thresholds for this client only (most specific wins, over preset, over the global default). Everything re-scores Recommendations + Creative Lab live and persists.
      </p>
    </section>
  )
}

function NumCell({ value, step, prefix, suffix, onCommit }: { value: number; step: number; prefix?: string; suffix?: string; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value))
  // re-sync when the effective value changes externally (e.g. Reset)
  useEffect(() => setText(String(value)), [value])
  return (
    <div className="flex items-center gap-1">
      {prefix && <span className="text-2xs text-ink-subtle">{prefix}</span>}
      <input
        type="number"
        step={step}
        min={0}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const v = Number(e.target.value)
          if (Number.isFinite(v) && v > 0) onCommit(v)
        }}
        className="input w-20 px-2 py-1 text-xs tabular-nums"
      />
      {suffix && <span className="text-2xs text-ink-subtle">{suffix}</span>}
    </div>
  )
}
