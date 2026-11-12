import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Raw (decoded) byte cap for one browser folder upload. */
export const DESIGN_SYSTEM_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

// Text and image files a design system can use; everything else is skipped.
const KEPT_EXTENSIONS = new Set([
  '.md', '.css', '.scss', '.json', '.txt', '.html', '.svg', '.js', '.ts', '.tsx', '.jsx',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf',
]);

export class DesignSystemUploadError extends Error {}

export type DesignSystemUploadFile = { path: string; content: string };

/**
 * Validate a browser folder upload and write it to a fresh temp dir, so the
 * existing local-folder import can run on it unchanged. Returns the staged
 * folder root plus a cleanup. Throws DesignSystemUploadError before writing
 * anything when the upload is empty, unsafe, too large, or has no DESIGN.md.
 */
export async function stageDesignSystemUpload(
  input: unknown,
): Promise<{ root: string; cleanup: () => Promise<void> }> {
  if (!Array.isArray(input) || input.length === 0) {
    throw new DesignSystemUploadError('upload has no files');
  }
  const decoded: Array<{ rel: string; bytes: Buffer }> = [];
  let total = 0;
  for (const f of input as DesignSystemUploadFile[]) {
    if (!f || typeof f.path !== 'string' || typeof f.content !== 'string') {
      throw new DesignSystemUploadError('each file needs a path and base64 content');
    }
    const raw = f.path.replace(/\\/g, '/');
    const rel = path.posix.normalize(raw);
    if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw) || rel.startsWith('../') || rel === '..' || rel.split('/').includes('..')) {
      throw new DesignSystemUploadError(`unsafe file path: ${f.path}`);
    }
    if (!KEPT_EXTENSIONS.has(path.posix.extname(rel).toLowerCase())) continue;
    const bytes = Buffer.from(f.content, 'base64');
    total += bytes.length;
    if (total > DESIGN_SYSTEM_UPLOAD_MAX_BYTES) {
      throw new DesignSystemUploadError(`upload exceeds ${DESIGN_SYSTEM_UPLOAD_MAX_BYTES / 1024 / 1024} MB`);
    }
    decoded.push({ rel, bytes });
  }
  // Browsers prefix every path with the picked folder's name; strip a shared one.
  const first = decoded[0]?.rel.split('/')[0];
  const shared = first && decoded.every((d) => d.rel.startsWith(`${first}/`)) ? `${first}/` : '';
  const files = decoded.map((d) => ({ rel: d.rel.slice(shared.length), bytes: d.bytes }));
  if (!files.some((f) => f.rel.toLowerCase() === 'design.md')) {
    throw new DesignSystemUploadError('folder must contain a DESIGN.md at its top level');
  }
  const staging = await mkdtemp(path.join(tmpdir(), 'od-ds-upload-'));
  // Named folder so the importer derives a sensible default id from it.
  const root = path.join(staging, shared ? shared.slice(0, -1) : 'design-system');
  try {
    for (const f of files) {
      const dest = path.join(root, f.rel);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, f.bytes);
    }
  } catch (err) {
    await rm(staging, { recursive: true, force: true });
    throw err;
  }
  return { root, cleanup: () => rm(staging, { recursive: true, force: true }) };
}
