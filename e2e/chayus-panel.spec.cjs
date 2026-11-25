'use strict';
// Browser test for the pages-only Chayus Meter panel on the real ET and WT pages.
// A generated tone stands in for the microphone. No account, server or network is used.
const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
let server, origin;

// The generated-tone microphone below only works in Chromium (Firefox and WebKit refuse an AudioContext
// started without a click). Real school computers are checked by hand on the staging preview.
test.skip(({ browserName }) => browserName !== 'chromium', 'generated-tone microphone needs Chromium');
// The quiet-versus-shout test runs about 40 seconds of real time on purpose.
test.setTimeout(120000);

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const file = path.normalize(path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(() => server.close());

// Replace getUserMedia with a tone we control. Records every call and every track stop.
async function fakeMic(page, mode) {
  await page.addInitScript(mode => {
    window.__mic = { calls: 0, stopped: 0, level: 0.1 };
    navigator.mediaDevices.getUserMedia = async () => {
      window.__mic.calls++;
      if (mode === 'denied') throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
      if (mode === 'none') throw Object.assign(new Error('none'), { name: 'NotFoundError' });
      const ctx = new AudioContext(); await ctx.resume();
      const osc = ctx.createOscillator(); const gain = ctx.createGain(); const dest = ctx.createMediaStreamDestination();
      osc.frequency.value = 220; gain.gain.value = 0; osc.connect(gain); gain.connect(dest); osc.start();
      // Speech-like: short gaps between bursts, like words with breaths. A constant tone would count as room hum.
      window.__mic.level = 0.1; let tick = 0;
      setInterval(() => { gain.gain.value = (tick++ % 5 === 4) ? 0 : window.__mic.level; }, 100);
      const stream = dest.stream;
      stream.getTracks().forEach(track => { const stop = track.stop.bind(track); track.stop = () => { window.__mic.stopped++; stop(); }; });
      return stream;
    };
    window.__netCalls = [];
    for (const name of ['fetch']) {
      const real = window[name].bind(window);
      window[name] = (...args) => { window.__netCalls.push(String(args[0])); return real(...args); };
    }
  }, mode);
}

for (const cls of ['et', 'wt']) {
  test.describe(`${cls.toUpperCase()} page`, () => {
    test('nothing starts by itself; permission is asked only on a click', async ({ page }) => {
      await fakeMic(page, 'ok');
      await page.goto(`${origin}/davening_student_app_${cls}/index.html`);
      await expect(page.locator('.chayus-panel')).toBeVisible();
      expect(await page.evaluate(() => window.__mic.calls)).toBe(0);
      await expect(page.locator('#chayusStatus')).toContainText('microphone is off');
      await page.getByRole('button', { name: /Turn on My Chayus Meter/ }).click();
      await expect(page.locator('#chayusStatus')).toContainText('Microphone on');
      expect(await page.evaluate(() => window.__mic.calls)).toBe(1);
    });

    test('a quiet voice and a shout draw the same meter; only a gentle reminder for shouting', async ({ page }) => {
      await fakeMic(page, 'ok');
      await page.goto(`${origin}/davening_student_app_${cls}/index.html`);
      await page.getByRole('button', { name: /Turn on My Chayus Meter/ }).click();
      await expect(page.locator('#chayusLive')).toHaveText('I hear you davening!', { timeout: 8000 });
      await page.waitForTimeout(22000); // let the meter settle at a comfortable voice
      const quiet = Number(await page.locator('#chayusCircle').evaluate(el => getComputedStyle(el).getPropertyValue('--chayus-flame')));
      await page.evaluate(() => { window.__mic.level = 0.9; });
      await page.waitForTimeout(8000);
      const loud = Number(await page.locator('#chayusCircle').evaluate(el => getComputedStyle(el).getPropertyValue('--chayus-flame')));
      expect(Math.abs(loud - quiet)).toBeLessThan(0.05);
      await expect(page.locator('#chayusLive')).toHaveText('A comfortable voice is perfect. No need to be loud.');
      expect(await page.locator('.chayus-panel').innerText()).not.toMatch(/\d+\s*%/);
    });

    test('pause, resume and off release the microphone; nothing leaves the computer', async ({ page }) => {
      await fakeMic(page, 'ok');
      await page.goto(`${origin}/davening_student_app_${cls}/index.html`);
      await page.getByRole('button', { name: /Turn on My Chayus Meter/ }).click();
      await expect(page.locator('#chayusStatus')).toContainText('Microphone on');
      await page.waitForTimeout(5000); // past the short room-sound calibration, so some time is measured
      await page.getByRole('button', { name: /Pause/ }).click();
      await expect(page.locator('#chayusStatus')).toContainText('Paused');
      expect(await page.evaluate(() => window.__mic.stopped)).toBeGreaterThan(0);
      await page.getByRole('button', { name: /Resume/ }).click();
      await expect(page.locator('#chayusStatus')).toContainText('picked up where it left off');
      await page.getByRole('button', { name: 'Turn microphone off' }).click();
      await expect(page.locator('#chayusStatus')).toContainText('no audio was saved or sent');
      await expect(page.getByRole('button', { name: /Turn on My Chayus Meter/ })).toBeVisible();
      expect(await page.evaluate(() => window.__netCalls.filter(u => /chayus|davening|cloudfunctions|firebase/i.test(u)))).toEqual([]);
    });

    for (const mode of ['denied', 'none']) {
      test(`${mode} microphone: meter stays off and davening still works`, async ({ page }) => {
        await fakeMic(page, mode);
        await page.goto(`${origin}/davening_student_app_${cls}/index.html`);
        await page.getByRole('button', { name: /Turn on My Chayus Meter/ }).click();
        await expect(page.locator('#chayusStatus')).toContainText('You can daven normally');
        await expect(page.getByRole('button', { name: /Turn on My Chayus Meter/ })).toBeVisible();
        await expect(page.locator('#playBtn, .controls .big').first()).toBeVisible();
      });
    }

    test('encouragement appears about every two and a half minutes of davening', async ({ page }) => {
      await page.clock.install();
      await fakeMic(page, 'ok');
      await page.goto(`${origin}/davening_student_app_${cls}/index.html`);
      await page.getByRole('button', { name: /Turn on My Chayus Meter/ }).click();
      await expect(page.locator('#chayusStatus')).toContainText('Microphone on');
      const initial = await page.locator('#chayusFeedback').innerText();
      await page.clock.runFor(140000);
      expect(await page.locator('#chayusFeedback').innerText()).toBe(initial);
      await page.clock.runFor(20000);
      await expect(page.locator('#chayusFeedback')).not.toHaveText(initial);
      await expect(page.locator('#chayusFeedback')).toHaveText(/Keep|Wonderful/);
    });
  });
}
