/**
 * Multi-artboard deck artifact (milestone M2) — the shared shape the daemon,
 * web and `od` CLI agree on. Design: `specs/current/slide-deck-m2-design.md`.
 *
 * A deck lives under `artifacts/<id>/`:
 *   manifest.json             version 2, artboards[] in slide order
 *   artboards/<artboard>.html one full 1920×1080 document per slide
 *   shared/theme.css          optional tokens shared by every artboard
 *
 * The single-file deck framework (`../prompts/deck-framework.ts`) still owns
 * template/seed-driven decks; the two coexist. v1 manifests never parse here
 * (`parseDeckManifestV2` returns null) so the v1 read path stays untouched.
 *
 * Pure TypeScript: no DOM, no Node APIs.
 */
import type { ArtifactLintFinding } from '../api/artifact-lint.js';
import { endOfTag, findRealTagOffset, HTML_TAG_PATTERNS } from '../runtime/html-injection-points.js';
import type { ArtifactExportKind, ArtifactStatus } from '../api/artifacts.js';

export const ARTBOARD_WIDTH = 1920;
export const ARTBOARD_HEIGHT = 1080;
/** Gap between artboards in the M2 row layout; M4's canvas consumes x/y as-is. */
export const ARTBOARD_GAP = 100;
/** Per-artboard size budget (roadmap Stage 3 static validation). */
export const ARTBOARD_MAX_BYTES = 24 * 1024;
export const DECK_MIN_ARTBOARDS = 3;
export const DECK_ARTBOARD_RENDERER = 'deck-artboards' as const;

export interface DeckArtboardEntry {
  /** Stable id, the file's basename without `.html`. */
  id: string;
  /** Artifact-relative path, always `artboards/<id>.html`. */
  file: string;
  title?: string;
  x: number;
  y: number;
  w: typeof ARTBOARD_WIDTH;
  h: typeof ARTBOARD_HEIGHT;
  status: ArtifactStatus;
}

export interface DeckManifestV2 {
  version: 2;
  kind: 'deck';
  renderer: typeof DECK_ARTBOARD_RENDERER;
  title: string;
  /** First artboard; keeps entry-based readers working. */
  entry: string;
  status: ArtifactStatus;
  exports: ArtifactExportKind[];
  /** Array order is slide order. */
  artboards: DeckArtboardEntry[];
  designSystemId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** Files produced by deck export (M3), one per format; latest wins. */
  exported?: DeckExportRecord[];
}

// ── Export (M3) ─ design: specs/current/deck-export-m3-design.md ───────────

export const DECK_EXPORT_FORMATS = ['pptx', 'pdf', 'html'] as const;
export type DeckExportFormat = (typeof DECK_EXPORT_FORMATS)[number];

export interface DeckExportRecord {
  format: DeckExportFormat;
  /** Artifact-relative path, `exports/<artifactId>.<ext>`. */
  file: string;
  bytes: number;
  createdAt: string;
}

/** `POST /api/projects/:id/artifacts/:artifactId/export` body. */
export interface DeckExportRequest {
  format: DeckExportFormat;
}

/** JSON response of the export endpoint (`?json=1`). */
export interface DeckExportResult {
  artifactId: string;
  record: DeckExportRecord;
}

export function isDeckExportFormat(value: unknown): value is DeckExportFormat {
  return typeof value === 'string' && (DECK_EXPORT_FORMATS as readonly string[]).includes(value);
}

export function deckExportFile(artifactId: string, format: DeckExportFormat): string {
  return `exports/${artifactId}.${format === 'html' ? 'zip' : format}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * `index.html` for the offline HTML ZIP: every artboard stacked, each in an
 * iframe scaled to the page width. Each artboard fits itself to its frame.
 */
export function buildDeckExportIndexHtml(manifest: DeckManifestV2): string {
  const frames = manifest.artboards
    .map(
      (a, i) =>
        `<section><iframe src="${escapeHtml(a.file)}" title="Slide ${i + 1}" loading="lazy"></iframe></section>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(manifest.title)}</title>
