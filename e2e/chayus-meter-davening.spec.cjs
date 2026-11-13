'use strict';
// Chayus Meter (#802) on the real ET Davening page, next to "I Want to Be Chazzan" (#799).
//
// Everything here is fictional and local: the page files are served from this
// checkout, sign-in is a stub, and the two Davening endpoints are answered by the
// real session services (backend/functions/*-session-service.cjs) running against
// an in-memory store. No Firebase project, real student or real microphone is used.
// The "microphone" is a generated tone with word-like gaps.
const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { act: chayusAct } = require('../backend/functions/chayus-session-service.cjs');
const { act: chazzanAct } = require('../backend/functions/davening-session-service.cjs');
const { feedbackFor } = require('../chayus-meter/core.js');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://davening.test';
const FUNCTIONS = 'https://us-central1-fun-torah-tools-staging.cloudfunctions.net/';
const ROSTER = [{ id: 'fictional-ari', name: 'Ari Example' }, { id: 'fictional-zev', name: 'Zev Example' }];
const ACTORS = {
  'token-teacher': { role: 'teacher', classId: 'et' },
  'token-ari': { role: 'student', classId: 'et', studentId: 'fictional-ari', name: 'Ari Example' },
  'token-zev': { role: 'student', classId: 'et', studentId: 'fictional-zev', name: 'Zev Example' }
};
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const METRIC_KEYS = ['activeIntervals', 'activeSeconds', 'calibrationSeconds', 'feedbackCount', 'measuredSeconds', 'pauseCount', 'pausedSeconds'];

function fakeDb() {
  const state = new Map();
  let queue = Promise.resolve();
  return { ref: key => ({
    get: async () => ({ val: () => structuredClone(state.get(key) ?? null) }),
    transaction(update) {
      const result = queue.then(() => {
        const next = update(structuredClone(state.get(key) ?? null));
        if (next !== undefined) { if (next === null) state.delete(key); else state.set(key, structuredClone(next)); }
        return { committed: next !== undefined, snapshot: { val: () => structuredClone(next ?? null) } };
      });
      queue = result.catch(() => {});
      return result;
    }
  }) };
}

// Runs in the page before any site script. Replaces the microphone with a
// generated "voice" and counts anything that could carry audio off the device.
function browserSetup({ token, claims, micError }) {
  window.__mic = { requests: 0, streams: [], recorders: 0, peers: 0, sockets: 0, error: micError };
  window.__user = { getIdToken: async () => token, getIdTokenResult: async () => ({ claims }) };
  const count = (name, key) => {
    const Original = window[name];
    if (!Original) return;
    window[name] = class extends Original { constructor(...args) { super(...args); window.__mic[key]++; } };
  };
  count('MediaRecorder', 'recorders'); count('RTCPeerConnection', 'peers'); count('WebSocket', 'sockets');
  navigator.mediaDevices.getUserMedia = async constraints => {
    window.__mic.requests++;
    window.__mic.constraints = constraints;
    if (window.__mic.error) throw new DOMException('Fictional test refusal', window.__mic.error);
    const context = new AudioContext();
    await context.resume();
    // Half-second loop: 0.35 s of tone, 0.15 s of quiet, like words with gaps.
    const buffer = context.createBuffer(1, context.sampleRate / 2, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length * 0.7; i++) data[i] = 0.1 * Math.sin(2 * Math.PI * 220 * i / context.sampleRate);
    const source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
    const gain = context.createGain(); gain.gain.value = window.__voice ?? 0;
    const out = context.createMediaStreamDestination();
    source.connect(gain).connect(out); source.start();
    window.__setVoice = value => { window.__voice = value; gain.gain.value = value; };
    window.__mic.streams.push(out.stream);
    return out.stream;
  };
}

