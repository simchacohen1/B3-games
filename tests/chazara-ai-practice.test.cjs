'use strict';
// Chazara AI Practice (#688) — automated tests with fictional data and a fake transcriber.
// Simple, lenient two-step check: (1) instant in-browser silence check, (2) OpenAI
// transcription must contain real words. No meaning check, no comparison with the pasuk.
// These tests verify the rules, security and limits — not real transcription quality.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const F = require('./chazara-ai-fixtures.cjs');
const Check = require('../chazara/ai-practice-check.js');
const { checkTranscript } = require('../backend/functions/chazara-ai/transcript-check.cjs');
const { evaluateAttempt } = require('../backend/functions/chazara-ai/pipeline.cjs');
const { decide } = require('../backend/functions/chazara-ai/decide.cjs');
const { createService, cleanAssignment } = require('../backend/functions/chazara-ai/service.cjs');
const { createHandler } = require('../backend/functions/chazara-ai/http.cjs');
const { openaiTranscriber, extFor, TRANSCRIBE_MODEL } = require('../backend/functions/chazara-ai/providers.cjs');

const ROOT = path.resolve(__dirname, '..');
const items = keys => keys.map(k => ({ id: k, label: k }));
const clip = spec => ({ buffer: F.segment(spec), mimeType: 'audio/webm;codecs=opus', durationMs: 20000 });
const run = (keys, specs, opts) => evaluateAttempt({ items: items(keys), clips: specs.map(clip), providers: F.fakeProviders(opts) });
const outcome = async (keys, specs, opts) => (await run(keys, specs, opts)).decision;

const READ_AND_EXPLAIN = F.HEARD['18_1'] + ' and Hashem appeared to Avraham by Mamre he was sitting by the tent door';
const good = () => ({ text: READ_AND_EXPLAIN });

// ---------- step 1: instant silence check (runs in the browser, nothing uploaded) ----------
const measured = (kind, seconds = 12) => ({ durationMs: seconds * 1000, ...Check.measure(F.framesFrom(F.synth(kind, seconds))) });

test('silence check: speech passes; silence and a quiet room are stopped instantly', () => {
  assert.deepEqual(Check.assess(measured('speech')), { ok: true, reason: null });
  assert.equal(Check.assess(measured('silence')).reason, 'too_quiet');
  assert.equal(Check.assess({ durationMs: 12000, peakRms: 0.2, voicedMs: 200 }).reason, 'too_quiet', 'a click or a cough alone is not a try');
  assert.equal(Check.assess(measured('short')).ok, true, 'a brief burst of real sound goes on to be transcribed (lean toward passing)');
});

test('silence check: very short recordings are stopped instantly', () => {
  assert.equal(Check.assess(measured('speech', 1.5)).reason, 'too_short');
  assert.equal(Check.assess({ durationMs: 0 }).reason, 'too_short');
  assert.equal(Check.assess(null).reason, 'too_short');
});

test('silence check leans toward passing: noise, quiet voices and missing measurements go on', () => {
  assert.equal(Check.assess(measured('noise')).ok, true, 'loud noise is not silence — the transcription step decides');
  assert.equal(Check.assess({ durationMs: 8000, peakRms: 0.02, voicedMs: 500 }).ok, true, 'a soft voice with half a second of sound passes');
  assert.equal(Check.assess({ durationMs: 8000, measured: false }).ok, true, 'never block a child because the level could not be measured');
});

test('silence check message is the gentle "Couldn\'t Hear Clearly" outcome', () => {
  assert.equal(Check.MESSAGE.outcome, 'unclear');
  assert.equal(Check.MESSAGE.title, "Couldn't Hear Clearly");
  assert.equal(Check.MESSAGE.message, "I couldn't hear you — try again!");
});

// ---------- step 2: real words in the transcription ----------
test('real words pass in any language or script — meaning and the pasuk are not checked', () => {
  for (const t of [READ_AND_EXPLAIN, F.HEARD['18_1'], 'Hashem appeared to Avraham', 'און ער איז געזעסן', 'vayera elav hashem',
    'Avraham was swimming with camels', 'dog', 'and he', 'I want to play soccer'])
    assert.equal(checkTranscript(t).passes, true, t);
});

