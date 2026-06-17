/* Small deterministic PRNG + sampling helpers so the demo dataset is identical
   on every load (stable suggestions, stable charts, believable story). */

export type Rng = () => number

/** mulberry32 — fast, decent-quality, fully deterministic from a 32-bit seed. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** stable string → 32-bit hash, so we can seed per-entity deterministically. */
export function hashString(str: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function rngFor(...parts: (string | number)[]): Rng {
  return mulberry32(hashString(parts.join('|')))
}

/** float in [min, max) */
export function range(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min)
}

/** int in [min, max] inclusive */
export function intRange(rng: Rng, min: number, max: number): number {
  return Math.floor(range(rng, min, max + 1))
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}

/** pick n distinct items (or fewer if arr is small) */
export function sample<T>(rng: Rng, arr: readonly T[], n: number): T[] {
  const copy = [...arr]
  const out: T[] = []
  while (out.length < n && copy.length) {
    out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0])
  }
  return out
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p
}

/** Box-Muller gaussian, clamped to avoid wild tails. */
export function gaussian(rng: Rng, mean = 0, sd = 1): number {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
  return mean + z * sd
}

/** multiplicative noise around 1.0, clamped to [1-spread, 1+spread] */
export function jitter(rng: Rng, spread = 0.12): number {
  return 1 + Math.max(-spread, Math.min(spread, gaussian(rng, 0, spread / 2)))
}

/** crude Poisson sampler (Knuth) for small lambda — used for daily orders. */
export function poisson(rng: Rng, lambda: number): number {
  if (lambda <= 0) return 0
  if (lambda > 30) return Math.max(0, Math.round(gaussian(rng, lambda, Math.sqrt(lambda))))
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= rng()
  } while (p > L)
  return k - 1
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}
