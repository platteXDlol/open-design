// M3 public share viewer: GET /s/<token> (page) and GET /s/<token>/f/<file> (deck files).
// The only daemon surface reachable without a session or OD_API_TOKEN. It reads the
// live deck folder of one artifact and nothing else; every miss is the same plain 404.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import {
  ARTBOARD_ALLOWED_HOSTS,
  ARTBOARD_HEIGHT,
  ARTBOARD_WIDTH,
  parseDeckManifestV2,
  type DeckManifestV2,
} from '@open-design/contracts';
import type { ShareStore } from './share-store.js';

export interface ShareViewerDeps {
  store: Pick<ShareStore, 'resolve'>;
  /** Absolute deck folder (`…/artifacts/<artifactId>`) for a resolved share, or null. */
  resolveDeckDir: (share: { userId: string; projectId: string; artifactId: string }) => string | null;
}

const FONT_HOSTS = [...ARTBOARD_ALLOWED_HOSTS].map((h) => `https://${h}`).join(' ');

/** Slides and shared assets: inline scripts/styles allowed, no network except fonts, no forms. */
const FILE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  `style-src 'self' 'unsafe-inline' ${FONT_HOSTS}`,
  `font-src 'self' data: ${FONT_HOSTS}`,
  "img-src 'self' data: blob:",
  "media-src 'self' data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join('; ');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function commonHeaders(res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  // The token is in the URL; never leak it to font hosts or anywhere else.
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function notFound(res: Response) {
  commonHeaders(res);
  res.status(404).type('text/plain').send('Not found');
}

function readManifest(deckDir: string): DeckManifestV2 | null {
  try {
    return parseDeckManifestV2(JSON.parse(fs.readFileSync(path.join(deckDir, 'manifest.json'), 'utf8')));
  } catch {
    return null;
  }
}