test('empty, filler sounds, repeated syllables and recognizer inventions fail', () => {
  for (const t of ['', '   ', '...', '[Music]', '(silence)', '♪ ♪', 'Thank you.', 'Thanks for watching!', 'תודה רבה',
    'um uh hmm', 'la la la la', 'blah blah boing boing', 'bababa', 'lalala', 'אה אה', 'ha ha ha', 'ab'])
    assert.equal(checkTranscript(t).passes, false, JSON.stringify(t));
});

// ---------- results ----------
test('reading + translation (real words) -> Excellent', async () => {
  const d = await outcome(['18_1'], [good()]);
  assert.equal(d.outcome, 'excellent');
  assert.equal(d.message, 'Excellent job! You read and explained the pasuk beautifully!');
});

test('Yiddish, English, mixed, even unrelated real words -> Excellent (lean heavily toward passing)', async () => {
  for (const text of ['און השם האט זיך באוויזן צו אברהם', 'Hashem showed Himself ער איז געזעסן', 'can I go outside now'])
    assert.equal((await outcome(['18_1'], [{ text }])).outcome, 'excellent', text);
});

test('gibberish or empty transcript -> Let\'s Try Again, "I couldn\'t make that out"', async () => {
  for (const text of ['', 'blah blah boing boing', 'la la la la', 'Thank you.']) {
    const d = await outcome(['18_1'], [{ text }]);
    assert.equal(d.outcome, 'try_again', text);
    assert.equal(d.message, "I couldn't make that out — try again.");
  }
});

test('multi-pasuk: all with words -> Excellent; some -> Almost There; none -> Let\'s Try Again', async () => {
  assert.equal((await outcome(['18_1', '18_2', '18_3'], [good(), good(), good()])).outcome, 'excellent');
  const almost = await outcome(['18_1', '18_2', '18_3'], [good(), { text: 'la la la' }, good()]);
  assert.equal(almost.outcome, 'almost');
  assert.deepEqual(almost.pesukim.map(p => p.status), ['great', 'practice', 'great']);
  assert.equal((await outcome(['18_1', '18_2'], [{ text: '' }, { text: 'um' }])).outcome, 'try_again');
});

test('messages are gentle and free of technical words', () => {
  for (const d of [decide([{ id: 'a', label: 'a', passes: true }]), decide([{ id: 'a', label: 'a', passes: false }]),
    decide([{ id: 'a', label: 'a', passes: true }, { id: 'b', label: 'b', passes: false }])]) {
    assert.doesNotMatch(JSON.stringify(d), /confidence|transcri|speech recognition|openai|\bAI\b|wrong|fail|bad/i);
  }
});

test('one transcription per pasuk clip, nothing else', async () => {
  const providers = F.fakeProviders();
  await evaluateAttempt({ items: items(['18_1', '18_2']), clips: [clip(good()), clip(good())], providers });
  assert.equal(providers.calls.transcribe, 2);
});

test('audio length for the cost report: provider figure first, else the clamped browser length', async () => {
  const providers = F.fakeProviders();
  const a = await evaluateAttempt({ items: items(['18_1']), clips: [{ ...clip({ text: 'x y', seconds: 31.5 }) }], providers });
  assert.equal(a.usage.audioSeconds, 31.5);
  const b = await evaluateAttempt({ items: items(['18_1', '18_2']), clips: [{ ...clip(good()), durationMs: 999999 }, { ...clip(good()), durationMs: -5 }], providers });
  assert.equal(b.usage.audioSeconds, 60);
});

