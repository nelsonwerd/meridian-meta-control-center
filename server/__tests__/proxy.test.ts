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
// Every /api/* route requires the CSRF guard header (see proxy: X-Meridian-Client)
const CSRF = { 'x-meridian-client': '1' }

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

  it('redactToken strips every occurrence, including the percent-encoded form', () => {
    const weird = 'TOK|EN+with special'
    const body = `{"paging":{"next":"https://graph/x?access_token=${encodeURIComponent(weird)}&after=z"},"again":"${weird}"}`
    const out = redactToken(body, weird)
    expect(out).not.toContain(weird)
    expect(out).not.toContain(encodeURIComponent(weird))
    expect(out).toContain('REDACTED')
  })

  it('parseBucHeader reads the worst bucket across ALL entries (regain hint is MINUTES)', () => {
    const raw = JSON.stringify({
      '123': [
        { type: 'ads_management', call_count: 12, total_cputime: 20, total_time: 30, estimated_time_to_regain_access: 0 },
        { type: 'ads_insights', call_count: 40, total_cputime: 97, total_time: 30, estimated_time_to_regain_access: 4 },
      ],
    })
    // per Meta's rate-limiting reference, estimated_time_to_regain_access is minutes
    expect(parseBucHeader(raw)).toEqual({ maxPct: 97, regainMinutes: 4 })
    expect(parseBucHeader(null)).toBeNull()
    expect(parseBucHeader('not json')).toBeNull()
  })

  it('backoffDelayMs converts the MINUTES regain hint to ms, capped', () => {
    expect(backoffDelayMs(0, 4, 300_000)).toBe(240_000) // 4 min → 240s
    expect(backoffDelayMs(1, undefined, 8000)).toBe(2000) // exponential fallback
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
      ANTHROPIC_ALLOWED_MODELS: 'test-model',
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
    const res = await fetch(`${proxyBase}/api/meta/v25.0/act_1/campaigns?fields=name,objective&limit=200`, { headers: CSRF })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: [{ id: 'c1' }] })
    const seen = upstream.last()
    expect(seen.url).toContain('/v25.0/act_1/campaigns')
    expect(seen.url).toContain('fields=name%2Cobjective')
    expect(seen.url).toContain(`access_token=${TOKEN}`)
  })

  it('routes the partner token when X-Meta-Business-Id names a mapped business', async () => {
    await fetch(`${proxyBase}/api/meta/v25.0/act_9/adsets?fields=name`, {
      headers: { ...CSRF, 'x-meta-business-id': 'biz_partner' },
    })
    expect(upstream.last().url).toContain(`access_token=${PARTNER_TOKEN}`)
  })

  it('rejects a client-supplied access_token (GET query and POST body)', async () => {
    const g = await fetch(`${proxyBase}/api/meta/v25.0/act_1/ads?access_token=SNEAKY`, { headers: CSRF })
    expect(g.status).toBe(400)
    const p = await fetch(`${proxyBase}/api/meta/v25.0/120210001`, {
      method: 'POST',
      headers: CSRF,
      body: new URLSearchParams({ status: 'PAUSED', access_token: 'SNEAKY' }),
    })
    expect(p.status).toBe(400)
  })

  it('rejects non-Graph-shaped paths', async () => {
    for (const bad of ['v25.0/..%2Fetc', 'nope', 'v25.0//x']) {
      const res = await fetch(`${proxyBase}/api/meta/${bad}`, { headers: CSRF })
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
      headers: CSRF,
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
    const res = await fetch(`${proxyBase}/api/meta/v25.0/act_1/insights?fields=spend`, { headers: CSRF })
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
    const res = await fetch(`${proxyBase}/api/meta/v25.0/act_1/campaigns?fields=name`, { headers: CSRF })
    expect(res.status).toBe(200)
    expect(calls).toBe(3)
  })

  it('gives up after retries and passes the throttle status through', async () => {
    upstream.setScript((_req, res) => {
      res.writeHead(429, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 613, message: 'rate limited' } }))
    })
    const res = await fetch(`${proxyBase}/api/meta/v25.0/act_1/campaigns?fields=name`, { headers: CSRF })
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
      headers: { ...CSRF, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'test-model', system: 's', messages: [{ role: 'user', content: 'u' }] }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: 'Line one.\nLine two.' })
  })

  it('narrate 400s on malformed body', async () => {
    const res = await fetch(`${proxyBase}/api/ai/narrate`, { method: 'POST', headers: CSRF, body: 'not json' })
    expect(res.status).toBe(400)
  })

  it('404s unknown routes when not serving dist', async () => {
    const res = await fetch(`${proxyBase}/definitely-not-a-route`)
    expect(res.status).toBe(404)
  })

  it('403s /api/* without the CSRF guard header — GET, write POST, and narrate', async () => {
    const g = await fetch(`${proxyBase}/api/meta/v25.0/act_1/campaigns?fields=name`)
    expect(g.status).toBe(403)
    const w = await fetch(`${proxyBase}/api/meta/v25.0/120210001`, { method: 'POST', body: new URLSearchParams({ status: 'PAUSED' }) })
    expect(w.status).toBe(403) // the CSRF-relevant one: a drive-by write must never reach Graph
    const n = await fetch(`${proxyBase}/api/ai/narrate`, { method: 'POST', body: '{}' })
    expect(n.status).toBe(403)
  })

  it('narrate rejects models outside the allowlist and caps max_tokens', async () => {
    const bad = await fetch(`${proxyBase}/api/ai/narrate`, {
      method: 'POST',
      headers: { ...CSRF, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-fable-5', messages: [{ role: 'user', content: 'x' }] }),
    })
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { error: string }).error).toContain('not allowed')

    upstream.setScript((req, res) => {
      const body = JSON.parse(req.body)
      expect(body.max_tokens).toBe(2000) // 999999 clamped to the cap
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }))
    })
    const capped = await fetch(`${proxyBase}/api/ai/narrate`, {
      method: 'POST',
      headers: { ...CSRF, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'test-model', messages: [{ role: 'user', content: 'x' }], max_tokens: 999999 }),
    })
    expect(capped.status).toBe(200)
  })
})

