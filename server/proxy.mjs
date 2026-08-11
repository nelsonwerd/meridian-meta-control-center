/* ============================================================================
   Meridian backend proxy — zero-dependency Node (>=20) server.

   Purpose: the browser NEVER holds a Meta token (or an Anthropic key). This
   process holds them in env and forwards:

     GET  /healthz            → Graph /me probe with the server-side token
     GET  /api/meta/<path>    → graph.facebook.com/<path> + access_token injected
     POST /api/meta/<path>    → same, for writes (status / daily_budget)
     POST /api/ai/narrate     → Anthropic Messages API (optional LLM narrative)
     GET  <anything else>     → static file serving of dist/ (SPA fallback) when
                                SERVE_DIST=1 — so one process can run all of
                                Meridian in production.

   Env:
     PORT (8787) · HOST (127.0.0.1)
     META_SYSTEM_TOKEN        default system-user token (agency BM)
     META_TOKENS              optional JSON map { "<businessId>": "<token>" } for
                              client-owned BMs with their own tokens
     META_GRAPH_BASE          default https://graph.facebook.com (tests override)
     ANTHROPIC_API_KEY        enables /api/ai/narrate
     ANTHROPIC_BASE           default https://api.anthropic.com (tests override)
     SERVE_DIST=1 · DIST_DIR  serve the built SPA (default <repo>/dist)
     BACKOFF_CAP_MS           max backoff wait (tests use a tiny cap)

   Run: node server/proxy.mjs        (docs/META_INTEGRATION.md §5)
   ========================================================================== */

import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/* ----------------------------- config ----------------------------------- */

/** @typedef {{
 *   port: number, host: string,
 *   graphBase: string, anthropicBase: string,
 *   systemToken: string, tokensByBusiness: Record<string, string>,
 *   anthropicKey: string, serveDist: boolean, distDir: string,
 *   backoffCapMs: number,
 * }} ProxyConfig */

/** Build config from an env object (injectable for tests).
 *  @param {Record<string, string | undefined>} env
 *  @returns {ProxyConfig} */
export function configFromEnv(env) {
  /** @type {Record<string, string>} */
  let tokensByBusiness = {}
  if (env.META_TOKENS) {
    try {
      tokensByBusiness = JSON.parse(env.META_TOKENS)
    } catch {
      console.error('[proxy] META_TOKENS is not valid JSON — ignoring it.')
    }
  }
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '127.0.0.1',
    graphBase: (env.META_GRAPH_BASE ?? 'https://graph.facebook.com').replace(/\/+$/, ''),
    anthropicBase: (env.ANTHROPIC_BASE ?? 'https://api.anthropic.com').replace(/\/+$/, ''),
    systemToken: env.META_SYSTEM_TOKEN ?? '',
    tokensByBusiness,
    anthropicKey: env.ANTHROPIC_API_KEY ?? '',
    serveDist: env.SERVE_DIST === '1',
    distDir: env.DIST_DIR ?? path.resolve(__dirname, '..', 'dist'),
    backoffCapMs: Number(env.BACKOFF_CAP_MS ?? 8000),
  }
}

/* --------------------------- pure helpers ------------------------------- */

/** Choose the token for a request: per-business token if the browser named a
 *  business (X-Meta-Business-Id), else the default system-user token.
 *  @param {ProxyConfig} cfg @param {string | undefined} businessId */
export function pickToken(cfg, businessId) {
  if (businessId && cfg.tokensByBusiness[businessId]) return cfg.tokensByBusiness[businessId]
  return cfg.systemToken
}

/** Meta Graph paths we will forward: version-prefixed entity/edge paths like
 *  `v25.0/act_123/insights` or `v25.0/120210001`. Anything else — absolute URLs,
 *  dot-segments, empty — is rejected (the proxy must never be an open forwarder).
 *  @param {string} p */
export function isValidMetaPath(p) {
  if (!p || p.length > 512) return false
  if (!/^v\d+\.\d+\//.test(p)) return false
  if (p.includes('..') || p.includes('//') || p.includes('\\')) return false
  return /^[A-Za-z0-9_\-./]+$/.test(p)
}

/** Redact every occurrence of the injected token from an upstream response body
 *  (Graph embeds it in paging.next URLs — it must not reach the browser).
 *  @param {string} body @param {string} token */
export function redactToken(body, token) {
  if (!token) return body
  return body.split(token).join('REDACTED')
}

/** Parse Meta's X-Business-Use-Case-Usage header → worst-case usage pct + the
 *  advertised regain time. Null when absent/unparseable.
 *  @param {string | null} raw
 *  @returns {{ maxPct: number, regainSeconds: number } | null} */
export function parseBucHeader(raw) {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    let maxPct = 0
    let regainSeconds = 0
    for (const arr of Object.values(parsed)) {
      for (const e of /** @type {Array<Record<string, number>>} */ (arr)) {
        maxPct = Math.max(maxPct, e.call_count ?? 0, e.total_cputime ?? 0, e.total_time ?? 0)
        regainSeconds = Math.max(regainSeconds, e.estimated_time_to_regain_access ?? 0)
      }
    }
    return { maxPct, regainSeconds }
  } catch {
    return null
  }
}

