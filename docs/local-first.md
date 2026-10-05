# Local-First OpenDesign

OpenDesign Local is a self-hosted, Local-First fork of OpenDesign. The goal is a Claude-Design-quality design tool that runs on your own hardware, uses your own AI provider keys, and keeps your data on your LAN.

## What it is

- A self-hosted daemon + web UI you run in Docker on a home server, NAS, or Proxmox VM.
- Talks to AI providers via standard OpenAI-compatible `/v1/chat/completions`. Works with cloud BYOK (OpenAI, Anthropic) and local model servers (llama-swap, Ollama, vLLM).
- Six HTTP providers: `openai`, `anthropic`, `ollama`, `vllm`, `openai-custom`, `anthropic-custom`. No login wall, no subscription button.
- Optional OIDC SSO via Authentik/Keycloak, activated in Settings. Username + password works out of the box.
- LAN-reachable: the daemon can serve other devices on your home network. Toggle on with an env var; default is loopback-only.

## What it is not

- Not a SaaS. No telemetry, no remote analytics, no centralized account.
- Not multi-tenant. One user or one small group on a LAN.
- Not a drop-in replacement for OpenDesign's full feature set. The fork targets Claude-Design parity incrementally; the MVP ships with chat + one output type + design system import.
- Not committed to upstream. The fork cherry-picks security fixes from `nexu-io/open-design`; it does not aim to merge back.

## LAN access and the `OD_ALLOW_PRIVATE_NETWORKS` toggle

By default the daemon refuses to connect to user-configured AI provider endpoints on private IP ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`). This is the upstream safeguard from `packages/contracts/src/api/connectionTest.ts:isBlockedExternalApiHostname()`.

OpenDesign Local flips that default for the Local-First case: `OD_ALLOW_PRIVATE_NETWORKS=1` is the default. Setting it to `0` restores the strict behavior.

| Range | Default | When `OD_ALLOW_PRIVATE_NETWORKS=0` |
|---|---|---|
| `127.0.0.0/8`, `::1`, `localhost`, `*.localhost` | Always allowed | Always allowed |
| `10.0.0.0/8` | Allowed | Blocked |
| `172.16.0.0/12` | Allowed | Blocked |
| `192.168.0.0/16` | Allowed | Blocked |
| `100.64.0.0/10` (CGNAT) | Blocked | Blocked |
| `169.254.0.0/16` (cloud metadata) | Blocked | Blocked |
| `0.0.0.0/8`, `>=224.0.0.0/4` (multicast) | Blocked | Blocked |

The asset-download SSRF guard (the part that protects against compromised upstream gateways; see upstream issue #5478) is **always** strict. Setting `OD_ALLOW_PRIVATE_NETWORKS=0` does not weaken it; setting `OD_ALLOW_PRIVATE_NETWORKS=1` does not weaken it either.

## The six providers

| Protocol | Default base URL pattern | Auth |
|---|---|---|
| `openai` | `https://api.openai.com/v1` (overridable) | BYOK API key |
| `anthropic` | `https://api.anthropic.com` (overridable) | BYOK API key |
| `ollama` | `http://127.0.0.1:11434/v1` | None |
| `vllm` | `http://127.0.0.1:8000/v1` | None |
| `openai-custom` | User-supplied OpenAI-compatible base URL | BYOK API key (optional) |
| `anthropic-custom` | User-supplied Anthropic-compatible base URL | BYOK API key (optional) |

The two `*-custom` entries are the recommended way to point at a remote llama-swap, vLLM, OpenRouter, or any other OpenAI/Anthropic-compatible gateway. Both `ollama` and `vllm` are first-class protocols because they are the two most common local model servers; the custom variants cover everything else.

## Daemon user auth

The daemon runs a SQLite-backed user table. On first run, create a username/email + password. After that, the daemon serves `/api/*` with bearer-token auth.

Optional later: OIDC SSO. When activated in Settings, the login page shows a "Sign in with [provider]" button alongside the password form. The first OIDC user becomes admin automatically; the local password user is always a fallback admin.

## Quick start

```bash
# 1. Pull the image (or build locally for LAN reachability)
docker pull ghcr.io/platteXDlol/od-local:latest

# 2. Generate an auth token (or skip and use username/password)
openssl rand -hex 32

# 3. Configure
cat > .env <<'EOF'
OD_BIND=127.0.0.1:7456
OD_API_TOKEN=<token-from-step-2>
OD_ALLOW_PRIVATE_NETWORKS=1
LLAMA_SWAP_URL=http://host.docker.internal:8800/v1
LLAMA_SWAP_MODEL=Qwen3.6-35B-A3B
EOF

# 4. Run
docker compose up -d

# 5. Open
open http://127.0.0.1:7456
```

To expose the daemon to other devices on your LAN, change `OD_BIND=0.0.0.0:7456` in `.env` and restart. Bind to a public IP only behind an authenticated TLS reverse proxy.

## Why a fork

OpenDesign is a great general-purpose design tool, but it has a heavy login wall and a "log in with your subscription" button. For users who want to point at a local model server on `192.168.1.42:11434` and never touch a SaaS account, those defaults are friction. The fork removes the friction.

It also keeps the chat infrastructure, the artifact rendering framework, the skill system, the design systems library (~155 systems), the mock CLIs, and the contracts layer. Reusing those saves 6–12 months of solo-dev work versus a from-scratch rebuild.

## Roadmap

| Version | Scope | Status |
|---|---|---|
| v0.1 (this weekend) | 6 providers, LAN toggle, Woodpecker CI, single-artifact chat | In progress |
| v1 (MVP) | Multi-artifact chat, slide-deck output, manual design system import, local HTML/PPTX export | Planned (3 months) |
| v2 (Canvas) | Figma-style pan/zoom, tweaks panel, undo/redo | Planned (3 months) |
| v3 (Refinement) | Comments, direct editing, model-generated tweak sliders | Planned (3 months) |
| v4 (Design systems) | Codebase/screenshot extraction, multi-system management | Planned (2 months) |
| v5 (Inputs) | DOCX/PPTX/XLSX import, web capture, codebase import | Planned (1 month) |
| v6 (Export + handoff) | Multi-artboard PDF, PPTX, coding-agent handoff bundle, share link | Planned (2 months) |
| v7 (Sharing + auth) | OIDC SSO, share link with comment/edit, Postgres migration | Planned (1 month) |
| v8 (Quotas + admin) | Per-user usage tracking, admin settings | Planned (1 month) |

Full plan: `specs/current/claude-design-local-roadmap.md`.
Risks: `specs/current/claude-design-local-risks.md`.
This-weekend first slice: `specs/current/claude-design-local-this-weekend.md`.
