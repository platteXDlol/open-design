// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeckSharePanel } from '../../src/components/DeckSharePanel';

const api = '/api/projects/p1/artifacts/deck-v1/shares';
const token = `odsh_${'a'.repeat(43)}`;
const active = { id: 's1', projectId: 'p1', artifactId: 'deck-v1', createdAt: 0, expiresAt: 1, revokedAt: null, status: 'active' };

describe('DeckSharePanel (share link AC1, AC4, AC5)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('creates a link with the chosen expiry, lists links, and revokes', async () => {
    let shares: unknown[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        shares = [active];
        return new Response(JSON.stringify({ share: active, token, path: `/s/${token}` }), { status: 201 });
      }
      if (init?.method === 'DELETE') {
        shares = [{ ...active, status: 'revoked', revokedAt: 2 }];
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(JSON.stringify({ shares }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<DeckSharePanel projectId="p1" artifactId="deck-v1" />);

    fireEvent.change(screen.getByLabelText(/Expires/), { target: { value: '7d' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }));
    const input = (await screen.findByLabelText('Share link')) as HTMLInputElement;
    expect(input.value).toBe(`${window.location.origin}/s/${token}`);
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(post[0]).toBe(api);
    expect(JSON.parse(String(post[1]!.body))).toEqual({ expires: '7d' });

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(screen.getByText(/revoked/)).toBeTruthy());
    expect(fetchMock.mock.calls.some(([u, i]) => u === `${api}/s1` && i?.method === 'DELETE')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
  });
});
