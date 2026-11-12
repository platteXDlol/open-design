# M3 — Design-system folder upload

**Goal:** As a self-hosted user (Docker or another machine on the LAN), I want to pick a design-system folder in my browser and use it right away, so that my decks follow my brand without mounting folders or a separate publish step.

## Acceptance criteria
1. Settings → Design systems → "Choose folder" uploads the picked folder; the daemon imports it with the same code as the path import (`POST /api/design-systems/import/upload`).
2. `od design-systems import-local <path> --upload` sends the same request shape from the CLI machine.
3. Uploads without a top-level `DESIGN.md`, with unsafe paths (`../`, absolute), with no files, or over 20 MB are refused with 400 and nothing is written.
4. Imports (upload and path) are published immediately; projects accept them.
5. Live: a deck generated with the imported system uses its colors in `shared/theme.css`.

## Decisions
- Size cap 20 MB decoded (`DESIGN_SYSTEM_UPLOAD_MAX_BYTES`, apps/daemon/src/design-systems/upload.ts); route JSON limit 32 MB for base64 overhead.
- Only text, image and font files are kept; other files are skipped silently.
- Files are staged to a temp dir and passed to `importLocalDesignSystemProject` unchanged; temp dir removed afterwards.
- Generating a design system from code in Docker/BYOK (DS create flow) stays out of scope (user decision 3b).
