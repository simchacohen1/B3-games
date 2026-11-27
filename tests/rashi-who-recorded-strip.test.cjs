// Rashi Letters teacher page, one page: "Who recorded" strip (Today / Yesterday / This week), waiting cards, then "Earlier".
// Everything is Rashi only and read only.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const H = require('../rashi-letters/history-core.js');
const page = fs.readFileSync('rashi-letters/teacher.html', 'utf8').replace(/\r\n/g, '\n');

test('page order: strip, waiting cards, Earlier; no separate History tab; loads the Rashi history script', () => {
  const at = s => page.indexOf(s);
  assert.ok(at('id="whoRecordedStrip"') < at('id="recPanel"'));
  assert.ok(at('id="recPanel"') < at('id="earlierPanel"'));
  assert.ok(at('id="earlierPanel"') < at('id="letterPanel"'));
  assert.match(page, /<script src="\.\/history-core\.js/);
  assert.doesNotMatch(page, /activity-history\/tab\.js/, 'the History tab is gone from this page');
  for (const k of ['today', 'yesterday', 'week', 'month', 'all']) assert.match(page, new RegExp('data-range="' + k + '"'));
});

function run() {
  const block = page.split('<script>').find(b => b.includes('One page: the "Who recorded" strip'));
  const code = block.split('</script>')[0];
  const els = {};
  const el = id => (els[id] = els[id] || { innerHTML: '', listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, setAttribute() {} });
  const ctx = {
    window: {}, RashiHistoryCore: H, console, Date, Object, Math, Number, String, Array, Promise,
    document: { getElementById: id => el(id), querySelector: () => el('erBar'), querySelectorAll: () => [] },
    escapeHtml: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    UNITS: new Array(9), isOwner: false, db: {}, firebase: { auth: () => ({ currentUser: null }) },
    teacherScope: { students: { s1: { name: 'Avi' }, s2: { name: 'Yossi' }, s3: { name: 'Dovid' } } },
    flushGradeSaves: async () => {}, drawRecTab: () => {}, loadRecordings: async () => {}, renderRecordings() {}
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext("var selSid = '';", ctx); /* the page declares this in its main script */
  vm.runInContext(code, ctx);
  return { ctx, els };
}

test('strip: green chips show how many times (×1, ×2); gray for no recording; Rashi readings only', () => {
  const { ctx, els } = run();
  const now = Date.now(), startOfToday = new Date(now).setHours(0, 0, 0, 0), yesterday = startOfToday - 12 * 3600 * 1000; /* noon yesterday in the clock the page uses (fixed: now-30h fell two days back before 06:00 UTC) */
  ctx.rashiProgress = { s1: { lastActive: now, units: { zayin_letter: { attempts: 5, correct: 5 } } } }; /* practice must not turn s1 green */
  ctx.renderRecordings(
    [{ id: 'a', studentId: 's2', createdAt: now, sectionLabel: 'Vayeira 18:1' }, { id: 'b', studentId: 's2', createdAt: now - 1000, sectionLabel: 'Vayeira 18:2' }],
    [{ id: 'c', studentId: 's3', createdAt: yesterday, sectionLabel: 'Zayin', gradedAt: yesterday }]);
  const html = els.whoRecordedStrip.innerHTML;
  assert.match(html, /1 of 3/);
  assert.match(html, /wr-chip done[^>]*data-wr-sid="s2"[\s\S]*?×2/);
  assert.match(html, /wr-chip none[^>]*data-wr-sid="s3"/);
  assert.match(html, /wr-chip none[^>]*data-wr-sid="s1"/);
  els.whoRecordedStrip.listeners.click({ target: { closest: s => (s === '[data-period]' ? { dataset: { period: 'yesterday' } } : null) } });
  assert.match(els.whoRecordedStrip.innerHTML, /wr-chip done[^>]*data-wr-sid="s3"[\s\S]*?×1/);
  assert.match(els.whoRecordedStrip.innerHTML, /wr-chip none[^>]*data-wr-sid="s2"/);
});

test('Earlier groups readings by day and tapping a chip filters it to that boy', async () => {
  const { ctx, els } = run();
  const now = Date.now();
  ctx.renderRecordings([{ id: 'a', studentId: 's2', createdAt: now, sectionLabel: 'Vayeira 18:1' }, { id: 'b', studentId: 's3', createdAt: now - 1000, sectionLabel: 'Vayeira 18:2' }], []);
  assert.match(els.earlierList.innerHTML, /er-day">Today/);
  assert.match(els.earlierList.innerHTML, /Yossi/);
  assert.match(els.earlierList.innerHTML, /Dovid/);
  await els.whoRecordedStrip.listeners.click({ target: { closest: s => (s === '[data-wr-sid]' ? { dataset: { wrSid: 's2' } } : null) } });
  await new Promise(r => setTimeout(r, 5));
  assert.match(els.earlierList.innerHTML, /Yossi/);
  assert.doesNotMatch(els.earlierList.innerHTML, /Dovid/);
  assert.match(els.whoRecordedStrip.innerHTML, /Showing only Yossi/);
});
