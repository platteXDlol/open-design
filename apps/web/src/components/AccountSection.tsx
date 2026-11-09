// v7 SSO: current user, sign out, and personal API tokens for `od` (mirrors `od auth`).
import { useCallback, useEffect, useState } from 'react';
import type { ApiTokenCreateResponse, ApiTokenInfo, AuthMeResponse } from '@open-design/contracts';
import { Button, Input } from '@open-design/components';
import { useT } from '../i18n';
import styles from './AccountSection.module.css';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function AccountSection(): JSX.Element {
  const t = useT();
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const [tokens, setTokens] = useState<ApiTokenInfo[]>([]);
  const [label, setLabel] = useState('');
  const [created, setCreated] = useState<ApiTokenCreateResponse | null>(null);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    try {
      const m = await api<AuthMeResponse>('/api/auth/me');
      setMe(m);
      if (m.ssoEnabled) setTokens((await api<{ tokens: ApiTokenInfo[] }>('/api/auth/tokens')).tokens);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  async function createToken() {
    const r = await api<ApiTokenCreateResponse>('/api/auth/tokens', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: label || 'cli' }),
    });
    setCreated(r);
    setLabel('');
    await reload();
  }
  async function revoke(id: string) {
    await api(`/api/auth/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await reload();
  }
  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.assign('/');
  }

  if (error) return <section className="settings-section"><p role="alert">{t('account.loadFailed')}</p></section>;
  if (!me) return <section className="settings-section" aria-busy="true" />;
  if (!me.ssoEnabled || !me.user) {
    return <section className="settings-section"><p>{t('account.ssoOff')}</p></section>;
  }
  return (
    <section className="settings-section">
      <div className={styles.row}>
        <span>{t('account.signedInAs')} <strong>{me.user.email ?? me.user.name ?? me.user.id}</strong>{me.user.isAdmin ? ` · ${t('account.admin')}` : ''}</span>
        <Button variant="secondary" size="sm" onClick={() => void logout()}>{t('account.logout')}</Button>
      </div>
      <h3>{t('account.tokens')}</h3>
      <p className={styles.hint}>{t('account.tokensHint')}</p>
      {created ? (
        <p role="status">{t('account.tokenShownOnce')} <code className={styles.secret}>{created.token}</code></p>
      ) : null}
      <div className={styles.row}>
        <Input aria-label={t('account.tokenLabel')} placeholder={t('account.tokenLabel')} value={label} onChange={(e) => setLabel(e.target.value)} />
        <Button variant="primary" size="sm" onClick={() => void createToken()}>{t('account.createToken')}</Button>
      </div>
      {tokens.length === 0 ? <p className={styles.hint}>{t('account.noTokens')}</p> : (
        <ul className={styles.tokens}>
          {tokens.map((tok) => (
            <li key={tok.id}>
              <span>{tok.label}</span>
              <Button variant="ghost" size="sm" onClick={() => void revoke(tok.id)}>{t('account.revoke')}</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
