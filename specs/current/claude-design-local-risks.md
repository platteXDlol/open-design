# OpenDesign Local — Risk List

Consolidated risk register across the 8 stages of `claude-design-local-roadmap.md`. Updated as the fork progresses; reviewed at each milestone.

## Severity

- **High** — blocks a milestone or causes data loss if unmitigated
- **Medium** — degrades a feature or causes user-visible friction
- **Low** — nice-to-fix; rarely blocks

## High-severity risks

| ID | Risk | Mitigation | Owner | Phase |
|---|---|---|---|---|
| **R1** | Canvas is the longest single thread (~3 months) and gates most refinement features. | Scope cuts in v2: text-edit first, drag-resize later. Ship multi-artboard without full pan/zoom if needed. | Solo | v2 |
| **R2** | Local model context (16–32K) is the binding constraint on every generation turn. | Aggressive lazy-loading (per-turn budget ~12K). Per-artboard context assembly, not per-project. | Solo | All |
| **R4** | Solo-dev velocity — 6–12 months to Claude Design parity is realistic; 12+ months is also realistic. | Ship MVP first. "This weekend" + M0 is the first shippable slice. Re-evaluate scope at M3. | Solo | All |
| **R5** | Single-machine deployment — disk failure on the Proxmox host = data loss unless backed up. | Nightly tarball + GPG encryption + optional rsync to a second host. Document the restore procedure. | Solo | v1 |
| **R12** | Tool-call reliability on local models — schema must be unambiguous; some local models hallucinate or skip tool calls. | Schema-pinned tool calls, retry budget 1, telemetry for per-tool failure rates so we know which tool is fragile. | Solo | v1 |
| **R34** | Backup encryption key loss — if the user loses the GPG passphrase, the backups are unreadable. | Document the requirement in the homelab README; recommend storing the passphrase in a password manager AND in a sealed envelope. | Solo | v7 |

## Medium-severity risks

| ID | Risk | Mitigation | Owner | Phase |
|---|---|---|---|---|
| **R3** | Vision support not guaranteed on the user's llama-swap models. | Best-effort, flag-gated. Screenshot extraction requires an explicit vision route in Settings. | Solo | v4-v5 |
| **R6** | Skill ecosystem may assume Claude-specific behaviors (specific tool-use formats, function-calling shapes). | Audit `skills/` early in v1. Document per-skill "needs Claude" badges. | Solo | v1 |
| **R7** | llama-swap swap latency — first request to a cold model can take 5–30s. | `warmupOnStartup: true`. `coldStartMessage` shown in chat during swap. | Solo | v1 |
| **R9** | Manifest v1 → v2 migration — existing single-artboard artifacts must keep working. | Backward-compat parser reads both v1 (`entry` field) and v2 (`artboards[]` field). v1 is read-only after v2 lands. | Solo | v1 |
| **R11** | Local model context with multi-artboard artifacts — including all artboards blows the budget. | Lazy-load artboards on demand. Only include the artboard being edited plus brief summary of others. | Solo | v1-v3 |
| **R13** | llama-swap cold-start latency (same as R7). | (Same as R7.) | Solo | v1 |
| **R15** | Plan turn output variance — local models can produce malformed Plan JSON. | Schema-pinned `emit_plan` tool call. Runtime validates and falls back to "no plan, sequential artboards" on failure. | Solo | v1 |
| **R16** | Iframe proliferation — 20 artboards = 20 iframes. Memory bounded but real. | Lazy-mount off-screen artboards (focused + ±2 neighbors; unmount further with placeholder thumbnails). | Solo | v2 |
| **R17** | Iframe-to-iframe cross-talk on `appliesTo: 'all'` tweaks — who owns the canonical value? | Host owns `tweaks.json`. Iframes are read-only mirrors via `postMessage`. | Solo | v2 |
| **R18** | Selector invalidation across edits — direct text edit can invalidate CSS selectors. | Fallback `domPath` plus bbox handles this. UX shows a "stale anchor" indicator. v1 ships the fallback. | Solo | v2-v3 |
| **R20** | Snapshot write amplification — every `write_artboard` snapshots the full project tree by default. | Snapshot only the changed artboard per `write_artboard`. Full-project snapshot only on user "save version". | Solo | v2 |
| **R23** | DESIGN.md synthesis quality from local model — vague or hallucinated guidance. | User-editable preview before commit. Synthesis prompt explicitly forbids invention. | Solo | v4 |
| **R25** | Multi-system swap mid-generation confuses the local model. | Enforce turn-boundary swap. Refuse mid-tool-call. | Solo | v4 |
| **R27** | PPTX semantic mapping is approximate — design-heavy decks lose fidelity vs HTML. | Hybrid strategy with screenshot backgrounds. User can force `screenshot` for pixel parity. | Solo | v6 |
| **R29** | Handoff bundle can leak design intent if shared publicly. | Owner-only handoffs. Public share uses a redacted bundle (no SPEC.md, no comments). | Solo | v6 |
| **R30** | SPEC.md hallucination risk — local models may invent features not in the design. | Strict prompt forbids invention. Heuristic check flags SPEC.md sections that lack corresponding artboards/components/comments. User reviews. | Solo | v6 |
| **R33** | OIDC misconfiguration can lock out the only admin. | Local password user always admin; OIDC admins are additive. Recovery env `OD_RESET_ADMIN=1` issues a one-time admin token in the logs. | Solo | v7 |
| **R35** | Prompt-injection in codebase extraction — a poisoned `tailwind.config.ts` could trick DESIGN.md synthesis. | File-content size cap (1 MB per file). Regex scan for known injection patterns; flagged files require user approval. Synthesis prompt treats codebase as untrusted. User reviews synthesized DESIGN.md before commit. | Solo | v4 |

