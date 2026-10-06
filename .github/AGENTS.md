# GitHub automation guide

This directory is intentionally transitional. Primary CI for the Local-First fork is **Woodpecker** — see `.woodpecker.yml` at the repo root and root `AGENTS.md` § "GitHub automation boundary".

The remaining `.github/workflows/` files reflect the upstream two-layer architecture (atomic capability workflows, `handoff.py`, R2 convergence, scope routing) and are kept as a mirror only. Do not introduce new GH Actions workflows. To add a check, extend `.woodpecker.yml` or `pnpm guard` instead.

Release artifacts are produced locally via `pnpm tools-pack`; no release CI workflows run from this fork.

## Removal plan

Removal of the GH Actions surface is a follow-up decision tracked by the roadmap (`specs/current/claude-design-local-roadmap.md`). Do not delete `ci.yml` or any of the capability workflows without an explicit maintainer call.
