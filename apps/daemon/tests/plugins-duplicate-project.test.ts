import express from 'express';
import type http from 'node:http';
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  InstalledPluginRecord,
  Project,
  WorkspaceCollabContext,
} from '@open-design/contracts';
import { sendApiError } from '../src/http/api-errors.js';
import {
  closeDatabase,
  deleteProject,
  getConversation,
  getProject,
  insertConversation,
  insertProject,
  openDatabase,
} from '../src/db.js';
import { duplicatePluginExampleIntoProject } from '../src/plugins/duplicate-project.js';
import { removeProjectDir } from '../src/projects.js';
import { registerPluginRoutes } from '../src/routes/plugins/index.js';
import { resolveUserProjectsRoot } from '../src/storage/user-scope.js';

const tempRoots: string[] = [];

afterEach(async () => {
  closeDatabase();
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

async function makePreviewPlugin(root: string, id = 'duplicate-fixture'): Promise<InstalledPluginRecord> {
  const pluginRoot = path.join(root, id);
  await mkdir(path.join(pluginRoot, 'preview'), { recursive: true });
  await writeFile(
    path.join(pluginRoot, 'preview', 'index.html'),
    '<!doctype html><html><body><h1>Duplicable</h1></body></html>',
    'utf8',
  );
  return {
    id,
    title: 'Duplicate Fixture',
    fsPath: pluginRoot,
    manifest: {
      name: id,
      title: 'Duplicate Fixture',
      od: { preview: { entry: 'preview/index.html' } },
    },
  } as InstalledPluginRecord;
}

async function expectMissing(pathname: string): Promise<void> {
  await expect(access(pathname)).rejects.toMatchObject({ code: 'ENOENT' });
}

async function verifyWorkspaceRequestAuthority(req: express.Request) {
  const workspaceId = req.get('x-od-workspace-id')?.trim() ?? '';
  const workspaceMemberId =
    req.get('x-od-workspace-member-id')?.trim() ?? '';
  return {
    ok: true as const,
    context: {
      workspaceId,
      workspaceName: workspaceId,
      workspaceType: 'team',
      workspaceMemberId,
      role: 'member',
      memberStatus: 'active',
      lifecycleState: 'active',
      billingState: 'active',
      planId: null,
      providerMode: 'platform_credits',
      seatSummary: {
        seatLimit: 5,
        usedSeats: 1,
        availableSeats: 4,
        isSeatFull: false,
      },
      permissions: {
        canManageMembers: false,
        canManageBilling: false,
        canInviteMembers: false,
        canManageAutoRecharge: false,
        canShareProjects: true,
        canWriteSyncedFiles: true,
        canViewWorkspaceSettings: true,
        canManageSharedResources: false,
      },
    } as WorkspaceCollabContext,
  };
}

describe('plugin project duplication', () => {
  it.skipIf(process.platform === 'win32')(
    'rejects duplicates that would skip a required symlinked file',
    async () => {
      const root = await makeTempRoot('od-plugin-duplicate-helper-');
      const projectsRoot = resolveUserProjectsRoot(root);
      const plugin = await makePreviewPlugin(root);
      await writeFile(path.join(plugin.fsPath, 'preview', 'target.txt'), 'asset', 'utf8');
      await symlink('target.txt', path.join(plugin.fsPath, 'preview', 'linked.txt'));

      await expect(
        duplicatePluginExampleIntoProject({
          plugin,
          projectsRoot,
          projectId: 'symlink-project',
          metadata: { kind: 'prototype' },
          assembleExample: (templateHtml) => templateHtml,
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: 'DUPLICATE_COPY_INCOMPLETE',
      });
    },
  );




});

async function listen(app: express.Express): Promise<{ server: http.Server; url: string }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind to a TCP port');
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
