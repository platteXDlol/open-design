# OpenDesign Local — "This Weekend" First Slice

A 2-day build that locks the foundation before the 3-month MVP. Goal: prove the toolchain end-to-end (fork, providers, LAN toggle, Woodpecker, llama-swap, single-artifact chat) before committing to a longer design surface.

## What this weekend delivers

- A working fork on `platteXDlol/open-design-local` with `feat/mvp-foundation` branch
- 6 HTTP providers (no SaaS push, no OAuth-to-provider button)
- `OD_ALLOW_PRIVATE_NETWORKS=1` default-on for RFC1918 LAN ranges
- Woodpecker CI replacing GitHub Actions
- A single-artifact chat that talks to llama-swap
- One eval case ready for the v1 design-quality eval

## What this weekend does NOT deliver

- Multi-artifact artifacts (manifest v2)
- Canvas
- Comments
- Tweaks panel
- Design system extraction
- OIDC SSO
- Backup automation
- Nightly tarball

These are all in v1+ per `claude-design-local-roadmap.md`.

## Saturday morning (4 hours)

**Goal**: fork is local, llama-swap is reachable, daemon is up.

1. **Fork OpenDesign** to `platteXDlol/open-design-local` (one-time, GitHub UI).
2. **Clone locally**:
   ```bash
   git clone git@github.com:platteXDlol/open-design-local.git
   cd open-design-local
   git remote add upstream git@github.com:nexu-io/open-design.git
   git checkout -b feat/mvp-foundation
   ```
3. **Set up llama-swap** on the Proxmox host (or any machine that the Docker daemon can reach). One model is enough for the slice. The Qwen3 family is the target for the fork: `Qwen3.6-35B-A3B` (default — MoE, ~3B active params, fast on the Strix Halo), `Qwen3.8-27B` (dense, 27B), or `Qwen3-Coder-Next` (code-specialized). Use whichever is already loaded; the system-prompt discipline and tool-calling strategy work across the family.
4. **Confirm llama-swap is reachable**:
   ```bash
   curl http://127.0.0.1:8800/v1/models
   # → {"data":[{"id":"Qwen3.6-35B-A3B", ...}]}
   ```
5. **Run the local dev loop** to confirm the fork is healthy:
   ```bash
   pnpm install
   pnpm tools-dev
   pnpm tools-serve start updater
   ```
6. **Smoke test the daemon**:
   ```bash
   curl http://127.0.0.1:17456/api/health
   # → {"status":"ok",...}
   ```

If any of these fail, fix them before continuing. The 3-month MVP build depends on every step above working.

## Saturday afternoon (4 hours)

**Goal**: providers are scoped, LAN toggle works, tests are green.

1. **Scope the providers** — `git grep` the type union in `packages/contracts/src/api/connectionTest.ts` and confirm the only entries are `openai | anthropic | ollama | vllm | openai-custom | anthropic-custom`. If the upstream has additional entries (`azure`, `google`, `senseaudio`, `aihubmix`, `bedrock`), remove them from:
   - `packages/contracts/src/api/connectionTest.ts` (the `ConnectionTestProtocol` union)
   - Any UI selector that lists them
   - Any CLI subcommand that accepts them
   - The OAuth-to-provider code paths

2. **Add `allowPrivateNetworks` to `ValidateBaseUrlOptions`**:
   - In `packages/contracts/src/api/connectionTest.ts`, add a new optional field `allowPrivateNetworks?: boolean` to `ValidateBaseUrlOptions`.
   - Default value: `false` (preserves the strict default-deny for any caller that does not opt in).
   - Wire it into the `validateBaseUrl` body so that when `true`, RFC1918 hosts (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) pass instead of being rejected.
   - Mirror the same logic in `validateBaseUrlResolved` (the DNS-aware sibling) at the resolved-IP layer.
   - Add a helper `isRfc1918Host(hostname: string): boolean` and re-use the existing trailing-dot / `::ffff:` normalization helpers.

3. **Write the red tests first** in `packages/contracts/tests/connection-test.test.ts`:
   - RFC1918 host is allowed when `allowPrivateNetworks: true`
   - RFC1918 host is still blocked when `allowPrivateNetworks: false` (regression)
   - `169.254.169.254` and `100.64.0.1` stay blocked even when `allowPrivateNetworks: true` (security invariant)
   Run `pnpm --filter @open-design/contracts test` and confirm the new cases go red. Then implement and confirm they go green.