async function classroom() {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const stores = { chayus: fakeDb(), chazzan: fakeDb() };
  const log = { chayus: [], chazzan: [], awards: 0, stray: [], errors: [] };
  async function open(token, { micError = '' } = {}) {
    const actor = ACTORS[token];
    const claims = actor.role === 'student' ? { b3StudentRole: 'student', b3StudentId: actor.studentId, b3ClassId: 'et' } : {};
    const context = await browser.newContext();
    await context.addInitScript(browserSetup, { token, claims, micError });
    const page = await context.newPage();
    page.on('pageerror', error => log.errors.push(`${token}: ${error.message}`));
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.url().startsWith(FUNCTIONS)) {
        const name = url.pathname.slice(1);
        const body = request.postDataJSON();
        const caller = ACTORS[(request.headers().authorization || '').replace('Bearer ', '')];
        if (!caller || !['daveningChayus', 'daveningChazzan'].includes(name)) { log.stray.push(request.url()); return route.abort(); }
        log[name === 'daveningChayus' ? 'chayus' : 'chazzan'].push({ token, raw: request.postData(), body });
        try {
          if (name === 'daveningChazzan' && body.action === 'roster') return route.fulfill({ json: { roster: ROSTER } });
          const session = name === 'daveningChayus'
            ? await chayusAct({ db: stores.chayus, actor: caller, body, getRoster: async () => ROSTER })
            : await chazzanAct({ db: stores.chazzan, actor: caller, body, catalog: ['part-1', 'part-2'],
              getRoster: async () => ROSTER, awardPoint: async () => { log.awards++; } });
          return route.fulfill({ json: { session } });
        } catch (error) {
          if (!error.status) throw error;
          return route.fulfill({ status: error.status, json: { error: error.message } });
        }
      }
      // The page's own Firebase SDK tag (existing behaviour, unrelated to the meter).
      if (url.href.startsWith('https://www.gstatic.com/firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: '' });
      if (url.origin !== ORIGIN) { log.stray.push(request.url()); return route.abort(); }
      if (url.pathname.startsWith('/vendor/firebase/')) {
        return route.fulfill({ contentType: 'text/javascript', body: 'window.firebase=window.firebase||{apps:[{}],initializeApp(){},auth:()=>({onAuthStateChanged(cb){setTimeout(()=>cb(window.__user),0)}})};' });
      }
      if (url.pathname === '/firebase-config.js') {
        return route.fulfill({ contentType: 'text/javascript', body: 'window.B3_FIREBASE_CONFIG={projectId:"fun-torah-tools-staging"};' });
      }
      const file = path.join(ROOT, decodeURIComponent(url.pathname));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    });
    await page.goto(`${ORIGIN}/davening_student_app_et/index.html`);
    await expect(page.locator('.chayus-panel h2')).toHaveText('🎙️ My Chayus Meter');
    return page;
  }
  return { browser, log, open };
}

const meter = page => page.locator('#chayusCircle');
const status = page => page.locator('#chayusStatus');
const mic = page => page.evaluate(() => ({ ...window.__mic, streams: window.__mic.streams.map(stream => stream.getTracks().map(track => track.readyState)) }));
const flame = page => page.evaluate(() => Number(document.getElementById('chayusCircle').style.getPropertyValue('--chayus-flame')));

function expectOnlySummaryNumbersLeftTheDevice(log, token) {
  const submits = log.chayus.filter(entry => entry.token === token && entry.body.action === 'submit');
  for (const { raw, body } of submits) {
    expect(Object.keys(body).sort()).toEqual(['action', 'classId', 'metrics', 'sessionId']);
    expect(Object.keys(body.metrics).sort()).toEqual(METRIC_KEYS);
    expect(Object.values(body.metrics).every(value => typeof value === 'number')).toBe(true);
    expect(raw.length).toBeLessThan(400);
  }
  for (const entry of log.chayus.filter(item => item.token === token && item.body.action !== 'submit')) {
    expect(Object.keys(entry.body).filter(key => !['action', 'classId', 'sessionId'].includes(key))).toEqual([]);
  }
  return submits;
}