// ---------- OpenAI provider ----------
test('OpenAI provider: gpt-4o-mini-transcribe, multipart upload, key from the secret, no language forced', async () => {
  assert.equal(TRANSCRIBE_MODEL, 'gpt-4o-mini-transcribe');
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push([url, init]); return { ok: true, json: async () => ({ text: 'וירא אליו', usage: { type: 'duration', seconds: 12 } }) }; };
  const t = openaiTranscriber({ apiKey: () => 'sk-test', fetchImpl });
  const out = await t({ buffer: Buffer.from('abc'), mimeType: 'audio/webm;codecs=opus' });
  assert.deepEqual(out, { text: 'וירא אליו', seconds: 12 });
  const [url, init] = sent[0];
  assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(init.headers.Authorization, 'Bearer sk-test');
  assert.equal(init.body.get('model'), 'gpt-4o-mini-transcribe');
  assert.equal(init.body.get('language'), null);
  assert.equal(init.body.get('file').name, 'pasuk.webm');
  assert.equal(extFor('audio/mp4'), 'mp4'); assert.equal(extFor('audio/ogg;codecs=opus'), 'ogg'); assert.equal(extFor(''), 'webm');
  const bad = openaiTranscriber({ apiKey: () => 'k', fetchImpl: async () => ({ ok: false, status: 400, text: async () => 'Invalid file format' }) });
  await assert.rejects(bad({ buffer: Buffer.from('x'), mimeType: 'audio/webm' }), e => e.code === 'transcribe_failed' && e.status === 400);
});

test('no Anthropic, Google Speech or local model dependency remains', () => {
  for (const dir of ['backend/functions/chazara-ai', 'backend/chazara-ai-staging/chazara-ai'])
    for (const f of fs.readdirSync(path.join(ROOT, dir)))
      assert.doesNotMatch(fs.readFileSync(path.join(ROOT, dir, f), 'utf8'), /anthropic|@google-cloud\/speech|huggingface|whisper/i, dir + '/' + f);
  for (const f of ['backend/functions/package.json', 'backend/chazara-ai-staging/package.json'])
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /@anthropic-ai\/sdk|@huggingface\/transformers/, f);
  assert.match(fs.readFileSync(path.join(ROOT, 'backend/functions/chazara-ai-practice.js'), 'utf8'), /defineSecret\('OPENAI_API_KEY'\)/);
});

// ---------- service: scenarios 19–22 and teacher controls ----------
function setup({ data, providers, now } = {}) {
  const store = F.memoryStore(data || F.baseData());
  let t = now || Date.UTC(2026, 10, 9, 15, 0, 0);
  const clock = { now: () => t, advance: ms => { t += ms; } };
  const prov = providers || F.fakeProviders();
  const svc = createService({ store, providers: prov, now: clock.now });
  return { store, svc, clock, prov };
}
const STUDENT_A = { studentId: 'stu_a', classId: 'class_one' };
const STUDENT_C = { studentId: 'stu_c', classId: 'class_two' };
const files = specs => specs.map(s => ({ buffer: F.segment(s), mimeType: 'audio/webm;codecs=opus' }));
let rid = 0;
const reqId = () => 'request_' + String(++rid).padStart(6, '0');
async function makeAi(env, keys = ['18_1'], mode = 'ai') {
  const r = await env.svc.teacherSave(F.TEACHER, { classId: 'class_one', assignment: F.aiAssignment(keys, mode) });
  return r.id;
}

test('teacher: Regular is the default; AI mode needs only the Hebrew text', async () => {
  const env = setup();
  const r = await env.svc.teacherSave(F.TEACHER, { classId: 'class_one', assignment: { sefer: 'Bereishis', perek: 18, from: 1, to: 1 } });
  assert.equal(r.assignment.mode, 'regular');
  await assert.rejects(env.svc.teacherSave(F.TEACHER, { classId: 'class_one', assignment: { mode: 'ai', perek: 18, from: 1, to: 1, pesukim: {} } }), /Hebrew text/);
  const ok = await env.svc.teacherSave(F.TEACHER, { classId: 'class_one', assignment: { mode: 'ai', perek: 18, from: 1, to: 1, pesukim: { '18_1': { hebrew: F.PESUKIM['18_1'].hebrew, meaning: 'ignored' } } } });
  assert.equal(ok.assignment.pesukim[0].meaning, undefined, 'no meaning field is stored');
  assert.throws(() => cleanAssignment({ mode: 'ai', perek: 18, from: 1, to: 9 }), /up to 6/);
  const list = await env.svc.teacherList(F.TEACHER, { classId: 'class_one' });
  assert.equal(list.assignments.length, 2);
  assert.equal(list.aiEnabled, true);
});

