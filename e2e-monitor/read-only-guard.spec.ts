import { test, expect } from './fixtures';
import { FUNCTIONS_URL, openHomeSignedOut } from './helpers';
import { inspectDatabaseMessage, isGoogleSignIn, isSignInCheck, mayForwardHttpRequest, DATABASE_WEBSOCKET_PATTERN } from './read-only-guard';

// Proves the read-only guard works before trusting it with a signed-in test.
// Both probes aim at places that would REFUSE the change anyway (a private
// database path and a function that does not exist), so even if the guard
// ever broke, nothing on the live site could change.

test.describe('Read-only guard', () => {
  test('recognizes Firebase write messages', () => {
    const put = inspectDatabaseMessage('{"t":"d","d":{"r":7,"a":"p","b":{"p":"/a/b","d":1}}}');
    expect(put).toEqual({ block: true, path: 'p /a/b', ack: '{"t":"d","d":{"r":7,"b":{"s":"ok","d":""}}}' });
    expect(inspectDatabaseMessage('{"t":"d","d":{"r":8,"a":"m","b":{"p":"/x","d":{}}}}').block).toBe(true);
    expect(inspectDatabaseMessage('{"t":"d","d":{"r":9,"a":"q","b":{"p":"/x","h":""}}}').block).toBe(false);
    expect(inspectDatabaseMessage('{"t":"c","d":{"t":"h","d":{}}}').block).toBe(false);
    expect(inspectDatabaseMessage('not json').block).toBe(false);
  });

  test('lets only sign-in checks through', () => {
    const auth = new URL(FUNCTIONS_URL + '/funTorahStudentAuth');
    expect(isSignInCheck(auth, '{"action":"login"}')).toBe(true);
    expect(isSignInCheck(auth, '{"action":"verify"}')).toBe(true);
    expect(isSignInCheck(auth, '{"action":"choosePin"}')).toBe(false);
    expect(isSignInCheck(new URL(FUNCTIONS_URL + '/yiddishApi'), '{"action":"login"}')).toBe(false);
    expect(isSignInCheck(new URL('https://untrusted.example/funTorahStudentAuth'), '{"action":"login"}')).toBe(false);
    expect(mayForwardHttpRequest(new URL('https://untrusted.example/funTorahStudentAuth'), 'POST', '{"action":"login"}')).toBe(false);
    expect(isGoogleSignIn(new URL('https://www.googleapis.com/identitytoolkit/v3/relyingparty/getAccountInfo'))).toBe(true);
    expect(isGoogleSignIn(new URL('https://securetoken.googleapis.com/v1/token'))).toBe(true);
    expect(isGoogleSignIn(new URL('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken'))).toBe(true);
    expect(isGoogleSignIn(new URL('https://identitytoolkit.googleapis.com/v1/accounts:signUp'))).toBe(false);
    expect(isGoogleSignIn(new URL('https://identitytoolkit.googleapis.com/v1/accounts:update'))).toBe(false);
    expect(isGoogleSignIn(new URL('https://identitytoolkit.googleapis.com/v1/accounts:delete'))).toBe(false);
    expect(isGoogleSignIn(new URL('https://www.googleapis.com/identitytoolkit/v3/relyingparty/signupNewUser'))).toBe(false);
    expect(mayForwardHttpRequest(new URL('https://identitytoolkit.googleapis.com/v1/accounts:signUp'), 'POST', '{}')).toBe(false);
    expect(isGoogleSignIn(new URL('https://www.googleapis.com/upload/storage/v1/b/x/o'))).toBe(false);
    expect(isGoogleSignIn(new URL('https://firebasestorage.googleapis.com/v0/b/x/o'))).toBe(false);
  });

  test('blocks writes on the site itself and database fallback transports', () => {
    const site = new URL('https://funtorahtools.com/save');
    expect(mayForwardHttpRequest(site, 'POST', '{}')).toBe(false);
    expect(mayForwardHttpRequest(site, 'PATCH', '{}')).toBe(false);
    expect(mayForwardHttpRequest(site, 'GET', null)).toBe(true);
    const db = new URL('https://b3-games-default-rtdb.firebaseio.com/.lp?d0=write');
    expect(mayForwardHttpRequest(db, 'GET', null)).toBe(false);
    const otherDb = new URL('https://example-default-rtdb.us-central1.firebasedatabase.app/.lp');
    expect(mayForwardHttpRequest(otherDb, 'GET', null)).toBe(false);
    expect(DATABASE_WEBSOCKET_PATTERN.test('wss://b3-games-default-rtdb.firebaseio.com/.ws?v=5')).toBe(true);
    expect(DATABASE_WEBSOCKET_PATTERN.test('wss://example-default-rtdb.us-central1.firebasedatabase.app/.ws?v=5')).toBe(true);
    expect(mayForwardHttpRequest(new URL(FUNCTIONS_URL + '/funTorahStudentAuth'), 'POST', '{"action":"login"}')).toBe(true);
    expect(mayForwardHttpRequest(new URL(FUNCTIONS_URL + '/funTorahStudentAuth'), 'POST', '{"action":"choosePin"}')).toBe(false);
  });

  test('stops a real database write and a server call on the live site', async ({ page, blockedWrites }) => {
    await openHomeSignedOut(page);
    const result = await page.evaluate(async (functionsUrl) => {
      const w = window as any;
      const db = w.firebase.database();
      // Without the guard, the server would answer "permission denied".
      const write = await Promise.race([
        db.ref('b3Private/siteMonitorGuardCheck').set(1).then(() => 'ok', (e: any) => 'refused: ' + e.code),
        new Promise(resolve => setTimeout(() => resolve('timeout'), 20_000)),
      ]);
      const call = await fetch(functionsUrl + '/siteMonitorGuardCheck', { method: 'POST', body: '{}' })
        .then(r => r.status, () => 'network error');
      return { write, call };
    }, FUNCTIONS_URL);
    expect(result.write, 'database write should be answered by the guard').toBe('ok');
    expect(result.call).toBe(503);
    expect(blockedWrites.map(b => b.detail)).toEqual(expect.arrayContaining([
      'p /b3Private/siteMonitorGuardCheck',
      `POST ${FUNCTIONS_URL}/siteMonitorGuardCheck`,
    ]));
  });
});
