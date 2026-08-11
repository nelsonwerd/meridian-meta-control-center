import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
// @ts-expect-error — plain-ESM server module checked by server/tsconfig.json (checkJs)
import { backoffDelayMs, configFromEnv, createProxyServer, isValidMetaPath, parseBucHeader, pickToken, redactToken } from '../proxy.mjs'

/* ============================================================================
   Proxy tests — the mock upstream stands in for graph.facebook.com and the
   Anthropic API, so every behaviour (token injection, redaction, backoff,
   rejection of client tokens) is verified against a real HTTP round-trip with
   zero network access.
   ========================================================================== */

interface Recorded {
  method: string
  url: string
  body: string
}

/** Scriptable upstream: records every request; responds per the current script. */
function makeUpstream() {
  const recorded: Recorded[] = []
  let script: (req: Recorded, res: http.ServerResponse) => void = (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [] }))
  }
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const rec = { method: req.method ?? '', url: req.url ?? '', body: Buffer.concat(chunks).toString('utf8') }
    recorded.push(rec)
    script(rec, res)
  })
  return {
    server,
    recorded,
    setScript(fn: typeof script) {
      script = fn
    },
    last() {
      return recorded[recorded.length - 1]
    },
  }
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })
}

const TOKEN = 'TESTTOKEN_abc123'
const PARTNER_TOKEN = 'PARTNERTOKEN_xyz789'

describe('proxy pure helpers', () => {
  it('isValidMetaPath accepts version-prefixed Graph paths only', () => {
    expect(isValidMetaPath('v25.0/act_123/insights')).toBe(true)
    expect(isValidMetaPath('v25.0/120210001')).toBe(true)
    expect(isValidMetaPath('v25.0/act_1/adsets')).toBe(true)
    expect(isValidMetaPath('act_123/insights')).toBe(false) // no version prefix
    expect(isValidMetaPath('v25.0/../etc/passwd')).toBe(false)
    expect(isValidMetaPath('v25.0//act_1')).toBe(false)
    expect(isValidMetaPath('https://evil.example/x')).toBe(false)
    expect(isValidMetaPath('')).toBe(false)
    expect(isValidMetaPath('v25.0/a'.padEnd(600, 'a'))).toBe(false)
  })

  it('redactToken strips every occurrence', () => {
    const body = `{"paging":{"next":"https://graph/x?access_token=${TOKEN}&after=z"},"again":"${TOKEN}"}`
    const out = redactToken(body, TOKEN)
    expect(out).not.toContain(TOKEN)
    expect(out).toContain('REDACTED')
  })

  it('parseBucHeader reads the worst bucket', () => {
    const raw = JSON.stringify({
      '123': [{ type: 'ads_insights', call_count: 12, total_cputime: 97, total_time: 30, estimated_time_to_regain_access: 4 }],
    })
    expect(parseBucHeader(raw)).toEqual({ maxPct: 97, regainSeconds: 4 })
    expect(parseBucHeader(null)).toBeNull()
    expect(parseBucHeader('not json')).toBeNull()
  })

  it('backoffDelayMs honours the regain hint but caps', () => {
    expect(backoffDelayMs(0, 4, 8000)).toBe(4000)
    expect(backoffDelayMs(1, undefined, 8000)).toBe(2000)
    expect(backoffDelayMs(3, 900, 8000)).toBe(8000) // capped
  })

  it('pickToken routes per business id with system fallback', () => {
    const cfg = configFromEnv({ META_SYSTEM_TOKEN: TOKEN, META_TOKENS: JSON.stringify({ b1: PARTNER_TOKEN }) })
    expect(pickToken(cfg, 'b1')).toBe(PARTNER_TOKEN)
    expect(pickToken(cfg, 'b2')).toBe(TOKEN)
    expect(pickToken(cfg, undefined)).toBe(TOKEN)
  })
})

