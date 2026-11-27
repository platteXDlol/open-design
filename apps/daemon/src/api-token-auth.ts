import { createHmac, timingSafeEqual } from 'node:crypto';

export const API_TOKEN_BASIC_USERNAME = 'open-design';

export function isTruthyEnvFlag(value: any): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function isApiAuthDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyEnvFlag(env.OD_DISABLE_API_AUTH);
}

export function apiTokenFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return (env.OD_API_TOKEN ?? '').trim();
}

export function isApiTokenMiddlewareEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return apiTokenFromEnv(env).length > 0 && !isApiAuthDisabled(env);
}

function secretsMatch(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function decodeBasicCredentials(value: string): { username: string; password: string } | null {
  const match =
    /^Basic[\t ]+((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)[\t ]*$/i.exec(
      value,
    );
  if (!match?.[1]) return null;

  const encoded = match[1];
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) return null;

  const decoded = bytes.toString('utf8');
  if (!Buffer.from(decoded, 'utf8').equals(bytes)) return null;

  const separator = decoded.indexOf(':');
  if (separator < 0) return null;
  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

export function apiTokenAuthorizationMatches(value: any, apiToken: string): boolean {
  if (typeof value !== 'string' || apiToken.length === 0) return false;

  const bearer = /^Bearer[\t ]+(\S+)[\t ]*$/i.exec(value);
  if (bearer?.[1]) return secretsMatch(bearer[1], apiToken);

  const basic = decodeBasicCredentials(value);
  return basic !== null
    && basic.username === API_TOKEN_BASIC_USERNAME
    && secretsMatch(basic.password, apiToken);
}

export const TOKEN_SESSION_COOKIE = 'od_token_session';
export const TOKEN_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Stateless browser session: an HMAC keyed by the token, so it survives restarts and dies when OD_API_TOKEN changes. */
export function tokenSessionValue(apiToken: string): string {
  return createHmac('sha256', apiToken).update('od-token-session-v1').digest('hex');
}

export function tokenSessionMatches(cookieValue: string | null | undefined, apiToken: string): boolean {
  if (!cookieValue || apiToken.length === 0) return false;
  return secretsMatch(cookieValue, tokenSessionValue(apiToken));
}

export function tokenLoginMatches(candidate: unknown, apiToken: string): boolean {
  return typeof candidate === 'string' && apiToken.length > 0 && secretsMatch(candidate.trim(), apiToken);
}

export function renderTokenLoginPage(error: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · OpenDesign</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
  main { width: min(360px, calc(100vw - 48px)); padding: 32px; border: 1px solid color-mix(in srgb, CanvasText 15%, transparent); border-radius: 12px; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  p { margin: 0 0 20px; font-size: 14px; opacity: .7; }
  label { display: block; font-size: 13px; margin-bottom: 6px; }
  input { box-sizing: border-box; width: 100%; padding: 10px 12px; font: inherit; border-radius: 8px; border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); background: Canvas; color: CanvasText; }
  button { margin-top: 16px; width: 100%; padding: 10px; font: inherit; font-weight: 600; border: 0; border-radius: 8px; background: CanvasText; color: Canvas; cursor: pointer; }
  .error { margin: 12px 0 0; color: #d33; font-size: 13px; opacity: 1; }
</style>
</head>
<body>
<main>
  <h1>OpenDesign</h1>
  <p>Enter the access token to continue.</p>
  <form method="post" action="/api/auth/token-login">
    <label for="token">Access token</label>
    <input id="token" name="token" type="password" autocomplete="current-password" required autofocus>
    ${error ? '<p class="error" role="alert">Wrong token. Try again.</p>' : ''}
    <button type="submit">Sign in</button>
  </form>
</main>
</body>
</html>`;
}
