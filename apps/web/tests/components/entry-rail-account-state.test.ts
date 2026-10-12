import { describe, expect, it } from 'vitest';

import {
  resolveEntryRailAccountFooterState,
  requiresAmrReauthentication,
} from '../../src/components/entry-rail-account-state';
import type { WorkspaceContextState } from '../../src/collab/useWorkspaceContext';

const SIGNED_IN_CONTEXT = {
  workspaceId: 'workspace-1',
} as WorkspaceContextState['context'];

describe('resolveEntryRailAccountFooterState (Local-First fork)', () => {
  it('always returns "hidden" while a workspace context is present', () => {
    expect(resolveEntryRailAccountFooterState({
      context: SIGNED_IN_CONTEXT,
      loading: false,
      failure: 'unavailable',
    }, true)).toBe('hidden');
  });

  it('always returns "hidden" while the workspace identity is still loading', () => {
    expect(resolveEntryRailAccountFooterState({
      context: null,
      loading: true,
    }, null)).toBe('hidden');
  });

  it.each([true, null, false] as const)(
    'always returns "hidden" during a workspace outage regardless of the AMR login state (%s)',
    (amrLoggedIn) => {
      expect(resolveEntryRailAccountFooterState({
        context: null,
        loading: false,
        failure: 'unavailable',
      }, amrLoggedIn)).toBe('hidden');
    },
  );

  it('always returns "hidden" even when authoritative auth has expired', () => {
    expect(resolveEntryRailAccountFooterState({
      context: null,
      loading: false,
      failure: 'reauth-required',
    }, true, 'reauth_required')).toBe('hidden');
  });

  it('always returns "hidden" even when a workspace identity is loaded and reauth is required', () => {
    expect(resolveEntryRailAccountFooterState({
      context: SIGNED_IN_CONTEXT,
      loading: false,
      failure: 'reauth-required',
    }, true, 'reauth_required')).toBe('hidden');
  });

  it('always returns "hidden" for a next successful null response', () => {
    expect(resolveEntryRailAccountFooterState({
      context: null,
      loading: false,
    }, true)).toBe('hidden');
  });

  it('always returns "hidden" for the legacy unsupported-daemon failure mode', () => {
    expect(resolveEntryRailAccountFooterState({
      context: null,
      loading: false,
      failure: 'unsupported',
    }, true)).toBe('hidden');
  });
});

describe('requiresAmrReauthentication (Local-First fork)', () => {
  it('still reports reauth-required when the AMR session is in the reauth_required state', () => {
    // `requiresAmrReauthentication` is kept for type-compat with the existing
    // call sites in `entry-rail-account-state`'s wider module surface. The
    // rail no longer reads its return value, but the function still
    // computes the same boolean it always did.
    expect(requiresAmrReauthentication('authenticated', 'reauth-required')).toBe(true);
  });
});