/** Backoff wait before a retry, honouring Meta's regain hint but capped.
 *  @param {number} attempt @param {number | undefined} regainSeconds @param {number} capMs */
export function backoffDelayMs(attempt, regainSeconds, capMs) {
  const base = regainSeconds && regainSeconds > 0 ? regainSeconds * 1000 : 2 ** attempt * 1000
  return Math.min(base, capMs)
}

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms))

/* --------------------------- request handling --------------------------- */

/** @param {http.ServerResponse} res @param {number} status @param {unknown} obj
 *  @param {Record<string, string>} [headers] */
function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers })
  res.end(body)
}

/** Read a request body (bounded — a Graph write is a tiny form payload).
 *  @param {http.IncomingMessage} req @returns {Promise<string>} */
function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Forward one request to Graph with server-side token injection + BUC-aware
 *  retries. Returns the upstream response with the token redacted.
 *  @param {ProxyConfig} cfg
 *  @param {{ method: 'GET' | 'POST', metaPath: string, search: URLSearchParams, body?: string, token: string }} fwd */
async function forwardToGraph(cfg, fwd) {
  const url = new URL(`${cfg.graphBase}/${fwd.metaPath}`)
  for (const [k, v] of fwd.search) url.searchParams.append(k, v)

  for (let attempt = 0; ; attempt++) {
    /** @type {RequestInit} */
    let init
    if (fwd.method === 'POST') {
      const body = new URLSearchParams(fwd.body ?? '')
      body.set('access_token', fwd.token)
      init = { method: 'POST', body }
    } else {
      url.searchParams.set('access_token', fwd.token)
      init = { method: 'GET' }
    }
    const res = await fetch(url, init)
    const buc = parseBucHeader(res.headers.get('x-business-use-case-usage'))
    const throttled = res.status === 429 || (buc != null && buc.maxPct >= 95)
    if (throttled && attempt < 3) {
      await sleep(backoffDelayMs(attempt, buc?.regainSeconds, cfg.backoffCapMs))
      continue
    }
    const text = await res.text()
    return {
      status: res.status,
      body: redactToken(text, fwd.token),
      bucHeader: res.headers.get('x-business-use-case-usage'),
    }
  }
}

/* ------------------------------ static SPA ------------------------------ */

const MIME = /** @type {Record<string, string>} */ ({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
})

/** Serve the built SPA: exact file when it exists under distDir, else
 *  index.html (client-side routing). Path traversal is structurally blocked by
 *  resolving inside distDir and re-checking the prefix.
 *  @param {ProxyConfig} cfg @param {string} urlPath @param {http.ServerResponse} res */
async function serveStatic(cfg, urlPath, res) {
  const rel = urlPath.replace(/^\/+/, '') || 'index.html'
  let filePath = path.resolve(cfg.distDir, rel)
  if (!filePath.startsWith(path.resolve(cfg.distDir) + path.sep) && filePath !== path.resolve(cfg.distDir)) {
    sendJson(res, 400, { error: 'bad path' })
    return
  }
  try {
    const st = await stat(filePath)
    if (st.isDirectory()) filePath = path.join(filePath, 'index.html')
  } catch {
    filePath = path.join(cfg.distDir, 'index.html') // SPA fallback
  }
  try {
    const data = await readFile(filePath)
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' })
    res.end(data)
  } catch {
    sendJson(res, 404, { error: 'not found (is dist/ built? run npm run build)' })
  }
}

/* ------------------------------- server --------------------------------- */

/** Create the proxy server (not yet listening — tests attach to an ephemeral
 *  port; `main` below listens on cfg.host:cfg.port).
 *  @param {ProxyConfig} cfg */