test('teacher: can switch an assignment to AI Practice, edit the Hebrew, and hide it', async () => {
  const env = setup();
  const id = await makeAi(env, ['18_1'], 'regular');
  const a = F.aiAssignment(['18_1'], 'ai');
  a.pesukim['18_1'].hebrew = F.PESUKIM['18_1'].hebrew + ' ';
  await env.svc.teacherSave(F.TEACHER, { classId: 'class_one', assignmentId: id, assignment: a });
  let list = await env.svc.teacherList(F.TEACHER, { classId: 'class_one' });
  assert.equal(list.assignments[0].mode, 'ai');
  assert.equal(list.assignments[0].pesukim[0].hebrew, F.PESUKIM['18_1'].hebrew);
  await env.svc.teacherArchive(F.TEACHER, { classId: 'class_one', assignmentId: id, active: false });
  assert.equal((await env.svc.studentList(STUDENT_A)).assignments.length, 0);
});

test('students see the Hebrew text for every pasuk', async () => {
  const env = setup();
  await makeAi(env, ['18_1', '18_2', '18_3']);
  const list = await env.svc.studentList(STUDENT_A);
  assert.equal(list.assignments[0].pesukim.length, 3);
  assert.ok(list.assignments[0].pesukim.every(p => /[א-ת]/.test(p.hebrew)));
});

test('19a. transcription service down/timeout -> friendly "short break", not counted, retry allowed', async () => {
  const env = setup({ providers: F.fakeProviders({ transcribeFails: true }) });
  const id = await makeAi(env);
  const r = await env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: reqId() }, files([good('18_1')]));
  assert.equal(r.outcome, 'unavailable');
  assert.equal(env.store.data.b3Private.chazaraAiPractice.progress, undefined, 'not counted as an attempt');
  assert.equal(env.store.data.b3Private.chazaraAiPractice.inflight?.stu_a, undefined, 'released so the child can retry');
});

test('19c. interrupted recordings: missing pasuk audio, corrupt audio, empty file', async () => {
  const env = setup();
  const id = await makeAi(env, ['18_1', '18_2']);
  await assert.rejects(env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: reqId() }, files([good('18_1')])), e => e.code === 400);
  await assert.rejects(env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: reqId() }, files([good('18_1'), { corrupt: true }])), e => e.code === 422);
  await assert.rejects(env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: reqId() }, [{ buffer: Buffer.alloc(0), mimeType: 'audio/webm' }, { buffer: Buffer.alloc(0), mimeType: 'audio/webm' }]), e => e.code === 400);
  assert.equal(env.store.data.b3Private.chazaraAiPractice.inflight?.stu_a, undefined, 'a failed upload never locks the student out');
});

test('19d. the browser\'s recording lengths are clamped and used only for the cost report', async () => {
  const env = setup();
  const id = await makeAi(env);
  await env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: reqId(), durations: '[999999]' }, files([good()]));
  assert.equal(env.store.data.b3Private.chazaraAiPractice.usage.months[Object.keys(env.store.data.b3Private.chazaraAiPractice.usage.months)[0]].audioSeconds, 60);
  env.clock.advance(5000);
  const r = await env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: reqId(), durations: 'not json' }, files([good()]));
  assert.equal(r.outcome, 'excellent', 'a bad durations field never blocks the check');
});

