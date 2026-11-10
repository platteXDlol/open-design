# Deck export (M3, Stage 6 slice) — design

Status: approved (single PR, decision E6). Follows `slide-deck-m2-design.md`.

## Goal / use case

As a self-hosting user running OpenDesign via `docker compose` (no desktop app),
I want to export a multi-artboard deck as PPTX, PDF, or an offline HTML ZIP —
from the web UI or the `od` CLI — so that I can present or share the deck
outside OpenDesign.

## Acceptance criteria

1. **PPTX headless** — Given a valid M2 deck with N artboards and a daemon with no
   desktop runtime, when I `POST /api/projects/:id/artifacts/:artifactId/export
   {format:"pptx"}`, then I get a 16:9 `.pptx` with N slides in manifest order,
   each a full-bleed 1920×1080 render of its artboard.
2. **PDF + HTML** — Same deck: `format:"pdf"` returns an N-page PDF; `format:"html"`
   returns a ZIP with `manifest.json`, `shared/`, `artboards/*.html`, and an
   `index.html` that opens offline and shows every slide.
3. **Stored + recorded** — Each export is written to `artifacts/<id>/exports/` and
   listed in the manifest's `exports` field; re-exporting replaces the same format.
4. **Invalid deck refused** — Given a deck failing `validateArtboardDeck`, export
   returns 422 with the findings and writes nothing.
5. **Dual surface** — The deck viewer has an Export menu (PPTX/PDF/HTML) and
   `od artifacts deck export --deck <id> --format pptx|pdf|html [--out <path>] [--json]`
   both hit the same endpoint. Existing single-file deck exports are unchanged.

## Design

- **Renderer seam** — `SlideRenderer(files: absPath[]) → SlideImage[]`
  (`apps/daemon/src/artifacts/deck-artboard-export.ts`). M3 ships one
  implementation, `createHeadlessSlideRenderer` (`playwright-core` + Chromium),
  used by desktop and Docker alike. Chromium resolves from `OD_CHROMIUM_PATH`,
  then Playwright's download, then common system paths; none → 501. The
  Electron `desktopSlideRenderer` stays on the single-file deck routes only.
- **Rendering** — one page per artboard at 1920×1080, `file://` load from the
  artifact dir (artboards link `../shared/theme.css`), wait for `load` + fonts,
  PNG screenshot. Network beyond `ARTBOARD_ALLOWED_HOSTS` blocked.
- **Assembly** — reuse `buildScreenshotPptx` / `buildScreenshotPdf`
  (`apps/daemon/src/deck-export.ts:159,204`). HTML ZIP via `jszip` + generated
  `index.html` (slides stacked, each in a scaled iframe; no external fetches).
- **Contracts** — `DeckExportFormat`, `DeckExportRequest`, `DeckExportResult`
  in `packages/contracts/src/artifacts/deck-artboards.ts`; manifest `exports`
  entries `{format, file, bytes, createdAt}`.
- **Sync** — request blocks until the file exists (30 s page-load timeout per artboard), responds with
  the binary (`Content-Disposition`); `?json=1` returns the `DeckExportResult` instead.
- **Docker** — `deploy/Dockerfile` (Alpine) installs `chromium`, `font-noto`,
  `font-noto-cjk`; sets `OD_CHROMIUM_PATH=/usr/bin/chromium-browser`. Verified
  playwright-core 1.60 drives Alpine Chromium as a non-root user.
- **Manifest** — records go to a new optional `exported[]` field; the existing
  `exports` capability list is unchanged. A regenerated deck's manifest is
  rewritten by the M2 tracker, which drops stale `exported` records.

Out of scope (later Stage 6): hybrid/semantic PPTX, editable PPTX headless,
async jobs + SSE progress, handoff bundle, share links.

## PR plan

One PR (E6): contracts types, headless renderer, export endpoint, Dockerfile,
web Export buttons in `DeckArtboardsViewer`, `od artifacts deck export`.

## Decision log

| # | Decision | Chosen | Rejected | Why |
|---|---|---|---|---|
| E1 | Headless renderer | playwright-core + system Chromium (daemon dep only) | browser-side capture; desktop-only | Real browser fidelity; CLI works without a browser |
| E2 | PPTX strategy at M3 | screenshot (1 image/slide) | hybrid now; dom-to-pptx headless | All pieces exist except renderer; hybrid later on same seam |
| E3 | Formats | PPTX + PDF + HTML ZIP | PPTX + HTML | PDF is free once images exist |
| E4 | Sync vs async | sync with timeout | job + SSE | 5–10 slides take seconds |
| E5 | Storage | `artifacts/<id>/exports/` + manifest `exported[]` | stream only | Re-download; hook for share/handoff |
| E6 | PR split | one PR (endpoint + UI + CLI) | backend first, UI/CLI later | AGENTS.md capability closure rule |
