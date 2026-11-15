import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFolderPickerAvailable, resetFolderPickerAvailableCache } from '../../src/providers/registry';

afterEach(() => {
  resetFolderPickerAvailableCache();
  vi.unstubAllGlobals();
});

function stubFetch(response: Response | Error) {
  const fn = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('fetchFolderPickerAvailable', () => {
  it('is false when the daemon reports no native folder picker (Docker)', async () => {
    stubFetch(new Response(JSON.stringify({ folderPicker: false }), { status: 200 }));
    await expect(fetchFolderPickerAvailable()).resolves.toBe(false);
  });

  it('is true when the daemon reports a picker', async () => {
    stubFetch(new Response(JSON.stringify({ folderPicker: true }), { status: 200 }));
    await expect(fetchFolderPickerAvailable()).resolves.toBe(true);
  });

  it('keeps the old always-shown behavior for daemons without the endpoint', async () => {
    stubFetch(new Response('not found', { status: 404 }));
    await expect(fetchFolderPickerAvailable()).resolves.toBe(true);
  });

  it('asks the daemon once per page', async () => {
    const fn = stubFetch(new Response(JSON.stringify({ folderPicker: false }), { status: 200 }));
    await fetchFolderPickerAvailable();
    await fetchFolderPickerAvailable();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
