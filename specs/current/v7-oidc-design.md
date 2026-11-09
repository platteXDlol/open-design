# v7 — OIDC SSO (auth half of M7)

Status: design approved (decisions below), first PR not started.
Related: `specs/current/claude-design-local-roadmap.md` (Stage 7, M7), `specs/current/local-only-divergence.md` §4.2.

## Goal

As a homelab admin, I want my partner and me to log in to one daemon with our Authentik/Keycloak accounts, so that each of us only sees our own projects without sharing a Linux account.

## Acceptance criteria (first PR)

1. **Login gate.** Given SSO is configured, when an unauthenticated browser requests the app, it is redirected to the IdP; an unauthenticated `/api/*` call gets `401`. After the callback, a session cookie identifies the user.
2. **Isolation.** Given users A and B are logged in, `resolveUserId` returns the session user (IdP `sub`, sanitized), so A cannot list, read or write B's projects via API or project file paths.
3. **Off by default.** Given no `OD_OIDC_*` env, behavior is unchanged: synthetic `local` user, no login screen.
4. **CLI.** Given SSO is on, `od` works with a per-user API token created in Settings; agent processes spawned by the daemon get a run-scoped token for the run's user.
5. **Recovery.** Given `OD_RESET_ADMIN=1`, the daemon logs a one-time admin login link that works without the IdP.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | First PR = login + per-user isolation only; share links, quotas, audit log, admin UI later | Smallest slice that proves M7's core. |
| 2 | Stay on SQLite; add `users`, `sessions`, `api_tokens` tables | v0.6 removed the storage reason to migrate; Postgres is not needed for login. Supersedes roadmap OQ-4 for this slice. |
| 3 | `openid-client` in `apps/daemon/package.json` (not root) | Maintained, PKCE + discovery, ID-token verification via jose (2 same-author deps: jose, oauth4webapi; user confirmed over reusing mcp-oauth.ts); avoids hand-rolled security code. |
| 4 | Config via env: `OD_OIDC_ISSUER`, `OD_OIDC_CLIENT_ID`, `OD_OIDC_CLIENT_SECRET`, `OD_PUBLIC_URL`; Settings shows read-only | Fits docker-compose; a bad value cannot lock the admin out from the UI. |
| 5 | No local password users; first SSO user = admin; `OD_RESET_ADMIN=1` one-time link | Less surface (no password hashing / login form). |
| 6 | Per-user API tokens for `od`; run-scoped tokens for spawned agents | Reuses the existing bearer-token path (`apps/daemon/src/api-token-auth.ts`). |
| 7 | First SSO admin takes over `users/local/` once (rename, v0.6 migration safety rules) | Existing single-user data stays visible to its owner. |

## Design

- **Chokepoint.** `resolveUserId()` (`apps/daemon/src/storage/user-scope.ts:37`) gains a request-scoped source: an `AsyncLocalStorage` user context set by auth middleware. No context → today's env/`local` behavior (AC3). The 5 existing callers stay unchanged.
- **User id.** `users.id` = sanitized, stable id derived from `(issuer, sub)` (hash when `sub` is not path-safe); same validation as `OD_USER_ID` (no separators, no `.`/`..`).
- **Routes.** `GET /api/auth/login` (PKCE + state, redirect), `GET /api/auth/callback`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET|POST|DELETE /api/auth/tokens`. Contract types in `packages/contracts/src/api/auth.ts`.
- **Middleware.** Runs before all `/api/*` and static serving when SSO is on: session cookie (`HttpOnly`, `SameSite=Lax`, `Secure` when `OD_PUBLIC_URL` is https) or `Authorization: Bearer <token>`. Allow-list: `/api/auth/*`, `/api/health`.
- **Isolation check.** Project lookups by id verify `projects.user_id` matches the current user (404 otherwise); file paths already resolve under `users/<id>/projects`.
- **Web.** On `401` from `/api/auth/me`, redirect to `/api/auth/login`. Settings → Account: current user, logout, API tokens, read-only SSO config.
- **CLI.** `od auth token create|list|revoke` (`--json`) and `OD_API_TOKEN` env / `--token` flag, through the same `/api/auth/tokens` endpoints (UI/CLI dual-track).
- **Agents.** Spawned agents get `OD_API_TOKEN` = a run-scoped token revoked at run end.
- **Migration (D7).** On first admin creation, rename `users/local/` → `users/<admin-id>/` once, refuse if the target exists, update `projects.user_id`, write a marker.

## Out of scope (later v7 PRs)

Share links (view/comment/edit), local password users, OIDC group → role mapping, admin user-management UI, quotas, audit log, Postgres.

## Open points to verify while implementing

- `apps/daemon/src/mcp-oauth.ts` already has PKCE + `openid-configuration` discovery helpers; decision 3 stands unless reuse proves clearly smaller.
- How the web app currently reacts to `401` outside the removed collab code.
