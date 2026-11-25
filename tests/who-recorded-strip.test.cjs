// "Who recorded" strip on the teacher pages: green check = recorded today, gray = not, tap jumps, updates live.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const W = require('../record_pesukim/who-recorded.js');

const NOW = new Date(2026, 10, 25, 14, 0, 0).getTime();
const TODAY = new Date(2026, 10, 25, 8, 0, 0).getTime(), YESTERDAY = new Date(2026, 10, 24, 20, 0, 0).getTime();
const isRecording = (s, from) => !!(s.id && s.status !== 'deleted' && (Number(s.submittedAt) || 0) >= from);

function fakeDb(data){
  const listeners = {};
  return { data, listeners, ref(path){ return {
    on(ev, cb){ (listeners[path] = listeners[path] || []).push(cb); cb({ val: () => data[path] || null }); },
    off(ev, cb){ listeners[path] = (listeners[path] || []).filter(x => x !== cb); }
  }; }, push(path, value){ data[path] = value; (listeners[path] || []).forEach(cb => cb({ val: () => value })); } };
}
function fakeEl(){ return { innerHTML: '', onclick: null }; }

test('counts only recordings from today that were not deleted', () => {
  const items = { a: { id: 'a', submittedAt: TODAY }, b: { id: 'b', submittedAt: YESTERDAY }, c: { id: 'c', submittedAt: TODAY, status: 'deleted' } };
  assert.equal(W.countToday(items, isRecording, NOW), 1);
  assert.equal(W.countToday(null, isRecording, NOW), 0);
});

test('one chip per student, by name; green with a check only when recorded today', () => {
  const list = W.chips({ s2: 'Yossi', s1: 'Avi' }, { s2: 2 });
  assert.deepEqual(list.map(c => [c.name, c.recorded, c.count]), [['Avi', false, 0], ['Yossi', true, 2]]);
  const html = W.html(list, 'Who recorded today');
  assert.match(html, /1 of 2/);
  assert.match(html, /wr-chip done[^>]*data-wr-sid="s2"[^>]*>[\s\S]*?✓[\s\S]*?Yossi[\s\S]*?×2/);
  assert.match(html, /wr-chip none[^>]*data-wr-sid="s1"/);
  assert.doesNotMatch(html.split('data-wr-sid="s1"')[1].split('</button>')[0], /✓/);
  assert.match(W.html(W.chips({ x: '<b>"x"</b>' }, {})), /&lt;b&gt;/, 'names are escaped');
});

test('it updates live when a new recording arrives, and a tap reports the student', () => {
  const path = 'posukPractice/submissions';
  const db = fakeDb({ [path + '/s1']: { a: { id: 'a', submittedAt: YESTERDAY } } });
  const el = fakeEl(); const picked = [];
  const strip = W.mount({ db, el, path, students: () => ({ s1: 'Avi', s2: 'Yossi' }), isRecording, onPick: sid => picked.push(sid), now: () => NOW });
  assert.match(el.innerHTML, /0 of 2/);
  db.push(path + '/s2', { b: { id: 'b', submittedAt: TODAY } });
  assert.match(el.innerHTML, /1 of 2/);
  assert.match(el.innerHTML, /wr-chip done[^>]*data-wr-sid="s2"/);
  db.push(path + '/s2', { b: { id: 'b', submittedAt: TODAY, status: 'deleted' } });
  assert.match(el.innerHTML, /0 of 2/, 'a deleted recording turns the chip gray again');
  el.onclick({ target: { closest: () => ({ dataset: { wrSid: 's1' } }) } });
  assert.deepEqual(picked, ['s1']);
  strip.stop();
  assert.equal(db.listeners[path + '/s1'].length, 0, 'stopping removes the listeners');
});

test('a student who joins the class later gets a chip', () => {
  const path = 'p'; const db = fakeDb({}); const el = fakeEl(); let roster = { s1: 'Avi' };
  const strip = W.mount({ db, el, path, students: () => roster, isRecording, now: () => NOW });
  roster = { s1: 'Avi', s3: 'Dovid' }; strip.sync();
  assert.match(el.innerHTML, /Dovid/);
  roster = { s3: 'Dovid' }; strip.sync();
  assert.doesNotMatch(el.innerHTML, /Avi/);
  strip.stop();
});

test('Posuk teacher page has the strip at the top and sends a tap to that student\'s recordings', () => {
  const page = fs.readFileSync('record_pesukim/teacher.html', 'utf8').replace(/\r\n/g, '\n');
  assert.ok(page.indexOf('id="whoRecordedStrip"') < page.indexOf('<div class="tab-bar">'));
  assert.match(page, /<script src="who-recorded\.js/);
  assert.match(page, /B3WhoRecorded\.mount\(\{[\s\S]*?path: B3PosukGradingQueue\.submissionsPath[\s\S]*?status !== 'deleted'/);
  assert.match(page, /onPick: sid => \{ Object\.assign\(gradeView, \{ range:'all', sid, status:'all'[\s\S]*?setTab\('grade'\)/);
  assert.match(page, /renderStudentList\(\);\s*mountWhoRecorded\(\);/);
});
