import type { BrowserContext } from '@playwright/test';

/**
 * Read-only mode for the live site monitor.
 *
 * Every browser page in the monitor runs behind this guard, so a test can
 * never change the live database, files or points, even while signed in:
 * - Realtime Database writes (set/update/push/transactions/onDisconnect) sent
 *   over Firebase's WebSocket are NOT forwarded. The page gets a normal
 *   "ok" reply, so it keeps working, but the server never sees the write.
 * - Any other POST/PUT/PATCH/DELETE to another site (server functions, file
 *   uploads, database REST) is answered with 503 instead of being sent.
 * Allowed exceptions, which only check credentials: the student sign-in
 * function for actions "login" and "verify" (never "choosePin"), and
 * Google's sign-in services (Firebase Auth account and token checks).
 *
 * Everything blocked is listed in the test report so new writes are visible.
 */

// Firebase Realtime Database client actions that change data on the server.
const WRITE_ACTIONS = new Set(['p', 'm', 'o', 'om', 'oc', 'on']);

export type BlockedWrite = { kind: 'database' | 'request'; detail: string };

/** Decides what to do with one complete client->server Firebase message. */
export function inspectDatabaseMessage(text: string): { block: false } | { block: true; path: string; ack: string } {
  let message: any;
  try { message = JSON.parse(text); } catch { return { block: false }; }
  const d = message?.t === 'd' ? message.d : null;
  if (!d || !WRITE_ACTIONS.has(d.a)) return { block: false };
  const ack = JSON.stringify({ t: 'd', d: { r: d.r, b: { s: 'ok', d: '' } } });
  return { block: true, path: `${d.a} ${d.b?.p ?? '?'}`, ack };
}

// Firebase Auth: newer SDKs use identitytoolkit./securetoken. hosts, the
// compat SDK on this site uses www.googleapis.com/identitytoolkit/...
export function isGoogleSignIn(url: URL): boolean {
  // Authentication-only endpoints: never allow Auth account creation,
  // profile/password updates or deletion from a live-site monitor.
  if (url.hostname === 'securetoken.googleapis.com') return url.pathname === '/v1/token';
  if (url.hostname === 'identitytoolkit.googleapis.com') {
    return new Set([
      '/v1/accounts:lookup',
      '/v1/accounts:signInWithCustomToken',
      '/v1/accounts:signInWithPassword',
      '/v1/accounts:signInWithIdp',
    ]).has(url.pathname);
  }
  if (url.hostname === 'www.googleapis.com') {
    return new Set([
      '/identitytoolkit/v3/relyingparty/getAccountInfo',
      '/identitytoolkit/v3/relyingparty/verifyCustomToken',
      '/identitytoolkit/v3/relyingparty/verifyPassword',
      '/identitytoolkit/v3/relyingparty/verifyAssertion',
    ]).has(url.pathname);
  }
  return false;
}

const SIGN_IN_ACTIONS = new Set(['login', 'verify']);

export function isSignInCheck(url: URL, body: string | null): boolean {
  // Never permit a lookalike cross-site endpoint to bypass the write guard.
  if (url.origin !== 'https://us-central1-b3-games.cloudfunctions.net') return false;
  if (!/\/funTorahStudentAuth$/.test(url.pathname)) return false;
  try { return SIGN_IN_ACTIONS.has(JSON.parse(body || '{}').action); } catch { return false; }
}

/**
 * The Realtime Database also uses firebasedatabase.app hosts. Its legacy
 * long-polling fallback packs writes into GET URLs; block that transport,
 * rather than accidentally letting a GET mutation through.
 */
export const DATABASE_WEBSOCKET_PATTERN = /(?:firebaseio\.com|firebasedatabase\.app)\/\.ws(?:\?|$)/;

export function mayForwardHttpRequest(url: URL, method: string, body: string | null): boolean {
  const isDatabase = /(?:^|\.)(?:firebaseio\.com|firebasedatabase\.app)$/.test(url.hostname);
  if (isDatabase && url.pathname === '/.lp') return false;
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  // Same-origin POST is NOT automatically safe: keep it blocked too.
  return isGoogleSignIn(url) || isSignInCheck(url, body);
}

export async function installReadOnlyGuard(context: BrowserContext, siteOrigin: string, blocked: BlockedWrite[]) {
  await context.routeWebSocket(DATABASE_WEBSOCKET_PATTERN, ws => {
    const server = ws.connectToServer();
    // Firebase splits messages over 16 KB: a frame holding the count, then the parts.
    let pending: { left: number; frames: string[] } | null = null;
    ws.onMessage(frame => {
      const text = typeof frame === 'string' ? frame : frame.toString();
      if (pending) {
        pending.frames.push(text);
        if (--pending.left > 0) return;
        const frames = pending.frames;
        pending = null;
        // frames[0] is the count; the rest join into one message.
        return handle(frames.slice(1).join(''), () => frames.forEach(f => server.send(f)));
      }
      if (/^\d{1,5}$/.test(text) && Number(text) > 1) { pending = { left: Number(text), frames: [text] }; return; }
      handle(text, () => server.send(text));
    });
    function handle(text: string, forward: () => void) {
      const verdict = inspectDatabaseMessage(text);
      if (!verdict.block) return forward();
      blocked.push({ kind: 'database', detail: verdict.path });
      ws.send(verdict.ack);
    }
  });

  await context.route('**/*', async route => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    if (mayForwardHttpRequest(url, method, request.postData())) {
      return route.continue();
    }
    blocked.push({ kind: 'request', detail: `${method} ${url.origin}${url.pathname}` });
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Blocked by the site monitor (read-only test).' }),
    });
  });
}
