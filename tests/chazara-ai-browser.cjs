#!/usr/bin/env node
'use strict';
/**
 * Chazara AI Practice — browser journey with fictional data (no Firebase, no paid services).
 * Chromium's fake microphone supplies audio; the checker endpoint is mocked, so this proves
 * the screens, recording flow, multi-pasuk steps, retry, accessibility basics and layout —
 * NOT recognition accuracy.
 *   node tests/chazara-ai-browser.cjs        (screenshots in test-results/chazara-ai/)
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'test-results', 'chazara-ai');
const ENDPOINT = 'https://us-central1-b3-games.cloudfunctions.net/chazaraAiPractice';
fs.mkdirSync(OUT, { recursive: true });

const HEB = {
  '18_1': 'וַיֵּרָא אֵלָיו ה׳ בְּאֵלֹנֵי מַמְרֵא וְהוּא יֹשֵׁב פֶּתַח הָאֹהֶל כְּחֹם הַיּוֹם',
  '18_2': 'וַיִּשָּׂא עֵינָיו וַיַּרְא וְהִנֵּה שְׁלֹשָׁה אֲנָשִׁים נִצָּבִים עָלָיו וַיַּרְא וַיָּרָץ לִקְרָאתָם מִפֶּתַח הָאֹהֶל וַיִּשְׁתַּחוּ אָרְצָה'
};
const ASSIGNMENTS = [
  { id: 'aiOne', title: 'Vayeira 1–2', mode: 'ai', sefer: 'Bereishis', perek: 18, from: 1, to: 2, progress: null,
    pesukim: [{ id: '18_1', perek: 18, posuk: 1, label: 'פרק יח · פסוק א', hebrew: HEB['18_1'] }, { id: '18_2', perek: 18, posuk: 2, label: 'פרק יח · פסוק ב', hebrew: HEB['18_2'] }] },
  { id: 'regOne', title: 'Teacher Chazara', mode: 'regular', sefer: 'Bereishis', perek: 18, from: 1, to: 1, progress: null,
    pesukim: [{ id: '18_1', perek: 18, posuk: 1, label: 'פרק יח · פסוק א', hebrew: HEB['18_1'] }] }
];

const FIREBASE_STUB = `
(function(){
  function snap(v){return{val:function(){return v},exists:function(){return v!=null}}}
  function ref(){return{once:async function(){return snap(null)},on:function(){},off:function(){},set:async function(){},update:async function(){},remove:async function(){},push:function(){return Object.assign(ref(),{key:'k'+Math.random().toString(36).slice(2)})},transaction:async function(fn){fn(null);return{committed:true}}}}
  var user={uid:'fictional',getIdToken:async function(){return 'fictional-student-token'}};
  window.firebase=window.firebase||{apps:[],initializeApp:function(){this.apps.push({})},database:Object.assign(function(){return{ref:ref}},{ServerValue:{TIMESTAMP:0}}),storage:function(){return{ref:ref}},auth:function(){return{currentUser:user,onAuthStateChanged:function(cb){cb(user)}}}};
})();`;

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

async function main() {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const results = [];
  const check = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name + ': ' + e.message]); } console.log(results[results.length - 1].join('  ').split('\n')[0]); };
  const calls = [];
  let nextOutcome = 'almost';

  async function studentPage(viewport) {
    const ctx = await browser.newContext({ viewport, permissions: ['microphone'] });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      sessionStorage.setItem('b3Games_studentId', 'fictional_student');
      sessionStorage.setItem('b3Games_studentName', 'Fictional Student');
      window.B3SiteSettings = { onAuthStateChanged: cb => cb(null, false), getActingStudent: () => null };
    });
    await page.route(/gstatic\.com\/firebasejs/, r => r.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB }));
    await page.route(/fonts\.googleapis|game-gate\.js|guest-mode\.js|activity-share\.js|homework-mode\.js|private-media\.js|teacher-preview\.js/, r => r.fulfill({ contentType: 'text/javascript', body: '' }));
    await page.route(ENDPOINT, async route => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 });
      const ct = req.headers()['content-type'] || '';
      if (ct.includes('application/json')) {
        calls.push(JSON.parse(req.postData()).action);
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, aiEnabled: true, assignments: ASSIGNMENTS }) });
      }
      const body = req.postDataBuffer() || Buffer.alloc(0);
      const parts = (body.toString('latin1').match(/name="audio\d"/g) || []).length;
      calls.push('evaluate:' + parts + ':' + (req.headers().authorization || '').slice(0, 12));
      await new Promise(r => setTimeout(r, 900));
      const msgs = { excellent: ['Excellent!', 'Excellent job! You read and explained the pasuk beautifully!', []],
        almost: ['Almost There!', "Great effort! You're getting closer. Practice a little more and try again!", ['Next time, explain what the pasuk means too.']] };
      const [title, message, tips] = msgs[nextOutcome];
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, outcome: nextOutcome, title, message, tips,
        pesukim: [{ id: '18_1', label: 'פרק יח · פסוק א', status: 'great' }, { id: '18_2', label: 'פרק יח · פסוק ב', status: nextOutcome === 'excellent' ? 'great' : 'practice' }] }) });
    });
    await page.goto(base + '/chazara/index.html');
    return { ctx, page };
  }

  // ---------- desktop student journey ----------
  const { ctx, page } = await studentPage({ width: 1280, height: 900 });
  await check('AI Practice panel appears inside the Chazara chart', async () => {
    await page.waitForSelector('#aiPracticePanel:not([hidden]) .aip-card', { timeout: 20000 });
    assert.ok(await page.isVisible('#grid'), 'the regular chart is still on the page');
    assert.ok(calls.includes('studentList'));
  });
  await check('regular teacher assignment is shown separately with its Hebrew text', async () => {
    const t = await page.textContent('#aiPracticePanel');
    assert.match(t, /Chazara from your teacher/);
    assert.match(t, /Teacher listens/);
    const dir = await page.$eval('.aip-regular-item .aip-hebrew', e => getComputedStyle(e).direction);
    assert.equal(dir, 'rtl');
  });
  await page.screenshot({ path: path.join(OUT, '1-chart-panel.png'), fullPage: false });
  await page.click('.aip-card');
  await check('practice screen shows the Hebrew of EVERY pasuk, right-to-left', async () => {
    await page.waitForSelector('.aip-dialog');
    const texts = await page.$$eval('.aip-pasuk .aip-hebrew', els => els.map(e => [e.textContent, getComputedStyle(e).direction, e.getAttribute('lang')]));
    assert.equal(texts.length, 2);
    assert.equal(texts[0][0], HEB['18_1']); assert.equal(texts[1][0], HEB['18_2']);
    assert.ok(texts.every(t => t[1] === 'rtl' && t[2] === 'he'));
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.textContent), '🎙️ Start Recording', 'keyboard focus starts on the big button');
  });
  await page.screenshot({ path: path.join(OUT, '2-ready.png') });
  await page.keyboard.press('Enter'); // keyboard-only start
  await check('recording indicator, microphone status and too-early nudge', async () => {
    await page.waitForSelector('.aip-mic.on');
    assert.match(await page.textContent('.aip-mic.on'), /Recording/);
    await page.click('.aip-btn.next');
    assert.match(await page.textContent('.aip-note'), /Keep going/);
    assert.equal(await page.$$eval('.aip-pasuk', e => e.length), 1, 'only the current pasuk while recording');
  });
  await page.screenshot({ path: path.join(OUT, '3-recording.png') });
  await page.waitForTimeout(3200);
  await page.click('.aip-btn.next');
  await check('multi-pasuk: moves to pasuk 2 and shows progress', async () => {
    await page.waitForSelector('.aip-dot.done');
    assert.match(await page.textContent('.aip-pasuk .aip-label'), /\(2\/2\)/);
    assert.ok(await page.isVisible('.aip-btn.finish'));
  });
  await page.waitForTimeout(3200);
  await page.click('.aip-btn.finish');
  await check('checking animation then "Almost There" result', async () => {
    await page.waitForSelector('.aip-checking');
    assert.match(await page.textContent('.aip-checking'), /Checking your Chazara/);
    await page.screenshot({ path: path.join(OUT, '4-checking.png') });
    await page.waitForSelector('.aip-result.almost', { timeout: 15000 });
    assert.match(await page.textContent('.aip-result'), /Great effort/);
    const ev = calls.find(c => c.startsWith('evaluate'));
    assert.equal(ev, 'evaluate:2:Bearer ficti', 'one recording per pasuk, sent with the sign-in token');
  });
  await page.screenshot({ path: path.join(OUT, '5-almost.png') });
  await check('retry: Try Again starts a fresh recording and can reach Excellent', async () => {
    nextOutcome = 'excellent';
    await page.click('text=🎙️ Try Again');
    await page.click('.aip-btn.big-rec');
    await page.waitForSelector('.aip-mic.on');
    await page.waitForTimeout(3100); await page.click('.aip-btn.next');
    await page.waitForTimeout(3100); await page.click('.aip-btn.finish');
    await page.waitForSelector('.aip-result.excellent', { timeout: 15000 });
    assert.match(await page.textContent('.aip-result'), /Excellent job/);
    assert.equal(calls.filter(c => c.startsWith('evaluate')).length, 2);
  });
  await page.screenshot({ path: path.join(OUT, '6-excellent.png') });
  await check('Escape/Done closes the screen and returns to the chart', async () => {
    await page.click('text=Done');
    await page.waitForSelector('.aip-overlay', { state: 'detached' });
    assert.ok(await page.isVisible('#grid'));
  });
  await ctx.close();

  // ---------- phone layout + reduced motion ----------
  const phone = await studentPage({ width: 390, height: 844 });
  await check('phone layout: no horizontal scroll, large buttons', async () => {
    await phone.page.waitForSelector('.aip-card');
    await phone.page.click('.aip-card');
    await phone.page.waitForSelector('.aip-btn.big-rec');
    const { sw, cw, h } = await phone.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h: document.querySelector('.aip-btn.big-rec').getBoundingClientRect().height }));
    assert.ok(sw <= cw + 1, 'scrollWidth ' + sw + ' > ' + cw);
    assert.ok(h >= 56, 'record button is at least 56px tall');
  });
  await phone.page.screenshot({ path: path.join(OUT, '7-phone.png') });
  await phone.ctx.close();

  // ---------- teacher panel ----------
  const tctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const tpage = await tctx.newPage();
  const saved = [];
  await tpage.route(ENDPOINT, async route => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (b.action === 'teacherSave') { saved.push(b); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'new1' }) }); }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, aiEnabled: false, assignments: [
      { id: 'aiOne', title: 'Vayeira 1–2', mode: 'ai', sefer: 'Bereishis', perek: 18, from: 1, to: 2, active: true, pesukim: [{ perek: 18, posuk: 1, hebrew: HEB['18_1'] }, { perek: 18, posuk: 2, hebrew: HEB['18_2'] }],
        completion: { stu_a: { attempts: 3, lastOutcome: 'excellent', excellent: true, lastAt: Date.UTC(2026, 10, 9) }, stu_b: { attempts: 1, lastOutcome: 'almost', excellent: false } } },
      { id: 'regOne', title: 'Teacher Chazara', mode: 'regular', sefer: 'Bereishis', perek: 18, from: 3, to: 3, active: true, pesukim: [] }] }) });
  });
  await tpage.route(/sefaria\.org/, r => r.fulfill({ status: 503, body: '' }));
  await tpage.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>.hidden{display:none}.pill{padding:3px 8px;border-radius:99px}</style></head><body>
    <div id="teacherApp"><div class="panel" id="recordingsPanel">Existing recordings panel</div></div>
    <script>${FIREBASE_STUB}
      var teacherScope={selected:'class_one',classes:{class_one:{name:'Fictional Class'}},students:{stu_a:{name:'Fictional A',classId:'class_one'},stu_b:{name:'Fictional B',classId:'class_one'},stu_c:{name:'Fictional C',classId:'class_one'}}};
    </script><script>${fs.readFileSync(path.join(ROOT, 'chazara/ai-practice-teacher.js'), 'utf8')}</script></body></html>`);
  await check('teacher sees which assignments use AI Practice and simple completion (no grade)', async () => {
    await tpage.waitForSelector('#aiPracticeTeacherPanel details');
    const t = await tpage.textContent('#aiPracticeTeacherPanel');
    assert.match(t, /🤖 AI Practice/); assert.match(t, /Regular — you review/);
    assert.match(t, /1 of 3 students reached Excellent · 2 practiced/);
    assert.match(t, /not switched on yet/);
    assert.doesNotMatch(t, /%|score|grade:/i);
  });
  await check('new assignment: Regular is the default; AI needs the "I checked" box', async () => {
    await tpage.click('text=+ New assignment');
    assert.equal(await tpage.$eval('input[name=aipMode][value=regular]', e => e.checked), true);
    await tpage.fill('#aipTitleInput', 'Fictional AI set');
    const nums = await tpage.$$('fieldset input[type=number]');
    await nums[0].fill('18'); await nums[1].fill('1'); await nums[2].fill('1');
    await tpage.check('input[name=aipMode][value=ai]');
    await tpage.fill('textarea[aria-label="Hebrew text for pasuk 1"]', HEB['18_1']);
    assert.equal(await tpage.$$eval('textarea', t => t.length), 1, 'only the Hebrew text box: no meaning field');
    assert.equal(await tpage.$eval('textarea[aria-label="Hebrew text for pasuk 1"]', e => getComputedStyle(e).direction), 'rtl');
    await tpage.click('text=Create assignment');
    assert.match(await tpage.textContent('fieldset'), /tick the box/);
    assert.equal(saved.length, 0);
    await tpage.check('fieldset input[type=checkbox]');
    await tpage.click('text=Create assignment');
    await tpage.waitForFunction(() => !document.querySelector('fieldset'));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].assignment.mode, 'ai');
    assert.equal(saved[0].classId, 'class_one');
    assert.equal(saved[0].assignment.pesukim['18_1'].hebrew, HEB['18_1']);
    assert.equal(saved[0].assignment.pesukim['18_1'].meaning, undefined);
  });
  await tpage.click('#aiPracticeTeacherPanel summary');
  await tpage.screenshot({ path: path.join(OUT, '8-teacher.png'), fullPage: true });
  await tctx.close();

  await browser.close(); server.close();
  for (const [s, n] of results) console.log(s + '  ' + n);
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed} passed, ${failed} failed. Screenshots: ${path.relative(ROOT, OUT)}/`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
