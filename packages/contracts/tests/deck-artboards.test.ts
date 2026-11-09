import { describe, expect, it } from 'vitest';
import {
  ARTBOARD_HEIGHT,
  ARTBOARD_MAX_BYTES,
  ARTBOARD_SKELETON_HTML,
  ARTBOARD_WIDTH,
  DECK_MIN_ARTBOARDS,
  buildDeckManifestV2,
  isDeckArtboardPath,
  parseDeckManifestV2,
  validateArtboardHtml,
  validateArtboardDeck,
} from '../src/artifacts/deck-artboards';

const slide = (body: string) =>
  ARTBOARD_SKELETON_HTML.replace('<!-- SLOT: slide content -->', body);

describe('artboard skeleton', () => {
  it('is a valid artboard on its own once filled', () => {
    expect(validateArtboardHtml(slide('<h1>Pricing that scales</h1>'))).toEqual([]);
  });

  it('fixes the 1920x1080 frame', () => {
    expect(ARTBOARD_WIDTH).toBe(1920);
    expect(ARTBOARD_HEIGHT).toBe(1080);
    expect(ARTBOARD_SKELETON_HTML).toContain('data-od-artboard="1"');
    expect(ARTBOARD_SKELETON_HTML).toContain('../shared/theme.css');
  });
});

describe('validateArtboardHtml (AC3)', () => {
  const ids = (html: string) => validateArtboardHtml(html).map((f) => f.id);

  it('rejects prose that is not a document', () => {
    expect(ids('Here is your slide about pricing, enjoy it a lot friend!!!!!!!!!!!!!!!')).toContain('not-a-document');
  });

  it('rejects placeholder text', () => {
    expect(ids(slide('<h1>TODO pricing</h1>'))).toContain('placeholder');
    expect(ids(slide('<p>Lorem ipsum dolor</p>'))).toContain('placeholder');
    expect(ids(slide('<p>Price: TBD</p>'))).toContain('placeholder');
  });

  it('ignores placeholder words in markup, styles and scripts (real-model false positive)', () => {
    expect(ids(slide('<ul><li class="task todo">Ship landing page</li></ul>'))).not.toContain('placeholder');
    expect(ids(slide('<style>.todo{color:red}</style><p>Done</p>'))).not.toContain('placeholder');
    expect(ids(slide('<script>const todo = 1;</script><p>Done</p>'))).not.toContain('placeholder');
  });

  it('rejects third-party URLs but allows approved font CDNs and data URIs', () => {
    expect(ids(slide('<img src="https://example.com/a.png">'))).toContain('third-party-url');
    expect(ids(slide('<script src="//cdn.evil.dev/x.js"></script>'))).toContain('third-party-url');
    expect(
      ids(slide('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">')),
    ).not.toContain('third-party-url');
    expect(ids(slide('<img src="data:image/png;base64,AAAA">'))).not.toContain('third-party-url');
  });

  it('rejects artboards over the size budget', () => {
    expect(ids(slide(`<p>${'x'.repeat(ARTBOARD_MAX_BYTES)}</p>`))).toContain('too-large');
  });

  it('requires the frame marker', () => {
    expect(ids(slide('<h1>Hi</h1>').replace('data-od-artboard="1"', ''))).toContain('missing-frame-marker');
  });

  it('requires exactly one slide root', () => {
    const two = slide('<h1>Hi</h1>').replace(
      '</main>',
      '</main><main class="artboard" data-od-slide-root>x</main>',
    );
    expect(ids(two)).toContain('slide-root-count');
  });
});

describe('manifest v2 (AC1, AC5)', () => {
  const files = ['artboards/01-title.html', 'artboards/02-problem.html', 'artboards/03-pricing.html'];

  it('builds an ordered v2 manifest laid out in a row', () => {
    const m = buildDeckManifestV2({ title: 'Pitch', files });
    expect(m.version).toBe(2);
    expect(m.kind).toBe('deck');
    expect(m.renderer).toBe('deck-artboards');
    expect(m.entry).toBe(files[0]);
    expect(m.artboards.map((a) => a.id)).toEqual(['01-title', '02-problem', '03-pricing']);
    expect(m.artboards.map((a) => a.x)).toEqual([0, 2020, 4040]);
    expect(m.artboards.every((a) => a.w === 1920 && a.h === 1080 && a.y === 0)).toBe(true);
  });

  it('round-trips through the parser', () => {
    const m = buildDeckManifestV2({ title: 'Pitch', files });
    expect(parseDeckManifestV2(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });

  it('returns null for v1 manifests so the v1 path is untouched', () => {
    expect(
      parseDeckManifestV2({ version: 1, kind: 'deck', title: 'x', entry: 'deck.html', renderer: 'deck-html', exports: [] }),
    ).toBeNull();
  });

  it('rejects unsafe artboard paths', () => {
    const m = buildDeckManifestV2({ title: 'Pitch', files });
    const bad = { ...m, artboards: [{ ...m.artboards[0], file: '../../etc/passwd' }] };
    expect(parseDeckManifestV2(bad)).toBeNull();
  });

  it('recognises artboard paths', () => {
    expect(isDeckArtboardPath('artifacts/deck-v1/artboards/01-title.html')).toEqual({
      artifactId: 'deck-v1',
      artboardId: '01-title',
      file: 'artboards/01-title.html',
    });
    expect(isDeckArtboardPath('artifacts/deck-v1/manifest.json')).toBeNull();
    expect(isDeckArtboardPath('artifacts/../x/artboards/a.html')).toBeNull();
  });
});

describe('validateArtboardDeck (AC1, AC3)', () => {
  it('requires at least the minimum artboard count', () => {
    expect(DECK_MIN_ARTBOARDS).toBe(3);
    const m = buildDeckManifestV2({ title: 'x', files: ['artboards/a.html', 'artboards/b.html'] });
    expect(validateArtboardDeck(m, m.artboards.map((a) => a.file)).map((f) => f.id)).toContain('too-few-artboards');
  });

  it('flags manifest/disk disagreement and plan mismatch', () => {
    const files = ['artboards/a.html', 'artboards/b.html', 'artboards/c.html'];
    const m = buildDeckManifestV2({ title: 'x', files });
    const ids = validateArtboardDeck(m, files.slice(0, 2), { expectedCount: 5 }).map((f) => f.id);
    expect(ids).toContain('missing-artboard-file');
    expect(ids).toContain('artboard-count-mismatch');
  });

  it('passes a consistent deck', () => {
    const files = ['artboards/a.html', 'artboards/b.html', 'artboards/c.html'];
    const m = buildDeckManifestV2({ title: 'x', files });
    expect(validateArtboardDeck(m, files)).toEqual([]);
  });
});
