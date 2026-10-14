'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const teacher = read('shorashim/teacher.js');
const excerpt = (source, begin, end) => {
  const start = source.indexOf(begin), stop = source.indexOf(end, start + begin.length);
  assert.ok(start >= 0 && stop > start, `Missing executable section: ${begin}`);
  return source.slice(start, stop);
};

test('recording length updates from metadata, seekable ranges, and errors', () => {
  const label = { textContent: 'Checking length…' }, events = {};
  const audio = { duration: NaN, seekable: { length: 0 }, parentElement: { querySelector: () => label },
    addEventListener: (name, callback) => { events[name] = callback; } };
  const context = vm.createContext({ document: { querySelectorAll: () => [audio] } });
  vm.runInContext(excerpt(teacher, 'function recordingDurationLabel(', 'async function loadShorashimRecordings('), context);
  context.updateShorashimAudioDurations();
  audio.duration = 65.2; events.loadedmetadata();
  assert.equal(label.textContent, 'Length: 1:05');
  audio.duration = Infinity; audio.seekable = { length: 1, end: () => 123.1 }; events.progress();
  assert.equal(label.textContent, 'Length: 2:03');
  audio.seekable = {length:0}; audio.dataset={recordingDurationMs:'74500'}; events.durationchange();
  assert.equal(label.textContent, 'Length: 1:15');
  audio.dataset={};audio.readyState=1;events.loadedmetadata();assert.equal(label.textContent,'Duration unavailable');
  label.textContent = 'Checking length…'; events.error();
  assert.equal(label.textContent, 'Duration unavailable');
});

test('missing points requests can be reconnected without altering connected or approved recordings', () => {
  const box = { innerHTML: '' }, nodes = new Map([['shorashimRecordingsList', box]]);
  const context = vm.createContext({ $: id => nodes.get(id), esc: value => String(value),
    recordingModeLabel: () => 'Recording', recordingPoints: () => 2, recordingTime: () => 'Today',
    updateShorashimAudioDurations() {},
    shorashimRecordingRows: [
      { studentId: 'test-boy', eventId: 'missing', status: 'pending', audioURL: 'https://example.test/test.webm' },
      { studentId: 'test-boy', eventId: 'connected', pointRequestId: 'request-1', status: 'pending' },
      { studentId: 'test-boy', eventId: 'approved', status: 'approved' },
      { studentId: "bad'key", eventId: 'unsafe', status: 'pending' }
    ] });
  vm.runInContext(excerpt(teacher, 'function renderShorashimRecordings(', 'async function repairShorashimRecording('), context);
  context.renderShorashimRecordings();
  assert.equal((box.innerHTML.match(/Reconnect points request/g) || []).length, 1);
  assert.match(box.innerHTML, /repairShorashimRecording\('test-boy','missing'\)/);
  assert.match(box.innerHTML, /preload="metadata"/);
  assert.match(box.innerHTML, /reviewShorashimRecording\('request-1','approve'\)/);
});

test('recording repair uses existing authentication and the verified repair endpoint', async () => {
  let request, loaded = 0, popups = 0;
  const user = { email: 'simcha5770@gmail.com', getIdToken: async () => 'test-only-token' };
  const context = vm.createContext({ window: {}, firebase: { auth: () => ({ currentUser: user,
    signInWithPopup: () => { popups++; throw Error('Unexpected sign-in'); } }) },
    STUDENT_REWARDS_AUTO_AWARD_URL: 'https://example.test/rewards',
    fetch: async (url, options) => { request = { url, ...options }; return { ok: true, json: async () => ({ok:true}) }; },
    loadShorashimRecordings: async () => { loaded++; }, alert: message => { throw Error(message); } });
  vm.runInContext(excerpt(teacher, 'async function repairShorashimRecording(', 'async function reviewShorashimRecording('), context);
  await context.window.repairShorashimRecording('test-boy', 'test-event');
  assert.equal(popups, 0); assert.equal(loaded, 1);
  assert.deepEqual(JSON.parse(request.body), { action: 'repair-shorashim-recording', studentId: 'test-boy', eventId: 'test-event' });
  assert.equal(request.headers.Authorization, 'Bearer test-only-token');
});

function generator(random) {
  const context = vm.createContext({ window: {}, document: { readyState: 'loading', addEventListener() {},
    createElement: () => ({ set innerHTML(value) { this.textContent = value; } }) },
    Math: Object.assign(Object.create(Math), { random }) });
  vm.runInContext(read('game-show/question-generator-grade3-v4.js'), context);
  return context.window.FunTorahSefariaGeneratorCore;
}
test('Game Show randomizes correct positions while retaining the correct answers', () => {
  const sources = [1,2,3,4].map(n => ({ ref: `Genesis 18:${n}`, text: 'A supplied source.' }));
  const low = generator(() => 0), high = generator(() => 0.99);
  const a = low.makeItems(sources, 'mc', '', 4, sources), b = high.makeItems(sources, 'mc', '', 4, sources);
  assert.equal(a.length, 4); assert.equal(b.length, 4);
  for (const [core, items] of [[low,a],[high,b]]) for (const [i,item] of items.entries()) {
    assert.equal(item.choices[item.correctIndex], core.shortChoice(core.questionAndAnswer(sources[i], '').answer));
    assert.equal(new Set(item.choices).size, 4);
  }
  assert.notEqual(a[0].correctIndex, b[0].correctIndex);
});
test('Bereishis 18:15 asks about Sarah denying laughter, rather than admitting it', () => {
  const qa = generator(() => 0.5).questionAndAnswer({ref:'Genesis 18:15',text:'Sarah denied it, saying I did not laugh, because she was afraid.'}, '');
  assert.match(qa.q, /say she did not laugh/);
  assert.equal(qa.answer, 'Sarah was afraid.');
});
