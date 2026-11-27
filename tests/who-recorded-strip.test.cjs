// "Who recorded" strip on the Posuk teacher page: Today / Yesterday / This week switch, ×1/×2/×3, tap a boy to show only him, live updates.
// Posuk recordings only. Read only.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const W = require('../record_pesukim/who-recorded.js');
const H = require('../rashi-letters/history-core.js');

const NOW = new Date(2026, 10, 25, 14, 0, 0).getTime();            // Wednesday
const TODAY = new Date(2026, 10, 25, 8, 0, 0).getTime(), YESTERDAY = new Date(2026, 10, 24, 20, 0, 0).getTime(), SUNDAY = new Date(2026, 10, 22, 9, 0, 0).getTime();
const isRecording = s => !!(s.id && s.status !== 'deleted');

function fakeDb(data){
  const listeners = {};
  return { data, listeners, ref(path){ return {
    on(ev, cb){ (listeners[path] = listeners[path] || []).push(cb); cb({ val: () => data[path] || null }); },
    off(ev, cb){ listeners[path] = (listeners[path] || []).filter(x => x !== cb); }
  }; }, push(path, value){ data[path] = value; (listeners[path] || []).forEach(cb => cb({ val: () => value })); } };
}
function fakeEl(){ return { innerHTML: '', onclick: null }; }
const click = (el, sel, dataset) => el.onclick({ target: { closest: s => (s === sel ? { dataset } : null) } });

test('counts the recordings in the period, not the deleted ones', () => {
  const items = { a: { id: 'a', submittedAt: TODAY }, b: { id: 'b', submittedAt: YESTERDAY }, c: { id: 'c', submittedAt: TODAY, status: 'deleted' }, d: { id: 'd', submittedAt: SUNDAY } };
  assert.equal(W.countIn(items, isRecording, H.range('today', NOW)), 1);
  assert.equal(W.countIn(items, isRecording, H.range('yesterday', NOW)), 1);
  assert.equal(W.countIn(items, isRecording, H.range('week', NOW)), 3, 'this week runs from Sunday');
  assert.equal(W.countIn(null, isRecording, H.range('today', NOW)), 0);
});

test('one chip per student, by name; green with a check and a count only when recorded in the period', () => {
  const list = W.chips({ s2: 'Yossi', s1: 'Avi' }, { s2: 2 });
  assert.deepEqual(list.map(c => [c.name, c.recorded, c.count]), [['Avi', false, 0], ['Yossi', true, 2]]);
  const html = W.html(list, { period: 'today' });
  assert.match(html, /1 of 2/);
  assert.match(html, /wr-chip done[^>]*data-wr-sid="s2"[^>]*>[\s\S]*?✓[\s\S]*?Yossi[\s\S]*?×2/);
  assert.match(html, /wr-chip none[^>]*data-wr-sid="s1"/);
  assert.doesNotMatch(html.split('data-wr-sid="s1"')[1].split('</button>')[0], /✓/);
  for (const k of ['today', 'yesterday', 'week']) assert.match(html, new RegExp('data-period="' + k + '"'));
  assert.match(W.html(W.chips({ x: '<b>"x"</b>' }, {}), {}), /&lt;b&gt;/, 'names are escaped');
});

