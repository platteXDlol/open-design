import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InstalledPluginRecord } from '@open-design/contracts';
import { startServer } from '../src/server.js';
import { ensureWorkspaceResource, openDatabase } from '../src/db.js';
import { upsertInstalledPlugin } from '../src/plugins/registry.js';
import {
  __resetPluginEventBufferForTests,
  recordPluginEvent,
} from '../src/plugins/events.js';

let server: http.Server;
let baseUrl: string;
let shutdown: (() => Promise<void> | void) | undefined;

function fakePlugin(
  id: string,
  sourceKind: InstalledPluginRecord['sourceKind'] = 'local',
): InstalledPluginRecord {
  const now = Date.now();
  return {
    id,
    title: id,
    version: '1.0.0',
    sourceKind,
    source: `/private/plugins/${id}`,
    trust: sourceKind === 'bundled' ? 'bundled' : 'trusted',
    capabilitiesGranted: [],
    manifest: { name: id, title: id, version: '1.0.0' } as InstalledPluginRecord['manifest'],
    fsPath: `/private/plugins/${id}`,
    installedAt: now,
    updatedAt: now,
  };
}

function headers(memberId: string) {
  return {
    'x-od-workspace-id': 'event-workspace',
    'x-od-workspace-member-id': memberId,
    'x-od-workspace-role': 'member',
  };
}

beforeAll(async () => {
  const started = await startServer({ port: 0, returnServer: true }) as {
    url: string;
    server: http.Server;
    shutdown?: () => Promise<void> | void;
  };
  baseUrl = started.url;
  server = started.server;
  shutdown = started.shutdown;
  const db = openDatabase(process.cwd(), { dataDir: process.env.OD_DATA_DIR! });

  for (const plugin of [
    fakePlugin('event-bundled', 'bundled'),
    fakePlugin('event-unbound'),
    fakePlugin('event-personal-a'),
    fakePlugin('event-personal-b'),
    fakePlugin('event-team'),
  ]) upsertInstalledPlugin(db, plugin);

  ensureWorkspaceResource(db, 'plugin', 'event-workspace', 'event-personal-a', {
    visibility: 'personal',
    createdByWorkspaceMemberId: 'event-member-a',
  });
  ensureWorkspaceResource(db, 'plugin', 'event-workspace', 'event-personal-b', {
    visibility: 'personal',
    createdByWorkspaceMemberId: 'event-member-b',
  });
  ensureWorkspaceResource(db, 'plugin', 'event-workspace', 'event-team', {
    visibility: 'team',
    createdByWorkspaceMemberId: 'event-member-a',
  });

  __resetPluginEventBufferForTests();
  for (const pluginId of [
    'event-bundled',
    'event-unbound',
    'event-personal-a',
    'event-personal-b',
    'event-team',
    '',
  ]) {
    recordPluginEvent({
      kind: pluginId ? 'plugin.installed' : 'plugin.marketplace-refreshed',
      pluginId,
      details: { source: `/private/source/${pluginId || 'global'}` },
    });
  }
});

afterAll(async () => {
  __resetPluginEventBufferForTests();
  await Promise.resolve(shutdown?.());
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('plugin event workspace isolation', () => {

  it('keeps headerless local compatibility to bundled and unbound events only', async () => {
    const response = await fetch(`${baseUrl}/api/plugins/events/snapshot`);
    expect(response.status).toBe(200);
    const body = await response.json() as { events: Array<{ pluginId: string }> };
    expect(body.events.map((event) => event.pluginId).sort()).toEqual([
      'event-bundled',
      'event-unbound',
    ]);
  });


});
