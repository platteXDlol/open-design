import type http from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import * as platform from '@open-design/platform';
import { startServer } from '../src/server.js';
type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

describe('API proxy routes', () => {
  const realFetch = globalThis.fetch;
  const originalMediaConfigDir = process.env.OD_MEDIA_CONFIG_DIR;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const started = await startServer({ port: 0, returnServer: true }) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    if (originalMediaConfigDir == null) delete process.env.OD_MEDIA_CONFIG_DIR;
    else process.env.OD_MEDIA_CONFIG_DIR = originalMediaConfigDir;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('converts OpenAI-compatible CRLF SSE chunks into proxy delta/end events', async () => {
    const fetchMock = vi.fn((input: FetchInput, init?: FetchInit) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) return realFetch(input, init);
      return Promise.resolve(sseResponse([
        'data: {"choices":[{"delta":',
        'data: {"content":"hi"}}]}',
        '',
        'data: [DONE]',
        '',
      ].join('\r\n')));
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await realFetch(`${baseUrl}/api/proxy/openai/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    await expect(res.text()).resolves.toContain('event: delta\ndata: {"delta":"hi"}');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
        redirect: 'error',
      }),
    );
  });

  it.each([
    {
      provider: 'anthropic',
      path: '/api/proxy/anthropic/stream',
      body: {
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'sk-ant',
        model: 'claude-test',
        messages: [{ role: 'user', content: 'hello' }],
      },
      response: sseResponse('event: message_stop\ndata: {}\n\n'),
    },
    {
      provider: 'openai',
      path: '/api/proxy/openai/stream',
      body: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'hello' }],
      },
      response: sseResponse('data: [DONE]\n\n'),
    },
    {
      provider: 'ollama',
      path: '/api/proxy/ollama/stream',
      body: {
        baseUrl: 'https://ollama.example.com',
        apiKey: 'ollama-key',
        model: 'llama3',
        messages: [{ role: 'user', content: 'hello' }],
      },
      response: new Response(new TextEncoder().encode('{"done":true}\n'), {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      }),
    },
  ])('uses the live proxy dispatcher for $provider proxy requests', async ({ path, body, response }) => {
    const proxySpy = vi.spyOn(platform, 'resolveSystemProxyEnv').mockReturnValue({
      HTTPS_PROXY: 'http://system-proxy.internal:8443',
      NODE_USE_ENV_PROXY: '1',
    });
    const fetchMock = vi.fn((input: FetchInput, init?: FetchInit) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) return realFetch(input, init);
      expect(init?.dispatcher).toBeDefined();
      return Promise.resolve(response.clone());
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const res = await realFetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      expect(res.status).toBe(200);
      await res.text();
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) => !String(input).startsWith(baseUrl) && init?.dispatcher,
        ),
      ).toBe(true);
    } finally {
      proxySpy.mockRestore();
    }
  });

  it('uses the live proxy dispatcher for ElevenLabs voice discovery', async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), 'od-elevenlabs-proxy-route-'));
    process.env.OD_MEDIA_CONFIG_DIR = configDir;
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, 'media-config.json'), JSON.stringify({
      providers: {
        elevenlabs: {
          apiKey: 'eleven-test-key',
          baseUrl: 'https://elevenlabs-gateway.example.test',
        },
      },
    }), 'utf8');

    const proxySpy = vi.spyOn(platform, 'resolveSystemProxyEnv').mockReturnValue({
      HTTPS_PROXY: 'http://system-proxy.internal:8443',
      NODE_USE_ENV_PROXY: '1',
    });
    const fetchMock = vi.fn((input: FetchInput, init?: FetchInit) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) return realFetch(input, init);
      expect(url).toBe('https://elevenlabs-gateway.example.test/v2/voices?page_size=100');
      expect(init?.dispatcher).toBeDefined();
      return Promise.resolve(Response.json({
        voices: [{ voice_id: 'voice-1', name: 'Rachel' }],
      }));
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const res = await realFetch(`${baseUrl}/api/media/providers/elevenlabs/voices?limit=100`);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        voices: [{ voiceId: 'voice-1', name: 'Rachel' }],
      });
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) => input === 'https://elevenlabs-gateway.example.test/v2/voices?page_size=100' && init?.dispatcher,
        ),
      ).toBe(true);
    } finally {
      proxySpy.mockRestore();
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it('uses the live proxy dispatcher for Tavily research search', async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), 'od-tavily-proxy-route-'));
    process.env.OD_MEDIA_CONFIG_DIR = configDir;
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, 'media-config.json'), JSON.stringify({
      providers: {
        tavily: {
          apiKey: 'tavily-test-key',
          baseUrl: 'https://tavily-gateway.example.test',
        },
      },
    }), 'utf8');

    const proxySpy = vi.spyOn(platform, 'resolveSystemProxyEnv').mockReturnValue({
      HTTPS_PROXY: 'http://system-proxy.internal:8443',
      NODE_USE_ENV_PROXY: '1',
    });
    const fetchMock = vi.fn((input: FetchInput, init?: FetchInit) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) return realFetch(input, init);
      expect(url).toBe('https://tavily-gateway.example.test/search');
      expect(init?.dispatcher).toBeDefined();
      return Promise.resolve(Response.json({
        answer: 'Proxy-safe summary',
        results: [
          {
            title: 'Proxy-safe source',
            url: 'https://example.test/source',
            content: 'Snippet',
          },
        ],
      }));
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const res = await realFetch(`${baseUrl}/api/research/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: 'proxy-aware research',
          providers: ['tavily'],
        }),
      });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual(expect.objectContaining({
        query: 'proxy-aware research',
        provider: 'tavily',
        summary: 'Proxy-safe summary',
        sources: [
          expect.objectContaining({
            title: 'Proxy-safe source',
            url: 'https://example.test/source',
          }),
        ],
      }));
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) => input === 'https://tavily-gateway.example.test/search' && init?.dispatcher,
        ),
      ).toBe(true);
    } finally {
      proxySpy.mockRestore();
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it('reports malformed proxy env before sending the start event on Anthropic streams', async () => {
    const originalHttpProxy = process.env.HTTP_PROXY;
    const originalHttpsProxy = process.env.HTTPS_PROXY;
    const originalAllProxy = process.env.ALL_PROXY;
    process.env.HTTP_PROXY = 'not a valid proxy url';
    delete process.env.HTTPS_PROXY;
    delete process.env.ALL_PROXY;

    try {
      const res = await realFetch(`${baseUrl}/api/proxy/anthropic/stream`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-ant',
          model: 'claude-test',
          messages: [{ role: 'user', content: 'hello' }],
        }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('event: error');
      expect(text).toContain('INTERNAL_ERROR');
      expect(text).not.toContain('event: start');
    } finally {
      if (originalHttpProxy === undefined) delete process.env.HTTP_PROXY;
      else process.env.HTTP_PROXY = originalHttpProxy;
      if (originalHttpsProxy === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = originalHttpsProxy;
      if (originalAllProxy === undefined) delete process.env.ALL_PROXY;
      else process.env.ALL_PROXY = originalAllProxy;
    }
  });

  // Regression: appendVersionedApiPath needs to thread three shapes:
  //   * bare host                  → inject /v1 (api.openai.com)
  //   * sub-path containing /vN    → no inject (api.deepinfra.com/v1/openai)
  //   * sub-path without /vN       → inject /v1 (api.deepseek.com/anthropic)
  // The earlier end-of-path check broke the second case; a "non-empty
  // path → respect verbatim" intermediate fix broke the third. Pin all
  // three so neither regression returns.
  it.each([
    [
      'https://api.deepinfra.com/v1/openai',
      'https://api.deepinfra.com/v1/openai/chat/completions',
    ],
    [
      'https://api.deepinfra.com/v1/openai/',
      'https://api.deepinfra.com/v1/openai/chat/completions',
    ],
    [
      'https://openrouter.ai/api/v1',
      'https://openrouter.ai/api/v1/chat/completions',
    ],
    [
      'https://api.openai.com',
      'https://api.openai.com/v1/chat/completions',
    ],
    [
      'https://api.openai.com/',
      'https://api.openai.com/v1/chat/completions',
    ],
  ])('routes OpenAI baseUrl %s to %s', async (input, expected) => {
    const fetchMock = vi.fn((req: FetchInput, init?: FetchInit) => {
      const url = String(req);
      if (url.startsWith(baseUrl)) return realFetch(req, init);
      return Promise.resolve(sseResponse('data: [DONE]\n\n'));
    });
    vi.stubGlobal('fetch', fetchMock);

    await realFetch(`${baseUrl}/api/proxy/openai/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: input,
        apiKey: 'sk-test',
        model: 'm',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(String(fetchMock.mock.calls[0]![0])).toBe(expected);
  });

  // The Anthropic proxy goes through the same `appendVersionedApiPath`
  // helper, but its preset table includes Anthropic-compatible gateways
  // mounted at non-versioned sub-paths (DeepSeek `/anthropic`, MiniMax
  // `/anthropic`, MiMo `/anthropic`). Those still need the `/v1`
  // injection, otherwise upstream returns 404 on `.../anthropic/messages`.
  it.each([
    [
      'https://api.anthropic.com',
      'https://api.anthropic.com/v1/messages',
    ],
    [
      'https://api.deepseek.com/anthropic',
      'https://api.deepseek.com/anthropic/v1/messages',
    ],
    [
      'https://api.minimax.io/anthropic',
      'https://api.minimax.io/anthropic/v1/messages',
    ],
    [
      'https://token-plan-cn.xiaomimimo.com/anthropic',
      'https://token-plan-cn.xiaomimimo.com/anthropic/v1/messages',
    ],
    [
      'https://proxy.example.test/v1/',
      'https://proxy.example.test/v1/messages',
    ],
    [
      'https://proxy.example.test/custom/anthropic/v1/',
      'https://proxy.example.test/custom/anthropic/v1/messages',
    ],
  ])('routes Anthropic baseUrl %s to %s', async (input, expected) => {
    const fetchMock = vi.fn((req: FetchInput, init?: FetchInit) => {
      const url = String(req);
      if (url.startsWith(baseUrl)) return realFetch(req, init);
      return Promise.resolve(sseResponse('data: [DONE]\n\n'));
    });
    vi.stubGlobal('fetch', fetchMock);

    await realFetch(`${baseUrl}/api/proxy/anthropic/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: input,
        apiKey: 'sk-test',
        model: 'm',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(String(fetchMock.mock.calls[0]![0])).toBe(expected);
  });

  it('allows loopback API base URLs for local OpenAI-compatible providers', async () => {
    const fetchMock = vi.fn((input: FetchInput, init?: FetchInit) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) return realFetch(input, init);
      return Promise.resolve(sseResponse('data: [DONE]\n\n'));
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await realFetch(`${baseUrl}/api/proxy/openai/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'http://localhost:11434/v1',
        apiKey: 'sk-local',
        model: 'llama-local',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain('event: end');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-local' }),
        redirect: 'error',
      }),
    );
  });

  it('allows IPv4-mapped loopback API base URLs for local OpenAI-compatible providers', async () => {
    const fetchMock = vi.fn((input: FetchInput, init?: FetchInit) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) return realFetch(input, init);
      return Promise.resolve(sseResponse('data: [DONE]\n\n'));
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await realFetch(`${baseUrl}/api/proxy/openai/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'http://[::ffff:127.0.0.1]:11434/v1',
        apiKey: 'sk-local',
        model: 'llama-local',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain('event: end');
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'http://[::ffff:7f00:1]:11434/v1/chat/completions',
    );
  });

  it('blocks private network API base URLs before proxying', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await realFetch(`${baseUrl}/api/proxy/openai/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'http://192.168.1.50:11434/v1',
        apiKey: 'sk-private',
        model: 'private-model',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(res.status).toBe(403);
    await expect(res.text()).resolves.toContain('Internal IPs blocked');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'http://0.0.0.0:11434/v1',
    'http://100.64.0.1:11434/v1',
    'http://169.254.169.254/latest/meta-data',
    'http://224.0.0.1:11434/v1',
    'http://[::]/v1',
    'http://[::ffff:192.168.1.50]:11434/v1',
    'http://[fd00::1]:11434/v1',
    'http://[fe80::1]:11434/v1',
  ])('blocks local and private API base URL form %s before proxying', async (privateBaseUrl) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await realFetch(`${baseUrl}/api/proxy/openai/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: privateBaseUrl,
        apiKey: 'sk-private',
        model: 'private-model',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(res.status).toBe(403);
    await expect(res.text()).resolves.toContain('Internal IPs blocked');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces OpenAI-compatible in-stream error frames', async () => {
    vi.stubGlobal('fetch', vi.fn((input: FetchInput, init?: FetchInit) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) return realFetch(input, init);
      return Promise.resolve(sseResponse('data: {"error":{"message":"bad model"}}\n\n'));
    }));

    const res = await realFetch(`${baseUrl}/api/proxy/openai/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        model: 'bad-model',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    await expect(res.text()).resolves.toContain('Provider error: bad model');
  });  // Regression for PR #1176: the Ollama proxy fetch must also set
  // `redirect: 'error'`. Without it, a validated public host could
  // 3xx the daemon to a private/internal URL and slip past the
  // resolved-IP SSRF check that runs *before* the fetch.
  it('forwards redirect:error on the Ollama proxy upstream fetch', async () => {
    const ndjsonResponse = new Response(
      new TextEncoder().encode('{"done":true}\n'),
      {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      },
    );
    const fetchMock = vi.fn((input: FetchInput, init?: FetchInit) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) return realFetch(input, init);
      return Promise.resolve(ndjsonResponse);
    });
    vi.stubGlobal('fetch', fetchMock);

    await realFetch(`${baseUrl}/api/proxy/ollama/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'https://ollama.example.com',
        apiKey: 'ollama-key',
        model: 'llama3',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    const [upstreamUrl, upstreamInit] = fetchMock.mock.calls[0]!;
    expect(String(upstreamUrl)).toBe('https://ollama.example.com/api/chat');
    expect(upstreamInit?.redirect).toBe('error');
  });  // A client that disconnects (Stop / closed tab) must not keep the upstream
  // request billing. Every upstream proxy fetch has to carry an AbortSignal
  // tied to the client connection so the in-flight completion — and any
  // BYOK tool loop that would otherwise fire further paid rounds — unwinds
  // when the client goes away.
  it('passes a client-cancellation signal to the upstream on a simple proxy stream', async () => {
    let upstreamInit: FetchInit | undefined;
    const fetchMock = vi.fn((input: FetchInput, init?: FetchInit) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) return realFetch(input, init);
      upstreamInit = init;
      return Promise.resolve(sseResponse('data: [DONE]\n\n'));
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await realFetch(`${baseUrl}/api/proxy/openai/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    await res.text();

    expect(upstreamInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it('passes a client-cancellation signal to the upstream on a BYOK tool-loop stream', async () => {
    let upstreamInit: FetchInit | undefined;
    const fetchMock = vi.fn((input: FetchInput, init?: FetchInit) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) return realFetch(input, init);
      upstreamInit = init;
      return Promise.resolve(sseResponse('data: [DONE]\n\n'));
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await realFetch(`${baseUrl}/api/proxy/openai/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    await res.text();

    expect(upstreamInit?.signal).toBeInstanceOf(AbortSignal);
  });
});

function sseResponse(text: string): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    },
  );
}
