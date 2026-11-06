import { describe, expect, it } from 'vitest';
import {
  ARTBOARD_SKELETON_HTML,
  renderArtboardDeckDirective,
  renderDeckDirective,
  renderDeckFrameworkDirective,
  renderLegacyDeckCompatibilityDirective,
} from '../src/index.js';

describe('artboard deck directive', () => {
  it('tells the agent to write one file per slide with the skeleton and shared theme', () => {
    const d = renderArtboardDeckDirective();
    expect(d).toContain('artifacts/<deck-id>/artboards/');
    expect(d).toContain('shared/theme.css');
    expect(d).toContain(ARTBOARD_SKELETON_HTML.trim());
    expect(d).toContain('od artifacts deck validate');
  });

  it('routes each mode to one source of text', () => {
    expect(renderDeckDirective('artboards', 'filesystem')).toBe(renderArtboardDeckDirective());
    expect(renderDeckDirective('canonical', 'filesystem')).toBe(renderDeckFrameworkDirective('filesystem'));
    expect(renderDeckDirective('legacy_compatible', 'filesystem')).toBe(
      renderLegacyDeckCompatibilityDirective('filesystem'),
    );
  });

  it('falls back to the single-file framework when the runtime cannot write files', () => {
    expect(renderDeckDirective('artboards', 'text_artifact')).toBe(
      renderDeckFrameworkDirective('text_artifact'),
    );
  });
});

describe('artboard directive shares slide-content discipline with the single-file framework', () => {
  it.each([
    '## Density and overflow discipline',
    '## Data chart discipline',
    '## Nested / concentric diagram discipline',
    '## Mermaid diagram theme discipline',
  ])('%s', (heading) => {
    expect(renderArtboardDeckDirective()).toContain(heading);
  });
});
