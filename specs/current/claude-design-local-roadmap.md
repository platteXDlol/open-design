# OpenDesign Local — Roadmap

The master plan for the Local-First fork of OpenDesign. Single source of truth for the fork's direction, milestones, decision log, and handoff payload. Read this first; everything else references it.

## 0. How to read this

- § 1 — Understanding summary (what, why, who, locked constraints)
- § 2 — Phases and milestones (8 stages, 7 milestones)
- § 3 — Stage-by-stage summary (one paragraph each)
- § 4 — Test/eval plan (3 layers)
- § 5 — Open questions (to resolve before v1)
- § 6 — Decision log (every choice, with alternatives)
- § 7 — Handoff payload (for the implementation framework)

Companion documents:
- `claude-design-local-this-weekend.md` — the 2-day first slice (M0)
- `claude-design-local-risks.md` — 37-row risk register

## 1. Understanding summary

### What
A self-hosted, Local-First **Claude Design** clone, forked from `nexu-io/open-design` to `platteXDlol/open-design-local`. Solo developer, phased delivery, OpenDesign's chat / artifact / skill infrastructure reused, Figma-style canvas + other Claude Design gaps built incrementally on top.

### Why
The user wants the Claude Design experience (idea → on-brand artifact → iterate → export → handoff) without the SaaS login wall, the SaaS providers, or the data leaving their homelab. They have a Strix Halo 96 GB unified-memory machine behind llama-swap and want that hardware pointed at Claude Design parity.

### Who
Primary: solo maintainer + family/friends on the LAN. Secondary: open-source community if the fork gains traction. Single-tenant in practice; multi-user-shape data model.

### Locked constraints

- **HTTP providers (6 only):** `openai`, `anthropic`, `ollama`, `vllm`, `openai-custom`, `anthropic-custom`. `azure`, `google`, `senseaudio`, `aihubmix`, `bedrock` and the OAuth-to-provider code path removed.
- **Local CLI agents:** keep all (Claude Code, Codex, opencode, Gemini, etc.), document as an alternative auth story.
- **Provider auth:** BYOK API keys only. No OAuth to providers.
- **Daemon user auth (v1):** username/email + password at first run. Optional OIDC SSO (Authentik/Keycloak) later, activatable in Settings.
- **LAN:** `OD_ALLOW_PRIVATE_NETWORKS=1` default-on for `10.0.0.0/8 + 172.16.0.0/12 + 192.168.0.0/16`. Cloud-metadata (`169.254.0.0/16`) and CGNAT (`100.64.0.0/10`) stay blocked always. Asset-download SSRF guard stays strict always.
- **Deployment:** self-hosted homelab (Proxmox, Docker/Podman, reverse proxy, OIDC SSO later, PostgreSQL from v7).
- **AI backend:** local models via llama-swap, OpenAI-compatible `/v1/chat/completions`. Single model in v1, split by task when ≥2 are loaded.
- **Fork path:** keep `apps/web` + `packages/*` + `skills/` + `design-systems/` + `design-templates/` + `craft/` + `mocks/` + `packages/contracts`. Throw away `apps/desktop`, `apps/packaged`, `apps/closure`, SaaS providers, OAuth-to-provider code.
- **Upstream relationship:** cherry-pick only — own identity, manual security-fix backports from `nexu-io/open-design`.
- **CI:** Woodpecker-only — single pipeline on PR + push to main, runs `pnpm guard` + `pnpm typecheck` + scoped vitest. No `pnpm build` on PR. Full builds local via `pnpm tools-dev`. GitHub Actions deprecated.

### Assumptions (labelled)

