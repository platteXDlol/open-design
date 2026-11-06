import { describe, expect, it } from 'vitest';
import {
  buildDeckRepairMessage,
  DECK_REPAIR_MAX_ROUNDS,
  deckRepairRound,
} from '../../src/artifacts/deck-repair.js';

const bad = [
  {
    artifactId: 'pitch-v1',
    findings: [
      { severity: 'P0' as const, id: 'invalid-artboard', message: 'Artboards failed validation: 03 (placeholder).', fix: 'Rewrite the listed artboards.' },
    ],
  },
];

describe('deck repair loop', () => {
  it('turns finalize findings into one follow-up instruction', () => {
    const msg = buildDeckRepairMessage(bad, 0)!;
    expect(msg).toContain('artifacts/pitch-v1');
    expect(msg).toContain('[invalid-artboard]');
    expect(msg).toContain('repair round 1 of 2');
  });

  it('stops after the round budget and when nothing failed', () => {
    expect(buildDeckRepairMessage(bad, DECK_REPAIR_MAX_ROUNDS)).toBeNull();
    expect(buildDeckRepairMessage([{ artifactId: 'ok', findings: [] }], 0)).toBeNull();
    expect(buildDeckRepairMessage([], 0)).toBeNull();
  });

  it('reads the round from the chat body', () => {
    expect(deckRepairRound({})).toBe(0);
    expect(deckRepairRound({ deckRepairRound: 1 })).toBe(1);
    expect(deckRepairRound({ deckRepairRound: 'x' })).toBe(0);
  });
});
