import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ARTBOARD_SKELETON_HTML, buildDeckManifestV2 } from '@open-design/contracts';
import {
  createHeadlessSlideRenderer,
  DeckExportError,
  exportDeckArtifact,
  resolveChromiumPath,
  type SlideRenderer,
} from '../../src/artifacts/deck-artboard-export.js';

const slide = (body: string) => ARTBOARD_SKELETON_HTML.replace('<!-- SLOT: slide content -->', body);
// 1×1 transparent PNG: a stand-in renderer so assembly tests need no browser.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const fakeRender: SlideRenderer = async (files) => files.map(() => ({ buffer: PNG, jpeg: false }));

describe('deck export (M3)', () => {
  let root: string;
  const dir = () => path.join(root, 'artifacts', 'deck-v1');
  const write = (rel: string, text: string) => {
    const p = path.join(dir(), rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  const files = ['artboards/01-title.html', 'artboards/02-pricing.html', 'artboards/03-contact.html'];
  const manifest = () => JSON.parse(readFileSync(path.join(dir(), 'manifest.json'), 'utf8'));

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'od-deck-export-'));
    files.forEach((f, i) => write(f, slide(`<h1>Slide ${i + 1}</h1>`)));
    write('shared/theme.css', ':root{--bg:#fff}');
    write('manifest.json', JSON.stringify({ ...buildDeckManifestV2({ title: 'Pitch', files }), custom: 1 }));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('AC1: pptx has one slide per artboard, stored and recorded (AC3)', async () => {
    const { record, buffer } = await exportDeckArtifact({
      projectRoot: root, artifactId: 'deck-v1', format: 'pptx', render: fakeRender,
    });
    const zip = await JSZip.loadAsync(buffer);
    expect(Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))).toHaveLength(3);
    expect(record.file).toBe('exports/deck-v1.pptx');
    expect(existsSync(path.join(dir(), record.file))).toBe(true);
    expect(manifest().exported).toEqual([record]);
    expect(manifest().custom).toBe(1);
  });

  it('AC2: pdf has N pages; html zip has index + artboards + shared', async () => {
    const pdf = await exportDeckArtifact({ projectRoot: root, artifactId: 'deck-v1', format: 'pdf', render: fakeRender });
    expect((await PDFDocument.load(pdf.buffer)).getPageCount()).toBe(3);
    const html = await exportDeckArtifact({ projectRoot: root, artifactId: 'deck-v1', format: 'html' });
    const names = Object.keys((await JSZip.loadAsync(html.buffer)).files);
    expect(names).toEqual(expect.arrayContaining(['index.html', 'manifest.json', 'shared/theme.css', ...files]));
    expect(names.some((n) => n.startsWith('exports'))).toBe(false);
  });

  it('AC3: re-export replaces the record for that format only', async () => {
    let t = 0;
    const now = () => new Date(++t * 1000);
    await exportDeckArtifact({ projectRoot: root, artifactId: 'deck-v1', format: 'pdf', render: fakeRender, now });
    await exportDeckArtifact({ projectRoot: root, artifactId: 'deck-v1', format: 'html', now });
    await exportDeckArtifact({ projectRoot: root, artifactId: 'deck-v1', format: 'pdf', render: fakeRender, now });
    const ex = manifest().exported;
    expect(ex.map((e: any) => e.format)).toEqual(['html', 'pdf']);
    expect(ex[1].createdAt).toBe(new Date(3000).toISOString());
  });

  it('AC4: invalid deck is refused and nothing is written', async () => {
    write('artboards/02-pricing.html', slide('<h1>TODO</h1>'));
    const err = await exportDeckArtifact({ projectRoot: root, artifactId: 'deck-v1', format: 'html' }).catch((e) => e);
    expect(err).toBeInstanceOf(DeckExportError);
    expect(err.kind).toBe('invalid');
    expect(err.findings.map((f: any) => f.id)).toContain('placeholder');
    expect(existsSync(path.join(dir(), 'exports'))).toBe(false);
    expect(manifest().exported).toBeUndefined();
  });

  it('reports missing decks and a missing renderer', async () => {
    await expect(exportDeckArtifact({ projectRoot: root, artifactId: 'nope', format: 'html' }))
      .rejects.toMatchObject({ kind: 'not-found' });
    await expect(exportDeckArtifact({ projectRoot: root, artifactId: 'deck-v1', format: 'pptx', render: null }))
      .rejects.toMatchObject({ kind: 'no-renderer' });
  });

  it('OD_CHROMIUM_PATH pointing nowhere resolves to null', async () => {
    expect(await resolveChromiumPath({ OD_CHROMIUM_PATH: '/nonexistent/chrome' })).toBeNull();
  });
});

const chromium = await resolveChromiumPath();
describe.skipIf(!chromium)('headless renderer (real Chromium)', () => {
  it('renders each artboard to a 1920×1080 PNG', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'od-deck-render-'));
    try {
      const a = path.join(root, 'a.html');
      const b = path.join(root, 'b.html');
      writeFileSync(a, slide('<h1>One</h1>'));
      writeFileSync(b, slide('<h1>Two</h1>'));
      const images = await createHeadlessSlideRenderer(chromium!)([a, b]);
      expect(images).toHaveLength(2);
      // PNG IHDR: width at byte 16, height at byte 20.
      expect(images[0]!.buffer.readUInt32BE(16)).toBe(1920);
      expect(images[0]!.buffer.readUInt32BE(20)).toBe(1080);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
