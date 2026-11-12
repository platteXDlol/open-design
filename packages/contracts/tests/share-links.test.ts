import { describe, expect, it } from 'vitest';
import {
  isShareLinkExpiry,
  isShareToken,
  shareLinkExpiresAt,
  shareLinkPath,
  shareLinkStatus,
} from '../src/index.js';

const DAY = 86_400_000;

describe('share link contracts', () => {
  it('maps expiry choices to absolute times', () => {
    expect(shareLinkExpiresAt('1d', 1000)).toBe(1000 + DAY);
    expect(shareLinkExpiresAt('30d', 0)).toBe(30 * DAY);
    expect(shareLinkExpiresAt('never', 5)).toBeNull();
    expect(isShareLinkExpiry('7d')).toBe(true);
    expect(isShareLinkExpiry('2d')).toBe(false);
  });

  it('derives status: revoked wins, then expired, else active', () => {
    expect(shareLinkStatus({ expiresAt: null, revokedAt: null }, 10)).toBe('active');
    expect(shareLinkStatus({ expiresAt: 10, revokedAt: null }, 10)).toBe('expired');
    expect(shareLinkStatus({ expiresAt: 99, revokedAt: 5 }, 10)).toBe('revoked');
  });

  it('checks token shape before lookup', () => {
    const ok = `odsh_${'a'.repeat(43)}`;
    expect(isShareToken(ok)).toBe(true);
    expect(isShareToken(`ods_${'a'.repeat(43)}`)).toBe(false);
    expect(isShareToken(`odsh_${'a'.repeat(42)}/`)).toBe(false);
    expect(shareLinkPath(ok)).toBe(`/s/${ok}`);
  });
});
