# M3 — view-only share links for decks

Status: implemented (PR `feat/m3-share-link`). Part of M3 "the user generates, exports, and shares a deck"
(`claude-design-local-roadmap.md`).

## Goal

As a self-hosted user, I want to send a partner a link to one of my decks that they can open read-only
without an account, so that I can show my work without exporting files or creating a login for them.

## Acceptance criteria → tests

| AC | Behaviour | Tests |
|----|-----------|-------|
| 1 | Share button / `od share create --deck <id> [--expires 1d\|7d\|30d\|never] --json` returns `/s/odsh_…`; default 30 days; only the token's sha256 is stored | `apps/daemon/tests/share-links/share-store.test.ts`, `share-links-server.test.ts`, `apps/daemon/tests/share-cli.test.ts`, `apps/web/tests/components/deck-share-panel.test.tsx`, `packages/contracts/tests/share-links.test.ts` |
| 2 | No session / no `OD_API_TOKEN`, SSO on or off: read-only page, slide list + one 1920×1080 slide, live deck state | `share-viewer-routes.test.ts` (real SSO middleware mounted after the viewer), `share-links-server.test.ts` |
| 3 | Only that deck's files (manifest artboards + `shared/**`); `/api/*` stays gated; sandboxed frames + CSP; GET/HEAD only | `share-viewer-routes.test.ts` |
| 4 | Revoked / expired / unknown / malformed token → identical plain 404 | `share-store.test.ts`, `share-viewer-routes.test.ts`, `share-links-server.test.ts` |
| 5 | List via UI, `od share list --json`, `GET …/shares`; owner-only; revoked kept with status | `share-store.test.ts`, `share-links-server.test.ts`, `share-cli.test.ts`, `deck-share-panel.test.tsx` |

Manual: open a link in a private window from another LAN machine.

## Design

- **Contract:** `packages/contracts/src/api/share-links.ts` — `ShareLink`, expiry choices, `odsh_` + 43 base64url
  token shape (distinct from `ods_` sessions and `odt_` API tokens).
- **Store:** `apps/daemon/src/share-links/share-store.ts`, SQLite table `share_links` (id, token_hash, user_id,
  project_id, artifact_id, created_at, expires_at, revoked_at). Revoke sets `revoked_at`; rows are kept.
- **Owner API** (`apps/daemon/src/routes/project/index.ts`, behind the normal auth gate):
  `POST|GET /api/projects/:id/artifacts/:artifactId/shares`, `DELETE …/shares/:shareId`. Create requires a valid
  v2 deck (`inspectDeckArtifact`). Owner = request user (`resolveUserId()`).
- **Public viewer** (`apps/daemon/src/share-links/share-viewer.ts`), mounted in `server.ts` *before*
  `createAuthMiddleware`, outside `/api` so the `OD_API_TOKEN` gate never sees it:
  - `GET /s/:token` — daemon-rendered page, nonce CSP, `frame-ancestors 'none'`, `connect-src 'none'`.
  - `GET /s/:token/f/<file>` — manifest artboards and `shared/**` only, realpath-contained; CSP allows inline
    script/style and the `ARTBOARD_ALLOWED_HOSTS` font hosts, no network otherwise.
  - Always `Cache-Control: no-store`, `Referrer-Policy: no-referrer` (the token is in the URL),
    `X-Robots-Tag: noindex`. Other methods → 405.
  - Deck dir resolved per request as the share owner (`runWithUser` + `getProject` + `resolveUserProjectDir`), so
    the page is always the live deck.
- **CLI:** `od share create|list|revoke` (`apps/daemon/src/share-cli.ts`, registered in `SUBCOMMAND_MAP`).
- **Web:** Share button in `DeckArtboardsViewer` opens `DeckSharePanel` (expiry select, create + copy, list,
  revoke). Dev proxy rewrites `/s/:path*` to the daemon (`apps/web/next.config.ts`).

## Decision log

| # | Decision | Why |
|---|----------|-----|
| S1 | One deck per link | Smallest unit that matches "share a deck"; project-wide sharing can come later. |
| S2 | Live, not a snapshot | No copy to manage; revoke is the control. |
| S3 | SQLite, hashed tokens | Same store and pattern as sessions/API tokens; a DB leak exposes no working links. |
| S4 | Default 30 days (1d/7d/30d/never) | Links don't live forever by accident. |
| S5 | Anyone with the link, even with SSO on | Partners have no account; the token is the credential. |
| S6 | Lean daemon-served page, not the Next app | Nothing from the app shell or `/api` reaches the viewer. |
| S7 | Link origin = the owner's browser origin (CLI: daemon URL) | No public-URL setting exists without SSO; settled during build. |
| S8 | Revoked links stay listed as "revoked" | The owner can see what was shared. |
