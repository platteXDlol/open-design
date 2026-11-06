# Slide-deck renderer — M2 design

Status: decided 2026-11-05 (all recommended options, see Decision log). No code yet.
Roadmap anchor: `specs/current/claude-design-local-roadmap.md:85` (M2 row).

## Goal

As a local user, I want to describe a deck in chat and get a multi-artboard deck
(one HTML file per slide) that streams in slide by slide, is validated, and renders
in the web viewer, so that I can review and later export each slide independently.

## Acceptance criteria

1. Given a blank deck project, when I ask for "5-slide pitch deck for a SaaS pricing
   page", then `artifacts/<id>/artboards/` holds 5 HTML files and `artifacts/<id>/manifest.json`
   is a valid v2 manifest listing them in order.
2. Given a run in progress, when an artboard file finishes writing and passes static
   validation, then the chat stream carries an `artboard` agent event and the viewer
   shows that slide before the run ends.
3. Given an artboard that fails static validation (placeholder text, third-party URL,
   >24 KB, missing frame marker, not a document), then findings are fed back to the
   agent through the `<artifact-lint>` channel, with a bounded repair count; a deck
   with <3 valid artboards is not marked `complete`.
4. Given a v2 deck manifest, when I open it, then the viewer shows a thumbnail rail
   plus one main 1920×1080 frame with keyboard prev/next.
5. Given an existing v1 single-file deck, when I open it, then it renders exactly as
   before (v1 read path unchanged).

## Current infrastructure (baseline)

- Single-file scaffold `DECK_SKELETON_HTML` + `renderDeckFrameworkDirective` in
  `packages/contracts/src/prompts/deck-framework.ts` (daemon re-export:
  `apps/daemon/src/prompts/deck-framework.ts`). Feeds classic, BYOK and OD Next.
- Deck protocol v1: `packages/contracts/src/runtime/deck-protocol.ts`
  (`od:slide`, `od:slide-state`, `od:deck-ready`).
- Viewer: `isDeck` forces srcDoc (`apps/web/src/components/file-viewer-render-mode.ts:104`);
  `injectDeckBridge` (`apps/web/src/runtime/srcdoc.ts:3152`); per-slide srcDocs
  for thumbnails/presenter in `apps/web/src/components/FileViewer.tsx` (~`:11065`, `:13737`).
- Manifest v1: `ArtifactManifest` (`packages/contracts/src/api/artifacts.ts:94`), single
  `entry`; renderer selection in `apps/web/src/artifacts/renderer-registry.ts`; legacy
  inference duplicated in `apps/daemon/src/artifacts/manifest.ts:269` and the web copy.
- Stream: `tool_input_target` / `tool_input_progress` / `tool_use` / `end.artifactPaths`
  (`packages/contracts/src/sse/chat.ts`); project `file-changed` events
  (`apps/web/src/providers/project-events.ts:48`).
- Validation: `validateHtmlArtifact` (`apps/web/src/artifacts/validate.ts`), anti-slop
  lint (`packages/contracts/src/api/artifact-lint.ts`), `apps/daemon/src/run-deliverable-validation.ts`.
- Export: `apps/daemon/src/deck-export.ts` (screenshot PPTX via `pptxgenjs` 4.0.1, PDF via
  `pdf-lib`) from `DesktopRenderSlidesInput`.

## Design

### Artifact shape (D1)

```
artifacts/<id>/
  manifest.json            # version 2
  artboards/01-title.html  # one full 1920×1080 document per slide
  …
  shared/theme.css         # optional: :root tokens + per-deck styles
```

Manifest v2 (new type in `packages/contracts/src/api/artifacts.ts`):

```ts
interface ArtboardEntry {
  id: string;            // stable, e.g. "01-title"
  file: string;          // "artboards/01-title.html", artifact-relative
  title?: string;
  x: number; y: number;  // M2: laid out in a row; M4 canvas consumes as-is
  w: 1920; h: 1080;
  status: 'streaming' | 'complete' | 'error';
}
interface ArtifactManifestV2 extends Omit<ArtifactManifest, 'version'> {
  version: 2;
  kind: 'deck';
  renderer: 'deck-artboards';
  entry: string;         // = artboards[0].file, keeps v1 readers working
  artboards: ArtboardEntry[];   // array order = slide order
}
```

v1 manifests stay readable; the parser accepts both (risk R9).

### Artboard document

Lean scaffold `ARTBOARD_SKELETON_HTML` in `packages/contracts/src/prompts/`: a
1920×1080 frame marker (`data-od-artboard="1"`), one always-visible slide root,
`fit()` for standalone preview, print CSS for a single page, `<link>` to
`../shared/theme.css`. No navigation JS: the host owns navigation.

### Relation to the single-file framework (D2, D7)

Both kept. Single-file stays for template/seed-driven decks (`guizang-ppt`,
`html-ppt`, `simple-deck` and the `html-ppt-*` variants); multi-artboard is the default
for blank decks. Templates are not ported in M2.

### Writing (D4)

The agent writes artboards with its normal file tools under
`artifacts/<id>/artboards/`. The daemon recognises the path, validates, and maintains
the manifest. No `write_artboard` tool in M2.

