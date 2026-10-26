# Local-Only Divergence — What This Fork Strips, What It Keeps, and Why

This document is the single source of truth for **what is intentionally
not in OpenDesign Local**, the security and product trade-offs that
made those exclusions, and the escape hatch for any future PR that
wants to re-introduce one of them. Read this before any change that
touches the agent registry, the daemon route surface, the settings
agent list, the i18n key namespace, or the multi-user story.

It is the answer to the question "why does the upstream `nexu-io/open-design`
have this and we don't?"

## 0. Scope

Out of scope here:

- **The protocol-narrowing arc (v0.2–v0.3)**, which dropped
  `azure | google | senseaudio | aihubmix | bedrock` from
  `ConnectionTestProtocol`. That story lives in
  `claude-design-local-roadmap.md` (v0.2 + v0.3 retrospective). The
  current doc starts at v0.4, where the divergence is the **agent
  runtime** and the **Cloud sign-in surface**, not the BYOK protocols.
- **The local-first data path contract.** Read the root `AGENTS.md`
  section **Daemon data directory contract** before changing anything
  that touches `RUNTIME_DATA_DIR`, `PROJECTS_DIR`, or
  `ARTIFACTS_DIR`. The data path is the fork's *foundation*, not its
  divergence.

## 1. What was removed

Three orthogonal cuts, in chronological order, each one its own PR.

### 1.1 v0.4.0 — AMR/Cloud sign-in surfaces (PR #13, web-only)

**Cut**: every UI surface that pointed at the OpenDesign Cloud
identity.

- 5 React components deleted:
  - `CloudSignInTip` (the bottom-left "sign in to OpenDesign" callout)
  - `AmrLoginPill` (the sign-in / pending / cancel / console-action button)
  - `AmrBalanceDialog` + module CSS (the "balance exhausted" upgrade prompt)
  - `AmrArtifactUpgradeGate` (the "upgrade your plan" artifact gate)
  - `HomeAmrBalanceGateDialogs` (the Home-page balance-gate host)
  - `ProjectWorkspaceRecoveryTip` + module CSS (the rail account recovery
    tip — only rendered the cloud workspace state)
