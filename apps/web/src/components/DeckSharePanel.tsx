/**
 * M3 share links for one deck (`specs/current/share-link-m3.md`): create a
 * read-only `/s/<token>` link, copy it, list and revoke existing links.
 */
import { useCallback, useEffect, useState } from 'react';
import { SHARE_LINK_DEFAULT_EXPIRY, SHARE_LINK_EXPIRIES, type ShareLink, type ShareLinkExpiry } from '@open-design/contracts';
import { Button } from '@open-design/components';
import { createShareLink, listShareLinks, revokeShareLink } from '../runtime/share-links';
import styles from './DeckArtboardsViewer.module.css';

const EXPIRY_LABEL: Record<ShareLinkExpiry, string> = { '1d': '1 day', '7d': '7 days', '30d': '30 days', never: 'Never' };

interface Props {
  projectId: string;
  artifactId: string;
}

export function DeckSharePanel({ projectId, artifactId }: Props) {
  const [expires, setExpires] = useState<ShareLinkExpiry>(SHARE_LINK_DEFAULT_EXPIRY);
  const [shares, setShares] = useState<ShareLink[]>([]);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    () => listShareLinks(projectId, artifactId).then(setShares, (e: Error) => setError(e.message)),
    [projectId, artifactId],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.sharePanel} aria-label="Share deck">
      <div className={styles.shareRow}>
        <label>
          Expires{' '}
          <select value={expires} onChange={(e) => setExpires(e.target.value as ShareLinkExpiry)} disabled={busy}>
            {SHARE_LINK_EXPIRIES.map((x) => (
              <option key={x} value={x}>
                {EXPIRY_LABEL[x]}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const created = await createShareLink(projectId, artifactId, expires);
              setUrl(created.url);
              await navigator.clipboard?.writeText(created.url).catch(() => undefined);
            })
          }
        >
          Create link
        </Button>
      </div>
      {url ? (
        <p className={styles.shareUrl}>
          <input readOnly value={url} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
          <span>Copied. Anyone with this link can view the deck.</span>
        </p>
      ) : null}
      {error ? <p role="alert" className={styles.exportError}>{error}</p> : null}
      {shares.length ? (
        <ul className={styles.shareList}>
          {shares.map((s) => (
            <li key={s.id} data-status={s.status}>
              <span>
                {new Date(s.createdAt).toLocaleDateString()} · {s.status}
                {s.status === 'active' ? ` · ${s.expiresAt === null ? 'never expires' : `expires ${new Date(s.expiresAt).toLocaleDateString()}`}` : ''}
              </span>
              {s.status === 'active' ? (
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => revokeShareLink(projectId, artifactId, s.id))}>
                  Revoke
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
