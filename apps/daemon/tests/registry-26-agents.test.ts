import { describe, expect, it } from 'vitest';
import { SHIPPED_AGENT_DEFS } from '../src/runtimes/registry.js';
import type { RuntimeAgentDef } from '../src/runtimes/types.js';

describe('SHIPPED_AGENT_DEFS (Local-First fork)', () => {
  it('does not include the amr runtime', () => {
    expect(SHIPPED_AGENT_DEFS.find((a: RuntimeAgentDef) => a.id === 'amr')).toBeUndefined();
  });

  it('ships 26 agents (was 27 before PR #2 dropped amr)', () => {
    expect(SHIPPED_AGENT_DEFS.length).toBe(26);
  });

  it('agent ids are unique', () => {
    const ids = SHIPPED_AGENT_DEFS.map((a: RuntimeAgentDef) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every shipped agent has a non-empty id and name', () => {
    for (const agent of SHIPPED_AGENT_DEFS) {
      expect(agent.id).toBeTruthy();
      expect(agent.name).toBeTruthy();
    }
  });
});