## Low-severity risks

| ID | Risk | Mitigation | Owner | Phase |
|---|---|---|---|---|
| **R8** | BYOK provider config drift — users will mix local llama-swap with cloud BYOK (OpenAI/Anthropic API). | Clear UI distinction in Settings. Per-provider routing in `ModelRouteConfig`. | Solo | v1 |
| **R10** | Artboard x/y/w/h metadata unused in v1 (canvas ships in v2). | Manifest ships the fields anyway; missing fields default to a column layout. | Solo | v1 |
| **R14** | Render-and-check cost (headless Chromium). | Off by default. Per-artifact opt-in flag in the chat composer. | Solo | v1 |
| **R19** | Comment injection cost — every turn with open comments re-injects them into model context. | Only inject open comments on the active artboard, capped at the last 5 unresolved. | Solo | v2 |
| **R21** | Codebase extraction is slow on large repos (5K files = 1–2 min; 50K files = 10+ min). | Cap at 10K files; warn user for larger. | Solo | v4 |
| **R22** | Screenshot extraction depends on vision (opt-in). | Default off. Clear error message when vision route is empty. | Solo | v4 |
| **R24** | Token normalization can lose semantic meaning (e.g., Tailwind `blue-500` vs the user's "primary" blue). | Cluster by closest-neighbor in color space. User can override. | Solo | v4 |
| **R26** | Built-in system edits — clone-and-fork is heavy for a one-token change. | Per-project color overlay (no fork). | Solo | v4 |
| **R28** | PDF stitching across artboards is slow (10 artboards × 1s print = 10s; user waits). | Stream progress via SSE; show a per-artboard progress bar. | Solo | v6 |
| **R31** | `pptxgenjs` font embedding — embedded fonts can blow up the PPTX size. | Reference fonts by default; opt-in to inline when the user has a specific font-fidelity requirement. | Solo | v6 |
| **R32** | Headless Chromium memory cost for PDF/PPTX hybrid rendering. | Serial, not parallel. Clean up between artboards. | Solo | v6 |
| **R36** | Caddy automatic TLS requires a public DNS — fails for homelab-only deployments. | Caddy supports `tls internal` for self-signed homelab use. Document both modes. | Solo | v7 |
| **R37** | OIDC `clientSecret` storage at rest — sensitive. | Encrypted with `OD_SECRET_KEY` (32-byte base64). Key rotation supported via `OD_SECRET_KEY_OLD`. | Solo | v7 |

## Risk review cadence

- **At every milestone** (M0, M1, M2, ...) — review high-severity items; add new risks discovered during the milestone work.
- **Monthly** — review medium-severity items; close any that have been mitigated; promote newly discovered blockers.
- **At every phase boundary** (v1, v2, ...) — full sweep of all severities; reset the "owner" column if the maintainer changes.

## Out-of-scope risks (acknowledged but not in this fork)

- **Live multi-user collaborative editing with real-time cursor sync.** Claude Design supports this on a shared cloud canvas. OpenDesign Local does not; single-user per daemon. The local-first stance argues against it.
- **Pixel-perfect Figma-grade transform handles.** Claude Design explicitly does not aim for this; OpenDesign Local matches.
- **All upstream SaaS connectors (Adobe, Canva, Gamma, Miro, Vercel, Wix, etc.).** Document the SaaS trade-off; the user can run a cloud OpenDesign alongside the local one if they need a specific connector.
- **Public hosting / multi-tenant SaaS.** Out of scope for a Local-First fork. The homelab deployment is the supported shape; a VPS is supported with the same Docker Compose but is not the recommended target.
