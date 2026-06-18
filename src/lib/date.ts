/* Pure, dependency-free UTC date helpers. Shared by the demo generator and the
   metrics layer so there is ONE implementation (avoids the two copies that could
   drift). Imports nothing — keeps it safe from circular imports (metrics imports
   from demo/generate, so date math must live below both). ISO 'YYYY-MM-DD'. */

export type ISODate = string

export function addDays(iso: ISODate, days: number): ISODate {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}