test('20. retries work; progress counts attempts; same request replays without re-checking', async () => {
  const env = setup();
  const id = await makeAi(env);
  const first = reqId();
  const r1 = await env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: first }, files([{ text: 'la la la' }]));
  assert.equal(r1.outcome, 'try_again');
  const calls = env.prov.calls.transcribe;
  const again = await env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: first }, files([{ text: 'la la la' }]));
  assert.equal(again.replayed, true);
  assert.equal(env.prov.calls.transcribe, calls, 'duplicate request did not pay for transcription again');
  env.clock.advance(5000);
  const r2 = await env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: reqId() }, files([good('18_1')]));
  assert.equal(r2.outcome, 'excellent');
  const p = env.store.data.b3Private.chazaraAiPractice.progress.class_one[id].stu_a;
  assert.equal(p.attempts, 2);
  assert.equal(p.excellentCount, 1);
  assert.equal(p.lastOutcome, 'excellent');
  const s = await env.svc.studentList(STUDENT_A);
  assert.equal(s.assignments[0].progress.excellent, true);
});

test('21a. cross-class isolation: other class cannot list, edit or practice an assignment', async () => {
  const env = setup();
  const id = await makeAi(env);
  await assert.rejects(env.svc.teacherList(F.OTHER_TEACHER, { classId: 'class_one' }), e => e.code === 403);
  await assert.rejects(env.svc.teacherSave(F.OTHER_TEACHER, { classId: 'class_one', assignmentId: id, assignment: F.aiAssignment() }), e => e.code === 403);
  await assert.rejects(env.svc.teacherArchive(F.OTHER_TEACHER, { classId: 'class_one', assignmentId: id }), e => e.code === 403);
  assert.equal((await env.svc.studentList(STUDENT_C)).assignments.length, 0);
  await assert.rejects(env.svc.evaluate(STUDENT_C, { assignmentId: id, requestId: reqId() }, files([good('18_1')])), e => e.code === 404);
});

test('21b. unauthorized teachers: not Google, unverified, inactive, or class without Chazara', async () => {
  const env = setup();
  const t = F.TEACHER;
  await assert.rejects(env.svc.teacherList({ ...t, firebase: { sign_in_provider: 'custom' } }, { classId: 'class_one' }), e => e.code === 403);
  await assert.rejects(env.svc.teacherList({ ...t, email_verified: false }, { classId: 'class_one' }), e => e.code === 403);
  await assert.rejects(env.svc.teacherList({ uid: 'stranger', email: 'x@example.test', email_verified: true, firebase: { sign_in_provider: 'google.com' } }, { classId: 'class_one' }), e => e.code === 403);
  env.store.data.b3Games.workspaces['b3-2026'].classes.class_one.toolGrants.chazara = false;
  await assert.rejects(env.svc.teacherList(t, { classId: 'class_one' }), /not turned on/);
  await assert.rejects(env.svc.usageReport(t), e => e.code === 403);
});

test('21c. the browser cannot supply the pasuk text or the result', async () => {
  const env = setup();
  const id = await makeAi(env);
  const r = await env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: reqId(), meaning: 'blah', hebrew: 'בלה', outcome: 'excellent' }, files([{ text: 'בלה בלה בום' }]));
  assert.equal(r.outcome, 'try_again', 'the browser cannot claim a result');
  const regularId = await makeAi(env, ['18_1'], 'regular');
  env.clock.advance(5000);
  await assert.rejects(env.svc.evaluate(STUDENT_A, { assignmentId: regularId, requestId: reqId() }, files([good('18_1')])), e => e.code === 404, 'regular assignments are never AI-checked');
});