test('the period switch re-counts; a tap reports the student; a picked boy is shown with a Show everyone button', () => {
  const path = 'posukPractice/submissions';
  const db = fakeDb({ [path + '/s1']: { a: { id: 'a', submittedAt: YESTERDAY } }, [path + '/s2']: { b: { id: 'b', submittedAt: TODAY }, c: { id: 'c', submittedAt: TODAY - 1000 } } });
  const el = fakeEl(); const picked = []; let selected = '';
  const strip = W.mount({ db, el, path, students: () => ({ s1: 'Avi', s2: 'Yossi' }), isRecording, selected: () => selected, onPick: sid => picked.push(sid), range: H.range, now: () => NOW });
  assert.match(el.innerHTML, /1 of 2/);
  assert.match(el.innerHTML, /wr-chip done[^>]*data-wr-sid="s2"[\s\S]*?×2/);
  click(el, '[data-period]', { period: 'yesterday' });
  assert.match(el.innerHTML, /wr-chip done[^>]*data-wr-sid="s1"[\s\S]*?×1/);
  assert.match(el.innerHTML, /wr-chip none[^>]*data-wr-sid="s2"/);
  click(el, '[data-period]', { period: 'week' });
  assert.match(el.innerHTML, /2 of 2/);
  click(el, '[data-wr-sid]', { wrSid: 's1' });
  selected = 's1'; strip.redraw();
  assert.deepEqual(picked, ['s1']);
  assert.match(el.innerHTML, /wr-chip [^"]*sel[^>]*data-wr-sid="s1"/);
  assert.match(el.innerHTML, /Showing only Avi/);
  click(el, '[data-clear]', {});
  assert.deepEqual(picked, ['s1', '']);
  strip.stop();
});

test('it updates live when a new recording arrives, and stopping removes the listeners', () => {
  const path = 'p';
  const db = fakeDb({ [path + '/s1']: { a: { id: 'a', submittedAt: YESTERDAY } } });
  const el = fakeEl();
  const strip = W.mount({ db, el, path, students: () => ({ s1: 'Avi', s2: 'Yossi' }), isRecording, range: H.range, now: () => NOW });
  assert.match(el.innerHTML, /0 of 2/);
  db.push(path + '/s2', { b: { id: 'b', submittedAt: TODAY } });
  assert.match(el.innerHTML, /1 of 2/);
  db.push(path + '/s2', { b: { id: 'b', submittedAt: TODAY, status: 'deleted' } });
  assert.match(el.innerHTML, /0 of 2/, 'a deleted recording turns the chip gray again');
  strip.stop();
  assert.equal(db.listeners[path + '/s1'].length, 0);
});

test('a student who joins the class later gets a chip', () => {
  const path = 'p'; const db = fakeDb({}); const el = fakeEl(); let roster = { s1: 'Avi' };
  const strip = W.mount({ db, el, path, students: () => roster, isRecording, range: H.range, now: () => NOW });
  roster = { s1: 'Avi', s3: 'Dovid' }; strip.sync();
  assert.match(el.innerHTML, /Dovid/);
  roster = { s3: 'Dovid' }; strip.sync();
  assert.doesNotMatch(el.innerHTML, /Avi/);
  strip.stop();
});

test('Posuk teacher page: strip on top, one page (Marking with Waiting + Earlier), no separate History tab', () => {
  const page = fs.readFileSync('record_pesukim/teacher.html', 'utf8').replace(/\r\n/g, '\n');
  assert.ok(page.indexOf('id="whoRecordedStrip"') < page.indexOf('<div class="tab-bar">'));
  assert.match(page, /<script src="\.\.\/rashi-letters\/history-core\.js[^>]*><\/script><script src="who-recorded\.js/);
  assert.doesNotMatch(page, /activity-history\/tab\.js/, 'the History tab is gone from this page');
  assert.match(page, /B3WhoRecorded\.mount\(\{[\s\S]*?path: B3PosukGradingQueue\.submissionsPath[\s\S]*?status !== 'deleted'[\s\S]*?onPick: pickStudent/);
  assert.match(page, /renderStudentList\(\);\s*mountWhoRecorded\(\);/);
  for (const id of ['gradeWaiting', 'gradeEarlier', 'gradeSearch']) assert.match(page, new RegExp('id="' + id + '"'));
  for (const k of ['today', 'yesterday', 'week', 'month', 'all']) assert.match(page, new RegExp("\\['" + k + "', "));
  // every other tab is still there
  for (const t of ['overviewTabBtn', 'rosterTabBtn', 'summaryTabBtn', 'reportsTabBtn', 'chazaraRecordingsTabBtn', 'translationsTabBtn']) assert.match(page, new RegExp('id="' + t + '"'));
});