- **A.** Repo name `open-design-local`, display "OpenDesign Local". Renames cheap early.
- **B.** License Apache-2.0 (matches upstream).
- **C.** Backend stays Express for v1; migrate to NestJS + Postgres when OIDC SSO + quotas are needed (post-MVP, in v7).
- **D.** Frontend stays Next.js (`apps/web`); new top-level `apps/web/src/components/canvas/` directory added in v2 for the pan/zoom shell.
- **E.** MVP (v1) feature set: Projects + chat + one output type (slide deck) + BYOK provider config + manual design system import (Settings → folder pick) + local HTML/PPTX export. Defer everything else.
- **F.** First output type after landing pages: **slide deck** (most concrete, easiest to measure quality against Claude Design's reference, repeats well for eval).

## 2. Phases and milestones

### Phase timeline (solo, 16-month horizon)

```
2026 Q4        2027 Q1        2027 Q2        2027 Q3        2027 Q4
─────────────  ─────────────  ─────────────  ─────────────  ─────────────
v1 MVP         v2 Canvas      v3 Refine      v4 DS-extract  v5–v8 Inputs/Handoff/Auth/Quotas
3 months       3 months       3 months       2 months       1 month each
```

| Phase | Scope | Duration | Dependencies | Decision gate |
|---|---|---|---|---|
| **v0.1** (this weekend) | 6 providers, LAN toggle, Woodpecker CI, single-artifact chat, llama-swap integration | 2 days | None | "Can I send a prompt and get a streaming valid HTML response?" |
| **v1 — MVP** | Multi-artifact chat, slide-deck output, manual design system import, local HTML/PPTX export, manifest v2 | 3 months | v0.1 | "Can I generate a 5-slide deck in < 5 min and open the HTML in a browser?" |
| **v2 — Canvas** | Figma-style pan/zoom shell, multi-artboard artifacts, tweaks panel, undo/redo via snapshots | 3 months | v1 | "Can I pan/zoom across 10 artboards, drag a tweak slider, and see the change without a model call?" |
| **v3 — Refinement** | Inline comments, direct text editing, on-canvas style inspector, model-generated tweak sliders, "apply everywhere" loop | 3 months | v2 | "Can I leave a comment, get a model fix, and undo it with Cmd+Z?" |
| **v4 — Design systems** | Codebase extraction, screenshot extraction (vision-flagged), `extractedFrom` metadata, DESIGN.md synthesis, multi-system management | 2 months | v1 | "Can I extract a system from my Qwik repo and use it on a new project in < 5 min?" |
| **v5 — Inputs** | DOCX/PPTX/XLSX import, web capture (URL → reference, vision-flagged), codebase import (re-uses v4) | 1 month | v4 | "Can I paste a URL and have tokens extracted from the rendered page?" |
| **v6 — Export + handoff** | Multi-artboard PDF, PPTX export (hybrid), coding-agent handoff bundle, share link view-only, ZIP packaging | 2 months | v2 | "Can I export a handoff bundle and have Claude Code build a working app from it?" |
| **v7 — Sharing + auth** | OIDC SSO via Authentik/Keycloak, Postgres migration, share link comment/edit, audit log | 1 month | v1 | "Can my partner log in via Authentik and view my project via a share link?" |
| **v8 — Quotas + admin** | Per-user quota tracking, org-level default design system, system lock, admin settings UI | 1 month | v1 | "Can I see 'this month I used 12 hours of model time' in Settings?" |

**Total: 16 months solo to full Claude Design parity. Realistic to ship v0.1 + v1 + v2 in 6 months.**

### Milestones

A milestone is reached when a specific user can do a specific thing, end to end, without engineer help.

| # | Milestone | Verified by |
|---|---|---|
| **M0** | "This weekend" — daemon runs in Docker, llama-swap serves a model, BYOK provider config saves, first chat returns a streaming response | Manual: open `http://localhost:7456`, send "Hello", see response |
| **M1** | A user can configure 6 providers and a model route, with a single design system bound to their project | Settings UI screenshot + `GET /api/users/:id/settings` returns the config |
| **M2** | A user can describe a deck in chat and get a multi-artboard artifact (3+ slides) streamed, validated, and rendered | Manual: "5-slide pitch deck for a SaaS pricing page" → 5 HTML files in `artifacts/deck-v1/artboards/` |
| **M3** | The v1 ships — `docker compose up` brings up the stack, the user generates, exports, and shares a deck | `pnpm tools-pack` builds the image; `docker compose up` on a fresh Proxmox host works |
| **M4** | The canvas is up — user can pan/zoom across 10 artboards, drag tweaks, undo a change | Video: pan across a 10-artboard deck, drag a spacing slider, Cmd+Z restores the previous value |
| **M5** | Comments work end to end — user pins a comment, model reads it on next turn, fixes the issue, user marks it resolved | Video: pin a comment, model returns a fix, resolved count increments |
| **M6** | A handoff bundle is generated and consumed by Claude Code to build a working app | Video: export handoff, drop into a fresh repo, Claude Code writes a Next.js app that visually matches the design |
| **M7** | OIDC SSO works — user logs in via Authentik, project is shared with a partner via link, partner views it | Manual: log in via OIDC, generate share link, open in incognito, see the project |

## 3. Stage-by-stage summary

### Stage 1 — Product scope + architecture
Self-hosted, Local-First Claude Design clone. Fork OpenDesign (not from-scratch — saves 5–8 months of reinventing chat infra). Keep `apps/web`, `packages/*`, `skills/`, `design-systems/`, `design-templates/`, `craft/`, `mocks/`, `packages/contracts`. Throw away `apps/desktop`, `apps/packaged`, `apps/closure`, SaaS providers, OAuth-to-provider code. Backend stays Express for v1; NestJS + Postgres deferred to v7. Frontend stays Next.js; new `apps/web/src/components/canvas/` for v2. AI backend is llama-swap (OpenAI-compatible).

### Stage 2 — Data model
- **Per-project** structure under `RUNTIME_DATA_DIR/projects/<project-id>/`: `project.json`, `chat/turns.jsonl`, `design-system.json` (or ref into `design-systems/<id>/`), `artifacts/<id>/{manifest.json, tweaks.json, comments.json, artboards/<id>.html, snapshots/}`, `versions/<sid>.{json,tar.zst}`, `shares/<token>.json`.
- **Manifest v2** adds `artboards[]` with `x/y/w/h` for multi-artboard support. v1 manifests stay readable; v1 is read-only after v2 lands.
- **Comments** are anchored to elements via `selector` + `domPath` fallback + `bbox` for screenshot-region pinning. Open comments on the active artboard are injected into the model's next-turn context.
- **Tweaks** are CSS variables the model emits; the host renders sliders that write to the iframe via postMessage without a model call.
- **Version snapshots** are full-project tarballs + metadata; 50-snapshot LRU retention.
- **Share links** are random tokens with permission flags; v1 ships view-only, full permission model in v7.

### Stage 3 — Generation pipeline
- **Agent loop**: one-shot Plan turn (one model call, ≤ 800 tokens output) → execute loop (per-artboard write + render-and-check) → finalize.
- **Six tools** (JSON-schema, OpenAI-compatible tool calling): `write_artboard`, `list_artboards`, `read_artboard`, `set_tweaks`, `add_comment`, `update_project_meta`. Anything else routes through daemon-side intent classification.
- **Per-turn context budget** ~12K tokens for local models: system prompt ~6K, tool schemas ~1.5K, conversation ~2K, active artboard ~1–2K, manifest summary + comments + tweaks + design tokens ~1.3K. Lazy-load artboards on demand.
- **Structured output strategy**: tool-calling for local models (Qwen3 family — `Qwen3.6-35B-A3B` by default, with `Qwen3.8-27B` and `Qwen3-Coder-Next` as fallbacks; Llama-3.3-70B and DeepSeek-Coder also tested) handles tool calls reliably; `<artifact>` parser path retained for cloud BYOK (OpenAI, Anthropic). Switch is `RuntimeAgentDef.promptInputFormat` per runtime.
- **Local-model output discipline** pinned LAST in the system prompt (per existing OpenDesign pattern, matching the deck-framework pinning for load-bearing constraints).
- **Validation** in three layers, cheapest first: static (HTML must pass `validateHtmlArtifact`, no placeholders, no third-party URLs, ≤ 24 KB per artboard); render-and-check (off by default, opt-in per-artifact); self-review (user-triggered, never auto-apply).
- **Model routing config** lives in `apps/daemon/src/runtime/routing.ts`; Settings UI table is editable live. Default for v1: single model for everything, vision disabled, warmup on startup.

### Stage 4 — Canvas and editor
- **Pan/zoom shell** at `apps/web/src/components/canvas/` (new). Wraps the existing `FileViewer` per-artboard; each `ArtboardFrame` is one iframe. Lazy-mount ±2 neighbors; off-screen = placeholder thumbnail.
- **Zustand store** for selection (`{ selectedArtboardId, selectedElement, hoveredElement, tool, viewport, undoStack }`) and canvas UI state.
- **Four new postMessage extensions**: `od:canvas-element-rect`, `od:canvas-element-hover`, `od:canvas-edit-applied`, `od:canvas-tweaks-apply`. Reuse the existing `isOurIframe(ev.source)` pattern from `file-viewer-render-mode.ts`.
- **Tweak panel** is a fixed right rail; CSS variables; no model calls.
- **Comment overlay** loads `comments.json` and queries iframe for live rects; pins are anchored to selector + bbox.
- **Direct text edit** is `contenteditable` in the iframe; on `blur` the iframe posts the new HTML; host writes via `POST /api/projects/:id/artifacts/:aid/artboards/:bid/content`.
- **Undo/redo** is file-based snapshots (cheaper than in-memory diff; survives restart). Per-artboard scope, not per-project.

### Stage 5 — Design systems
- **Manifest v2** adds `instructionFile`, `previewCards[]`, `extractedFrom` to the existing `design-systems/<id>/manifest.json` format. 155 systems ship as-is.
- **Codebase extraction pipeline**: read CSS variables / Tailwind config / CSS-in-JS / style dictionaries / top-N components → cluster tokens → synthesize DESIGN.md via one local model call (~30–60s) → write manifest v2 + tokens.css + components.html + preview cards.
- **Screenshot extraction** is vision-flagged; uses the `vision` model route. When vision is empty, the endpoint returns 503 with a clear error.
- **Application at generation time**: `instructionFile` is injected into every turn with the active system (~800 tokens); token subset ~300 tokens; component samples lazy-loaded; preview cards plan-turn-only. Total ~2.6K per turn, leaves the 12K budget intact.
- **Multi-system management**: project → system binding, user default, system default ("default"). Per-call override is allowed; swap enforced at turn boundaries only.
- **Built-in systems are read-only** — edit forks under `design-systems/user/<user-id>/<system-id>-fork/`. Per-project color overlay avoids forking for one-token changes.

### Stage 6 — Export and handoff
- **PDF export** extends existing to multi-artboard (one print per artboard via headless Chromium). Strategy 3 (hybrid): semantic text mapping + screenshot backgrounds. New tool `export_pdf`.
- **PPTX export** new; three strategies (semantic / screenshot / hybrid), default hybrid. New tool `export_pptx` + endpoint. Uses `pptxgenjs`.
- **Standalone HTML** publish at `/p/<token>.html` with strict CSP (`connect-src 'none'`, `frame-ancestors 'none'`, `form-action 'none'`). New `POST /api/projects/:id/artifacts/:aid/publish`.
- **ZIP export** of `manifest.json` + artboards + tweaks + active design system + auto-generated README.
- **Coding-agent handoff bundle** new; the killer Local-First feature. Output: `manifest.json` + artboards + design-system/{tokens.css, DESIGN.md, components.manifest.json, components/} + `interactions.json` (extracted from tweaks + comments + data-* attrs) + auto-generated `SPEC.md` + `HANDOFF.md` for the human.
- **Share link view-only** at `/s/<token>`; full permission model in v7.

### Stage 7 — Collaboration, auth, deployment, security
- **OIDC SSO** via Authentik/Keycloak (opt-in, Settings-activated). PKCE flow; first OIDC user becomes admin; local password user is always fallback admin. `OD_RESET_ADMIN=1` recovery env issues a one-time token in the logs.
- **Quota tracking** (per-user, per-month): turns, modelTokens in/out, modelTimeMs, artifacts.created, snapshots.created, exports. Pure self-tracking, no billing integration.
- **Admin settings**: user management, OIDC provider management, org default design system, system lock, audit log (90-day default).
- **Sandboxing**: iframe `sandbox="allow-scripts"` (no `allow-same-origin`) for default preview; `sandbox="allow-scripts allow-same-origin"` for "powered preview" (existing pattern). Published HTML gets strict CSP.
- **Prompt-injection defenses** for codebase extraction: file-content size cap (1 MB), suspicious-pattern regex scan, sandboxed synthesis prompt, user review.
- **Homelab deployment** via `deploy/homelab/docker-compose.yml` + Caddy reverse proxy + `host.docker.internal` to reach llama-swap on the host.
- **Backup** via nightly tarball + GPG encryption; LRU 14-day rotation; optional rsync to a second Proxmox host.

### Stage 8 — Roadmap, milestones, test/eval, risks
- 8 phases, 7 milestones (M0 through M7), 16-month solo horizon.
- 3-layer test/eval: Vitest (existing) + Playwright (existing) + **design-quality eval** (new, the local-model-specific layer). 20-case corpus; static checks (automatic) + design-system adherence (vision-graded, opt-in) + human-rated (manual, sampled).
- 37-row risk register (consolidated in `claude-design-local-risks.md`).
- "This weekend" 2-day first slice (in `claude-design-local-this-weekend.md`).

## 4. Test/eval plan

### Layer 1 — Unit + integration (existing)

- **Vitest** for `apps/daemon/tests/`, `packages/contracts/tests/`, `apps/web/tests/`
- Coverage floor: 70% on contracts, 60% on daemon, 50% on web
- New: every new tool (Stage 3 §C) gets a tool-schema-validation test
- New: every new postMessage (Stage 4 §E) gets a receive-filter test
- New: every new endpoint (Stages 2–7) gets a Vitest route test with mock auth

### Layer 2 — E2E (existing)

- **Playwright** under `e2e/` for user-flow tests
- New: e2e test for "first-run wizard" (create user, configure provider, generate first artifact)
- New: e2e test for "multi-artboard generation" (10-slide deck, check 10 artboards persisted)
- New: e2e test for "tweak slider" (drag slider, verify `od:canvas-tweaks-apply` post, verify CSS var applied)
- New: e2e test for "handoff bundle" (export, unzip, validate manifest.json + SPEC.md present)

### Layer 3 — Design-quality eval (NEW)

The hard one. Local models produce variable quality; we need a way to measure "is this design any good?" without human review of every generation.

**Test corpus** at `tests/eval/cases/*.json` — 20 cases covering: deck (3), one-pager (3), design/prototype (3), design system (3), document (3), multi-artboard edge cases (5).

Example case:
```json
{
  "id": "deck-5-saas-pitch",
  "brief": "5-slide pitch deck for an early-stage SaaS that helps indie hackers launch faster. Modern Minimalist design system.",
  "outputType": "deck",
  "expectedArtboardCount": 5,
  "designSystemId": "default",
  "mustContain": ["Pricing", "Demo", "Contact"],
  "mustNotContain": ["TBD", "TODO", "lorem", "ipsum"]
}
```

**Three scoring dimensions**:

1. **Static** (automatic, no model):
   - HTML validation pass rate (all artboards pass `validateHtmlArtifact`)
   - Manifest v2 conformance
   - No placeholder text (regex scan)
   - No third-party URLs
   - Artboard size ≤ 24 KB
   - Token count output (rough sanity: not 0, not 50K)

2. **Design-system adherence** (model-graded, opt-in):
   - Send the rendered artboard + the system's `tokens.css` to a vision-capable model
   - Prompt: "Does the rendered design use the specified tokens? Score 0..1."
   - Average across the corpus. Local model quality bar: ≥ 0.6 average.

3. **Human-rated** (manual, sampled):
   - 1 in 10 generations rated by the maintainer on a 1–5 scale
   - Tracks over time; regression alerts if average drops > 0.5 in a month

**CI integration** (Woodpecker):
- Static checks: every PR
- Design-system adherence: nightly (too slow for PR feedback)
- Human rating: not in CI; maintainer reviews the weekly report

**Eval output**: `tests/eval/reports/<date>.json` with per-case scores + aggregate.

## 5. Resolved decisions (locked 2026-10-05)

All five open questions resolved. The plan is fully locked for v0.1 and v1.

- **OQ-1 (Model).** Qwen3 family in llama-swap. Primary default: `Qwen3.6-35B-A3B` (MoE, ~35B total / ~3B active, fast on the Strix Halo). Fallbacks available: `Qwen3.8-27B` (dense, ~27B), `Qwen3-Coder-Next` (code-specialized variant). Model route config defaults to whichever is loaded first; the user picks the active model in Settings → Models. All three are 2026-generation Qwen3 models and handle OpenAI-compatible tool calling reliably.
- **OQ-2 (Output type).** Slide deck. Confirmed. The eval corpus (`tests/eval/cases/`) will lead with deck cases.
- **OQ-3 (Phase order).** MVP first (v1), canvas in v2. Confirmed. v1 ships single-artifact chat with one iframe per artifact; the Figma-style pan/zoom shell arrives in v2.
- **OQ-4 (NestJS timing).** Post-MVP, in v7. Confirmed. v1 through v6 stay on Express + SQLite. The migration lands when OIDC SSO + quota tracking need Postgres.
- **OQ-5 (Branding).** Defer to v1 GA. Confirmed. v0.1 and v1 ship with upstream's branding. A small "OpenDesign Local" badge and wordmark land with the v1 GA release.

## 6. Decision log

| Decision | Alternatives considered | Why chosen |
|---|---|---|
| **Fork OpenDesign, not from-scratch** | Greenfield | Reuse 6–12 months of chat infra; fork delivers 50% from day 1. |
| **6 HTTP providers only** (openai, anthropic, ollama, vllm, openai-custom, anthropic-custom) | All upstream + curated subset | Matches user's explicit list; cleanest Local-First stance. |
| **`OD_ALLOW_PRIVATE_NETWORKS=1` default-on for RFC1918 (10/8 + 172.16/12 + 192.168/16)** | Default off (opt-in) | User's product stance is Local-First; LAN open by default. |
| **Cloud-metadata (169.254/16) and CGNAT (100.64/10) stay blocked always** | Open everything in RFC1918 | Defense-in-depth: cloud-metadata is exfil risk; CGNAT overlap with containers weakens DNS-rebinding defense. |
| **Asset-download SSRF guard stays strict** (no allowlist, no toggle) | Make toggleable | Issue #5478 — strict guard is non-negotiable for attacker-controllable URLs. |
| **Username/email + password for v1; OIDC opt-in later** | OIDC-only | OIDC requires external IdP; v1 keeps zero-external-deps. |
| **Express + SQLite for v1; NestJS + Postgres for v7+** | NestJS from day 1 | Bigger lift; defer until OIDC + quotas need it. |
| **Woodpecker-only CI; drop GitHub Actions** | Keep both | User-requested; lighter, faster, fits self-hosted ethos. |
| **Cherry-pick upstream, not PR-back** | PR-back-when-ready | Provider/auth divergence makes upstream merge unlikely. |
| **Single llama-swap model for v1; split later** | Multi-model from day 1 | Simpler; routing complexity kicks in when ≥2 models exist. |
| **Tool-calling for local models; `<artifact>` parsing for cloud** | Always tool-calling | Local models are weaker at free-form; tool-calling is more reliable. |
| **One iframe per artboard, lazy-mount ±2** | Single iframe with all artboards | Memory bounded; cross-artboard isolation. |
| **Tweaks as CSS variables, host-driven** | Model-driven on every change | Zero model tokens; instant slider drags. |
| **Snapshot per `write_artboard`, scoped to the changed artboard** | Full-project snapshot per turn | 10× write-amplification reduction. |
| **Per-turn context budget ~12K for local models** | All-artboard always-included | Smaller context = more reliable generation. |
| **OIDC group → role mapping (not just first-user)** | First-user-only admin | More flexible; first-user is the bootstrap. |
| **Nightly tarball + GPG encryption; rsync opt-in** | Continuous rsync | Cheaper, simpler, sufficient for solo. |
| **CSP `connect-src 'none'` for published HTML** | Allow `connect-src 'self'` | Static published HTML should not phone home. |
| **PPTX default = hybrid (semantic + screenshot)** | Screenshot-only | Better quality for design-heavy decks. |
| **Handoff bundle = HTML + tokens + components + interactions + SPEC.md** | HTML only | SPEC.md is the bridge to Claude Code / opencode. |
| **Path A (docs first, code later) for the first PR** | Path B (docs + code in one PR) | Smaller blast radius; collaborator review before code lands. |

## 7. Handoff payload

For Phase 1+ implementation. To be passed verbatim to whichever implementation framework the user picks (default: `enterprise-project-analyzer` or direct execution).

```yaml
understanding_summary:
  what: "Self-hosted, Local-First Claude Design clone, forked from nexu-io/open-design to platteXDlol/open-design-local. Solo dev, phased delivery, OpenDesign's chat/artifact/skill infrastructure reused, Figma-style canvas + other Claude Design gaps built incrementally."
  why: "User wants the Claude Design experience (idea → on-brand artifact → iterate → export → handoff) without the SaaS login wall, SaaS providers, or data leaving their homelab. Strix Halo 96 GB unified memory + llama-swap + 27-80B local models."
  who: "Solo maintainer + family/friends on LAN. Open-source community if it gains traction."
  constraints_locked:
    - "6 HTTP providers: openai, anthropic, ollama, vllm, openai-custom, anthropic-custom. azure/google/senseaudio/aihubmix/bedrock removed."
    - "Local CLI agents (claude, codex, opencode, etc.): keep all."
    - "Provider auth: BYOK API keys only. No OAuth to providers."
    - "Daemon user auth: username/email + password at first run. Optional OIDC later."
    - "LAN: OD_ALLOW_PRIVATE_NETWORKS=1 default-on for 10/8 + 172.16/12 + 192.168/16. Cloud-metadata (169.254/16) and CGNAT (100.64/10) stay blocked. Asset-download SSRF guard stays strict."
    - "Deployment: self-hosted homelab (Proxmox, Docker/Podman, reverse proxy, OIDC SSO later, PostgreSQL)."
    - "AI backend: local models via llama-swap, OpenAI-compatible /v1/chat/completions."
    - "Fork path: keep apps/web + packages/* + skills/ + design-systems/ + design-templates/ + craft/ + mocks/ + packages/contracts. Throw away apps/desktop, apps/packaged, apps/closure, SaaS providers, OAuth-to-provider code."
    - "Upstream relationship: cherry-pick only."
  path: "Fork OpenDesign. ~6 months to v1+v2 (MVP + canvas). 12-16 months solo to full Claude Design parity."

assumptions:
  - A: "Repo name: open-design-local; display: OpenDesign Local."
  - B: "License: Apache-2.0."
  - C: "Backend stays Express for v1; NestJS+Postgres for v7+."
  - D: "Frontend stays Next.js (apps/web); new apps/web/src/components/canvas/ for v2."
  - E: "CI: Woodpecker-only; no pnpm build on PR."
  - F: "MVP (v1): chat + slide-deck + 6 providers + manual design system + local HTML/PPTX export."

open_questions: []  # all five resolved 2026-10-05 — see § 5

resolved_decisions:
  - "OQ-1: Qwen3 family. Default Qwen3.6-35B-A3B; fallbacks Qwen3.8-27B, Qwen3-Coder-Next."
  - "OQ-2: First output type is slide deck."
  - "OQ-3: MVP (v1) before canvas (v2)."
  - "OQ-4: Express stays until v7. NestJS + Postgres migration in v7."
  - "OQ-5: Branding badge deferred to v1 GA."

decision_log: "See § 6 — 22 decisions logged."

context_snapshot:
  files_read:
    - "AGENTS.md (root + .github + apps + packages + apps/daemon + apps/web/components/chat)"
    - ".github/workflows/ci.yml"
    - ".github/AGENTS.md"
    - "apps/daemon/src/connectionTest.ts (lines 100-330)"
    - "apps/daemon/src/origin-validation.ts (lines 50-100)"
    - "apps/daemon/src/prompts/system.ts (lines 1-120, plus 905 fork point)"
    - "packages/contracts/src/api/connectionTest.ts (full)"
    - "packages/contracts/tests/connection-test.test.ts (full)"
    - "apps/web/src/artifacts/types.ts, manifest.ts, parser.ts, validate.ts, renderer-registry.ts"
    - "apps/web/src/components/file-viewer-render-mode.ts (full)"
    - "apps/web/src/components/FileViewer.tsx (first 100 lines, plus postMessage bridge references)"
    - "apps/web/src/runtime/srcdoc.ts (postMessage bridge surface)"
    - "apps/web/src/runtime/exports.ts (existing export surface)"
    - "apps/daemon/src/routes/design-systems.ts (first 80 lines)"
    - "design-systems/default/DESIGN.md (60 lines)"
    - "deploy/Dockerfile (first 60 lines)"
    - "deploy/README.md (first 120 lines)"
  stage_outputs:
    - "Stage 1: Product scope + phases + architecture (Mermaid) + tech stack"
    - "Stage 2: Data model + file formats (9 schemas with example JSON)"
    - "Stage 3: Generation pipeline (agent loop, 6 tool schemas, system prompt, context budget, structured output, model routing)"
    - "Stage 4: Canvas + editor (pan/zoom shell, 4 new postMessage, comments, tweaks, undo/redo)"
    - "Stage 5: Design system v2 + codebase/screenshot extraction + multi-system management"
    - "Stage 6: PDF/PPTX/HTML/ZIP/handoff exports + share link view-only"
    - "Stage 7: OIDC SSO + quota + admin + sandboxing/CSP + prompt-injection defenses + homelab deployment + backup"
    - "Stage 8: Roadmap + milestones + 3-layer test/eval + 37-row risk list + 'this weekend' 2-day plan"

target_skill: "enterprise-project-analyzer (or direct execution)"
mode: "step-by-step (default)"
```

## 8. Source files for the 8-stage plan

The full 8-stage design is in this repository's chat history (the brainstorming session that produced this doc). Each stage:

- **Stage 1** — Product scope, MVP vs. later phases, system architecture (Mermaid), tech stack with justification.
- **Stage 2** — Data model and file formats: project, manifest, artboard files, versions, comments, tweaks, design system, share links, users. Includes 9 example JSON schemas.
- **Stage 3** — Generation pipeline: agent loop shape, six tool definitions (JSON schemas), system-prompt design (local-model discipline pinned LAST), per-turn context budget table, structured-output strategy, progressive delivery, three-layer validation, model routing config.
- **Stage 4** — Canvas and editor: pan/zoom shell, artboard layout consumer, Zustand selection model, four new postMessage extensions, comment overlay, tweak panel, direct text editing, undo/redo via snapshots.
- **Stage 5** — Design-system extraction: manifest v2 format, codebase extraction pipeline, screenshot extraction (vision-flagged), application at generation time, multi-system management.
- **Stage 6** — Export and handoff: PDF (multi-artboard), PPTX (hybrid default), standalone HTML publish, ZIP packaging, coding-agent handoff bundle, share link view-only.
- **Stage 7** — Collaboration, auth, deployment, security: OIDC SSO via Authentik/Keycloak, quota tracking, admin settings, sandboxing + CSP, prompt-injection defenses, homelab deployment, backup strategy.
- **Stage 8** — This document. Roadmap, milestones, test/eval, risks, "this weekend" first slice.