/** Deck file a share may serve: listed artboards plus anything under shared/. */
function resolveDeckFile(deckDir: string, manifest: DeckManifestV2, rel: string): string | null {
  if (rel.includes('\0') || rel.includes('\\')) return null;
  const norm = path.posix.normalize(rel);
  if (norm.startsWith('..') || path.posix.isAbsolute(norm)) return null;
  const allowed = manifest.artboards.some((a) => a.file === norm) || norm.startsWith('shared/');
  if (!allowed) return null;
  try {
    const real = fs.realpathSync.native(path.join(deckDir, norm));
    const realDeck = fs.realpathSync.native(deckDir);
    if (!real.startsWith(`${realDeck}${path.sep}`) || !fs.statSync(real).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

export function renderShareViewerPage(manifest: DeckManifestV2, token: string, nonce: string): string {
  const slides = manifest.artboards.map((a, i) => ({
    src: `/s/${token}/f/${a.file}`,
    label: a.title || `Slide ${i + 1}`,
  }));
  const rail = slides
    .map(
      (s, i) =>
        `<li><button type="button" data-i="${i}"${i === 0 ? ' aria-current="true"' : ''}><span>${i + 1}</span>${escapeHtml(s.label)}</button></li>`,
    )
    .join('');
  const first = slides[0];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(manifest.title)}</title>
<style nonce="${nonce}">
*{box-sizing:border-box}
body{margin:0;height:100vh;display:grid;grid-template-columns:220px 1fr;grid-template-rows:auto 1fr;background:#111;color:#eee;font:14px/1.4 system-ui,sans-serif}
header{grid-column:1/-1;padding:10px 16px;border-bottom:1px solid #2a2a2a;display:flex;gap:12px;align-items:baseline}
header h1{font-size:15px;margin:0;font-weight:600}
header small{color:#999}
nav{overflow:auto;border-right:1px solid #2a2a2a}
ol{list-style:none;margin:0;padding:8px}
nav button{width:100%;text-align:left;background:none;border:0;color:inherit;padding:8px;border-radius:6px;cursor:pointer;font:inherit;display:flex;gap:8px}
nav button span{color:#888;min-width:1.5em}
nav button[aria-current="true"]{background:#2a2a2a}
nav button:focus-visible{outline:2px solid #6aa0ff}
main{display:grid;place-items:center;padding:16px;overflow:hidden}
.frame{width:min(100%,calc((100vh - 90px)*${ARTBOARD_WIDTH}/${ARTBOARD_HEIGHT}));aspect-ratio:${ARTBOARD_WIDTH}/${ARTBOARD_HEIGHT};background:#fff}
iframe{width:100%;height:100%;border:0;display:block}
@media (max-width:700px){body{grid-template-columns:1fr;grid-template-rows:auto auto 1fr}nav{border-right:0;border-bottom:1px solid #2a2a2a;max-height:30vh}}
</style>
</head>
<body>
<header><h1>${escapeHtml(manifest.title)}</h1><small>View only · <span id="pos">1</span> / ${slides.length}</small></header>
<nav aria-label="Slides"><ol>${rail}</ol></nav>
<main><div class="frame"><iframe id="slide" title="${escapeHtml(first?.label ?? 'Slide')}" sandbox="allow-scripts" referrerpolicy="no-referrer" src="${first ? escapeHtml(first.src) : 'about:blank'}"></iframe></div></main>
<script nonce="${nonce}">
(function(){
var slides=${JSON.stringify(slides).replace(/</g, '\\u003c')};
var cur=0,frame=document.getElementById('slide'),pos=document.getElementById('pos');
var buttons=document.querySelectorAll('nav button');
function go(i){if(i<0||i>=slides.length)return;cur=i;frame.src=slides[i].src;frame.title=slides[i].label;pos.textContent=String(i+1);
buttons.forEach(function(b,j){if(j===i)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');});}
buttons.forEach(function(b){b.addEventListener('click',function(){go(Number(b.dataset.i));});});
document.addEventListener('keydown',function(e){
if(e.key==='ArrowRight'||e.key==='ArrowDown'||e.key==='PageDown'||e.key===' '){e.preventDefault();go(cur+1);}
else if(e.key==='ArrowLeft'||e.key==='ArrowUp'||e.key==='PageUp'){e.preventDefault();go(cur-1);}
else if(e.key==='Home'){go(0);}else if(e.key==='End'){go(slides.length-1);}
});
})();
</script>
</body>
</html>
`;
}

export function registerShareViewerRoutes(app: Express, deps: ShareViewerDeps) {
  const resolveShare = (req: Request) => {
    const share = deps.store.resolve(String(req.params.token));
    if (!share) return null;
    const deckDir = deps.resolveDeckDir(share);
    if (!deckDir) return null;
    const manifest = readManifest(deckDir);
    return manifest ? { deckDir, manifest } : null;
  };

  app.all(['/s/:token', '/s/:token/f/*rest'], (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    commonHeaders(res);
    res.setHeader('Allow', 'GET, HEAD');
    res.status(405).type('text/plain').send('Method not allowed');
  });

  app.get('/s/:token', (req, res) => {
    const hit = resolveShare(req);
    if (!hit) return notFound(res);
    const nonce = randomBytes(16).toString('base64');
    commonHeaders(res);
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        `style-src 'nonce-${nonce}'`,
        "frame-src 'self'",
        "connect-src 'none'",
        "form-action 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    );
    res.type('html').send(renderShareViewerPage(hit.manifest, String(req.params.token), nonce));
  });

  app.get('/s/:token/f/*rest', (req, res) => {
    const hit = resolveShare(req);
    if (!hit) return notFound(res);
    const rest = (req.params as { rest?: string | string[] }).rest;
    const rel = Array.isArray(rest) ? rest.join('/') : String(rest ?? '');
    const file = resolveDeckFile(hit.deckDir, hit.manifest, rel);
    if (!file) return notFound(res);
    commonHeaders(res);
    res.setHeader('Content-Security-Policy', FILE_CSP);
    res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
    res.sendFile(file);
  });
}