- 1 component file retained but gated: `AmrOwnerTopUpDialog` (the
  "ask the owner to recharge" dialog) is preserved as a historical
  reference with its mount forced to `if (false)`. The next major
  daemon-side AMR cleanup (PR #2's follow-up) will retire it.
- Settings → AI Providers callout removed.
- Inline model switcher AMR account row removed.
- ChatPane `chat.amrCard.switchCta` reference forced to `if (false)`.
- 19 i18n locales updated; new key `entry.sessionExpired` replaces the
  AMR-specific `entry.authExpiredBody`.
- 18 AMR/Cloud test groups marked `.skip` (kept as a historical
  reference for any future opt-in toggle that re-exposes the cloud
  path).
- New `entry-rail-account-state` test asserts the rail always
  resolves to `'hidden'` across every input shape.

### 1.2 v0.4.1 — `amr` runtime from the agent registry (PR #14, daemon)

**Cut**: the `amr` runtime itself.

- `apps/daemon/src/runtimes/registry.ts`: drop the `amrAgentDef` import
  and the `amrAgentDef` entry from `SHIPPED_AGENT_DEFS`. Registry
  length drops from 27 to 26.
- 26 test files deleted (6 amr, 15 vela, mcp-vela-login,
  diagnostic-amr-runtime-log, db-workspace-resources,
  design-system-workspaceless-delete, design-systems-workspace-cli).
- New `registry-26-agents.test.ts` pins the new shape (no `amr`,
  exactly 26, unique ids, non-empty names).

### 1.3 v0.4.2 — `/api/integrations/vela/*` + 8 vela integrations
**(deferred — see § 4.1)**

The plan called for deleting the 8 vela integrations
(`vela.ts`, `vela-billing.ts`, `vela-command.ts`,
`vela-console-origin.ts`, `vela-errors.ts`, `vela-profile.ts`,
`vela-team-projects.ts`, `vela-wallet.ts`) and the vela routes file
in the same PR as the runtime drop. In practice the integrations
have 33 in-tree consumers across `collab/`, `routes/`, `services/`,
`runtimes/`, and `media/`; gutting all of them in one change was
beyond the PR review budget. The 8 integrations, the
`/api/integrations/vela/*` routes, the `collab/vela-cli-*` family
(5 files), and the `od amr <login|status>` CLI subcommands are
**still in the tree** as of v0.4.1. They are unreachable from the
web UI (PR #13) and from the agent registry (v0.4.1), but the daemon
still answers the endpoints. A follow-up PR will retire them in a
single, focused change.

**Landed as v0.5 (PR #17, merged 2026-10-15)** — see §4.1.

## 2. What was kept (and why)

### 2.1 Local CLI agents — all 26

The remaining 26 agents in the registry are all local CLIs the user
installs on their own machine: Claude Code, Codex, OpenCode, Cursor,
Kimi, Qwen, Hermes, Kiro, DeepSeek, Aider, etc. They are the *only*
way the user runs the fork today.

**Why kept**: the user's machine is the only "cloud" the fork has. The
local CLI is the user — the daemon does not own their identity, their
API keys, or their session. The agent is a thin wrapper around a
child process the user spawned; the daemon's only job is to plumb
the prompt, the streaming output, and the artifacts back to the web
UI.

### 2.2 BYOK providers — openai | anthropic | ollama

Three protocols in `ConnectionTestProtocol` (the `BYOK_*` enum). All
are HTTP, all are addressable from the homelab. No OAuth to a
provider, no cloud-only provider, no per-provider app registration.

**Why kept**: the fork's product surface is "BYOK chat against a local
model or a key the user owns". The protocols are the addressable
surfaces the user can stand up in their network.

### 2.3 The data path under `RUNTIME_DATA_DIR`

The daemon's data root, projects root, and artifacts root. Read the
root `AGENTS.md` **Daemon data directory contract** for the rules.
The fork does not change the path contract — it removes the
remote-identity state (the workspace/team/billing/AMR surfaces) that
the data path used to write into.

**Why kept**: the data path is the foundation the rest of the fork
sits on. Changing it is a separate problem and a separate decision.

### 2.4 The web UI shell, the settings shell, and the agent picker

The web app still mounts the `InlineModelSwitcher` popover, the
`SettingsDialog`, the chat panel, the file viewer, the artifact
preview. The agent picker shows 26 (down from 27); every other
element is unchanged.

**Why kept**: the user can pick a local CLI agent and run their
prompt immediately. The shell is what makes the daemon useful.

## 3. Security trade-offs

The divergence moves the trust boundary from "OpenDesign, Inc." to
"this homelab." Three concrete consequences:

### 3.1 No remote identity, no remote sign-in

The fork has no concept of a workspace owner, a team member, a
billing account, or a wallet. There is no `/api/integrations/vela/*`
endpoint that the user is expected to call from the web UI (the
endpoint is still in the daemon; it is dead from the UI's
perspective).

**Consequence**: anyone with LAN access to the daemon can use it.
This is by design — the fork is single-tenant in practice. The
upstream OIDC SSO + workspace invite flow (M7 in the roadmap) is
explicitly *future* work, not *missing* work.

**Mitigation today**: the LAN is the trust boundary. The
`OD_ALLOW_PRIVATE_NETWORKS=1` default restricts the asset-download
SSRF guard to the homelab. The cloud-metadata
(`169.254.0.0/16`) and CGNAT (`100.64.0.0/10`) blocks stay strict
always.

**Mitigation in M7 (v7+)**: OIDC SSO via Authentik/Keycloak, plug-in
`apps/web` as the relying party, set the daemon's auth middleware to
require a valid `id_token`. The fork inherits the same auth model
the user has on the rest of their homelab services.

### 3.2 No billing or quota surface

The user cannot run out of wallet, cannot see a balance, cannot be
prompted to upgrade. The Local-First daemon is free at the point of
use; the cost is the user's homelab electricity + the model
hardware.

**Consequence**: nothing prevents the user from running a 50-message
loop on a 70B model if they want to. That is a feature, not a bug —
it is the entire reason the fork exists.

**Mitigation today**: the homelab's llama-swap has its own queue
limits and timeouts. If the user wants a quota, they configure
llama-swap. The fork does not implement a quota layer.

### 3.3 No artifact upgrade / paywall

`AmrArtifactUpgradeGate` is gone (PR #1). The "you've used N
credits, upgrade your plan" surface no longer exists. The user can
generate an artifact for free, every time.

**Consequence**: the artifact pipeline has no upper bound. The
homelab's model can be the constraint; the user is otherwise
unlimited.

## 4. Future work

### 4.1 v0.5 — Finish the daemon-side vela cleanup **(landed — PR #17, merged 2026-10-15)**

**Outcome**: landed as one PR as planned — 598 files, +3,603 /
−103,893 (the largest single deletion in the fork so far). The 14
files, the `od amr <login|status>` subcommand, and the gutted 33
consumers went in together; the whole `collab/` service tree (22
files) came out with them since the consumers spanned it. The plan
below is kept as the original design.

The 8 vela integrations + 1 vela routes file + 5 collab/vela-cli-*
files + 1 collab/vela-workspace-context file + the `od amr
<login|status>` CLI subcommand are all still in the tree after v0.4.

**Goal**: delete the 14 files + retire the CLI subcommand + gut the
33 consumers. This is a single PR, but a large one — it touches
`collab/`, `routes/`, `services/`, `runtimes/`, `media/`, and the CLI
parser. Review budget: expect ~30 file changes.

**Test budget**: expect to delete 30+ daemon test files
(daemon-side mirror of PR #1's web-side cleanup) and add a new
regression test that pins the new route surface
(`/api/integrations/vela/*` returns 404, not 200).

**Compatibility risk**: low. The Local-First web UI does not
reference any of these endpoints. The daemon still answers them in
v0.4.1 only for the `od amr` CLI subcommand, which will be removed
in v0.5.

### 4.2 v1 — Local multi-user (M7 in the roadmap)

OIDC SSO via Authentik/Keycloak. The fork becomes multi-tenant-shape:
every request carries a `user_id`, the daemon stores per-user
project ownership, the workspace invite flow is local (no
OpenDesign-side anchor).

**Goal**: a small team on the same LAN can use the same daemon
instance without sharing a Linux account.

**Risk**: the data path contract (root `AGENTS.md`) needs a
per-user prefix scheme. This is the first divergence from the
shared-by-Linux-user storage model.

#### 4.2.1 Storage-shape half lands in v0.6 (this slice)

The data-path half of M7 ships in v0.6, separate from the OIDC
half. v0.6 reshapes `PROJECTS_DIR` from
`<RUNTIME_DATA_DIR>/projects/<projectId>/` to
`<RUNTIME_DATA_DIR>/users/<userId>/projects/<projectId>/` while
the daemon is still single-tenant — `resolveUserId()` returns the
synthetic `"local"` user id, `OD_USER_ID` overrides for tests and
packaged builds, no auth surface added.

This means v7 (M7) is now an auth feature, not a storage rewrite.
The chokepoint is one function in `apps/daemon/src/storage/user-scope.ts`:
v7 swaps `resolveUserId` to read the OIDC `sub` claim and the rest
of the code path follows. The SQLite `projects` table gains a
nullable `user_id` column in the same PR; pre-v0.6 rows surface
the synthetic id at read time, so a botched backfill of legacy
data does not strand existing projects.

The boot-time migration (`apps/daemon/src/storage/user-prefix-migration.ts`)
moves a pre-v0.6 single-tenant `projects/` tree into
`users/local/projects/` once, leaves a marker file, and no-ops
thereafter. It is synchronous so it runs before `openDatabase`, and
it refuses to merge on top of an already-populated target prefix
so a half-finished migration can never brick a daemon. The escape
hatch `OD_USER_PREFIX_MIGRATION=0` lets an operator with a
known-wrong legacy tree keep the daemon starting while they
clean up by hand.

**What this PR does NOT ship**: OIDC SSO, Authentik/Keycloak
integration, Postgres migration, share-link comment/edit, audit
log, per-user quotas, admin settings UI. v0.6 only changes the
on-disk project layout; the user-facing surface is identical.

### 4.3 The escape hatch

Any future PR may re-introduce a single removed surface if it
satisfies all of:

1. The PR adds the runtime / route / integration back with a
   feature flag (`OD_ENABLE_<feature>` env var, default off).
2. The PR does not touch the agent registry or the data path
   contract.
3. The PR includes a new entry in the **Decision log** below
   documenting the reason the surface is back.
4. The PR's plan is reviewed by a maintainer with the
   `daemon-data-path` CODEOWNER.

The flag pattern is the only acceptable way to re-introduce a
removed surface. A `feature/X` branch that simply adds the code
back without the flag will not be merged.

## 5. Decision log

| Date | Decision | Alternatives considered | Why we chose this |
|---|---|---|---|
| 2026-10-12 | Drop the AMR/Cloud sign-in UI (v0.4.0) | (a) keep the UI but point it at a future OIDC provider, (b) replace it with a local password gate | (a) needs a backend that doesn't exist yet, (b) adds a code path the v1 plan does not need |
| 2026-10-12 | Drop the `amr` runtime from the registry (v0.4.1) | (a) keep `amr` in the registry but mark it as `available: false`, (b) keep the runtime but remove the user-facing agent label | (a) leaves dead code in the tree, (b) keeps the cloud code path in the daemon for no user benefit |
| 2026-10-12 | Defer the 8 vela integrations + vela routes + 5 collab/vela-* files + `od amr` CLI subcommand to v0.5 | (a) do it in v0.4.1, (b) drop everything in v0.4.0 | (a) exceeded the PR review budget, (b) required the AMR runtime to also be removed before the agent picker could clean up |
| 2026-10-12 | Keep all 26 local CLI agents | (a) keep only Claude Code + OpenCode, (b) keep only the agents the user has personally tested | (a) limits the user's homelab, (b) the agents are unmaintained upstream and we do not gate on testing |
| 2026-10-12 | Keep BYOK protocols `openai | anthropic | ollama` | (a) keep all 8 upstream protocols, (b) keep only `ollama` | (a) reintroduces the v0.2 problem, (b) the user explicitly wants Anthropic + OpenAI as fallbacks for the local model |
| 2026-10-12 | No billing / quota layer | (a) implement per-user quota in the daemon, (b) rate-limit at the provider level | (a) is the same complexity as M7's auth, (b) is the user's responsibility (llama-swap) |
| 2026-10-12 | The escape hatch is a feature flag, not a branch | (a) a long-lived feature branch that is never merged, (b) a runtime config knob in the Settings UI | (a) rots, (b) the Settings UI is the very thing the divergence removes |
| 2026-10-15 | v0.5 lands as one large PR, not further slices (PR #17) | (a) split by directory across PRs (collab/, integrations/, cli), (b) keep the surface behind a feature flag | (a) the 33 consumers spanned all of those directories, so slicing only added merge-order risk, (b) the Local-First UI never calls any of it and the flag would become dead surface |
| 2026-10-15 | v0.6 lands the per-user project prefix storage-only, with a synthetic `local` user, before auth exists (PR #18) | (a) ship storage + OIDC in one PR, (b) wait for auth before reshaping storage | (a) entangles the data-path migration with the auth surface, (b) every PR in between would keep touching the old path shape; with the prefix already in, v7 is auth-only |
| 2026-10-16 | v0.7 removes the v0.5 stub layer and lifts `@ts-nocheck` on `server.ts` (PRs #19–#21) | (a) keep the stub + `@ts-nocheck` as an accepted escape hatch, (b) rewrite `server.ts` from scratch | (a) the nocheck on the largest daemon file was hiding real type errors, (b) the file was healthy once the stubs were gone — lifting the directive was one line |

## 6. Cross-references

- `claude-design-local-roadmap.md` — the v0.1–v0.7 history and
  the v1 milestone plan.
- `claude-design-local-risks.md` — the 37-row risk register. The
  risks added by the divergence are tagged `local-only` in column 1.
- `claude-design-local-this-weekend.md` — the M0 first slice. Read
  this if you are new to the fork.
- Root `AGENTS.md`, **Daemon data directory contract** — the data
  path rules. Read this before changing anything that touches
  `RUNTIME_DATA_DIR`.