### Streaming (D3)

New additive agent event in `DaemonAgentPayload`:

```ts
{ type: 'artboard'; artifactId: string; artboardId: string; file: string;
  index: number; total?: number; status: 'complete' | 'error' }
```

Emitted once per artboard after its write lands and validation runs. Finalize
writes `manifest.json` with `status: 'complete'` (or `'error'`); `end.artifactPaths`
lists all files. Old clients ignore the unknown type.

### Validation (D5)

Static, cheapest first, in the daemon:

- Per artboard: `validateHtmlArtifact` rules (shared via contracts or duplicated per
  the existing pattern), no `TBD|TODO|lorem|ipsum`, no third-party URLs except
  approved font CDNs, ≤24 KB, frame marker present, exactly one slide root.
- Per deck: ≥3 artboards, manifest ↔ disk agree, count matches the plan when one exists.
- Failures go back as `<artifact-lint>` findings with a bounded repair loop.
  Render-and-check and self-review are deferred.

### Rendering (D6)

New `deck-artboards` renderer in `apps/web/src/artifacts/renderer-registry.ts`:
thumbnail rail (reuse the existing thumbnail srcDoc path) + one main frame.
Host keyboard prev/next. The frame is a standalone `ArtboardFrame` component (one
iframe per artboard) so M4's canvas mounts N of them with lazy ±2 mounting.

### Design system flow

Unchanged path: project `designSystemId` → DESIGN.md/tokens injected by
`composeSystemPrompt`. New directive rule: write tokens once into
`shared/theme.css`; every artboard links it.

### Prompt variants (D8)

One artboard directive in `packages/contracts/src/prompts/`, consumed by legacy
(`apps/daemon/src/prompts/system.ts`), BYOK (`packages/contracts/src/prompts/system.ts`)
and OD Next (`packages/contracts/src/prompts/od-next-strategy.ts`), mirroring how
`deck-framework.ts` is carried. Read `docs/prompt-composition.md` before editing.

### Export hook (Stage 6, not built)

`manifest.artboards[]` (in order) maps 1:1 to `DesktopRenderSlidesInput`. Stage 6 adds
`artboardsToRenderInput(manifest)` beside `buildDeckRenderInput` in
`apps/daemon/src/deck-export.ts`.

### CLI surface

Per `AGENTS.md` dual-track rule: `od` must be able to list and validate a deck's
artboards over the same `/api/*` endpoints (scope in PR 1 or explicitly justified).

## Out of scope for M2

PPTX/PDF multi-artboard export, `write_artboard` tool, render-and-check, template
porting, pan/zoom canvas (M4), tweaks/comments per artboard.

## First implementation PR (proposed scope)

1. Contracts: `ArtifactManifestV2`, `ArtboardEntry`, `artboard` agent event,
   `ARTBOARD_SKELETON_HTML` + directive. Tests: v1/v2 parse, schema.
2. Daemon: v2 manifest read/write + static artboard/deck validators. Tests: AC1, AC3, AC5.
3. Daemon: `artboard` event emission on artboard writes + finalize. Test: AC2 via
   mock CLI replay (`mocks/`).
4. Web: `deck-artboards` renderer, `ArtboardFrame`, rail. Tests: AC4, AC5.
5. Prompt directive wired into all three paths + `od` CLI listing/validate.

Steps 4–5 may split into a second PR if the diff gets large.

## Decision log

| # | Decision | Chosen | Rationale |
|---|---|---|---|
| 1 | Artboard file | Full 1920×1080 doc per slide + `shared/theme.css` | Each slide previews/prints/exports alone; matches "5 HTML files". |
| 2 | Single-file framework | Coexist | Keeps existing decks and 25+ templates working. |
| 3 | Streaming | Per-artboard event + finalize | Slides appear progressively; additive protocol. |
| 4 | Writer | Normal file tools, daemon infers | Works for CLI agents and BYOK today. |
| 5 | Validation | Static + bounded repair | Cheap; covers `deck-5-saas-pitch`. |
| 6 | Viewer | Rail + one frame, reusable `ArtboardFrame` | Simple; M4 reuses the component. |
| 7 | Templates | Own lean scaffold; templates stay single-file | Their runtime JS/WebGL assumes one document. |
| 8 | Prompt variants | Both, one contracts source | Avoids intermittent per-run drift. |
| 9 | Directive trigger | Artboard directive only when no deck template/seed is bound (blank deck) | Templates stay single-file (D7); no flag needed for the M2 manual check. |
| 10 | PR split | PR 1 = steps 1–4; PR 2 = step 5 (directive in 3 prompt paths + `od` CLI list/validate + repair loop) | Prompt + CLI diff is large and reviewed separately. |
| 11 | Existing single-file deck, legacy path | Detect it and keep single-file directive (mirror OD Next `hasExistingDeckArtifact`) | Both paths agree; old decks not reformatted. |
| 12 | Inferred-deck branch | Artboard directive too | Also a blank deck (D9). |
| 13 | Repair delivery | Daemon starts ≤2 follow-up runs with findings | Works for all CLI agents + BYOK without a new tool. |
