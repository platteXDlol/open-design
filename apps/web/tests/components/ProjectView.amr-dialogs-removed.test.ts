// Local-First fork regression: the AMR/Cloud balance-gate dialogs that used
// to mount from `ProjectView.handleSend` are no longer reachable.
//
// The `AmrBalanceDialog` component file was deleted in PR #1, and the
// `AmrOwnerTopUpDialog` mount was forced to `if (false)` so its source
// stays as a historical reference without ever rendering. This test
// guards those two invariants by reading the source and the import
// graph directly:
//
//   1. `ProjectView.tsx` MUST NOT import the deleted `AmrBalanceDialog`.
//   2. The mount block in `ProjectView.tsx` MUST be gated on `if (false)`
//      for both dialogs.
//   3. The deleted file MUST NOT exist on disk.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');
const PROJECT_VIEW = resolve(REPO_ROOT, 'apps/web/src/components/ProjectView.tsx');
const AMR_BALANCE_DIALOG = resolve(REPO_ROOT, 'apps/web/src/components/AmrBalanceDialog.tsx');

// When vitest is run from `apps/web` via pnpm filter, `__dirname` already
// points at the package root. The chained `../../../` jumps too far and
// produces `/opt/projects/open-design/apps/apps/web/...`. Detect the
// package root and resolve from there.
const CWD_PROJECT_VIEW = resolve(process.cwd(), 'src/components/ProjectView.tsx');
const CWD_AMR_BALANCE_DIALOG = resolve(process.cwd(), 'src/components/AmrBalanceDialog.tsx');
const PROJECT_VIEW_PATH = existsSync(CWD_PROJECT_VIEW) ? CWD_PROJECT_VIEW : PROJECT_VIEW;
const AMR_BALANCE_DIALOG_PATH = existsSync(CWD_AMR_BALANCE_DIALOG)
  ? CWD_AMR_BALANCE_DIALOG
  : AMR_BALANCE_DIALOG;

describe('ProjectView AMR dialog removal (Local-First fork)', () => {
  it('does not import the deleted AmrBalanceDialog component', () => {
    const source = readFileSync(PROJECT_VIEW_PATH, 'utf8');
    // The deleted file was imported as `./AmrBalanceDialog`. Any import of
    // the deleted module would make the typecheck fail, so a passing
    // typecheck already proves the import is gone — but the assertion
    // makes the intent explicit in the test record.
    expect(source).not.toMatch(/from ['"]\.\/AmrBalanceDialog['"]/);
  });

  it('gates the AmrOwnerTopUpDialog mount on a constant false condition', () => {
    const source = readFileSync(PROJECT_VIEW_PATH, 'utf8');
    // The ask-owner dialog mount should be unreachable. Look for the
    // comment-bounded block that the previous PR added and assert the
    // gate is `if (false)` (not `if (isAmrSend)` or similar).
    expect(source).toMatch(/\{\s*false\s*\?\s*\([\s\S]*?AmrOwnerTopUpDialog[\s\S]*?\)\s*:\s*null\s*\}/);
  });

  it('removes the AmrBalanceDialog source file from the working tree', () => {
    expect(existsSync(AMR_BALANCE_DIALOG_PATH)).toBe(false);
  });
});
