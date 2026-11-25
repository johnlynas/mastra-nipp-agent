# Security

## Reporting vulnerabilities

Please report security issues privately via a GitHub Security Advisory on this repository (do not open a public issue).

## Accepted risks

Findings that cannot be fixed without breaking changes, or for which no patched upstream version exists, are tracked here with their rationale. Re-check each row when the owning dependency chain is upgraded.

| Package | Advisory | Severity | Status | Rationale / follow-up |
| --- | --- | --- | --- | --- |
| deepmerge (transitive via @rollup/plugin-node-resolve → @mastra/deployer) | [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | low | Accepted — no patched version published (latest is 4.3.1, inside the vulnerable range `>=4.2.0`) | Dev-only toolchain chain (used by mastra's deployer bundling), not reachable from runtime request handling. Re-check on next major mastra release; npm audit currently reports the fix as `mastra@0.1.56`, which is a downgrade and not viable. |
| picomatch (transitive via @mastra/core, tinyglobby/vite/vitest, fdir, rollup plugins) | [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) (CVE-2026-112366) | high | Mitigated in-tree — no patched release exists (advisory range is `<= 4.0.7`; latest published picomatch **is** 4.0.7; upstream fix PRs [micromatch/picomatch#238](https://github.com/micromatch/picomatch/pull/238) / [#246](https://github.com/micromatch/picomatch/pull/246) are open, unmerged as of 2026-11-17) | ReDoS via single-branch repeated extglobs with a leading bare quantifier (e.g. `+(*a)` compiled to the nested-quantifier regex `(?:[^/]*?a)+`). `scripts/patch-picomatch-redos.cjs` runs on `postinstall` and ports PR #238's guard into `node_modules/picomatch/lib/parse.js`, so risky patterns are literalized (matching only the literal pattern string) — verified: backtracking eliminated, 15-case glob-semantics suite passes. npm audit will keep flagging picomatch until a patched release ships; treat that finding as covered by this row. Re-check when mastra/vite upgrade their picomatch range or micromatch merges the PRs — then drop the postinstall patch. |

## Pinned overrides

`package.json` contains `overrides` that force patched transitive versions beyond what upstream ranges allow:

- `@hono/node-server` → `^2.1.8` (fixes GHSA-rmxm-3fg6-px4f; upstream @hono/node-ws 1.3.1 still declares a peer range of `^1.19.x`, so the override is required until that peer range is updated).
- `readdir-glob → minimatch` → `^11.0.1` (fixes GHSA-g3hv-75wg-m249; readdir-glob 3.0.0 declares `minimatch ^10`).

Drop each override once the upstream chain publishes compatible ranges.

## Per-request user authorization (MCP authz)

The agent verifies the caller's portal session on **every** chat request and
propagates that identity to the portal MCP server, so no tool call runs under a
shared admin session. Design doc: `.hermes/plans/2026-11-23_234507-mcp-per-user-authz.md`.

### What this repo guarantees

- **Session verified per request** — `getPortalSessionUser()` (BetterAuth
  bearer + shared `BETTER_AUTH_SECRET` + shared PostgreSQL) resolves the caller
  from the cookie/bearer on `/api/chat`; banned users and DB errors fail closed.
- **Token never from the client body** — the session token is read only from
  the verified auth header/cookie, then placed in requestContext as
  `mastra__portalSessionToken`.
- **Per-request transport auth** — `portalMcpFetch` (`src/mastra/mcp/client.ts`)
  injects `Authorization: Bearer *** user's token>` on every MCP request.
- **Role-filtered dispatch** — `mastra__callerIsAdmin` is set per request;
  `callMcpTool()` blocks admin-scoped tool ids (`ADMIN_TOOL_IDS`,
  `src/mastra/tools/admin-tools.ts`) for non-admin callers with a 403-shaped
  refusal before the MCP transport. Defense in depth — the MCP server's own
  scope gate is authoritative.

### What this repo delegates

- **MCP server** (`mastra-nipp-mcp`): token verification, the admin scope gate
  (403 for non-admins on `_admin` tools), per-caller `tools/list` filtering,
  per-call audit logging, and the no-token 401 default. See its `SECURITY.md`.
- **Portal** (`nipp-0111`): final authority — `requirePermission` + Postgres
  RLS under the non-owner `nipp_app` role re-check every call independently of
  both agent and MCP server.

