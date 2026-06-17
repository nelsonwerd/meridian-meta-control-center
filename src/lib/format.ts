/* Number / currency / percent formatting. Tabular-friendly, compact where useful. */

export function fmtCurrency(v: number, opts: { compact?: boolean; decimals?: number; currency?: string } = {}): string {
  const { compact = false, decimals, currency = 'USD' } = opts
  if (!isFinite(v)) return '—'
  if (compact && Math.abs(v) >= 1000) {
    return (
      new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(v)
    )
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals ?? (Math.abs(v) < 100 ? 2 : 0),
    maximumFractionDigits: decimals ?? (Math.abs(v) < 100 ? 2 : 0),
  }).format(v)
}

export function fmtNumber(v: number, opts: { compact?: boolean; decimals?: number } = {}): string {
  const { compact = false, decimals = 0 } = opts
  if (!isFinite(v)) return '—'
  if (compact && Math.abs(v) >= 1000) {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
  }
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v)
}

export function fmtPercent(v: number, decimals = 1): string {
  if (!isFinite(v)) return '—'
  return `${v.toFixed(decimals)}%`
}

/** signed percent change from a fraction (0.12 → "+12%") */
export function fmtDeltaPct(frac: number, decimals = 0): string {
  if (!isFinite(frac)) return '—'
  const pct = frac * 100
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(decimals)}%`
}

export function fmtRoas(v: number): string {
  if (!isFinite(v) || v === 0) return '—'
  return `${v.toFixed(2)}×`
}

export function fmtMultiplier(v: number): string {
  return `${v.toFixed(2)}×`
}

/** Format a KPI value by its metric key, for generic rendering. */
export function fmtMetric(key: string, v: number): string {
  if (!isFinite(v)) return '—'
  switch (key) {
    case 'spend':
    case 'revenue':
      return fmtCurrency(v, { compact: true })
    case 'cpa':
    case 'cpc':
    case 'cpm':
    case 'aov':
      return fmtCurrency(v, { decimals: 2 })
    case 'roas':
      return fmtRoas(v)
    case 'ctr':
    case 'cvr':
    case 'hookRate':
    case 'holdRate':
      return fmtPercent(v)
    case 'frequency':
      return v.toFixed(2)
    case 'purchases':
    case 'impressions':
    case 'reach':
    case 'clicks':
    case 'linkClicks':
    case 'addToCart':
    case 'landingPageViews':
      return fmtNumber(v, { compact: v >= 100000 })
    default:
      return fmtNumber(v)
  }
}

export const KPI_LABELS: Record<string, string> = {
  spend: 'Spend',
  revenue: 'Revenue',
  purchases: 'Orders',
  cpa: 'CPA',
  roas: 'ROAS',
  ctr: 'CTR',
  cpc: 'CPC',
  cpm: 'CPM',
  aov: 'AOV',
  frequency: 'Frequency',
  cvr: 'CVR',
  hookRate: 'Hook rate',
  holdRate: 'Hold rate',
  impressions: 'Impressions',
  reach: 'Reach',
  clicks: 'Clicks',
  linkClicks: 'Link clicks',
  addToCart: 'Add to cart',
  landingPageViews: 'LP views',
}

export const KPI_UNITS: Record<string, string> = {
  cpa: '$', cpc: '$', cpm: '$', aov: '$', ctr: '%', cvr: '%', hookRate: '%', holdRate: '%',
}
