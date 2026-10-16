import { test, expect, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
// SYNTHETIC ONLY: made-up students, an in-memory database, no network to Firebase.
// Chromium's fake microphone produces a real recording, so the real MediaRecorder code path runs.
const fixtures = require('../tests/fixtures/synthetic-class.cjs');
const { messagesApi } = require('../backend/functions/messages-core.cjs');
const ROOT = path.resolve(__dirname, '..');
const API = 'https://us-central1-b3-games.cloudfunctions.net/messagesPortal';
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

test.use({
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

async function setup(page: Page, opts: { failApi?: () => boolean } = {}) {
  const store = fixtures.makeStore();
  await page.route('https://synthetic.test/**', route => {
    const file = path.join(ROOT, new URL(route.request().url()).pathname);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404 });
    route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'text/plain', body: fs.readFileSync(file) });
  });
  const calls: any[] = [];
  await page.route(API, async route => {
    if (opts.failApi && opts.failApi()) return route.abort('failed');
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push(body.action);
    try {
      const out = await messagesApi(store, {}, body);
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out) });
    } catch (e: any) {
      route.fulfill({ status: e.code || 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: e.message }) });
    }
  });
  const s = fixtures.students.a1;
  await page.addInitScript(s => {
    sessionStorage.setItem('b3Games_studentId', s.studentId); sessionStorage.setItem('b3Games_studentName', s.studentName);
    sessionStorage.setItem('b3Games_classPin', s.pin); sessionStorage.setItem('b3Games_studentClass', s.classId);
  }, s);
  return { store, calls };
}
const open = (page: Page) => page.goto('https://synthetic.test/assignment-center/messages-student.html');
const voiceMessages = (store: any) => Object.values(store.data.assignmentCenter?.workspaces?.['b3-2026']?.classes?.['synth-a']?.threads?.synthA1?.messages || {}).filter((m: any) => m.type === 'voice') as any[];

test('record with the fake microphone, listen, send; teacher side can fetch the same audio', async ({ page }) => {
  const { store } = await setup(page);
  await open(page);
  await page.getByRole('button', { name: /Voice/ }).click();
  await expect(page.getByText(/Recording/)).toBeVisible();
  await page.waitForTimeout(2200);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText(/Listen, then send/)).toBeVisible();
  await expect(page.locator('audio')).toHaveCount(1);
  await page.getByRole('button', { name: 'Send voice message' }).click();
  await expect.poll(() => voiceMessages(store).length).toBe(1);
  const v = voiceMessages(store)[0];
  expect(v.voice.seconds).toBeGreaterThanOrEqual(1);
  expect(v.voice.bytes).toBeLessThan(512 * 1024);
  const file = store.files.get(v.voice.path);
  expect(file.readUInt32BE(0)).toBe(0x1a45dfa3); // real WebM from the browser
  const t = await messagesApi(store, fixtures.teachers.a, { action: 'voice', classId: 'synth-a', studentId: 'synthA1', messageId: v.id });
  expect(Buffer.from(t.data, 'base64').equals(file)).toBe(true);
  await expect(page.getByRole('button', { name: /Play voice message/ })).toBeVisible();
});

test('throw away a recording sends nothing', async ({ page }) => {
  const { store } = await setup(page);
  await open(page);
  await page.getByRole('button', { name: /Voice/ }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'Throw away' }).click();
  await page.getByRole('button', { name: /Voice/ }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(500);
  expect(voiceMessages(store).length).toBe(0);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
});

for (const [label, err, expected] of [
  ['blocked microphone', 'NotAllowedError', /blocked/i],
  ['no microphone', 'NotFoundError', /No microphone/i],
] as const) {
  test('clear message when ' + label, async ({ page }) => {
    await setup(page);
    await page.addInitScript(name => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('x'), { name })); }, err);
    await open(page);
    await page.getByRole('button', { name: /Voice/ }).click();
    await expect(page.locator('.msg-status')).toContainText(expected);
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible(); // typing still works
  });
}

test('browser without recording support says so', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => { delete (window as any).MediaRecorder; });
  await open(page);
  await page.getByRole('button', { name: /Voice/ }).click();
  await expect(page.locator('.msg-status')).toContainText(/not available in this browser/i);
});

test('recording stops by itself at 60 seconds', async ({ page }) => {
  const { store } = await setup(page);
  await page.clock.install();
  await open(page);
  await page.getByRole('button', { name: /Voice/ }).click();
  await expect(page.getByText(/Recording/)).toBeVisible();
  await page.clock.fastForward(61_000);
  await expect(page.getByText(/Listen, then send \(60s\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Throw away' }).click();
  expect(voiceMessages(store).length).toBe(0);
});

test('failed upload shows Not sent; retry after reconnecting saves exactly one message', async ({ page }) => {
  let down = false;
  const { store } = await setup(page, { failApi: () => down });
  await open(page);
  await page.getByRole('button', { name: /Voice/ }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stop' }).click();
  down = true;
  await page.getByRole('button', { name: 'Send voice message' }).click();
  await expect(page.getByText('Not sent.')).toBeVisible();
  expect(voiceMessages(store).length).toBe(0);
  down = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect.poll(() => voiceMessages(store).length).toBe(1);
  await page.waitForTimeout(800);
  expect(voiceMessages(store).length).toBe(1);
  await expect(page.getByText('Not sent.')).toHaveCount(0);
});

test('privacy: nothing from the chat is kept in the browser after it closes', async ({ page }) => {
  const { store } = await setup(page);
  await open(page);
  await page.getByRole('textbox', { name: 'Message' }).fill('PRIVATE-CHAT-TEXT-77');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('PRIVATE-CHAT-TEXT-77')).toBeVisible();
  const dump = await page.evaluate(async () => {
    const out: string[] = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), document.cookie];
    const dbs = (indexedDB as any).databases ? await (indexedDB as any).databases() : [];
    out.push(JSON.stringify(dbs));
    const keys = typeof caches === 'undefined' ? [] : await caches.keys();
    out.push(JSON.stringify(keys));
    return out.join('|');
  });
  expect(dump).not.toContain('PRIVATE-CHAT-TEXT-77');
  expect(Object.keys(store.data.assignmentCenter.workspaces['b3-2026'].classes['synth-a'].threads).join()).toBe('synthA1');
});