test.describe('Chayus Meter on the Davening page', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Uses a generated Chromium audio source');

  test('student opts in, the meter follows steady voice (not volume), pause and off work, the teacher gets the summary and no points are given', async () => {
    test.setTimeout(120000);
    const room = await classroom();
    try {
      const teacher = await room.open('token-teacher');
      // Both features are on the page, and the teacher runs both at once.
      await expect(teacher.locator('.davening-feature-panel')).toBeVisible();
      await teacher.getByRole('button', { name: '🎤 Open Chazzan sign-up' }).click();
      await teacher.getByRole('button', { name: '▶ Start Chayus session' }).click();
      await expect(status(teacher)).toHaveText('Chayus session is open for this class.');
      await expect(teacher.locator('#chayusBody')).toBeHidden();

      const ari = await room.open('token-ari');
      const zev = await room.open('token-zev');
      const activate = ari.getByRole('button', { name: '🎙️ Activate My Chayus Meter' });
      await expect(activate).toBeVisible();
      await expect(meter(ari)).toHaveAttribute('data-state', 'off');
      // Permission is never assumed: nothing touches the microphone before the click.
      expect((await mic(ari)).requests).toBe(0);
      await activate.click();
      await expect(status(ari)).toHaveText('Microphone on · you can pause or turn it off at any time.');
      const asked = await mic(ari);
      expect(asked.requests).toBe(1);
      expect(asked.constraints.video).toBe(false);
      await expect(meter(ari)).toHaveAttribute('data-state', 'calibrating');
      await expect(ari.locator('#chayusLive')).toHaveText('Getting used to the sound of the room…');

      // Quiet room: the meter is on but resting.
      await expect(meter(ari)).toHaveAttribute('data-state', 'on', { timeout: 8000 });
      await expect(meter(ari)).toHaveAttribute('data-voice', 'off');
      await expect(ari.locator('#chayusLive')).toHaveText('Listening quietly…');

      // A comfortable voice: flame flickers, bars move, ring starts to fill.
      await ari.evaluate(() => window.__setVoice(1));
      await expect(meter(ari)).toHaveAttribute('data-voice', 'on', { timeout: 5000 });
      await expect(ari.locator('#chayusLive')).toHaveText('I hear you davening!', { timeout: 5000 });
      expect(await ari.locator('.chayus-flame-inner').evaluate(node => getComputedStyle(node).animationName)).toBe('chayusFlicker');
      await expect.poll(() => ari.locator('#chayusBars i').first().evaluate(node => getComputedStyle(node).animationName), { timeout: 5000 }).toBe('chayusBar');
      await expect.poll(() => flame(ari), { timeout: 15000 }).toBeGreaterThan(0.75);
      const comfortable = await flame(ari);

      // Nine times louder: the meter does not jump, and the student gets a gentle reminder instead.
      await ari.evaluate(() => window.__setVoice(9));
      await expect(ari.locator('#chayusLive')).toHaveText('A comfortable voice is perfect. No need to be loud.', { timeout: 8000 });
      const loud = await flame(ari);
      expect(loud).toBeLessThanOrEqual(1.05);
      expect(loud - comfortable).toBeLessThan(0.2);
      await ari.evaluate(() => window.__setVoice(1));

      // Chazzan keeps working while the microphone is in use, and never asks for the microphone itself.
      const chazzanBefore = room.log.chazzan.filter(entry => entry.token === 'token-ari').length;
      await expect.poll(() => room.log.chazzan.filter(entry => entry.token === 'token-ari').length, { timeout: 12000 }).toBeGreaterThan(chazzanBefore);
      await expect(ari.getByRole('heading', { name: '🎤 I Want to Be Chazzan!' })).toBeVisible();
      expect((await mic(ari)).requests).toBe(1);

      // Pause: microphone released, meter rests, can resume.
      await ari.getByRole('button', { name: '⏸ Pause my meter' }).click();
      await expect(meter(ari)).toHaveAttribute('data-state', 'paused');
      await expect(meter(ari)).toHaveAttribute('data-voice', 'off');
      await expect(status(ari)).toHaveText('Paused · your microphone is off and nothing is being measured.');
      expect((await mic(ari)).streams[0]).toEqual(['ended']);
      await ari.getByRole('button', { name: '▶ Resume My Chayus Meter' }).click();
      await expect(status(ari)).toHaveText('Microphone on · your meter picked up where it left off.');
      expect((await mic(ari)).requests).toBe(2);
      await expect(meter(ari)).toHaveAttribute('data-voice', 'on', { timeout: 8000 });

      // Off: microphone released and the panel returns to the invitation.
      await ari.waitForTimeout(11000); // the service accepts one summary per 10 seconds
      await ari.getByRole('button', { name: 'Turn my microphone off' }).click();
      await expect(status(ari)).toHaveText(/^Microphone off · .* measured · no audio was saved\.$/);
      await expect(meter(ari)).toHaveAttribute('data-state', 'off');
      expect((await mic(ari)).streams[1]).toEqual(['ended']);
      await expect(ari.getByRole('button', { name: '🎙️ Turn My Chayus Meter back on' })).toBeVisible();

      // Teacher ends the session and reads the class summary.
      await teacher.getByRole('button', { name: 'End Davening & prepare class report' }).click();
      await expect(status(teacher)).toHaveText('Teacher summary ready. Points remain your decision through the Rewards controls.');
      const report = teacher.locator('#chayusReport');
      await expect(report.locator('p').first()).toHaveText('1 of 2 students chose microphone monitoring. These estimates are observational and are not grades.');
      await expect(report.locator('summary').nth(0)).toHaveText(/^Ari Example · voice heard \d+% of the measured time$/);
      await expect(report.locator('summary').nth(1)).toHaveText('Zev Example · No microphone data');
      await expect(report).toContainText('No points were given.');
      await expect(report.getByRole('link', { name: 'Open Student Rewards to decide points manually' }))
        .toHaveAttribute('href', '../student-rewards/teacher.html?class=b3_et&tab=Daily%20Points');
      await expect(report.locator('button, input, select')).toHaveCount(0);
      await expect(status(ari)).toHaveText('This class session has ended.', { timeout: 20000 });

      // Privacy and safety: only the seven summary numbers left the student's device.
      const submits = expectOnlySummaryNumbersLeftTheDevice(room.log, 'token-ari');
      expect(submits.length).toBeGreaterThanOrEqual(2);
      expect(submits.at(-1).body.metrics.activeSeconds).toBeGreaterThan(5);
      expect(room.log.chayus.filter(entry => entry.token === 'token-zev' && entry.body.action === 'submit')).toEqual([]);
      for (const page of [ari, zev]) {
        const state = await mic(page);
        expect([state.recorders, state.peers, state.sockets]).toEqual([0, 0, 0]);
      }
      expect((await mic(zev)).requests).toBe(0);
      expect(room.log.awards).toBe(0);
      expect(room.log.stray).toEqual([]);
      expect(room.log.errors).toEqual([]);
    } finally { await room.browser.close(); }
  });

  for (const [micError, message] of [
    ['NotAllowedError', 'Permission declined. The meter is off. You can daven normally.'],
    ['NotFoundError', 'The microphone could not start. Check browser permissions or microphone availability.']
  ]) {
    test(`${micError}: the meter stays off, nothing breaks, and the teacher sees "No microphone data"`, async () => {
      test.setTimeout(60000);
      const room = await classroom();
      try {
        const teacher = await room.open('token-teacher');
        await teacher.getByRole('button', { name: '▶ Start Chayus session' }).click();
        await expect(status(teacher)).toHaveText('Chayus session is open for this class.');
        const ari = await room.open('token-ari', { micError });
        await ari.getByRole('button', { name: '🎙️ Activate My Chayus Meter' }).click();
        await expect(status(ari)).toHaveText(message);
        await expect(meter(ari)).toHaveAttribute('data-state', 'off');
        await expect(ari.locator('#chayusLive')).toHaveText('');
        // He can try again later, and the rest of the Davening page still works.
        await expect(ari.getByRole('button', { name: '🎙️ Activate My Chayus Meter' })).toBeVisible();
        await expect(ari.locator('.davening-feature-panel')).toBeVisible();
        await teacher.getByRole('button', { name: 'End Davening & prepare class report' }).click();
        await expect(teacher.locator('#chayusReport summary').nth(0)).toHaveText('Ari Example · No microphone data');
        await expect(teacher.locator('#chayusReport')).toContainText('0 of 2 students chose microphone monitoring.');
        expect(room.log.chayus.filter(entry => entry.body.action === 'submit')).toEqual([]);
        expect(room.log.awards).toBe(0);
        expect(room.log.errors).toEqual([]);
      } finally { await room.browser.close(); }
    });
  }

  test('encouragement appears after about two and a half minutes of measured davening', async () => {
    test.setTimeout(240000);
    const room = await classroom();
    try {
      const teacher = await room.open('token-teacher');
      await teacher.getByRole('button', { name: '▶ Start Chayus session' }).click();
      await expect(status(teacher)).toHaveText('Chayus session is open for this class.');
      const ari = await room.open('token-ari');
      const feedback = ari.locator('#chayusFeedback');
      await ari.getByRole('button', { name: '🎙️ Activate My Chayus Meter' }).click();
      await expect(meter(ari)).toHaveAttribute('data-state', 'on', { timeout: 8000 });
      const startedAt = Date.now();
      await ari.evaluate(() => window.__setVoice(1));
      await expect(feedback).toHaveText('Daven at your own comfortable volume. You never need to shout.');
      // Not constant interruption: still the opening line two minutes in.
      await ari.waitForTimeout(120000);
      await expect(feedback).toHaveText('Daven at your own comfortable volume. You never need to shout.');
      await expect(feedback).toHaveText(feedbackFor(1), { timeout: 60000 });
      await expect(feedback).toHaveClass(/chayus-pop/);
      const seconds = (Date.now() - startedAt) / 1000;
      expect(seconds).toBeGreaterThan(140);
      expect(seconds).toBeLessThan(185);
      expect(await feedback.textContent()).not.toMatch(/\d/); // no scores or percentages shown to the student
      await ari.getByRole('button', { name: 'Turn my microphone off' }).click();
      await expect(status(ari)).toHaveText(/^Microphone off · about 3 minutes measured · no audio was saved\.$/);
      const submits = expectOnlySummaryNumbersLeftTheDevice(room.log, 'token-ari');
      expect(submits.at(-1).body.metrics.feedbackCount).toBe(1);
      expect(submits.at(-1).body.metrics.activeIntervals).toBe(1);
      expect(room.log.awards).toBe(0);
      expect(room.log.errors).toEqual([]);
    } finally { await room.browser.close(); }
  });
});
