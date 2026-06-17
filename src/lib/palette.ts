/* Chart + metric colors. Read from the CSS variables where possible so they
   track the theme; the categorical series palette is fixed-but-harmonious. */

export const C = {
  brand: 'rgb(138 124 249)',
  teal: 'rgb(54 214 195)',
  success: 'rgb(52 211 153)',
  warning: 'rgb(251 191 36)',
  danger: 'rgb(248 113 113)',
  info: 'rgb(96 165 250)',
  pink: 'rgb(232 160 191)',
  amber: 'rgb(230 180 80)',
  violet: 'rgb(155 138 251)',
  ink: 'rgb(150 158 173)',
}

/** Per-metric line colors used across charts for consistency. */
export const METRIC_COLOR: Record<string, string> = {
  spend: C.brand,
  revenue: C.teal,
  purchases: C.teal,
  cpa: C.warning,
  roas: C.success,
  ctr: C.info,
  cpm: C.pink,
  cpc: C.amber,
  frequency: C.danger,
}

/** Categorical palette for clients / cohorts / slices. */
export const SERIES = [
  C.brand,
  C.teal,
  C.info,
  C.warning,
  C.pink,
  C.success,
  C.amber,
  C.danger,
  C.violet,
  C.ink,
]

export function seriesColor(i: number): string {
  return SERIES[i % SERIES.length]
}
