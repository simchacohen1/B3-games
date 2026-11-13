'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../kriah-assessment/core.js');
const Recorder = require('../kriah-assessment/recorder.js');
const changeRecord = require('../backend/kriah-staging/transaction.cjs');
const { fixture, identities: I, example } = require('../scripts/kriah-fixture.cjs');
const { createService, PROJECT, WS, MAX_BYTES } = require('../backend/kriah-staging/service.cjs');
const ex = changes => Core.exercise({ ...example, ...changes });
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(20, 1)]).toString('base64');
const ctx = { classId: 'kriah-test-et', studentId: 'fictional-alef' };
async function assigned(f, sid = ctx.studentId) { return (await f.service.handle(I.teacherA, { action: 'assign', classId: ctx.classId, exerciseId: 'fictional-mixed-review', studentIds: [sid] })).assigned[0].id; }
const send = (f, actor, action, extra = {}) => f.service.handle(I[actor], { ...ctx, action, ...extra });
const denied = (promise, code = 403) => assert.rejects(promise, error => error.code === code);

test('Unicode: normalized combinations, finals, sheva and every standard vowel/dot remain individually targetable', () => {
  const u = Core.units(example.text), letters = u.units.filter(u => u.kind === 'letter'), dots = u.units.filter(u => u.kind === 'nekudah');
  assert.equal(letters.length, 19); for (const v of ['ך', 'ם', 'ן', 'ף', 'ץ']) assert(letters.some(u => u.label === v));
  for (const label of ['Kamatz', 'Patach', 'Segol', 'Tzeirei', 'Chirik', 'Cholam', 'Dagesh / shuruk', 'Kubutz', 'Sheva', 'Chataf segol', 'Chataf patach', 'Chataf kamatz', 'Shin dot', 'Sin dot']) assert(dots.some(u => u.label === label), label);
  assert.deepEqual(Core.units('בָּ'), Core.units('בָּ'));
  assert.equal(Core.units('בָּ־מֶלֶךְ').units.filter(u => u.kind === 'word').length, 2);
});
test('scoring is explicit, per-unit, adjustable; unmarked is not incorrect', () => {
  const e = ex({ text: 'בָּ בְ ך', unitType: 'letter' });
  const values = [{ unitId: 'l:0', category: 'correct' }, { unitId: 'l:1', category: 'self-correction' }, { unitId: 'n:0:1464', category: 'wrong-vowel' }];
  const s = Core.summary(e, values); assert.equal(s.total, 3); assert.equal(s.attempted, 2); assert.equal(s.correct, 2); assert.equal(s.notAssessed, 1); assert.equal(s.percent, 100);
  assert.equal(Core.summary({ ...e, countSelfCorrection: true }, values).percent, 50);
  assert.equal(s.skills.find(u => u.label === 'Kamatz').errors, 1);
  assert.equal(s.skills.find(u => u.label === 'Sheva').assessed, 0);
  assert.equal(Core.summary(e, []).percent, null);
  assert.equal(Core.summary(e, values, { seconds: 30 }).wpm, null);
  assert.equal(Core.summary(e, values, { seconds: 30, confirmed: true }).wpm, 6);
});
test('reject forged/duplicate units, unknown categories, invalid timestamps and missing scoring units', () => {
  const e = ex({ text: 'בָּ' });
  for (const m of [[{ unitId: 'l:100', category: 'correct' }], [{ unitId: 'l:0', category: 'fake' }], [{ unitId: 'l:0', category: 'correct', time: -1 }], [{ unitId: 'l:0', category: 'correct' }, { unitId: 'l:0', category: 'skipped' }]]) assert.throws(() => Core.marks(e, m));
  assert.throws(() => ex({ text: 'ך', unitType: 'nekudah' })); assert.throws(() => ex({ text: 'ב'.repeat(251) }));
});
test('original starter exercises cover every letter and final, teachers can define levels', () => {
  const parsed = Core.units(Core.STARTERS[0].text);
  const alphabet = [...'אבגדהוזחטיכלמנסעפצקרשתךםןףץ'];
  for (const letter of alphabet) assert(parsed.units.some(u => u.kind === 'letter' && u.label === letter));
  for (const starter of Core.STARTERS) assert(Core.exercise(starter));
  assert.equal(Core.skillId('nekudah', 'Sheva'), 'nekudah_1456');
});
test('end-to-end assigned → recorded → draft → reviewed → report; snapshots survive library edits', async () => {
  const f = await fixture(), id = await assigned(f);
  await send(f, 'teacherA', 'saveExercise', { exerciseId: 'fictional-mixed-review', exercise: ex({ text: 'שָׁלוֹם' }) });
  assert.equal((await send(f, 'studentA', 'get', { id })).record.exercise.text, ex().text);
  await send(f, 'studentA', 'submit', { id, audio: webm, type: 'audio/webm', duration: 10 });
  let record = (await send(f, 'teacherA', 'get', { id })).record;
  const marks = [{ unitId: 'l:0', category: 'wrong-letter', correction: 'ב', note: 'Fictional correction', time: 1 }, { unitId: 'n:0:1464', category: 'wrong-vowel' }];
  record = (await send(f, 'teacherA', 'grade', { id, revision: record.revision, marks, feedback: 'Private draft', shareFeedback: true })).record;
  assert.equal(record.status, 'in_progress'); assert.equal((await send(f, 'studentA', 'get', { id })).record.feedback, undefined);
  record = (await send(f, 'teacherA', 'grade', { id, revision: record.revision, marks, final: true, shareFeedback: true, feedback: 'Try this letter', recommendation: 'Practise kamatz.' })).record;
  assert.equal(record.status, 'reviewed'); assert.equal(record.summary.incorrect, 1); assert.equal(record.summary.categories['wrong-vowel'], 1);
  const report = await send(f, 'studentA', 'list'); assert.equal(report.records[0].feedback, 'Try this letter'); assert.equal(report.records[0].summary.skills.find(s => s.label === 'Kamatz').errors, 1);
  assert.equal(f.audio.reads.length, 0); await send(f, 'teacherA', 'audioRead', { id }); assert.equal(f.audio.reads.length, 1);
});
test('two teachers/classes, student A vs B, malformed IDs and unauthenticated access are denied server-side', async () => {
  const f = await fixture(), id = await assigned(f);
  for (const actor of ['teacherB', 'studentB']) for (const action of ['get', 'audioRead', 'list', 'submit', 'grade', 'delete']) await denied(send(f, actor, action, { id }));
  for (const action of ['saveExercise', 'assign', 'openClass', 'grade', 'delete']) await denied(send(f, 'studentA', action, { id }));
  await denied(f.service.handle(null, { ...ctx, action: 'get', id }), 401);
  await denied(send(f, 'teacherA', 'get', { id: '../other' }), 400);
  await denied(send(f, 'teacherA', 'get', { classId: 'et', id }));
  const classes = await f.service.handle(I.teacherA, { action: 'classes' }); assert.deepEqual(classes.classes.map(c => c.id), ['kriah-test-et']);
});
test('revoked teacher, student profile, membership and tool access fail even with an existing token', async () => {
  for (const [path, value, actor] of [[WS + 'teachers/' + I.teacherA.uid + '/active', false, 'teacherA'], ['b3Games/students/fictional-alef/profile/active', false, 'studentA'], ['b3Games/students/fictional-alef/memberships/fixture/active', false, 'studentA'], [WS + 'classes/kriah-test-et/members/fictional-alef/active', false, 'studentA'], [WS + 'classes/kriah-test-et/toolGrants/kriah-assessment', false, 'teacherA']]) {
    const f = await fixture(), id = await assigned(f); await f.store.set(path, value); await denied(send(f, actor, 'get', { id }));
  }
});
test('principal is class-scoped, owner can enumerate only enabled synthetic classes, non-Google teacher fails', async () => {
  const f = await fixture(); await send(f, 'principal', 'openClass');
  await denied(send(f, 'principal', 'openClass', { classId: 'kriah-test-wt', studentId: undefined }));
  assert.equal((await f.service.handle(I.owner, { action: 'classes' })).classes.length, 2);
  await denied(f.service.handle({ ...I.teacherA, firebase: { sign_in_provider: 'password' } }, { ...ctx, action: 'openClass' }));
});
test('real staging password fixtures require verified test-domain identity plus explicit server marker', async () => {
  const f = await fixture();
  const actor = { ...I.teacherA, email: 'teacher.alef@funtorahtools-staging.test', firebase: { sign_in_provider: 'password' } };
  const body = { ...ctx, action: 'openClass' };
  await denied(f.service.handle(actor, body));
  await f.store.set(WS + 'teachers/' + actor.uid + '/kriahSynthetic', true);
  assert.equal((await f.service.handle(actor, body)).students.length, 1);
  await denied(f.service.handle({ ...actor, email_verified: false }, body));
  await denied(f.service.handle({ ...actor, email: 'teacher@example.com' }, body));
  await f.store.set(WS + 'teachers/' + actor.uid + '/active', false);
  await denied(f.service.handle(actor, body));
});
test('upload retries are idempotent, original audio immutable, new attempt preserves previous audio', async () => {
  const f = await fixture(), id = await assigned(f);
  const payload = { id, audio: webm, type: 'audio/webm', duration: 4 };
  await Promise.all([send(f, 'studentA', 'submit', payload), send(f, 'studentA', 'submit', payload)]);
  assert.equal(f.audio.objects.size, 1); assert.equal((await send(f, 'studentA', 'submit', payload)).duplicate, true);
  await denied(send(f, 'studentA', 'submit', { ...payload, audio: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(20, 2)]).toString('base64') }), 409);
  const retries = await Promise.all([send(f, 'studentA', 'retry', { id }), send(f, 'studentA', 'retry', { id })]); assert.equal(retries[0].id, retries[1].id);
  assert.equal((await send(f, 'studentA', 'get', { id: retries[0].id })).record.status, 'assigned'); assert.equal(f.audio.objects.size, 1);
});
test('interrupted upload retains original, failed metadata write can retry same bytes', async () => {
  const f = await fixture(), id = await assigned(f), original = f.store.change; let failOnce = true;
  f.store.change = async (...args) => { if (failOnce) { failOnce = false; throw new Error('Synthetic outage'); } return original(...args); };
  await assert.rejects(send(f, 'studentA', 'submit', { id, audio: webm, type: 'audio/webm', duration: 5 }));
  assert.equal(f.audio.objects.size, 1);
  await send(f, 'studentA', 'submit', { id, audio: webm, type: 'audio/webm', duration: 5 }); assert.equal((await send(f, 'teacherA', 'get', { id })).record.status, 'submitted');
});
test('reject oversize, fake media, invalid duration; grade revision conflicts do not overwrite', async () => {
  const f = await fixture(), id = await assigned(f);
  for (const body of [{ audio: Buffer.alloc(MAX_BYTES + 1).toString('base64'), type: 'audio/webm', duration: 4 }, { audio: Buffer.alloc(24).toString('base64'), type: 'text/html', duration: 4 }, { audio: webm, type: 'audio/webm', duration: 301 }]) await denied(send(f, 'studentA', 'submit', { id, ...body }), 400);
  await send(f, 'studentA', 'submit', { id, audio: webm, type: 'audio/webm', duration: 4 });
  await send(f, 'teacherA', 'grade', { id, revision: 1, marks: [], feedback: 'Saved' });
  await denied(send(f, 'teacherA', 'grade', { id, revision: 1, marks: [], feedback: 'Stale' }), 409);
  assert.equal((await send(f, 'teacherA', 'get', { id })).record.feedback, 'Saved');
});
test('private notes and unshared final results are absent in student get/list responses', async () => {
  const f = await fixture(), id = await assigned(f); await send(f, 'studentA', 'submit', { id, audio: webm, type: 'audio/webm', duration: 5 });
  await send(f, 'teacherA', 'grade', { id, revision: 1, marks: [{ unitId: 'l:0', category: 'other', note: 'PRIVATE-NOTE' }], final: true, feedback: 'PRIVATE-FEEDBACK', shareFeedback: false });
  const body = JSON.stringify([await send(f, 'studentA', 'get', { id }), await send(f, 'studentA', 'list')]); assert(!body.includes('PRIVATE')); assert(!body.includes('assignedBy')); assert(!body.includes('hash')); assert(!body.includes('kriah/'));
});
test('mastery is an explicit teacher decision, scoped and optionally shared', async () => {
  const f = await fixture();
  await send(f, 'teacherA', 'setSkill', { kind: 'letter', label: 'ך', state: 'mastered', shared: false });
  assert.equal(Object.keys((await send(f, 'studentA', 'skills')).skills).length, 0);
  assert.equal((await send(f, 'teacherA', 'skills')).skills.letter_1498.state, 'mastered');
  await send(f, 'teacherA', 'setSkill', { kind: 'nekudah', label: 'Sheva', state: 'needs-practice', shared: true });
  assert.equal((await send(f, 'studentA', 'skills')).skills.nekudah_1456.state, 'needs-practice');
  await denied(send(f, 'studentB', 'skills'));
  await denied(send(f, 'studentA', 'setSkill', { kind: 'letter', label: 'א', state: 'mastered' }));
});
test('deletion retries after object failure, and orphan uploads are removed', async () => {
  const f = await fixture(), id = await assigned(f); await send(f, 'studentA', 'submit', { id, audio: webm, type: 'audio/webm', duration: 5 });
  const remove = f.audio.remove; let outage = true;
  f.audio.remove = async path => { if (outage) { outage = false; throw new Error('Synthetic object outage'); } return remove(path); };
  await assert.rejects(send(f, 'teacherA', 'delete', { id, confirm: id }));
  await denied(send(f, 'studentA', 'get', { id }), 404);
  await send(f, 'teacherA', 'delete', { id, confirm: id }); assert.equal(f.audio.objects.size, 0);
  await send(f, 'teacherA', 'delete', { id, confirm: id });
});
test('paginated reads are bounded, no audio downloads during class/list/report, delete removes audio', async () => {
  const f = await fixture(); for (let i = 0; i < 28; i++) await assigned(f);
  const page = await send(f, 'teacherA', 'list'); assert.equal(page.records.length, 25); assert(page.next);
  const older = await send(f, 'teacherA', 'list', { before: page.next }); assert.equal(older.records.length, 3); assert(!older.next);
  assert(!page.records.some(r => older.records.some(o => o.id === r.id))); assert.equal(f.audio.reads.length, 0);
  assert(f.store.reads.filter(r => r.path.includes('/records')).every(r => r.limit <= 26));
  await denied(send(f, 'teacherA', 'list', { limit: 100 }), 400);
  const id = page.records[0].id; await send(f, 'studentA', 'submit', { id, audio: webm, type: 'audio/webm', duration: 4 });
  await denied(send(f, 'teacherA', 'delete', { id, confirm: 'wrong' }), 400);
  await send(f, 'teacherA', 'delete', { id, confirm: id }); assert.equal(f.audio.objects.size, 0); await denied(send(f, 'studentA', 'get', { id }), 404);
});
test('synthetic cost evidence: scoped metadata, no broad student roots, audio only on demand', async t => {
  const f = await fixture(), id = await assigned(f);
  await send(f, 'studentA', 'submit', { id, audio: webm, type: 'audio/webm', duration: 5 });
  await send(f, 'teacherA', 'grade', { id, revision: 1, marks: [{ unitId: 'l:0', category: 'correct' }], final: true });
  f.store.reads.length = 0;
  const response = await send(f, 'teacherA', 'list');
  assert.equal(f.audio.reads.length, 0);
  assert(f.store.reads.every(r => r.path !== 'b3Games/students' && r.path !== WS + 'classes' && !r.path.includes('/kriah-test-wt')));
  const result = { scenario: 'one fictional reviewed attempt', metadataResponseBytes: Buffer.byteLength(JSON.stringify(response)), scopedStoreReadBytes: f.store.reads.reduce((n, r) => n + r.bytes, 0), storeReadCount: f.store.reads.length, audioDownloadsBeforePlay: f.audio.reads.length };
  await send(f, 'teacherA', 'audioRead', { id }); result.audioDownloadsAfterPlay = f.audio.reads.length;
  t.diagnostic(JSON.stringify(result));
});
test('staging-only backend and frontend refuse production; shared model parity', async () => {
  assert.throws(() => createService({ projectId: 'b3-games' }), /staging only/);
  assert.equal(fs.readFileSync('kriah-assessment/core.js', 'utf8'), fs.readFileSync('backend/kriah-staging/core.js', 'utf8'));
  const source = fs.readFileSync('kriah-assessment/client.js', 'utf8');
  const context = { window: { location: { hostname: 'funtorahtools.com', search: '' } }, URLSearchParams }; vm.runInNewContext(source, context);
  await assert.rejects(context.window.KriahClient.init(() => {}), /isolated staging/);
  assert.equal(PROJECT, 'fun-torah-tools-staging');
});
test('recorder mic denial, cancel during permission wait, supported Safari format, cleanup', async () => {
  const deniedRecorder = new Recorder({ media: { async getUserMedia() { throw Object.assign(new Error(), { name: 'NotAllowedError' }); } }, Recorder: class {} });
  await assert.rejects(deniedRecorder.start(), /permission was denied/); assert.equal(deniedRecorder.state, 'idle');
  let resolve, stopped = 0; const pending = new Recorder({ media: { getUserMedia() { return new Promise(r => resolve = r); } }, Recorder: class {} }); const p = pending.start(); pending.cancel(); resolve({ getTracks: () => [{ stop() { stopped++; } }] }); await p; assert.equal(stopped, 1);
  let selected, now = 0, completed;
  class FakeRecorder { static isTypeSupported(t) { return t === 'audio/mp4'; } constructor(stream, opts) { selected = opts.mimeType; this.mimeType = opts.mimeType; } start() {} stop() { this.ondataavailable({ data: new Blob([new Uint8Array(20)]) }); this.onstop(); } }
  const recorder = new Recorder({ media: { async getUserMedia() { return { getTracks: () => [{ stop() { stopped++; } }] }; } }, Recorder: FakeRecorder, clock: () => now, onComplete: v => completed = v });
  await recorder.start(); now = 1000; recorder.stop(); await Promise.resolve(); assert.equal(selected, 'audio/mp4'); assert.equal(completed.blob.type, 'audio/mp4'); assert.equal(recorder.timer, null); assert.equal(recorder.stream, null);
});
test('RTDB adapter tolerates provisional uncached null and clears a superseded error after server retry', async () => {
  const ref = { async transaction(update) {
    assert.equal(update(null), null, 'Provisional cache miss must reach the server comparison, not abort');
    const updated = update({ revision: 1, status: 'assigned' });
    assert.deepEqual(updated, { revision: 2, status: 'submitted' });
    return { committed: true, snapshot: { val: () => updated } };
  } };
  const result = await changeRecord(ref, row => {
    if (!row) throw Object.assign(new Error('Assessment not found.'), { code: 404 });
    return { revision: row.revision + 1, status: 'submitted' };
  });
  assert.equal(result.status, 'submitted');
});
test('RTDB adapter reports confirmed missing/conflicting records without overwriting data', async () => {
  const missing = { async transaction(update) { const value = update(null); assert.equal(value, null); return { committed: true, snapshot: { val: () => null } }; } };
  await denied(changeRecord(missing, row => { if (!row) throw Object.assign(new Error('Missing'), { code: 404 }); return row; }), 404);
  const row = { revision: 2, status: 'reviewed' };
  const conflict = { async transaction(update) { assert.equal(update(row), row); return { committed: true, snapshot: { val: () => row } }; } };
  await denied(changeRecord(conflict, () => { throw Object.assign(new Error('Revision conflict'), { code: 409 }); }), 409);
});