4. **Wire `OD_ALLOW_PRIVATE_NETWORKS` in the daemon**:
   - Add a `configuredAllowPrivateNetworks(): boolean` helper in `apps/daemon/src/origin-validation.ts`. Default: `true` (Local-First product stance). `OD_ALLOW_PRIVATE_NETWORKS=0` / `false` / `no` → `false`. Empty or missing → `true`.
   - In `apps/daemon/src/connectionTest.ts`, pass `allowPrivateNetworks: configuredAllowPrivateNetworks()` to `validateUserProviderBaseUrl` alongside the existing `allowedInternalHosts` option.
   - **Do not touch** `assertExternalAssetUrl` or `createAssetValidatingLookup`. The asset-download SSRF guard stays strict always.

5. **Add the daemon-side test** in `apps/daemon/tests/origin-validation.test.ts` (mirror the existing `OD_ALLOWED_INTERNAL_HOSTS` describe block at line 779). Two cases: default is `true`; explicit `=0` is `false`.

6. **Run the full validation floor**:
   ```bash
   pnpm guard
   pnpm typecheck
   pnpm --filter @open-design/contracts test
   pnpm --filter @open-design/daemon test
   ```
   All green. If anything fails, fix before continuing.

## Sunday morning (4 hours)

**Goal**: Woodpecker is the only CI, GitHub Actions is gone.

1. **Write `.woodpecker.yml`** at the repo root with this structure:
   ```yaml
   when:
     - event: pull_request
     - event: push
       branch: main

   steps:
     install:
       image: node:24-alpine
       environment: [CI=true]
       commands:
         - apk add --no-cache python3 make g++ git
         - corepack enable && corepack prepare pnpm@10.33.2 --activate
         - pnpm install --frozen-lockfile
       volumes:
         - /tmp/woodpecker-pnpm-store:/root/.local/share/pnpm/store

     guard:
       image: node:24-alpine
       depends_on: [install]
       commands: [pnpm guard]

     typecheck:
       image: node:24-alpine
       depends_on: [install]
       commands: [pnpm typecheck]

     test-contracts:
       image: node:24-alpine
       depends_on: [install]
       commands: [pnpm --filter @open-design/contracts test]

     test-daemon:
       image: node:24-alpine
       depends_on: [install]
       commands: [pnpm --filter @open-design/daemon test]
   ```

2. **Delete `.github/workflows/ci.yml`**. The file is 56 lines and the only GitHub Actions entry; deleting it is the cleanest cut. If you want a stub instead, replace it with a single job that fails fast with a message: "CI has moved to Woodpecker; see .woodpecker.yml at the repo root."

3. **Rewrite `.github/AGENTS.md`** as a one-paragraph note: "This directory is intentionally minimal. CI lives in Woodpecker — see `.woodpecker.yml` at the repo root and root `AGENTS.md` § GitHub automation boundary. Release workflows are produced locally via `pnpm tools-pack`. Do not reintroduce GitHub Actions workflows without an explicit maintainer decision."

4. **Update root `AGENTS.md` § "GitHub automation boundary"** to the Woodpecker-first framing. Suggested replacement text:
   > Primary CI runs in **Woodpecker** via `.woodpecker.yml`. The pipeline triggers on `pull_request` and `push` to `main`, runs `pnpm guard`, `pnpm typecheck`, and the `@open-design/contracts` + `@open-design/daemon` test scopes. No `pnpm build` on PR — full builds stay local via `pnpm tools-dev run web`. `.github/workflows/` is intentionally empty. Docker build/publish is a future Woodpecker `tag` pipeline, not a GitHub Actions workflow.

5. **Run `git diff --check` + `pnpm guard` + `pnpm typecheck`** — all green.

6. **Push the branch and open a PR**:
   ```bash
   git add .woodpecker.yml .github/AGENTS.md AGENTS.md packages/contracts/src/api/connectionTest.ts packages/contracts/tests/connection-test.test.ts apps/daemon/src/origin-validation.ts apps/daemon/src/connectionTest.ts apps/daemon/tests/origin-validation.test.ts apps/daemon/tests/connection-test.test.ts deploy/.env.example
   git status
   git commit -m "feat: foundation — 6 providers, OD_ALLOW_PRIVATE_NETWORKS default-on, Woodpecker CI"
   git push -u origin feat/mvp-foundation
   ```
   The PR body should follow `.github/pull_request_template.md`. Mark surface areas: `CLI flags/env vars` (yes — new `OD_ALLOW_PRIVATE_NETWORKS`), `AGENTS.md` (yes), `i18n keys` (no), `new root package.json dependencies` (no).

