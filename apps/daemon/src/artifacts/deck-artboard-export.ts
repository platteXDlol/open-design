/**
 * M3 deck export: multi-artboard deck → PPTX / PDF / offline HTML ZIP.
 * Design: `specs/current/deck-export-m3-design.md`.
 *
 * Rendering is headless Chromium via playwright-core so a Docker/web-only
 * daemon (no desktop runtime) can export. Assembly reuses the screenshot
 * builders in `../deck-export.ts`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import JSZip from 'jszip';
import {
  ARTBOARD_ALLOWED_HOSTS,
  ARTBOARD_HEIGHT,
  ARTBOARD_WIDTH,
  buildDeckExportIndexHtml,
  deckExportFile,
  type ArtifactLintFinding,
  type DeckExportFormat,
  type DeckExportRecord,
} from '@open-design/contracts';

import { buildScreenshotPdf, buildScreenshotPptx, type SlideImage } from '../deck-export.js';
import { inspectDeckArtifact } from './deck-artboard-tracker.js';

/** Renders absolute artboard file paths to one 1920×1080 PNG each, in order. */
export type SlideRenderer = (files: string[]) => Promise<SlideImage[]>;

export class DeckExportError extends Error {
  constructor(
    readonly kind: 'not-found' | 'invalid' | 'no-renderer',
    message: string,
    readonly findings: ArtifactLintFinding[] = [],
  ) {
    super(message);
  }
}

const SYSTEM_CHROMIUM_PATHS = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/** `OD_CHROMIUM_PATH`, then Playwright's own download, then common system installs. */
export async function resolveChromiumPath(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (env.OD_CHROMIUM_PATH) return existsSync(env.OD_CHROMIUM_PATH) ? env.OD_CHROMIUM_PATH : null;
  try {
    const { chromium } = await import('playwright-core');
    const p = chromium.executablePath();
    if (p && existsSync(p)) return p;
  } catch {
    // playwright-core reports no browser for this platform; try system paths.
  }
  return SYSTEM_CHROMIUM_PATHS.find((p) => existsSync(p)) ?? null;
}

export function createHeadlessSlideRenderer(executablePath: string): SlideRenderer {
  return async (files) => {
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
    try {
      const context = await browser.newContext({
        viewport: { width: ARTBOARD_WIDTH, height: ARTBOARD_HEIGHT },
        deviceScaleFactor: 1,
      });
      // Artboards are local files; only the allowed font CDNs may be fetched.
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        const ok = url.protocol === 'file:' || url.protocol === 'data:' || ARTBOARD_ALLOWED_HOSTS.has(url.hostname);
        return ok ? route.continue() : route.abort();
      });
      const page = await context.newPage();
      const images: SlideImage[] = [];
      for (const file of files) {
        await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 30_000 });
        // String form: the daemon tsconfig has no DOM lib.
        await page.evaluate('document.fonts.ready.then(() => undefined)');
        images.push({ buffer: await page.screenshot({ type: 'png' }), jpeg: false });
      }
      return images;
    } finally {
      await browser.close();
    }
  };
}

async function buildHtmlZip(dir: string, indexHtml: string): Promise<Buffer> {
  const zip = new JSZip();
  const walk = (rel: string) => {
    for (const name of readdirSync(path.join(dir, rel))) {
      const r = rel ? `${rel}/${name}` : name;
      if (r === 'exports' || r === 'snapshots') continue;
      if (statSync(path.join(dir, r)).isDirectory()) walk(r);
      else zip.file(r, readFileSync(path.join(dir, r)));
    }
  };
  walk('');
  zip.file('index.html', indexHtml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * Export one deck. Writes `artifacts/<id>/exports/<id>.<ext>`, records it in
 * the manifest's `exported` list (one entry per format), and returns the bytes.
 * Refuses invalid decks without writing anything.
 */
export async function exportDeckArtifact(opts: {
  projectRoot: string;
  artifactId: string;
  format: DeckExportFormat;
  /** Required for pptx/pdf. */
  render?: SlideRenderer | null;
  now?: () => Date;
}): Promise<{ record: DeckExportRecord; buffer: Buffer }> {
  const { projectRoot, artifactId, format } = opts;
  const deck = inspectDeckArtifact(projectRoot, artifactId);
  if (!deck || !deck.manifest) throw new DeckExportError('not-found', 'deck not found');
  if (!deck.valid) {
    const findings = [...deck.findings, ...deck.artboards.flatMap((a) => a.findings)];
    throw new DeckExportError('invalid', 'deck has validation findings; fix them before exporting', findings);
  }
  const manifest = deck.manifest;
  const dir = path.join(projectRoot, 'artifacts', artifactId);

  let buffer: Buffer;
  if (format === 'html') {
    buffer = await buildHtmlZip(dir, buildDeckExportIndexHtml(manifest));
  } else {
    if (!opts.render) {
      throw new DeckExportError(
        'no-renderer',
        'no Chromium found for deck export; install chromium or set OD_CHROMIUM_PATH',
      );
    }
    const images = await opts.render(manifest.artboards.map((a) => path.join(dir, a.file)));
    buffer =
      format === 'pptx'
        ? await buildScreenshotPptx(images, { title: manifest.title, aspect: ARTBOARD_WIDTH / ARTBOARD_HEIGHT })
        : await buildScreenshotPdf(images);
  }

  const file = deckExportFile(artifactId, format);
  mkdirSync(path.join(dir, 'exports'), { recursive: true });
  writeFileSync(path.join(dir, file), buffer);
  const record: DeckExportRecord = {
    format,
    file,
    bytes: buffer.length,
    createdAt: (opts.now?.() ?? new Date()).toISOString(),
  };
  // Rewrite the raw manifest so fields this module does not know survive.
  const manifestPath = path.join(dir, 'manifest.json');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  } catch {
    // inspectDeckArtifact parsed it a moment ago; fall back to the parsed shape.
    raw = { ...manifest };
  }
  const prior = Array.isArray(raw.exported) ? (raw.exported as Array<{ format?: unknown }>) : [];
  raw.exported = [...prior.filter((e) => e?.format !== format), record];
  writeFileSync(manifestPath, `${JSON.stringify(raw, null, 2)}\n`);
  return { record, buffer };
}
