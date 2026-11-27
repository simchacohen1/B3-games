'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = fs.readFileSync('shorashim/index.html', 'utf8');
const app = fs.readFileSync('shorashim/app.js', 'utf8');
const pointsSrc = fs.readFileSync('shorashim/review-points.js', 'utf8');

test('one Review button, no 4-mode screen; Games stay a separate link on the home page', () => {
  assert.ok(!page.includes('id="reviewHubScreen"'));
  assert.ok(!/data-review-mode="(no-hints|practice)"/.test(page));
  for (const gone of ['Record Chazara', 'No Hints Challenge', 'Practice Only', 'regularChazaraChoice', 'noHintsChazaraChoice', 'practiceOnlyChoice']) assert.ok(!page.includes(gone), gone);
  assert.match(page, /class="hub-card hub-review" data-review-mode="regular"/);
  assert.match(page, /id="gamesHomeCard" data-go="gamesScreen"/);
  assert.match(page, /How many do you want to review now\?/);
  assert.match(page, /id="hidePicturesToggle"[\s\S]*Hide pictures/);
  assert.match(page, /id="recordMyselfToggle"[\s\S]*Record myself/);
  assert.match(page, /review-points\.js\?v=/);
  assert.ok(!page.includes('reviewHubScreen'));
});
test('recordings go to the teacher and no longer ask for points', () => {
  assert.ok(!app.includes("source:'shorashim-recording'") && !app.includes("shorashim-no-hints"));
  assert.ok(!/fetch\(STUDENT_REWARDS_AUTO_AWARD_URL/.test(app));
  assert.match(app, /points=0/);
});

function harness({ spent = 800, minReviewMs = 500, signedIn = true } = {}) {
  const calls = [];
  let server = { words: 0 };
  const els = new Map();
  const mk = () => ({ classList: { _s: new Set(), toggle(n, on) { on ? this._s.add(n) : this._s.delete(n); }, add(n) { this._s.add(n); }, remove(n) { this._s.delete(n); }, contains(n) { return this._s.has(n); } }, textContent: '', style: {}, setAttribute() {}, addEventListener() {}, querySelector: () => null, after() {}, prepend() {}, appendChild() {} });
  const document = { readyState: 'complete', visibilityState: 'visible', getElementById: id => { if (!els.has(id)) els.set(id, mk()); return els.get(id); }, querySelector: () => null, querySelectorAll: () => [], createElement: () => mk(), head: { appendChild() {} }, body: { appendChild() {} }, addEventListener() {} };
  const ctx = {
    document, console, setTimeout, clearTimeout, AbortSignal, Date, Math, JSON, Promise,
    performance: { now: () => 10000 }, reviewShownAt: 10000 - spent, reviewDeck: [{ itemKey: 'shorashim:a' }], reviewIndex: 0,
    db: { settings: { minReviewMs } }, cloudEnabled: signedIn, cloudStudentId: signedIn ? 's1' : null,
    isGuestPreview: () => false, goScreen() {}, matchState: null, shootState: null, whackState: null, raceState: null,
    firebase: { apps: [{ options: { projectId: 'fun-torah-tools-staging' } }], auth: () => ({ currentUser: { getIdToken: async () => 't' } }) },
    fetch: async (url, opt) => {
      const b = JSON.parse(opt.body); calls.push(b);
      if (b.action === 'shorashim-words-report') server.words += b.words;
      const w = server.words;
      return { ok: true, status: 200, json: async () => ({ ok: true, day: 'd', words: w, points: Math.floor(w / 100), newlyAwarded: [] }) };
    },
    addEventListener() {}, window: null
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(`function qualifyCurrentCard(){return true} function goScreen(){} function pickMatch(){} function fireAtTarget(){} function whackMole(){} function answerRace(){}
    function startMatchGame(){} function startShootGame(){} function startWhackGame(){} function startRaceGame(){}`, ctx);
  vm.runInContext(pointsSrc, ctx);
  return { ctx, calls, server };
}
const tick = () => new Promise(r => setImmediate(r));

test('a reviewed word counts once per batch and only with the minimum time spent on it', async () => {
  const fast = harness({ spent: 100 });
  vm.runInContext('qualifyCurrentCard()', fast.ctx);
  fast.ctx.B3ShorashimWordPoints.flush(); await tick();
  assert.equal(fast.calls.filter(c => c.action === 'shorashim-words-report').length, 0, 'fast flipping earns nothing');
  const ok = harness({ spent: 900 });
  vm.runInContext('qualifyCurrentCard(); qualifyCurrentCard();', ok.ctx);
  await ok.ctx.B3ShorashimWordPoints.flush(); await tick();
  const reports = ok.calls.filter(c => c.action === 'shorashim-words-report');
  assert.equal(reports.length, 1); assert.equal(reports[0].words, 1, 'the same word twice in one batch is one word');
  assert.ok(reports[0].batchId);
});
test('progress shows words toward the next point', async () => {
  const h = harness({ spent: 900 });
  h.server.words = 63;
  await h.ctx.B3ShorashimWordPoints.refresh(); await tick();
  assert.equal(h.ctx.B3ShorashimWordPoints.progressText(), '⭐ 63/100 to next point · 0 points today (max 10)');
  vm.runInContext('qualifyCurrentCard()', h.ctx);
  assert.match(h.ctx.B3ShorashimWordPoints.progressText(), /^⭐ 64\/100 to next point/);
});
test('guests and signed-out pages earn and report nothing', async () => {
  const h = harness({ signedIn: false });
  vm.runInContext('qualifyCurrentCard()', h.ctx);
  await h.ctx.B3ShorashimWordPoints.flush(); await tick();
  assert.equal(h.calls.length, 0);
});
test('a correct game answer counts, a wrong one or one answered too fast does not', async () => {
  const h2 = harness();
  vm.runInContext(`function pickMatch(){ matchState.matched.add('k'); }`, h2.ctx);
  vm.runInContext(pointsSrc, h2.ctx);
  h2.ctx.matchState = { matched: new Set() };
  let t = 10000; h2.ctx.performance.now = () => t;
  t += 100; vm.runInContext('pickMatch(0)', h2.ctx);   // too fast since the game clock
  h2.ctx.matchState.matched = new Set();
  t += 900; vm.runInContext('pickMatch(0)', h2.ctx);   // enough time
  await h2.ctx.B3ShorashimWordPoints.flush(); await tick();
  const r = h2.calls.filter(c => c.action === 'shorashim-words-report');
  assert.equal(r.length, 1); assert.equal(r[0].words, 1);
});
