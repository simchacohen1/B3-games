'use strict';
// Homework notes (#621): while recording, a pulsing red dot and a running MM:SS timer show next to
// the button; the indicator goes away when recording stops; Cancel sends nothing.
const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test('recording indicator shows a red dot and MM:SS timer, then goes away', async ({ browserName }) => {
  test.skip(browserName !== 'chromium', 'Fake microphone flags are Chromium-only');
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const page = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
  await page.route('https://notes.test/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head></head><body><div id="host"></div></body></html>' }));
  await page.goto('https://notes.test/');
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '..', 'assignment-center', 'homework-common.js'), 'utf8') });
  await page.evaluate(() => {
    window.sent = [];
    document.getElementById('host').append(window.HomeworkCommon.conversation({ role: 'student', title: 'Message your teacher', messages: [],
      send: async body => { window.sent.push(body); return { ok: true }; } }));
  });
  await expect(page.locator('h4')).toHaveText('Message your teacher');
  const panel = page.locator('.conversation-recording');
  await expect(panel).toBeHidden();
  // Cancel: indicator shows, then goes away, nothing is sent.
  await page.click('.conversation-record');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.rec-dot')).toBeVisible();
  expect(await panel.locator('.rec-dot').evaluate(node => getComputedStyle(node).animationName)).toBe('recPulse');
  expect(await panel.locator('.rec-dot').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(224, 36, 36)');
  await expect(page.locator('.rec-time')).toHaveText('00:00 · 00:15 left');
  await expect(page.locator('.conversation-record')).toHaveText('■ Stop & send');
  await page.click('.conversation-cancel');
  await expect(panel).toBeHidden();
  await expect(page.locator('.conversation-feedback')).toHaveText('Recording cancelled. Nothing was sent.');
  expect(await page.evaluate(() => window.sent.length)).toBe(0);
  // Record about 2 seconds: the timer runs, then Stop & send hides the indicator and sends voice only.
  await page.click('.conversation-record');
  await expect(page.locator('.rec-time')).toHaveText('00:02 · 00:13 left', { timeout: 4000 });
  await page.click('.conversation-record');
  await expect(page.locator('.conversation-feedback')).toHaveText('Voice note sent.', { timeout: 10000 });
  await expect(panel).toBeHidden();
  await expect(page.locator('.conversation-record')).toHaveText('🎙 Record voice note');
  const sent = await page.evaluate(() => window.sent);
  expect(sent).toHaveLength(1);
  expect(sent[0].action).toBe('comment');
  expect(sent[0].text).toBeUndefined();
  expect(sent[0].assignmentId).toBeUndefined();
  await browser.close();
});