describe('proxy HTTP behaviour', () => {
  const upstream = makeUpstream()
  let proxyBase = ''
  let proxyServer: http.Server

  beforeAll(async () => {
    const upPort = await listen(upstream.server)
    const cfg = configFromEnv({
      META_SYSTEM_TOKEN: TOKEN,
      META_TOKENS: JSON.stringify({ biz_partner: PARTNER_TOKEN }),
      META_GRAPH_BASE: `http://127.0.0.1:${upPort}`,
      ANTHROPIC_API_KEY: 'sk-ant-test',
      ANTHROPIC_BASE: `http://127.0.0.1:${upPort}`,
      BACKOFF_CAP_MS: '5', // keep retries instant in tests
    })
    proxyServer = createProxyServer(cfg)
    const port = await listen(proxyServer)
    proxyBase = `http://127.0.0.1:${port}`
  })

  afterAll(() => {
    proxyServer.close()
    upstream.server.close()
  })

  it('GET forward injects the token server-side and passes query through', async () => {
    upstream.setScript((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'c1' }] }))
    })
    const res = await fetch(`${proxyBase}/api/meta/v25.0/act_1/campaigns?fields=name,objective&limit=200`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: [{ id: 'c1' }] })
    const seen = upstream.last()
    expect(seen.url).toContain('/v25.0/act_1/campaigns')
    expect(seen.url).toContain('fields=name%2Cobjective')
    expect(seen.url).toContain(`access_token=${TOKEN}`)
  })

  it('routes the partner token when X-Meta-Business-Id names a mapped business', async () => {
    await fetch(`${proxyBase}/api/meta/v25.0/act_9/adsets?fields=name`, {
      headers: { 'x-meta-business-id': 'biz_partner' },
    })
    expect(upstream.last().url).toContain(`access_token=${PARTNER_TOKEN}`)
  })

  it('rejects a client-supplied access_token (GET query and POST body)', async () => {
    const g = await fetch(`${proxyBase}/api/meta/v25.0/act_1/ads?access_token=SNEAKY`)
    expect(g.status).toBe(400)
    const p = await fetch(`${proxyBase}/api/meta/v25.0/120210001`, {
      method: 'POST',
      body: new URLSearchParams({ status: 'PAUSED', access_token: 'SNEAKY' }),
    })
    expect(p.status).toBe(400)
  })

  it('rejects non-Graph-shaped paths', async () => {
    for (const bad of ['v25.0/..%2Fetc', 'nope', 'v25.0//x']) {
      const res = await fetch(`${proxyBase}/api/meta/${bad}`)
      expect(res.status).toBe(400)
    }
  })

  it('POST write forwards form body with token injected', async () => {
    upstream.setScript((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ success: true }))
    })
    const res = await fetch(`${proxyBase}/api/meta/v25.0/120210001`, {
      method: 'POST',
      body: new URLSearchParams({ status: 'PAUSED' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    const seen = upstream.last()
    expect(seen.method).toBe('POST')
    const form = new URLSearchParams(seen.body)
    expect(form.get('status')).toBe('PAUSED')
    expect(form.get('access_token')).toBe(TOKEN)
  })

  it('redacts the token from upstream bodies (paging.next)', async () => {
    upstream.setScript((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [], paging: { next: `https://graph.facebook.com/x?access_token=${TOKEN}&after=zz` } }))
    })
    const res = await fetch(`${proxyBase}/api/meta/v25.0/act_1/insights?fields=spend`)
    const text = await res.text()
    expect(text).not.toContain(TOKEN)
    expect(text).toContain('REDACTED')
  })

  it('retries on 429 then succeeds (BUC backoff)', async () => {
    let calls = 0
    upstream.setScript((_req, res) => {
      calls++
      if (calls < 3) {
        res.writeHead(429, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { code: 613 } }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ ok: true }] }))
    })
    const res = await fetch(`${proxyBase}/api/meta/v25.0/act_1/campaigns?fields=name`)
    expect(res.status).toBe(200)
    expect(calls).toBe(3)
  })

  it('gives up after retries and passes the throttle status through', async () => {
    upstream.setScript((_req, res) => {
      res.writeHead(429, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 613, message: 'rate limited' } }))
    })
    const res = await fetch(`${proxyBase}/api/meta/v25.0/act_1/campaigns?fields=name`)
    expect(res.status).toBe(429)
  })

  it('healthz probes /me and reports the identity', async () => {
    upstream.setScript((req, res) => {
      expect(req.url).toContain('/me?')
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: '42', name: 'Meridian System User' }))
    })
    const res = await fetch(`${proxyBase}/healthz`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, name: 'Meridian System User' })
  })

  it('narrate forwards to Anthropic and joins text blocks', async () => {
    upstream.setScript((req, res) => {
      expect(req.url).toContain('/v1/messages')
      const body = JSON.parse(req.body)
      expect(body.model).toBe('test-model')
      expect(body.max_tokens).toBe(600)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ content: [{ type: 'text', text: 'Line one.' }, { type: 'text', text: 'Line two.' }] }))
    })
    const res = await fetch(`${proxyBase}/api/ai/narrate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'test-model', system: 's', messages: [{ role: 'user', content: 'u' }] }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: 'Line one.\nLine two.' })
  })

  it('narrate 400s on malformed body', async () => {
    const res = await fetch(`${proxyBase}/api/ai/narrate`, { method: 'POST', body: 'not json' })
    expect(res.status).toBe(400)
  })

  it('404s unknown routes when not serving dist', async () => {
    const res = await fetch(`${proxyBase}/definitely-not-a-route`)
    expect(res.status).toBe(404)
  })
})

describe('proxy without tokens (unconfigured)', () => {
  it('healthz is a clear 503, not a crash; /api/meta 503s; narrate 503s', async () => {
    const cfg = configFromEnv({})
    const server = createProxyServer(cfg)
    const port = await listen(server)
    const base = `http://127.0.0.1:${port}`
    try {
      const h = await fetch(`${base}/healthz`)
      expect(h.status).toBe(503)
      expect(((await h.json()) as { error: string }).error).toContain('META_SYSTEM_TOKEN')
      const m = await fetch(`${base}/api/meta/v25.0/act_1/campaigns?fields=name`)
      expect(m.status).toBe(503)
      const n = await fetch(`${base}/api/ai/narrate`, { method: 'POST', body: '{}' })
      expect(n.status).toBe(503)
    } finally {
      server.close()
    }
  })
})
