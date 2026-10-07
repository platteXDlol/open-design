// Tool definitions and executors exposed to BYOK chat sessions.
//
// Why this file exists: the BYOK chat proxy is a thin pass-through that
// doesn't carry the agent-runtime scaffolding the CLI agents (Claude
// Code / Codex / ...) carry. To let users ask their BYOK chat to "draw
// me a cat" and get an actual rendered PNG back, the daemon used to
// inject an OpenAI-shaped `tools` definition into the upstream completion
// request, then loop on the model's tool_calls: execute → feed the
// result back as a `role: 'tool'` message → re-issue the completion.
// The chat surface stayed the same; the tool dispatch happened
// entirely daemon-side.
//
// Local-First fork v0.3: dropped the SenseAudio + AIHubMix BYOK tool
// definitions and their `execute*` implementations. Both providers
// were cloud-only and removed in v0.2. The retained providers
// (anthropic / openai / ollama) use the OpenAI wire directly — no
// daemon-side tool dispatch. The `executeGenerateImage` /
// `executeGenerateVideo` / `executeGenerateSpeech` functions and the
// AIHubMix-specific executors that lived here are gone. Media
// generation for the retained providers is handled by the dedicated
// Media panel via `apps/daemon/src/media/`, not by the chat tool
// loop.

import { assertAndFetchExternalAsset } from './connectionTest.js';
import path from 'node:path';

// `path` / `assertAndFetchExternalAsset` imports stay for future tool
// executor expansion. (Local-First fork v0.3: removed the
// SenseAudio + AIHubMix executors that used them. With BYOK openai
// covering the retained providers, no daemon-side tool dispatch is
// needed today.) Suppress the unused-import lint for now.
void path;
void assertAndFetchExternalAsset;

/**
 * Runtime context the BYOK tool executor needs. Passed by the chat
 * route on every call so the tool layer stays free of global state and
 * can be unit-tested with a temp directory.
 *
 * Local-First fork v0.3: the `defaultImageModel` /
 * `defaultVideoModel` / `defaultSpeechModel` /
 * `defaultSpeechVoice` / `videoPollIntervalMs` fields are kept for
 * type compatibility with `routes/chat.ts` (which still passes them
 * in `toolCtx`), but no current executor reads them. The fields are
 * optional + never undefined-valued (callers spread-conditional), so
 * the dead-field cost is just an extra byte in the context object.
 * When the media layer cleanup lands, drop these + the
 * `routes/chat.ts` spread at the same time.
 */
export interface BYOKToolContext {
  /** Daemon project root — used to look up media-config when the chat
   *  session key is missing. */
  projectRoot: string;
  /** Daemon's PROJECTS_DIR (the `<projectRoot>/.od/projects/` folder
   *  that holds per-project file trees). Generated images land in
   *  `<projectsRoot>/<projectId>/byok-<id>.png` so the project's
   *  FileViewer / DesignFilesPanel discover them automatically and
   *  the file travels with the project on export, archive, rename. */
  projectsRoot: string;
  /** Active project id from the chat surface. Required — the BYOK
   *  chat always runs inside a project, so the tool dispatch refuses
   *  to fire without one rather than dump bytes into a global cache.
   *  Validated upstream via `isSafeId`. */
  projectId: string;
  /** The BYOK chat session's API key — first credential we try. Bypasses
   *  the media-config indirection so the same key the user just pasted
   *  for chat is the same key the image call uses. */
  upstreamApiKey: string;
  /** The BYOK chat session's base URL (may be a custom gateway). Falls
   *  back to api.senseaudio.cn. */
  upstreamBaseUrl?: string;
  /** Default image model the user picked in BYOK Settings, used when the
   *  LLM didn't pass `model` in tool args. Validated upstream — anything
   *  outside `BYOK_SENSEAUDIO_IMAGE_MODELS` is dropped so a stale
   *  client-side config can't smuggle an unregistered model id through.
   *  Falls back to `BYOK_SENSEAUDIO_DEFAULT_IMAGE_MODEL` (the registry's
   *  first SenseAudio image entry) when missing. */
  defaultImageModel?: string;
  /** Default video model the user picked in BYOK Settings / the composer
   *  video picker, used when the LLM didn't pass `model` in tool args.
   *  Validated upstream against `isAIHubMixVideoModel`; falls back to
   *  `BYOK_AIHUBMIX_DEFAULT_VIDEO_MODEL` when missing. */
  defaultVideoModel?: string;
  /** Default speech (TTS) model the user picked in the composer; authoritative
   *  over the LLM's `model` arg. Falls back to BYOK_AIHUBMIX_DEFAULT_SPEECH_MODEL. */
  defaultSpeechModel?: string;
  /** Default speech voice the user picked in the composer; used when neither the
   *  LLM nor the caller supplies a `voice_id`. */
  defaultSpeechVoice?: string;
  /** Test-only override for the video polling interval (ms). Production
   *  uses 5 s (SenseAudio's recommendation) — tests pass small values
   *  (e.g. 1 ms) to keep the suite fast without changing the polling
   *  semantics. */
  videoPollIntervalMs?: number;
  /** Optional per-request init copied from the live chat turn. Used to
   *  forward the current proxy dispatcher AND the client-cancellation
   *  signal into every upstream fetch the BYOK tool executor performs,
   *  so a disconnected client stops the tool loop's paid work.
   *
   *  Exception — asset downloads: when a provider result URL is fetched
   *  through `assertAndFetchExternalAsset` (connectionTest.ts), that
   *  helper intentionally OVERRIDES `init.dispatcher` with the shared
   *  asset-validating dispatcher whose connect-time DNS lookup rejects
   *  non-public addresses (issue #5478). Asset downloads therefore never
   *  ride the turn proxy dispatcher; submit/poll hops keep it. */
  requestInit?: Pick<RequestInit, 'dispatcher' | 'signal'>;
}

export interface ImageToolResult {
  ok: boolean;
  /** Daemon-served URL on success. */
  url?: string;
  /** Short human-readable failure reason. Stuffed into the `tool` role
   *  reply so the LLM can apologize / retry. */
  error?: string;
}

function withToolRequestInit(
  ctx: BYOKToolContext,
  init: RequestInit,
): RequestInit {
  return {
    ...ctx.requestInit,
    ...init,
  };
}

/**
 * OpenAI-style URL helper. Most BYOK OpenAI-compatible providers
 * (openai / ollama / openai-custom) expose /v1/chat/completions at a
 * per-version path; this normalises the chat route's `effectiveBaseUrl`
 * to that shape. The Azure-specific case lives in the connection-test
 * module (Azure keeps the per-deployment path off /v1/).
 */
export function appendOpenAIApiPath(baseUrl: string, suffix: string): string {
  const url = new URL(baseUrl);
  const trimmed = url.pathname.replace(/\/+$/, '');
  url.pathname = /\/v\d+(\/|$)/.test(trimmed)
    ? `${trimmed}${suffix}`
    : `${trimmed}/v1${suffix}`;
  return url.toString();
}