test('21d. HTTP layer: sign-in, origin, students vs teachers, unknown actions', async () => {
  const store = F.memoryStore(F.baseData());
  const tokens = { teacher: F.TEACHER, student: { uid: 'x', b3StudentId: 'stu_a', b3ClassId: 'class_one', b3StudentRole: 'student' } };
  const read = p => { const v = p.split('/').reduce((o, k) => (o == null ? null : o[k]), store.data); return v === undefined ? null : v; };
  const admin = {
    auth: () => ({ verifyIdToken: async tok => { if (!tokens[tok]) throw new Error('bad'); return tokens[tok]; } }),
    database: () => ({
      ref: p => ({
        once: async () => ({ val: () => read(p) }),
        get: async () => ({ val: () => read(p) }),
        set: async v => store.set(p, v),
        transaction: async fn => { const cur = read(p); const next = fn(cur); if (next !== undefined) await store.set(p, next); return { committed: next !== undefined, snapshot: { val: () => (next === undefined ? cur : next) } }; }
      })
    })
  };
  const handler = createHandler({ admin, allowedOrigin: o => o === 'https://funtorahtools.com', getProviders: () => F.fakeProviders() });
  const call = async (headers, body, method = 'POST') => {
    const res = { headers: {}, code: 200, body: null, set(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; } };
    await handler({ method, headers: { origin: 'https://funtorahtools.com', 'content-type': 'application/json', ...headers }, get(h) { return this.headers[h.toLowerCase()]; }, body }, res);
    return res;
  };
  assert.equal((await call({}, { action: 'studentList' })).code, 401);
  assert.equal((await call({ authorization: 'Bearer nope' }, { action: 'studentList' })).code, 401);
  assert.equal((await call({ authorization: 'Bearer teacher', origin: 'https://evil.example' }, { action: 'teacherList', classId: 'class_one' })).code, 403);
  assert.equal((await call({ authorization: 'Bearer teacher' }, { action: 'teacherList', classId: 'class_one' })).code, 200);
  assert.equal((await call({ authorization: 'Bearer teacher' }, { action: 'deleteEverything' })).code, 400);
  assert.equal((await call({ authorization: 'Bearer student' }, { action: 'teacherList', classId: 'class_one' })).code, 403, 'a student token is not a teacher');
  assert.equal((await call({ authorization: 'Bearer teacher' }, { action: 'studentList' })).code, 401, 'a teacher token is not a student');
  assert.equal((await call({ authorization: 'Bearer student' }, { action: 'studentList' })).code, 200);
  assert.equal((await call({}, null, 'GET')).code, 405);
});

test('22a. per-student daily limit, per-minute limit and the owner switch', async () => {
  const data = F.baseData();
  data.b3Private.chazaraAiPractice.config = { enabled: true, limits: { studentDay: 2, minute: 100 } };
  const env = setup({ data });
  const id = await makeAi(env);
  for (let i = 0; i < 2; i++) { await env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: reqId() }, files([good('18_1')])); env.clock.advance(5000); }
  await assert.rejects(env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: reqId() }, files([good('18_1')])), e => e.code === 429 && /tomorrow/.test(e.message));
  const env2 = setup({ data: { ...F.baseData(), b3Private: { chazaraAiPractice: { config: { enabled: true, limits: { minute: 1 } } } } } });
  const id2 = await makeAi(env2);
  await env2.svc.evaluate(STUDENT_A, { assignmentId: id2, requestId: reqId() }, files([good('18_1')]));
  env2.clock.advance(5000);
  await assert.rejects(env2.svc.evaluate(STUDENT_A, { assignmentId: id2, requestId: reqId() }, files([good('18_1')])), e => e.code === 429);
  const off = setup({ data: { ...F.baseData(), b3Private: { chazaraAiPractice: { config: { enabled: false } } } } });
  const id3 = await makeAi(off);
  await assert.rejects(off.svc.evaluate(STUDENT_A, { assignmentId: id3, requestId: reqId() }, files([good('18_1')])), e => e.code === 503);
  assert.equal(off.prov.calls.transcribe, 0, 'switched off = nothing sent to OpenAI');
});

