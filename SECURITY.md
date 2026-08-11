# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** This project
handles Meta Marketing API credentials, so a public report can hand someone a
working exploit before there's a fix.

Report privately via GitHub's [private vulnerability
reporting](https://github.com/nelsonwerd/meridian-meta-control-center/security/advisories/new)
(Security → Report a vulnerability). Include what you did, what happened, and
what you expected; a proof of concept helps.

This is an open-source project maintained on a best-effort basis — there is no
SLA. Expect an initial response within a couple of weeks, and please give a
reasonable window for a fix before disclosing publicly.

## What's in scope

Anything that could expose a credential or let someone act on an ad account they
shouldn't. The highest-value areas:

- **`server/proxy.mjs`** — the token proxy. It holds `META_SYSTEM_TOKEN`,
  `META_TOKENS`, and `ANTHROPIC_API_KEY`. Bugs that leak a token into a
  response, a log, or an error body; a way past the path validator that turns it
  into an open forwarder; a way past the `X-Meridian-Client` CSRF guard on the
  write and Anthropic routes; SSRF; traversal in the `SERVE_DIST` static server.
- **`src/lib/provider/liveProvider.ts`** — anything that would put a token in
  the browser, in `localStorage`, or in a URL.
- **Write path (`applyAction`)** — anything that could apply a change to the
  wrong entity or account, or bypass the confirmation step.

## Out of scope

- The demo mode dataset (synthetic, no credentials involved) and the hosted
  demo, which has no backend and cannot reach the Meta API.
- Findings that require an attacker to already control your proxy host or env.
- Missing hardening that is documented as your responsibility to configure
  (TLS termination, network exposure of the proxy, who can reach it).

## Deploying this safely

- Keep tokens in the proxy's environment or a secret manager. Never in the repo,
  the browser, the saved account mapping, or a client-side build.
- Don't expose the proxy to the public internet. It has no authentication of its
  own — it is designed to sit behind your own auth/network boundary, or bound to
  localhost (its default is `127.0.0.1`).
- Scope Meta system users narrowly: `ANALYZE` to read, `ADVERTISE` to write, and
  a regular (non-admin) system user. Rotate or revoke tokens when someone leaves.
- See [`docs/META_INTEGRATION.md`](docs/META_INTEGRATION.md) §1 and §5.
