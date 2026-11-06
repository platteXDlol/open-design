/**
 * M2 deck repair loop (spec decision 13): when a run ends with an artboard
 * deck that failed validation, the daemon starts a follow-up run carrying the
 * findings, at most `DECK_REPAIR_MAX_ROUNDS` times. After that the deck stays
 * `error` in its manifest and the user decides.
 */
import type { DeckFinalizeResult } from './deck-artboard-tracker.js';

export const DECK_REPAIR_MAX_ROUNDS = 2;

/** Repair round recorded on a chat body; 0 for a user-started run. */
export function deckRepairRound(body: { deckRepairRound?: unknown } | null | undefined): number {
  const n = body?.deckRepairRound;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * Follow-up instruction for the next repair round, or null when nothing needs
 * fixing or the round budget is spent.
 */
export function buildDeckRepairMessage(results: DeckFinalizeResult[], round: number): string | null {
  if (round >= DECK_REPAIR_MAX_ROUNDS) return null;
  const failing = results.filter((r) => r.findings.length > 0);
  if (failing.length === 0) return null;
  const lines = failing.flatMap((r) => [
    `Deck \`artifacts/${r.artifactId}\`:`,
    ...r.findings.map((f) => `- [${f.id}] ${f.message} Fix: ${f.fix}`),
  ]);
  return [
    `Automatic deck check (repair round ${round + 1} of ${DECK_REPAIR_MAX_ROUNDS}): the slide deck you just wrote failed validation.`,
    ...lines,
    'Fix only the slides named above, keep every other slide unchanged, and do not ask questions.',
  ].join('\n');
}
