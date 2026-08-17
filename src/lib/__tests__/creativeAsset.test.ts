import { afterEach, describe, expect, it, vi } from 'vitest'
import { LiveProvider, type LiveConfig } from '../provider/liveProvider'
import type { Creative } from '../types'

/* resolveCreativeAsset is the ON-DEMAND media read: one click, at most two Graph
   calls, and it must never throw — a preview that fails is a blank box, not a
   broken page. */

function stub(handler: (url: URL) => { status?: number; body: unknown }) {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    calls.push(url.pathname)
    const out = handler(url)
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200, headers: { 'content-type': 'application/json' } })
  })
  return calls
}

afterEach(() => vi.unstubAllGlobals())

const cfg: LiveConfig = { accounts: [{ clientId: 'c_a', adAccountId: 'act_1', businessId: 'b1' }], clients: [], windowDays: 56 }
const base: Creative = {
  id: 'cr1',
  clientId: 'c_a',
  name: 'Hero',
  format: 'video',
  angle: 'UGC Testimonial',
  thumbnailGradient: ['#000', '#fff'],
  thumbnailUrl: 'https://cdn/small.jpg',
  ratio: '4:5',
  headline: 'H',
  primaryText: 'P',
  batch: 'B',
  createdAt: '2026-08-01',
}

describe('resolveCreativeAsset', () => {
  it('returns a playable source + permalink for a video creative', async () => {
    stub((url) => {
      if (url.pathname.endsWith('/v99')) return { body: { source: 'https://cdn/video.mp4', picture: 'https://cdn/poster.jpg', permalink_url: 'https://fb.com/post' } }
      return { body: { image_url: 'https://cdn/orig.jpg' } }
    })
    const a = await new LiveProvider(cfg).resolveCreativeAsset({ ...base, videoId: 'v99' })
    expect(a?.videoUrl).toBe('https://cdn/video.mp4')
    expect(a?.permalinkUrl).toBe('https://fb.com/post')
    expect(a?.imageUrl).toBe('https://cdn/orig.jpg') // the original beats the auto poster
  })

  it('skips the video read entirely for a still creative', async () => {
    const calls = stub(() => ({ body: { image_url: 'https://cdn/orig.jpg' } }))
    const a = await new LiveProvider(cfg).resolveCreativeAsset({ ...base, format: 'image', videoId: undefined })
    expect(calls).toHaveLength(1) // one call, for the creative node
    expect(a?.imageUrl).toBe('https://cdn/orig.jpg')
    expect(a?.videoUrl).toBeUndefined()
  })

  it('asks for a LARGE thumbnail — the only fix for pixelated Advantage+ cards', async () => {
    let w: string | null = null
    let h: string | null = null
    stub((url) => {
      w = url.searchParams.get('thumbnail_width')
      h = url.searchParams.get('thumbnail_height')
      return { body: { thumbnail_url: 'https://cdn/big.jpg' } }
    })
    const a = await new LiveProvider(cfg).resolveCreativeAsset({ ...base, format: 'image', videoId: undefined })
    expect(w).toBe('1200')
    expect(h).toBe('1200')
    expect(a?.imageUrl).toBe('https://cdn/big.jpg')
  })

  it('a withheld video source still yields the still — playback degrades, preview does not', async () => {
    stub((url) => {
      if (url.pathname.endsWith('/v99')) return { status: 400, body: { error: { code: 100, message: 'no permission' } } }
      return { body: { image_url: 'https://cdn/orig.jpg' } }
    })
    const a = await new LiveProvider(cfg).resolveCreativeAsset({ ...base, videoId: 'v99' })
    expect(a?.videoUrl).toBeUndefined()
    expect(a?.imageUrl).toBe('https://cdn/orig.jpg')
  })

  it('falls back to the card thumbnail when BOTH reads fail, and never throws', async () => {
    stub(() => ({ status: 500, body: { error: { code: 1, message: 'nope' } } }))
    const a = await new LiveProvider(cfg).resolveCreativeAsset({ ...base, videoId: 'v99' })
    expect(a?.imageUrl).toBe('https://cdn/small.jpg') // the one we already had
  })

  it('returns null when there is genuinely nothing to show', async () => {
    stub(() => ({ status: 500, body: { error: { code: 1, message: 'nope' } } }))
    const a = await new LiveProvider(cfg).resolveCreativeAsset({ ...base, thumbnailUrl: undefined, videoId: undefined })
    expect(a).toBeNull()
  })

  it('routes through the business token that owns the creative', async () => {
    let sentBusiness: string | null = null
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentBusiness = (init?.headers as Record<string, string> | undefined)?.['X-Meta-Business-Id'] ?? null
      return new Response(JSON.stringify({ image_url: 'https://cdn/x.jpg' }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    await new LiveProvider(cfg).resolveCreativeAsset({ ...base, videoId: undefined })
    expect(sentBusiness).toBe('b1') // partner-BM creatives need their own token
  })
})