test('reject a 1-second decoded capture when microphone ran for 30 seconds', async () => {
  let closed = 0;
  class ShortDecoder { async decodeAudioData() { return { duration: 1 }; } async close() { closed++; } }
  await assert.rejects(Recorder.verifyPlayableDuration(new Blob(['fictional']), 30, { Decoder: ShortDecoder }), /cut off/);
  assert.equal(closed, 1);
  class FullDecoder { async decodeAudioData() { return { duration: 29.5 }; } async close() {} }
  const valid = await Recorder.verifyPlayableDuration(new Blob(['fictional']), 30, { Decoder: FullDecoder });
  assert.equal(valid.checked, true);
  class Unsupported { async decodeAudioData() { throw new Error('Codec not supported'); } async close() {} }
  assert.equal((await Recorder.verifyPlayableDuration(new Blob(['fictional']), 30, { Decoder: Unsupported })).checked, false);
});
test('teacher audioRead refuses shortened private storage objects, without deleting original metadata', async () => {
  const f = await fixture(), id = await assigned(f);
  await send(f, 'studentA', 'submit', { id, audio: webm, type: 'audio/webm', duration: 30 });
  const record = (await send(f, 'teacherA', 'get', { id })).record;
  const original = f.audio.objects.get(record.audio.path);
  original.bytes = original.bytes.subarray(0, original.bytes.length - 1);
  await denied(send(f, 'teacherA', 'audioRead', { id }), 409);
  assert.equal((await send(f, 'teacherA', 'get', { id })).record.audio.size, Buffer.from(webm, 'base64').length);
});