export function createProxyServer(cfg) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const p = url.pathname

      /* -- health -- */
      if (p === '/healthz') {
        if (!cfg.systemToken) {
          sendJson(res, 503, { ok: false, error: 'META_SYSTEM_TOKEN is not set — the proxy has no token to inject.' })
          return
        }
        const probe = await fetch(`${cfg.graphBase}/me?fields=id,name&access_token=${encodeURIComponent(cfg.systemToken)}`)
        const text = await probe.text()
        if (!probe.ok) {
          sendJson(res, 502, { ok: false, error: `Graph /me failed (${probe.status}): ${redactToken(text, cfg.systemToken).slice(0, 300)}` })
          return
        }
        /** @type {{ id?: string, name?: string }} */
        let me = {}
        try {
          me = JSON.parse(text)
        } catch {
          /* fall through with empty me */
        }
        sendJson(res, 200, { ok: true, name: me.name ?? me.id ?? 'unknown' })
        return
      }

      /* -- Meta Graph forwarder -- */
      if (p.startsWith('/api/meta/')) {
        const metaPath = p.slice('/api/meta/'.length)
        if (!isValidMetaPath(metaPath)) {
          sendJson(res, 400, { error: `Refusing to forward path "${metaPath}" — expected a version-prefixed Graph path like v25.0/act_123/insights.` })
          return
        }
        // The browser must NEVER supply a token — reject so a misconfigured
        // client is caught loudly instead of silently proxying its token.
        if (url.searchParams.has('access_token')) {
          sendJson(res, 400, { error: 'access_token must not be sent by the client — the proxy injects it server-side.' })
          return
        }
        const businessId = /** @type {string | undefined} */ (req.headers['x-meta-business-id'] ? String(req.headers['x-meta-business-id']) : undefined)
        const token = pickToken(cfg, businessId)
        if (!token) {
          sendJson(res, 503, { ok: false, error: 'No Meta token configured (set META_SYSTEM_TOKEN, or META_TOKENS for this business).' })
          return
        }
        if (req.method !== 'GET' && req.method !== 'POST') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }
        /** @type {string | undefined} */
        let body
        if (req.method === 'POST') {
          body = await readBody(req)
          if (new URLSearchParams(body).has('access_token')) {
            sendJson(res, 400, { error: 'access_token must not be sent by the client — the proxy injects it server-side.' })
            return
          }
        }
        const out = await forwardToGraph(cfg, { method: /** @type {'GET' | 'POST'} */ (req.method), metaPath, search: url.searchParams, body, token })
        /** @type {Record<string, string>} */
        const headers = {}
        if (out.bucHeader) headers['x-business-use-case-usage'] = out.bucHeader
        res.writeHead(out.status, { 'content-type': 'application/json; charset=utf-8', ...headers })
        res.end(out.body)
        return
      }

      /* -- Anthropic narrative forwarder (optional) -- */
      if (p === '/api/ai/narrate' && req.method === 'POST') {
        if (!cfg.anthropicKey) {
          sendJson(res, 503, { error: 'ANTHROPIC_API_KEY is not set — LLM narrative is disabled; heuristics keep working.' })
          return
        }
        const raw = await readBody(req)
        /** @type {{ model?: string, system?: string, messages?: unknown, max_tokens?: number }} */
        let payload
        try {
          payload = JSON.parse(raw)
        } catch {
          sendJson(res, 400, { error: 'body must be JSON' })
          return
        }
        if (!payload.model || !Array.isArray(payload.messages)) {
          sendJson(res, 400, { error: 'body must include model + messages[]' })
          return
        }
        const upstream = await fetch(`${cfg.anthropicBase}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': cfg.anthropicKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: payload.model,
            system: payload.system,
            messages: payload.messages,
            max_tokens: payload.max_tokens ?? 600,
          }),
        })
        const text = await upstream.text()
        if (!upstream.ok) {
          sendJson(res, 502, { error: `Anthropic ${upstream.status}: ${redactToken(text, cfg.anthropicKey).slice(0, 300)}` })
          return
        }
        /** @type {{ content?: Array<{ type: string, text?: string }> }} */
        let msg = {}
        try {
          msg = JSON.parse(text)
        } catch {
          /* fall through with empty msg */
        }
        const joined = (msg.content ?? [])
          .filter((b) => b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text)
          .join('\n')
        sendJson(res, 200, { text: joined })
        return
      }

      /* -- static SPA (production single-process mode) -- */
      if (cfg.serveDist && req.method === 'GET') {
        await serveStatic(cfg, p, res)
        return
      }

      sendJson(res, 404, { error: 'not found' })
    } catch (e) {
      sendJson(res, 500, { error: `proxy error: ${/** @type {Error} */ (e).message}` })
    }
  })
}

/* ------------------------------- entrypoint ----------------------------- */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const cfg = configFromEnv(process.env)
  const server = createProxyServer(cfg)
  server.listen(cfg.port, cfg.host, () => {
    console.log(`[proxy] listening on http://${cfg.host}:${cfg.port}`)
    console.log(`[proxy] Graph base: ${cfg.graphBase} · Meta token: ${cfg.systemToken ? 'set' : 'NOT SET'} · Anthropic key: ${cfg.anthropicKey ? 'set' : 'not set'} · serve dist: ${cfg.serveDist}`)
    if (!cfg.systemToken) console.log('[proxy] set META_SYSTEM_TOKEN to enable live Graph calls (docs/META_INTEGRATION.md §1).')
  })
}