test('22b. duplicate and overlapping requests: one check at a time, cooldown, size/type limits', async () => {
  const env = setup();
  const id = await makeAi(env);
  env.store.data.b3Private.chazaraAiPractice.inflight = { stu_a: { requestId: 'other_request_1', startedAt: env.clock.now() - 1000 } };
  await assert.rejects(env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: reqId() }, files([good('18_1')])), /Still checking/);
  env.clock.advance(130000); // stale lock expires
  await env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: reqId() }, files([good('18_1')]));
  await assert.rejects(env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: reqId() }, files([good('18_1')])), /One moment/);
  env.clock.advance(5000);
  await assert.rejects(env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: reqId() }, [{ buffer: Buffer.alloc(2 * 1024 * 1024, 1), mimeType: 'audio/webm' }]), e => e.code === 413);
  await assert.rejects(env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: reqId() }, [{ buffer: Buffer.from('x'), mimeType: 'video/mp4' }]), e => e.code === 415);
  await assert.rejects(env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: 'x' }, files([good('18_1')])), e => e.code === 400);
});

test('22c. usage totals give the owner cost and timing per evaluation', async () => {
  const env = setup();
  const id = await makeAi(env);
  await env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: reqId(), durations: '[20000]' }, files([good('18_1')]));
  const report = await env.svc.usageReport({ uid: 'owner', email: 'simcha5770@gmail.com', email_verified: true });
  assert.equal(report.evaluations, 1);
  assert.equal(report.outcomes.excellent, 1);
  assert.equal(report.audioSeconds, 20, 'audio seconds sent for transcription are tracked');
  assert.equal(report.estimatedCostPerEvaluationUsd, 0.001, '20 s at $0.003/min');
});

test('privacy: no audio or transcript is stored, and regular Chazara data is never touched', async () => {
  const env = setup();
  const id = await makeAi(env);
  await env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: reqId() }, files([good('18_1')]));
  const saved = JSON.stringify(env.store.data.b3Private.chazaraAiPractice.progress) + JSON.stringify(env.store.data.b3Private.chazaraAiPractice.inflight) + JSON.stringify(env.store.data.b3Private.chazaraAiPractice.usage);
  assert.doesNotMatch(saved, /וירא|Hashem appeared|transcript|"text"/);
  assert.ok(env.store.touched.every(([, p]) => !p.startsWith('posukPractice') && !p.startsWith('studentRewards')), 'no regular Chazara, events or points paths');
  assert.ok(env.store.touched.filter(([op]) => op !== 'get').every(([, p]) => p.startsWith('b3Private/chazaraAiPractice/')), 'writes stay in the server-only area');
});

// ---------- page integration (static) ----------
test('Chazara pages: AI Practice is added without changing existing recording/points code', () => {
  const html = fs.readFileSync(path.join(ROOT, 'chazara/index.html'), 'utf8');
  const teacher = fs.readFileSync(path.join(ROOT, 'chazara/teacher.html'), 'utf8');
  assert.match(html, /<script src="ai-practice\.js\?v=/);
  assert.match(html, /ai-practice\.css/);
  assert.match(teacher, /<script src="ai-practice-teacher\.js\?v=/);
  assert.match(html, /async function finishRecording\(st\)/, 'regular recorded Chazara still present');
  assert.match(html, /requestPoints\('chazara-recording',eventId\)/);
  const js = fs.readFileSync(path.join(ROOT, 'chazara/ai-practice.js'), 'utf8');
  assert.doesNotMatch(js, /studentRewardsAutoAward|requestPoints|posukPractice\/chazara|storage\(\)/, 'AI Practice requests no points and saves no audio');
  assert.match(js, /dir: 'rtl'/);
  assert.match(js, /prefers-reduced-motion/);
});

test('staging copy of the service matches the production source', () => {
  const { execFileSync } = require('node:child_process');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/sync-chazara-ai-staging.cjs'), '--check']);
  const idx = fs.readFileSync(path.join(ROOT, 'backend/chazara-ai-staging/index.js'), 'utf8');
  assert.match(idx, /may only run in/);
  assert.doesNotMatch(idx, /b3-games\.|'b3-games'/);
});

test('no database rule changes are needed: b3Private stays closed to browsers', () => {
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase-rules.json'), 'utf8')).rules;
  assert.equal(rules.b3Private['.read'], false);
  assert.equal(rules.b3Private['.write'], false);
  assert.equal(rules.b3Private.chazaraAiPractice, undefined);
});
