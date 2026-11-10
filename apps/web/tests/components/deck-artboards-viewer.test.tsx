// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDeckManifestV2 } from '@open-design/contracts';
import {
  DeckArtboardsViewer,
  deckArtifactDirForFile,
} from '../../src/components/DeckArtboardsViewer';

describe('deckArtifactDirForFile', () => {
  it('maps manifest and artboard files to their artifact dir', () => {
    expect(deckArtifactDirForFile('artifacts/deck-v1/manifest.json')).toBe('artifacts/deck-v1');
    expect(deckArtifactDirForFile('artifacts/deck-v1/artboards/01-title.html')).toBe('artifacts/deck-v1');
    expect(deckArtifactDirForFile('index.html')).toBeNull();
    expect(deckArtifactDirForFile('artifacts/deck-v1/notes.html')).toBeNull();
  });
});

describe('DeckArtboardsViewer (M2 AC4)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const files = ['artboards/01-title.html', 'artboards/02-problem.html', 'artboards/03-pricing.html'];

  function stubManifest() {
    const manifest = buildDeckManifestV2({ title: 'Pitch', files });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(manifest))));
  }

  it('renders a rail of all artboards and one main 1920x1080 stage, navigable by keyboard', async () => {
    stubManifest();
    render(<DeckArtboardsViewer projectId="p1" artifactDir="artifacts/deck-v1" initialFile="artboards/02-problem.html" />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Slide \d/ })).toHaveLength(3));
    const main = screen.getByTitle('Slide 2 of 3') as HTMLIFrameElement;
    expect(main.getAttribute('src')).toContain('/api/projects/p1/raw/artifacts/deck-v1/artboards/02-problem.html');
    expect(main.style.width).toBe('1920px');
    expect(main.style.height).toBe('1080px');

    const stage = screen.getByRole('region', { name: 'Pitch' });
    act(() => {
      fireEvent.keyDown(stage, { key: 'ArrowRight' });
    });
    expect(screen.getByTitle('Slide 3 of 3')).toBeTruthy();
    act(() => {
      fireEvent.keyDown(stage, { key: 'ArrowRight' });
    });
    expect(screen.getByTitle('Slide 3 of 3')).toBeTruthy();
    act(() => {
      fireEvent.keyDown(stage, { key: 'Home' });
    });
    expect(screen.getByTitle('Slide 1 of 3')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Slide 3' }));
    expect(screen.getByTitle('Slide 3 of 3')).toBeTruthy();
  });

  it('shows an empty state when the manifest is not a v2 deck', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: 1 }))));
    render(<DeckArtboardsViewer projectId="p1" artifactDir="artifacts/deck-v1" />);
    await waitFor(() => expect(screen.getByText('No slides yet.')).toBeTruthy());
  });

  it('exports through the deck export endpoint and surfaces daemon errors (M3 AC5)', async () => {
    const manifest = buildDeckManifestV2({ title: 'Pitch', files });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return new Response(JSON.stringify(manifest));
      return new Response(JSON.stringify({ error: { message: 'deck has validation findings' } }), { status: 422 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<DeckArtboardsViewer projectId="p1" artifactDir="artifacts/deck-v1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Export PPTX' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'deck has validation findings');
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(post[0]).toBe('/api/projects/p1/artifacts/deck-v1/export');
    expect(JSON.parse(String(post[1]!.body))).toEqual({ format: 'pptx' });
  });
});
