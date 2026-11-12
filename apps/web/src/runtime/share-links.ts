// M3 view-only deck links; same endpoints as `od share`.
import type { CreateShareLinkResponse, ShareLink, ShareLinkExpiry, ShareLinksResponse } from '@open-design/contracts';

const base = (projectId: string, artifactId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}/shares`;

async function ok<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    const body = (await resp.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message || `request failed (${resp.status})`);
  }
  return (await resp.json()) as T;
}

export async function createShareLink(projectId: string, artifactId: string, expires: ShareLinkExpiry) {
  const resp = await fetch(base(projectId, artifactId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expires }),
  });
  const created = await ok<CreateShareLinkResponse>(resp);
  return { ...created, url: `${window.location.origin}${created.path}` };
}

export async function listShareLinks(projectId: string, artifactId: string): Promise<ShareLink[]> {
  return (await ok<ShareLinksResponse>(await fetch(base(projectId, artifactId), { cache: 'no-store' }))).shares;
}

export async function revokeShareLink(projectId: string, artifactId: string, id: string): Promise<void> {
  await ok(await fetch(`${base(projectId, artifactId)}/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}