<style>
body{margin:0;background:#111;padding:24px;display:grid;gap:24px}
section{width:100%;max-width:1600px;margin:0 auto;aspect-ratio:${ARTBOARD_WIDTH}/${ARTBOARD_HEIGHT}}
iframe{width:100%;height:100%;border:0;display:block;background:#fff}
</style>
</head>
<body>
${frames}
</body>
</html>
`;
}

const ARTBOARD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ARTIFACT_ID_RE = ARTBOARD_ID_RE;

function artboardIdFromFile(file: string): string | null {
  const m = /^artboards\/([^/]+)\.html$/.exec(file);
  return m && ARTBOARD_ID_RE.test(m[1]!) ? m[1]! : null;
}

/**
 * Recognise a project-relative path as a deck artboard write, e.g.
 * `artifacts/deck-v1/artboards/01-title.html`. Returns null for anything else,
 * including traversal segments.
 */
export function isDeckArtboardPath(
  projectPath: string,
): { artifactId: string; artboardId: string; file: string } | null {
  const m = /^artifacts\/([^/]+)\/(artboards\/[^/]+\.html)$/.exec(projectPath.replace(/\\/g, '/'));
  if (!m || !ARTIFACT_ID_RE.test(m[1]!)) return null;
  const artboardId = artboardIdFromFile(m[2]!);
  return artboardId ? { artifactId: m[1]!, artboardId, file: m[2]! } : null;
}

/** True for any file belonging to an M2 artboard deck (slides, shared assets, manifest). */
export function isArtboardDeckFile(projectPath: string): boolean {
  const p = projectPath.replace(/\\/g, '/');
  return isDeckArtboardPath(p) !== null || /^artifacts\/[^/]+\/(shared\/|manifest\.json$)/.test(p);
}

export function buildDeckManifestV2(input: {
  title: string;
  /** Artifact-relative artboard files, in slide order. */
  files: string[];
  status?: ArtifactStatus;
  designSystemId?: string | null;
  now?: string;
}): DeckManifestV2 {
  const artboards = input.files.map((file, i): DeckArtboardEntry => {
    const id = artboardIdFromFile(file);
    if (!id) throw new Error(`invalid artboard file: ${file}`);
    return {
      id,
      file,
      x: i * (ARTBOARD_WIDTH + ARTBOARD_GAP),
      y: 0,
      w: ARTBOARD_WIDTH,
      h: ARTBOARD_HEIGHT,
      status: 'complete',
    };
  });
  const now = input.now ?? new Date(0).toISOString();
  return {
    version: 2,
    kind: 'deck',
    renderer: DECK_ARTBOARD_RENDERER,
    title: input.title,
    entry: artboards[0]?.file ?? '',
    status: input.status ?? 'complete',
    exports: ['html', 'pdf', 'zip'],
    artboards,
    ...(input.designSystemId !== undefined ? { designSystemId: input.designSystemId } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

const STATUSES: ReadonlySet<string> = new Set(['streaming', 'complete', 'error']);

/** Parse an untrusted manifest.json value. Returns null for v1 or malformed input. */
export function parseDeckManifestV2(value: unknown): DeckManifestV2 | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 2 || v.kind !== 'deck' || v.renderer !== DECK_ARTBOARD_RENDERER) return null;
  if (typeof v.title !== 'string' || !Array.isArray(v.artboards)) return null;
  const artboards: DeckArtboardEntry[] = [];
  for (const raw of v.artboards) {
    if (!raw || typeof raw !== 'object') return null;
    const a = raw as Record<string, unknown>;
    if (typeof a.file !== 'string' || artboardIdFromFile(a.file) !== a.id) return null;
    if (typeof a.x !== 'number' || typeof a.y !== 'number') return null;
    if (a.w !== ARTBOARD_WIDTH || a.h !== ARTBOARD_HEIGHT) return null;
    if (typeof a.status !== 'string' || !STATUSES.has(a.status)) return null;
    artboards.push({
      id: a.id as string,
      file: a.file,
      ...(typeof a.title === 'string' ? { title: a.title } : {}),
      x: a.x,
      y: a.y,
      w: ARTBOARD_WIDTH,
      h: ARTBOARD_HEIGHT,
      status: a.status as ArtifactStatus,
    });
  }
  const status = typeof v.status === 'string' && STATUSES.has(v.status) ? (v.status as ArtifactStatus) : 'complete';
  return {
    version: 2,
    kind: 'deck',
    renderer: DECK_ARTBOARD_RENDERER,
    title: v.title,
    entry: artboards[0]?.file ?? '',
    status,
    exports: Array.isArray(v.exports) ? (v.exports.filter((e) => typeof e === 'string') as ArtifactExportKind[]) : [],
    artboards,
    ...(v.designSystemId === null || typeof v.designSystemId === 'string' ? { designSystemId: v.designSystemId } : {}),
    ...(typeof v.createdAt === 'string' ? { createdAt: v.createdAt } : {}),
    ...(typeof v.updatedAt === 'string' ? { updatedAt: v.updatedAt } : {}),
    ...(Array.isArray(v.exported) ? { exported: parseExportRecords(v.exported) } : {}),
  };
}

function parseExportRecords(raw: unknown[]): DeckExportRecord[] {
  return raw.flatMap((r) => {
    if (!r || typeof r !== 'object') return [];
    const e = r as Record<string, unknown>;
    if (!isDeckExportFormat(e.format) || typeof e.file !== 'string' || !/^exports\/[^/]+$/.test(e.file)) return [];
    if (typeof e.bytes !== 'number' || typeof e.createdAt !== 'string') return [];
    return [{ format: e.format, file: e.file, bytes: e.bytes, createdAt: e.createdAt }];
  });
}

// ── Static validation ──────────────────────────────────────────────────────

/** Font CDNs an artboard may load; everything else off-origin is rejected. */
export const ARTBOARD_ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'fonts.bunny.net',
]);

const DOCUMENT_START_RE = /^(?:<!doctype\s+html\b|<html\b)/i;
const PLACEHOLDER_RE = /\b(?:TBD|TODO)\b|\blorem\b|\bipsum\b/i;
const URL_ATTR_RE = /\b(?:href|src|srcset|poster|action|formaction|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/gi;
const CSS_URL_RE = /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi;

function utf8Bytes(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

function thirdPartyHost(url: string): string | null {
  const u = url.trim();
  const m = /^(?:https?:)?\/\/([^/?#:]+)/i.exec(u);
  if (!m) return null;
  const host = m[1]!.toLowerCase();
  return ARTBOARD_ALLOWED_HOSTS.has(host) ? null : host;
}

function finding(id: string, message: string, fix: string, snippet?: string): ArtifactLintFinding {
  return { severity: 'P0', id, message, fix, ...(snippet ? { snippet } : {}) };
}

/** Static per-artboard checks. Empty array = valid. */
export function validateArtboardHtml(html: string): ArtifactLintFinding[] {
  const out: ArtifactLintFinding[] = [];
  const trimmed = html.replace(/^\uFEFF/, '').trim();
  if (!DOCUMENT_START_RE.test(trimmed)) {
    return [finding('not-a-document', 'Artboard is not an HTML document.', 'Write a full document starting with <!doctype html>, based on the artboard skeleton.')];
  }
  if (utf8Bytes(html) > ARTBOARD_MAX_BYTES) {
    out.push(finding('too-large', `Artboard exceeds ${ARTBOARD_MAX_BYTES} bytes.`, 'Move shared styles into ../shared/theme.css and cut content; one idea per slide.'));
  }
  const htmlAt = findRealTagOffset(trimmed, HTML_TAG_PATTERNS.htmlOpen);
  const htmlTag = htmlAt < 0 ? '' : trimmed.slice(htmlAt, endOfTag(trimmed, htmlAt) + 1);
  if (!/\sdata-od-artboard\s*=\s*["']1["']/i.test(htmlTag)) {
    out.push(finding('missing-frame-marker', 'Missing data-od-artboard="1" on <html>.', 'Keep the <html data-od-artboard="1"> marker from the artboard skeleton.'));
  }
  const roots = trimmed.match(/<[a-z][^>]*\sdata-od-slide-root\b/gi)?.length ?? 0;
  if (roots !== 1) {
    out.push(finding('slide-root-count', `Expected exactly one slide root, found ${roots}.`, 'Put the whole slide inside the single <main data-od-slide-root> element.'));
  }
  const text = trimmed.replace(/<!--[\s\S]*?-->/g, '');
  // Only rendered copy counts: class names like `task todo` or a `todo` JS var are not placeholders.
  const visibleText = text
    .replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  const ph = PLACEHOLDER_RE.exec(visibleText);
  if (ph) {
    out.push(finding('placeholder', 'Artboard contains placeholder text.', 'Replace placeholders with real, specific copy.', ph[0]));
  }
  const urls: string[] = [];
  for (const m of text.matchAll(URL_ATTR_RE)) urls.push(m[1] ?? m[2] ?? m[3] ?? '');
  for (const m of text.matchAll(CSS_URL_RE)) urls.push(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '');
  for (const url of urls) {
    const host = thirdPartyHost(url);
    if (host) {
      out.push(finding('third-party-url', `Artboard loads a third-party URL (${host}).`, 'Inline the asset, use a project-relative path, or a data: URI.', url));
      break;
    }
  }
  return out;
}

/** Deck-level checks: count, manifest↔disk agreement, plan match. */
export function validateArtboardDeck(
  manifest: DeckManifestV2,
  filesOnDisk: readonly string[],
  opts: { expectedCount?: number } = {},
): ArtifactLintFinding[] {
  const out: ArtifactLintFinding[] = [];
  const n = manifest.artboards.length;
  if (n < DECK_MIN_ARTBOARDS) {
    out.push(finding('too-few-artboards', `Deck has ${n} artboards; at least ${DECK_MIN_ARTBOARDS} required.`, 'Write one artboard file per slide.'));
  }
  const disk = new Set(filesOnDisk);
  const missing = manifest.artboards.filter((a) => !disk.has(a.file)).map((a) => a.file);
  if (missing.length) {
    out.push(finding('missing-artboard-file', `Manifest lists artboards missing on disk: ${missing.join(', ')}.`, 'Write the missing artboard files.'));
  }
  if (opts.expectedCount !== undefined && opts.expectedCount !== n) {
    out.push(finding('artboard-count-mismatch', `Plan expected ${opts.expectedCount} artboards, deck has ${n}.`, 'Write exactly the planned number of slides.'));
  }
  return out;
}

// ── Scaffold ───────────────────────────────────────────────────────────────

/**
 * One slide, standalone. No navigation JS — the host owns navigation. `fit()`
 * only exists so the file previews correctly when opened on its own; the
 * stage uses `transform-origin: top left` like the single-file framework.
 */
export const ARTBOARD_SKELETON_HTML = `<!doctype html>
<html lang="en" data-od-artboard="1">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><!-- SLOT: slide title --></title>
<link rel="stylesheet" href="../shared/theme.css">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #000; }
  .artboard {
    position: absolute; top: 0; left: 0;
    width: ${ARTBOARD_WIDTH}px; height: ${ARTBOARD_HEIGHT}px;
    transform-origin: top left; overflow: hidden; box-sizing: border-box;
    display: flex; flex-direction: column;
    background: var(--bg, #fff); color: var(--fg, #111);
  }
  @page { size: ${ARTBOARD_WIDTH}px ${ARTBOARD_HEIGHT}px; margin: 0; }
  @media print { html, body { overflow: visible; background: none; } .artboard { transform: none !important; } }
  /* SLOT: per-slide styles */
</style>
</head>
<body>
<main class="artboard" data-od-slide-root>
<!-- SLOT: slide content -->
</main>
<script>
(function(){
  var el = document.querySelector('[data-od-slide-root]');
  function fit(){
    var s = Math.min(innerWidth / ${ARTBOARD_WIDTH}, innerHeight / ${ARTBOARD_HEIGHT});
    var tx = (innerWidth - ${ARTBOARD_WIDTH} * s) / 2, ty = (innerHeight - ${ARTBOARD_HEIGHT} * s) / 2;
    el.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
  }
  addEventListener('resize', fit); fit();
})();
</script>
</body>
</html>
`;

/** `GET /api/projects/:id/artifacts/:artifactId/deck` — shared by the UI and `od artifacts deck`. */
export interface DeckInspectResponse {
  artifactId: string;
  manifest: DeckManifestV2 | null;
  artboards: Array<{ id: string; file: string; findings: ArtifactLintFinding[] }>;
  /** Deck-level findings (slide count, missing files). */
  findings: ArtifactLintFinding[];
  valid: boolean;
}
