import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ARTBOARD_SKELETON_HTML } from '@open-design/contracts';
import { createDeckArtboardTracker, inspectDeckArtifact } from '../../src/artifacts/deck-artboard-tracker.js';

const slide = (body: string) => ARTBOARD_SKELETON_HTML.replace('<!-- SLOT: slide content -->', body);

describe('deck artboard tracker (M2 AC1–AC3)', () => {
  let root: string;
  let events: any[];
  const write = (rel: string, html: string) => {
    const p = path.join(root, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, html);
  };
  const manifest = (id = 'deck-v1') =>
    JSON.parse(readFileSync(path.join(root, 'artifacts', id, 'manifest.json'), 'utf8'));

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'od-deck-'));
    events = [];
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('inspects a deck on disk for the API/CLI (AC4)', () => {
    for (const n of ['01', '02', '03']) write(`artifacts/deck-v1/artboards/${n}.html`, slide(`<h1>Slide ${n}</h1>`));
    expect(inspectDeckArtifact(root, 'deck-v1')!.valid).toBe(true);
    write('artifacts/deck-v1/artboards/02.html', slide('<h1>TODO</h1>'));
    const r = inspectDeckArtifact(root, 'deck-v1')!;
    expect(r.valid).toBe(false);
    expect(r.artboards.find((a) => a.id === '02')!.findings.map((f) => f.id)).toContain('placeholder');
    expect(inspectDeckArtifact(root, '../etc')).toBeNull();
    expect(inspectDeckArtifact(root, 'missing')).toBeNull();
  });

  it('emits one artboard event per landed slide and writes a streaming manifest (AC2)', () => {
    const t = createDeckArtboardTracker({ projectRoot: root, emit: (e) => events.push(e) });
    write('artifacts/deck-v1/artboards/01-title.html', slide('<h1>Launch faster</h1>'));
    t.settle();
    expect(events).toEqual([
      { type: 'artboard', artifactId: 'deck-v1', artboardId: '01-title', file: 'artboards/01-title.html', index: 0, status: 'complete' },
    ]);
    expect(manifest().status).toBe('streaming');
    // Unchanged file does not re-emit.
    t.settle();
    expect(events).toHaveLength(1);
  });

  it('finalizes 5 slides into a complete ordered v2 manifest (AC1)', () => {
    const t = createDeckArtboardTracker({ projectRoot: root, emit: (e) => events.push(e) });
    for (const id of ['03-pricing', '01-title', '02-problem', '05-contact', '04-demo']) {
      write(`artifacts/deck-v1/artboards/${id}.html`, slide(`<h1>${id}</h1>`));
    }
    t.settle();
    const result = t.finalize();
    const m = manifest();
    expect(m.version).toBe(2);
    expect(m.status).toBe('complete');
    expect(m.artboards.map((a: any) => a.id)).toEqual(['01-title', '02-problem', '03-pricing', '04-demo', '05-contact']);
    expect(result).toEqual([{ artifactId: 'deck-v1', findings: [] }]);
  });

  it('marks invalid slides and short decks as error (AC3)', () => {
    const t = createDeckArtboardTracker({ projectRoot: root, emit: (e) => events.push(e) });
    write('artifacts/deck-v1/artboards/01-title.html', slide('<h1>TODO</h1>'));
    write('artifacts/deck-v1/artboards/02-x.html', slide('<h1>ok</h1>'));
    t.settle();
    expect(events.find((e) => e.artboardId === '01-title')).toMatchObject({ status: 'error', findings: ['placeholder'] });
    const [deck] = t.finalize();
    expect(deck!.findings.map((f) => f.id)).toEqual(expect.arrayContaining(['too-few-artboards', 'invalid-artboard']));
    expect(manifest().status).toBe('error');
    expect(manifest().artboards[0].status).toBe('error');
  });

  it('ignores files that existed before the run and non-artboard paths', () => {
    write('artifacts/old/artboards/01.html', slide('<h1>old</h1>'));
    const t = createDeckArtboardTracker({ projectRoot: root, emit: (e) => events.push(e) });
    write('artifacts/deck-v1/notes.html', slide('<h1>x</h1>'));
    t.settle();
    expect(events).toEqual([]);
    expect(t.finalize()).toEqual([]);
    expect(existsSync(path.join(root, 'artifacts/old/manifest.json'))).toBe(false);
  });
});