// --- Playback length and Alef-Beis adventure presentation (#624 follow-up) ---
function fakePlayer() {
  const listeners = {}, player = { duration: NaN, readyState: 0, seeks: [],
    addEventListener(name, fn) { (listeners[name] ||= new Set()).add(fn); },
    removeEventListener(name, fn) { listeners[name]?.delete(fn); },
    emit(name) { [...(listeners[name] || [])].forEach(fn => fn()); },
    listening() { return Object.values(listeners).reduce((n, s) => n + s.size, 0); } };
  Object.defineProperty(player, 'currentTime', { get() { return player.seeks.at(-1) ?? 0; }, set(v) { player.seeks.push(v); } });
  return player;
}
test('playback length waits for the end-seek instead of trusting a part-way length', async () => {
  const player = fakePlayer(), pending = Recorder.resolveDuration(player, { setTimer: () => 1, clearTimer() {} });
  player.duration = Infinity; player.emit('loadedmetadata');
  assert.equal(player.seeks[0], 1e101);
  // A browser may report the first second before it has scanned the file.
  player.duration = 1; player.emit('durationchange');
  assert.equal(player.seeks.length, 1, 'must not stop at the part-way one-second length');
  player.duration = 34.7; player.emit('durationchange'); player.emit('seeked');
  assert.equal(await pending, 34.7);
  assert.equal(player.seeks.at(-1), 0); assert.equal(player.listening(), 0);
});
test('playback length: already known, and unknown after the time limit', async () => {
  const known = fakePlayer(); known.duration = 12; known.readyState = 1;
  assert.equal(await Recorder.resolveDuration(known, { setTimer: () => 1, clearTimer() {} }), 12);
  assert.equal(known.seeks.length, 0);
  let expire; const stuck = fakePlayer(), pending = Recorder.resolveDuration(stuck, { setTimer: fn => { expire = fn; return 1; }, clearTimer() {} });
  stuck.duration = Infinity; stuck.emit('loadedmetadata'); expire();
  assert.equal(await pending, null); assert.equal(stuck.seeks.at(-1), 0);
});
test('decoded recording gives its real length and an exact-length WAV copy', async () => {
  const samples = new Float32Array(8000).fill(0.5), buffer = { duration: 1, length: 8000, sampleRate: 8000, numberOfChannels: 1, getChannelData: () => samples };
  class Decoder { async decodeAudioData() { return buffer; } async close() {} }
  const info = await Recorder.inspect(new Blob(['fictional']), { Decoder });
  assert.equal(info.duration, 1);
  const bytes = Buffer.from(await info.toWav().arrayBuffer());
  assert.equal(bytes.length, 44 + 16000); assert.equal(bytes.toString('latin1', 0, 4), 'RIFF'); assert.equal(bytes.toString('latin1', 8, 12), 'WAVE');
  assert.equal(bytes.readUInt32LE(24), 8000); assert.equal(bytes.readUInt32LE(40), 16000); assert.equal(bytes.readInt16LE(44), Math.trunc(0.5 * 0x7fff));
  class Broken { async decodeAudioData() { throw new Error('unsupported'); } async close() {} }
  assert.equal(await Recorder.inspect(new Blob(['fictional']), { Decoder: Broken }), null);
  assert.equal(await Recorder.inspect(new Blob([]), { Decoder }), null);
});
test('Alef-Beis trail and reading tiles are in reading order (Alef first)', () => {
  const Magic = require('../kriah-assessment/magic.js');
  assert.equal(Magic.LETTERS.map(l => l.letter).join(''), 'אבגדהוזחטיכלמנסעפצקרשת');
  assert.deepEqual(Magic.LETTERS.slice(0, 3).map(l => l.name), ['Alef', 'Beis', 'Gimmel']);
  assert.equal(Magic.FINALS.map(l => l.letter).join(''), 'ךםןףץ');
  const words = Magic.passageModel('בָּ גִ שָׁלוֹם', Core);
  assert.deepEqual(words.map(w => w.length), [1, 1, 4]);
  assert.deepEqual(words.flat().map(t => t.index), [0, 1, 2, 3, 4, 5]);
  assert.equal(words[0][0].text.normalize('NFC'), 'בָּ'.normalize('NFC'));
  assert.ok(Magic.CHEERS.includes(Magic.cheer(0)) && Magic.CHEERS.includes(Magic.cheer(0.999)));
  // The page markup must keep Hebrew containers right-to-left.
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '../kriah-assessment/index.html'), 'utf8');
  assert.match(html, /id="trailLetters"[^>]*dir="rtl"/); assert.match(html, /class="letter-garden" dir="rtl"/);
});
