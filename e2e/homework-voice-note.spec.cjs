'use strict';
// Homework "Notes with this student" box: voice-only, text-only, and the empty-send warning.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }, permissions: ['microphone'] });

test('voice-only, text-only and empty send behave correctly', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Fake microphone flags are Chromium-only');
  await page.route('https://notes.test/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><div id="host"></div></body></html>' }));
  await page.goto('https://notes.test/');
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '..', 'assignment-center', 'homework-common.js'), 'utf8') });
  await page.evaluate(() => {
    window.sent = [];
    document.getElementById('host').append(window.HomeworkCommon.conversation({ role: 'teacher', messages: [], send: async body => { window.sent.push(body); return { ok: true }; } }));
  });
  // Empty send: warning only after clicking send.
  await expect(page.locator('.conversation-feedback')).toHaveText('');
  await page.click('.conversation-send');
  await expect(page.locator('.conversation-feedback')).toContainText('record a voice note');
  expect(await page.evaluate(() => window.sent.length)).toBe(0);
  // Voice only, 15 s (the maximum): must stay under the server's 100,000-byte limit.
  await page.click('.conversation-record');
  await page.waitForTimeout(15500);
  await expect(page.locator('.conversation-feedback')).toHaveText('Voice note sent.', { timeout: 10000 });
  const voice = await page.evaluate(() => window.sent[0]);
  expect(voice.action).toBe('comment');
  expect(voice.text).toBeUndefined();
  const bytes = Buffer.from(voice.voiceDataURL.split(',')[1], 'base64');
  expect(bytes.length).toBeGreaterThan(1000);
  expect(bytes.length).toBeLessThan(100000);
  expect(bytes.subarray(0, 4).toString('hex')).toBe('1a45dfa3');
  // Text only.
  await page.fill('textarea', 'Well done');
  await page.click('.conversation-send');
  await expect(page.locator('.conversation-feedback')).toHaveText('Message sent.');
  expect((await page.evaluate(() => window.sent[1]))).toMatchObject({ action: 'comment', text: 'Well done' });
});