describe('proxy static serving (SERVE_DIST production mode)', () => {
  it('serves exact files, falls back to index.html for SPA routes, blocks traversal', async () => {
    const fs = await import('node:fs/promises')
    const os = await import('node:os')
    const pathMod = await import('node:path')
    const dist = await fs.mkdtemp(pathMod.join(os.tmpdir(), 'meridian-dist-'))
    await fs.writeFile(pathMod.join(dist, 'index.html'), '<!doctype html><title>app</title>')
    await fs.mkdir(pathMod.join(dist, 'assets'))
    await fs.writeFile(pathMod.join(dist, 'assets', 'app.js'), 'console.log(1)')

    const server = createProxyServer(configFromEnv({ SERVE_DIST: '1', DIST_DIR: dist }))
    const port = await listen(server)
    const base = `http://127.0.0.1:${port}`
    try {
      const exact = await fetch(`${base}/assets/app.js`)
      expect(exact.status).toBe(200)
      expect(exact.headers.get('content-type')).toContain('javascript')
      expect(await exact.text()).toBe('console.log(1)')

      const spa = await fetch(`${base}/recommendations`) // client-side route
      expect(spa.status).toBe(200)
      expect(await spa.text()).toContain('<title>app</title>')

      // Traversal attempts must never leak a file outside distDir. Encoded
      // %2f is never decoded (the literal name misses → SPA fallback) and
      // literal ../ is normalized away by URL parsing — either way the
      // response must be the app shell, never /etc content.
      for (const evil of ['/..%2f..%2fetc%2fpasswd', '/assets/..%2f..%2fsecret', '/../../../../etc/passwd']) {
        const res = await fetch(`${base}${evil}`)
        const text = await res.text()
        expect(text, evil).not.toContain('root:')
        if (res.status === 200) expect(text, evil).toContain('<title>app</title>') // fallback shell only
      }
    } finally {
      server.close()
      await fs.rm(dist, { recursive: true, force: true })
    }
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
      const m = await fetch(`${base}/api/meta/v25.0/act_1/campaigns?fields=name`, { headers: { 'x-meridian-client': '1' } })
      expect(m.status).toBe(503)
      const n = await fetch(`${base}/api/ai/narrate`, { method: 'POST', headers: { 'x-meridian-client': '1' }, body: '{}' })
      expect(n.status).toBe(503)
    } finally {
      server.close()
    }
  })
})
