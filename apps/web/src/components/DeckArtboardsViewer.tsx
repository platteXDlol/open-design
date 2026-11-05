/**
 * M2 multi-artboard deck viewer (`specs/current/slide-deck-m2-design.md`):
 * a thumbnail rail plus one main 1920×1080 stage. Every slide is its own
 * URL-loaded iframe (`ArtboardFrame`) — the same unit M4's canvas will place
 * at the manifest's x/y, so the canvas wraps this rather than replacing it.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ARTBOARD_HEIGHT,
  ARTBOARD_WIDTH,
  isDeckArtboardPath,
  parseDeckManifestV2,
  type DeckManifestV2,
} from '@open-design/contracts';
import { projectRawUrl } from '../providers/registry';
import styles from './DeckArtboardsViewer.module.css';

/** `artifacts/<id>` for a v2 deck's manifest or artboard file, else null. */
export function deckArtifactDirForFile(fileName: string): string | null {
  const m = /^(artifacts\/[^/]+)\/manifest\.json$/.exec(fileName);
  if (m) return m[1]!;
  const hit = isDeckArtboardPath(fileName);
  return hit ? `artifacts/${hit.artifactId}` : null;
}

interface ArtboardFrameProps {
  src: string;
  title: string;
  /** Rendered width in CSS px; the 1920×1080 document is scaled to fit. */
  width: number;
  interactive?: boolean;
}

function ArtboardFrame({ src, title, width, interactive = true }: ArtboardFrameProps) {
  const scale = width / ARTBOARD_WIDTH;
  return (
    <div className={styles.frame} style={{ width, height: ARTBOARD_HEIGHT * scale }}>
      <iframe
        src={src}
        title={title}
        sandbox="allow-scripts"
        tabIndex={interactive ? 0 : -1}
        style={{
          width: `${ARTBOARD_WIDTH}px`,
          height: `${ARTBOARD_HEIGHT}px`,
          transform: `scale(${scale})`,
          pointerEvents: interactive ? undefined : 'none',
        }}
      />
    </div>
  );
}

interface Props {
  projectId: string;
  artifactDir: string;
  /** Artifact-relative artboard to open first. */
  initialFile?: string;
  /** Bumps when project files change; reloads manifest and frames. */
  refreshKey?: number | string;
}

export function DeckArtboardsViewer({ projectId, artifactDir, initialFile, refreshKey }: Props) {
  const [manifest, setManifest] = useState<DeckManifestV2 | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(960);

  useEffect(() => {
    let cancelled = false;
    fetch(projectRawUrl(projectId, `${artifactDir}/manifest.json`), { cache: 'no-store' })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const m = parseDeckManifestV2(json);
        setManifest(m);
        if (m && initialFile) {
          const i = m.artboards.findIndex((a) => a.file === initialFile);
          if (i >= 0) setActive(i);
        }
      })
      .catch(() => !cancelled && setManifest(null))
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [projectId, artifactDir, initialFile, refreshKey]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setStageWidth(Math.max(160, Math.min(width, (height * ARTBOARD_WIDTH) / ARTBOARD_HEIGHT)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [manifest]);

  const count = manifest?.artboards.length ?? 0;
  const go = useCallback((i: number) => setActive(Math.max(0, Math.min(count - 1, i))), [count]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const next: Record<string, number> = {
      ArrowRight: active + 1,
      ArrowDown: active + 1,
      PageDown: active + 1,
      ArrowLeft: active - 1,
      ArrowUp: active - 1,
      PageUp: active - 1,
      Home: 0,
      End: count - 1,
    };
    if (e.key in next) {
      e.preventDefault();
      go(next[e.key]!);
    }
  };

  if (!manifest || count === 0) {
    return <div className={styles.empty}>{loaded ? 'No slides yet.' : 'Loading slides…'}</div>;
  }

  const v = refreshKey === undefined ? '' : `?v=${encodeURIComponent(String(refreshKey))}`;
  const url = (file: string) => `${projectRawUrl(projectId, `${artifactDir}/${file}`)}${v}`;
  const current = manifest.artboards[Math.min(active, count - 1)]!;

  return (
    <div className={styles.root}>
      <nav className={styles.rail} aria-label="Slides">
        {manifest.artboards.map((a, i) => (
          <button
            key={a.id}
            type="button"
            aria-label={`Slide ${i + 1}`}
            aria-current={i === active ? 'true' : undefined}
            className={styles.thumb}
            data-status={a.status}
            onClick={() => go(i)}
          >
            <ArtboardFrame src={url(a.file)} title={`Thumbnail ${i + 1}`} width={160} interactive={false} />
            <span className={styles.thumbLabel}>{i + 1}</span>
          </button>
        ))}
      </nav>
      <div
        ref={stageRef}
        className={styles.stage}
        role="region"
        aria-label={manifest.title}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <ArtboardFrame key={current.id} src={url(current.file)} title={`Slide ${active + 1} of ${count}`} width={stageWidth} />
      </div>
    </div>
  );
}
