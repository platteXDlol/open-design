import type { WorkspaceContextState } from '../collab/useWorkspaceContext';

export type EntryRailAccountFooterState = 'hidden' | 'syncing' | 'recovering' | 'sign-in';

export function requiresAmrReauthentication(
  amrSessionState: import('@open-design/contracts').AmrSessionState | undefined,
  workspaceFailure: WorkspaceContextState['failure'],
): boolean {
  return amrSessionState === 'reauth_required' || workspaceFailure === 'reauth-required';
}

/**
 * Local-First fork: the entry rail never surfaces a Cloud account row. The
 * self-hosted daemon is the only "cloud" the user has, and there is no
 * authoritative sign-in state to show. The signature is preserved (the
 * AMR-derived callers still pass through it) but the body always answers
 * `'hidden'`. Unused parameters are prefixed with `_` so linters don't flag
 * them while we keep the call sites intact.
 */
export function resolveEntryRailAccountFooterState(
  _workspaceState: WorkspaceContextState,
  _amrLoggedIn: boolean | null | undefined,
  _amrSessionState?: import('@open-design/contracts').AmrSessionState,
): EntryRailAccountFooterState {
  return 'hidden';
}