7. **Verify the Woodpecker pipeline** ran all five steps green on the PR. If you have not yet set up the Woodpecker server, this is a good moment — the Web UI guides you through adding the repo.

## Sunday afternoon (4 hours)

**Goal**: end-to-end smoke with the local model. Either v0.1 ships Sunday night, or Monday starts with a debugging list.

1. **Set up the Docker Compose stack** (per the homelab deployment section of the roadmap):
   ```bash
   mkdir -p deploy/homelab
   # Write deploy/homelab/docker-compose.yml, .env, Caddyfile from the roadmap
   # (or copy from a snippet you keep handy)
   cd deploy/homelab
   docker compose up -d daemon
   ```

2. **Open the web UI** at `http://127.0.0.1:7456` (or the proxy URL if Caddy is up).

3. **Configure the provider** in Settings:
   - Protocol: `openai-custom`
   - Base URL: `http://host.docker.internal:8800/v1` (this reaches llama-swap on the host)
   - API key: empty (llama-swap typically doesn't require one)
   - Save.

4. **Configure the model route** in Settings → Models:
   - `defaultModel`: `Qwen3.6-35B-A3B` (or whichever Qwen3 variant you loaded — see step 3)
   - `generate`, `edit`, `designSystem`, `critique`: empty (use default)
   - `vision`: empty (disabled in v1)
   - `warmupOnStartup`: true
   - Save.

5. **Send a prompt** in the chat pane:
   > "Generate a 1-page HTML landing page for a small-batch coffee roaster in Brooklyn. Use a warm, editorial design. Hero with the brand name, a section about their sourcing, and a contact form."

6. **Verify the artifact**:
   - Streaming response visible in the chat pane
   - Final HTML is in the artifact panel and renders
   - HTML passes `validateHtmlArtifact` (no validation error toast)
   - The HTML does not contain `TBD`, `TODO`, `lorem`, or third-party URLs
   - The HTML uses the design system tokens (warm palette)

7. **If everything passes**: tag `v0.1.0-mvp-foundation`. The 3-month MVP build starts Monday.
   ```bash
   git tag v0.1.0-mvp-foundation
   git push origin v0.1.0-mvp-foundation
   ```

8. **If something fails**: do not force a tag. Log the issues for Monday. Common failures to expect:
   - llama-swap returns 503 during cold-load — expected; the UI should show `coldStartMessage`; if it doesn't, the model route config didn't take
   - The model emits invalid HTML — the validator should catch it; if it doesn't, the static-validation gate from Stage 3 §H is missing
   - The model emits `<script src="https://cdn.example.com/x.js">` — the local-model output discipline from Stage 3 §D is not yet enforced; the model needs a system-prompt rule to forbid external URLs (defer to v1)
   - Tokens balloon beyond 32K — the per-turn budget from Stage 3 §E is the binding constraint; lazy-loading is not yet implemented (defer to v1)

## Monday standup (15 minutes)

If v0.1 ships, the standup is one line: "Fork is up, llama-swap integration works, MVP build starts today." Then dive into the v1 backlog.

If v0.1 does not ship, the standup is the failure modes from step 8, plus a triage of which blocker is the highest-leverage to clear first. The v1 backlog is unchanged; the timeline shifts by however long the debugging takes.

## Open questions to resolve before v1

All five open questions were resolved on 2026-10-05. The plan is fully locked for v0.1 and v1. See `claude-design-local-roadmap.md` § 5 for the resolutions.

- **OQ-1 (locked).** Qwen3 family. Default: `Qwen3.6-35B-A3B` (MoE). Fallbacks: `Qwen3.8-27B`, `Qwen3-Coder-Next`.
- **OQ-2 (locked).** First output type is slide deck.
- **OQ-3 (locked).** MVP (v1) before canvas (v2).
- **OQ-4 (locked).** Express stays until v7. NestJS + Postgres in v7.
- **OQ-5 (locked).** Branding badge deferred to v1 GA.
