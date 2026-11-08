'use strict';
// Homework recorded instructions (#629): the teacher's "Record instructions" uses the same recorder as
// voice notes (red dot, MM:SS timer, Cancel, 15 s / 100 KB limit), and the student's play button loads
// the recording once and can be played again as many times as they like.
const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test('record instructions, then a student replays them', async ({ browserName }) => {
  test.skip(browserName !== 'chromium', 'Fake microphone flags are Chromium-only');
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
  await page.route('https://notes.test/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head></head><body><div id="host"></div><p id="msg"></p><div id="student"></div></body></html>' }));
  await page.goto('https://notes.test/');
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '..', 'assignment-center', 'homework-common.js'), 'utf8') });
  await page.evaluate(() => {
    window.recorded = [];
    const r = window.HomeworkCommon.voiceRecorder({ feedback: document.getElementById('msg'), idleLabel: '🎙 Record instructions', stopLabel: '■ Stop recording',
      recordingText: 'Recording now. Read the instructions aloud, then press Stop recording.', cancelledText: 'Recording cancelled. Nothing changed.',
      onRecorded: async dataURL => { window.recorded.push(dataURL); return 'Recorded. Press Save to keep it.'; } });
    document.getElementById('host').append(r.button, r.panel);
  });
  const button = page.locator('.conversation-record'), panel = page.locator('.conversation-recording');
  await expect(button).toHaveText('🎙 Record instructions');
  // Cancel records nothing.
  await button.click();
  await expect(panel.locator('.rec-dot')).toBeVisible();
  await expect(page.locator('.rec-time')).toHaveText('00:00 · 00:15 left');
  await expect(button).toHaveText('■ Stop recording');
  await page.click('.conversation-cancel');
  await expect(page.locator('#msg')).toHaveText('Recording cancelled. Nothing changed.');
  expect(await page.evaluate(() => window.recorded.length)).toBe(0);
  // About 2 seconds of instructions.
  await button.click();
  await expect(page.locator('.rec-time')).toHaveText('00:02 · 00:13 left', { timeout: 4000 });
  await button.click();
  await expect(page.locator('#msg')).toHaveText('Recorded. Press Save to keep it.', { timeout: 10000 });
  await expect(panel).toBeHidden();
  await expect(button).toHaveText('🎙 Record instructions');
  const dataURL = await page.evaluate(() => window.recorded[0]);
  const bytes = Buffer.from(dataURL.split(',')[1], 'base64');
  expect(dataURL.startsWith('data:audio/webm;base64,')).toBe(true);
  expect(bytes.subarray(0, 4).toString('hex')).toBe('1a45dfa3');
  expect(bytes.length).toBeLessThan(100000);

  // Student play button: loads once, plays again and again.
  await page.evaluate(dataURL => {
    window.loads = 0; window.plays = 0;
    const orig = window.Audio;
    window.Audio = function () { const a = new orig(); a.addEventListener('play', () => { window.plays++; }); return a; };
    document.getElementById('student').append(window.HomeworkCommon.instructionPlayer(async () => { window.loads++; return { voiceDataURL: dataURL }; }));
  }, dataURL);
  const play = page.locator('.instruction-play');
  await expect(play).toHaveText('🔊 Listen to the instructions');
  for (let i = 1; i <= 3; i++) {
    await play.click();
    await expect.poll(() => page.evaluate(() => window.plays)).toBe(i);
    // Wait for the clip to end; the button then offers to play it again.
    await expect(play).toHaveText('🔁 Listen again', { timeout: 10000 });
  }
  // Stop part-way, then play again from the start.
  await play.click();
  await expect(play).toHaveText('■ Stop');
  await play.click();
  await expect(play).toHaveText('🔁 Listen again');
  expect(await page.evaluate(() => window.loads)).toBe(1);
  await expect(page.locator('.instruction-status')).toHaveText('');
  await browser.close();
});
