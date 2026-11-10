// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountSection } from '../../src/components/AccountSection';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function stub(ssoEnabled: boolean) {
  let tokens = [{ id: 't1', label: 'laptop', createdAt: 1 }];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const m = init?.method ?? 'GET';
    if (url === '/api/auth/me') return Response.json({ ssoEnabled, user: ssoEnabled ? { id: 'u', email: 'a@x', name: null, isAdmin: true } : null });
    if (url === '/api/auth/tokens' && m === 'GET') return Response.json({ tokens });
    if (url === '/api/auth/tokens' && m === 'POST') { tokens = [...tokens, { id: 't2', label: 'cli', createdAt: 2 }]; return Response.json({ id: 't2', token: 'odt_secret' }); }
    if (url === '/api/auth/tokens/t1' && m === 'DELETE') { tokens = tokens.filter((t) => t.id !== 't1'); return Response.json({ ok: true }); }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', f);
  return f;
}

describe('AccountSection (v7)', () => {
  it('AC3: says SSO is off when not configured', async () => {
    stub(false);
    render(<AccountSection />);
    expect(await screen.findByText(/single sign-on is off/i)).toBeTruthy();
  });

  it('AC4: shows user, creates a token once, revokes', async () => {
    stub(true);
    render(<AccountSection />);
    expect(await screen.findByText('a@x')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /create token/i }));
    expect(await screen.findByText('odt_secret')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /revoke/i })[0]!);
    await waitFor(() => expect(screen.queryByText('laptop')).toBeNull());
  });
});
