import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// A fictional browser page with no Firebase network access. It runs the real
// Multiplayer Center script and simulates two unrelated student class scopes.
const script = readFileSync(resolve(process.cwd(), 'multiplayer/center.js'), 'utf8');
const url = 'https://example.test/multiplayer/index.html';

async function setup(page: any) {
  await page.route('**/*', (route: any) => route.abort('blockedbyclient'));
  await page.route('https://example.test/**', (route: any) => route.fulfill({
    status:200, contentType:'text/html',
    body:'<!doctype html><html><body><div id="accountStatus"></div><div id="games"></div><section id="invitationSection" hidden><div id="invitations"></div></section></body></html>'
  }));
  await page.goto(url);
  await page.evaluate(() => {
    sessionStorage.setItem('b3Games_studentId', 'fictional_a');
    sessionStorage.setItem('b3Games_studentName', 'Fictional A');
    const state: any = {refs:{}, authChanged:null};
    const db = {ref(path: string) {
      const ref: any = {
        offCount:0, listener:null,
        on(_event: string, callback: Function) {this.listener=callback;return callback;},
        off(_event: string, _callback: Function) {this.offCount++;},
        emit(room: any) {this.listener?.({val:()=>room});}
      };
      state.refs[path] = ref; return ref;
    }};
    (window as any).__mpAudit = state;
    (window as any).B3_FIREBASE_CONFIG = {projectId:'fictional-local'};
    (window as any).firebase = {
      apps:[{}], database:()=>db,
      auth:()=>({onAuthStateChanged(callback: Function) {state.authChanged=callback;}})
    };
    (window as any).B3Race = {classCenterRoomsPath: async (_db: any, studentId: string) => 'fictional-rooms/' + studentId};
  });
  await page.addScriptTag({content:script});
}
function invite(hostName: string) {
  return {room1:{host:'another-student',hostName,roomCode:'fictional-code',
    state:'lobby',gameKey:'shorashim',createdAt:Date.now(),playerCount:2}};
}

test('Multiplayer Center removes old-class invitations and listeners on student switch', async ({page}) => {
  await setup(page);
  await page.evaluate(async () => {
    const s=(window as any).__mpAudit;
    await s.authChanged({uid:'fictional_auth_a'});
    s.refs['fictional-rooms/fictional_a'].emit({
      a:{host:'another-student',hostName:'Class A Host',roomCode:'a-code',state:'lobby',gameKey:'shorashim',createdAt:Date.now(),playerCount:2}
    });
  });
  await expect(page.locator('#invitations')).toContainText('Class A Host');
  await page.evaluate(async () => {
    sessionStorage.setItem('b3Games_studentId', 'fictional_b');
    sessionStorage.setItem('b3Games_studentName', 'Fictional B');
    await (window as any).__mpAudit.authChanged({uid:'fictional_auth_b'});
  });
  await expect(page.locator('#accountStatus')).toContainText('Fictional B');
  await expect(page.locator('#invitationSection')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__mpAudit.refs['fictional-rooms/fictional_a'].offCount)).toBe(1);
  await page.evaluate(() => {
    const s=(window as any).__mpAudit;
    s.refs['fictional-rooms/fictional_a'].emit({
      stale:{host:'another-student',hostName:'Stale Class A',roomCode:'old',state:'lobby',gameKey:'shorashim',createdAt:Date.now(),playerCount:2}
    });
    s.refs['fictional-rooms/fictional_b'].emit({
      fresh:{host:'another-student',hostName:'Class B Host',roomCode:'new',state:'lobby',gameKey:'shorashim',createdAt:Date.now(),playerCount:2}
    });
  });
  await expect(page.locator('#invitations')).toContainText('Class B Host');
  await expect(page.locator('#invitations')).not.toContainText('Stale Class A');
});

test('Multiplayer Center hides invitations and disables games on sign-out', async ({page}) => {
  await setup(page);
  await page.evaluate(async () => {
    const s=(window as any).__mpAudit;
    await s.authChanged({uid:'fictional_auth_a'});
    s.refs['fictional-rooms/fictional_a'].emit({
      a:{host:'another-student',hostName:'Class A Host',roomCode:'a-code',state:'lobby',gameKey:'shorashim',createdAt:Date.now(),playerCount:2}
    });
  });
  await expect(page.locator('#invitationSection')).toBeVisible();
  await page.evaluate(async () => {await (window as any).__mpAudit.authChanged(null);});
  await expect(page.locator('#invitationSection')).toBeHidden();
  await expect(page.locator('#games button').first()).toBeDisabled();
  await expect(page.locator('#accountStatus')).toContainText('expired');
  expect(await page.evaluate(() => (window as any).__mpAudit.refs['fictional-rooms/fictional_a'].offCount)).toBe(1);
});
