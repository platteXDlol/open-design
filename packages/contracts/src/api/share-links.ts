// M3 view-only share links for one multi-artboard deck (see specs/current/share-link-m3.md).

export const SHARE_LINK_EXPIRIES = ['1d', '7d', '30d', 'never'] as const;
export type ShareLinkExpiry = (typeof SHARE_LINK_EXPIRIES)[number];
export const SHARE_LINK_DEFAULT_EXPIRY: ShareLinkExpiry = '30d';
/** Distinct from session (`ods_`) and API (`odt_`) token prefixes. */
export const SHARE_TOKEN_PREFIX = 'odsh_';

export type ShareLinkStatus = 'active' | 'expired' | 'revoked';

export interface ShareLink {
  id: string;
  projectId: string;
  artifactId: string;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms, or null for a link that never expires. */
  expiresAt: number | null;
  revokedAt: number | null;
  status: ShareLinkStatus;
}

export interface CreateShareLinkRequest {
  expires?: ShareLinkExpiry;
}

export interface CreateShareLinkResponse {
  share: ShareLink;
  /** Plain token, returned once; only its hash is stored. */
  token: string;
  /** Origin-relative viewer path, e.g. `/s/odsh_…`. */
  path: string;
}

export interface ShareLinksResponse {
  shares: ShareLink[];
}

export function isShareLinkExpiry(value: unknown): value is ShareLinkExpiry {
  return typeof value === 'string' && (SHARE_LINK_EXPIRIES as readonly string[]).includes(value);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Absolute expiry for a choice made at `now`; null = never. */
export function shareLinkExpiresAt(expiry: ShareLinkExpiry, now: number): number | null {
  if (expiry === 'never') return null;
  return now + Number.parseInt(expiry, 10) * DAY_MS;
}

export function shareLinkStatus(
  link: { expiresAt: number | null; revokedAt: number | null },
  now: number,
): ShareLinkStatus {
  if (link.revokedAt !== null) return 'revoked';
  if (link.expiresAt !== null && link.expiresAt <= now) return 'expired';
  return 'active';
}

export function shareLinkPath(token: string): string {
  return `/s/${token}`;
}

/** Token shape check before any lookup: prefix + 43 base64url chars (32 bytes). */
export function isShareToken(value: unknown): value is string {
  return typeof value === 'string' && /^odsh_[A-Za-z0-9_-]{43}$/.test(value);
}
