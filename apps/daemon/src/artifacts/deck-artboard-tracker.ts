/**
 * Watches one run's writes to `artifacts/<id>/artboards/*.html` (M2 deck
 * artboards, `specs/current/slide-deck-m2-design.md`).
 *
 * Runtime-agnostic on purpose: instead of parsing each adapter's tool input
 * (Write, Edit, Bash heredoc all differ), `settle()` rescans the project's
 * artboard folders after every `tool_result` and at stream end. A file counts
 * when its (mtime, size) differs from the snapshot taken at run start, so
 * decks from earlier runs are never touched unless rewritten.
 *
 * Sync fs on purpose: a deck is a handful of ≤24 KB files, and finalize must
 * land before the run's terminal frame.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildDeckManifestV2,
  isDeckArtboardPath,
  parseDeckManifestV2,
  validateArtboardDeck,
  validateArtboardHtml,
  type ArtifactLintFinding,
  type DeckInspectResponse,
  type DeckManifestV2,
} from '@open-design/contracts';

export interface DeckArtboardEvent {
  type: 'artboard';
  artifactId: string;
  artboardId: string;
  file: string;
  index: number;
  status: 'complete' | 'error';
  findings?: string[];
}

export interface DeckFinalizeResult {
  artifactId: string;
  findings: ArtifactLintFinding[];
}

type Stamp = string;

function scanArtboards(projectRoot: string): Map<string, Stamp> {
  const out = new Map<string, Stamp>();
  const artifactsDir = path.join(projectRoot, 'artifacts');
  if (!existsSync(artifactsDir)) return out;
  for (const artifact of readdirSync(artifactsDir, { withFileTypes: true })) {
    if (!artifact.isDirectory()) continue;
    const boards = path.join(artifactsDir, artifact.name, 'artboards');
    if (!existsSync(boards)) continue;
    for (const f of readdirSync(boards, { withFileTypes: true })) {
      if (!f.isFile()) continue;
      const rel = `artifacts/${artifact.name}/artboards/${f.name}`;
      if (!isDeckArtboardPath(rel)) continue;
      const st = statSync(path.join(boards, f.name));
      out.set(rel, `${st.mtimeMs}:${st.size}`);
    }
  }
  return out;
}

export function createDeckArtboardTracker(opts: {
  projectRoot: string;
  emit: (ev: DeckArtboardEvent) => void;
}) {
  const { projectRoot, emit } = opts;
  const seen = scanArtboards(projectRoot);
  /** artifactId → artboardId → finding ids for this run's writes. */
  const touched = new Map<string, Map<string, string[]>>();
  let index = 0;

  function writeManifest(artifactId: string, status: DeckManifestV2['status']): DeckManifestV2 {
    const dir = path.join(projectRoot, 'artifacts', artifactId);
    const files = readdirSync(path.join(dir, 'artboards'))
      .map((f) => `artboards/${f}`)
      .filter((f) => isDeckArtboardPath(`artifacts/${artifactId}/${f}`))
      .sort();
    const manifestPath = path.join(dir, 'manifest.json');
    let prev: DeckManifestV2 | null = null;
    try {
      prev = parseDeckManifestV2(JSON.parse(readFileSync(manifestPath, 'utf8')));
    } catch {
      prev = null;
    }
    const now = new Date().toISOString();
    const m = buildDeckManifestV2({ title: prev?.title ?? artifactId, files, status, now });
    if (prev?.createdAt) m.createdAt = prev.createdAt;
    if (prev?.designSystemId !== undefined) m.designSystemId = prev.designSystemId;
    const errs = touched.get(artifactId);
    for (const a of m.artboards) {
      const prevTitle = prev?.artboards.find((p) => p.id === a.id)?.title;
      if (prevTitle) a.title = prevTitle;
      if (errs?.get(a.id)?.length) a.status = 'error';
    }
    writeFileSync(manifestPath, `${JSON.stringify(m, null, 2)}\n`);
    return m;
  }

  return {
    /** Validate and announce artboards written since the last call. */
    settle(): void {
      const now = scanArtboards(projectRoot);
      const changed = new Set<string>();
      for (const [rel, stamp] of now) {
        if (seen.get(rel) === stamp) continue;
        seen.set(rel, stamp);
        const hit = isDeckArtboardPath(rel)!;
        const ids = validateArtboardHtml(readFileSync(path.join(projectRoot, rel), 'utf8')).map((f) => f.id);
        if (!touched.has(hit.artifactId)) touched.set(hit.artifactId, new Map());
        touched.get(hit.artifactId)!.set(hit.artboardId, ids);
        changed.add(hit.artifactId);
        emit({
          type: 'artboard',
          artifactId: hit.artifactId,
          artboardId: hit.artboardId,
          file: hit.file,
          index: index++,
          status: ids.length ? 'error' : 'complete',
          ...(ids.length ? { findings: ids } : {}),
        });
      }
      for (const artifactId of changed) writeManifest(artifactId, 'streaming');
    },

    /** Write final manifests for decks touched this run; returns deck findings. */
    finalize(): DeckFinalizeResult[] {
      const results: DeckFinalizeResult[] = [];
      for (const [artifactId, boards] of touched) {
        const draft = writeManifest(artifactId, 'complete');
        const findings = validateArtboardDeck(draft, draft.artboards.map((a) => a.file));
        const bad = [...boards].filter(([, ids]) => ids.length).map(([id, ids]) => `${id} (${ids.join(', ')})`);
        if (bad.length) {
          findings.push({
            severity: 'P0',
            id: 'invalid-artboard',
            message: `Artboards failed validation: ${bad.join('; ')}.`,
            fix: 'Rewrite the listed artboards to pass validation.',
          });
        }
        if (findings.length) writeManifest(artifactId, 'error');
        results.push({ artifactId, findings });
      }
      return results;
    },
  };
}

/**
 * Read-only check of one deck on disk: manifest, per-slide and deck findings.
 * Backs `GET /api/projects/:id/artifacts/:artifactId/deck`. Null when the
 * artifact id is unsafe or the deck does not exist.
 */
export function inspectDeckArtifact(projectRoot: string, artifactId: string): DeckInspectResponse | null {
  if (!isDeckArtboardPath(`artifacts/${artifactId}/artboards/x.html`)) return null;
  const dir = path.join(projectRoot, 'artifacts', artifactId);
  const boardsDir = path.join(dir, 'artboards');
  if (!existsSync(boardsDir)) return null;
  let manifest: DeckManifestV2 | null = null;
  try {
    manifest = parseDeckManifestV2(JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')));
  } catch {
    manifest = null;
  }
  const files = readdirSync(boardsDir)
    .map((f) => `artboards/${f}`)
    .filter((f) => isDeckArtboardPath(`artifacts/${artifactId}/${f}`))
    .sort();
  const artboards = files.map((file) => ({
    id: isDeckArtboardPath(`artifacts/${artifactId}/${file}`)!.artboardId,
    file,
    findings: validateArtboardHtml(readFileSync(path.join(dir, file), 'utf8')),
  }));
  const findings = validateArtboardDeck(manifest ?? buildDeckManifestV2({ title: artifactId, files }), files);
  return {
    artifactId,
    manifest,
    artboards,
    findings,
    valid: findings.length === 0 && artboards.every((a) => a.findings.length === 0),
  };
}
