'use strict';
// Chazara AI Practice (#688) — automated tests with fictional data and a fake Whisper.
// Lenient casual-practice rules: (1) the Hebrew roughly matches the pasuk, (2) extra words
// were said after it. Meaning is not judged. These tests verify the decision rules, security
// and limits; they do NOT establish real recognition accuracy (scripts/chazara-ai-audio-eval.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const F = require('./chazara-ai-fixtures.cjs');
const { hebrewCoverage } = require('../backend/functions/chazara-ai/hebrew-match.cjs');
const { analyzePcm, classifyAudio } = require('../backend/functions/chazara-ai/audio-signal.cjs');
const { evaluateAttempt } = require('../backend/functions/chazara-ai/pipeline.cjs');
const { decide, THRESHOLDS } = require('../backend/functions/chazara-ai/decide.cjs');
const { createService, cleanAssignment } = require('../backend/functions/chazara-ai/service.cjs');
const { createHandler } = require('../backend/functions/chazara-ai/http.cjs');
const { whisperRecognizer, cleanTranscript, WHISPER_MODEL } = require('../backend/functions/chazara-ai/providers.cjs');

const ROOT = path.resolve(__dirname, '..');
const items = keys => keys.map(k => ({ id: k, label: k, ...F.PESUKIM[k] }));
const run = (keys, specs, opts) => evaluateAttempt({ items: items(keys), segments: specs.map(F.segment), providers: F.fakeProviders(opts) });
const outcome = async (keys, specs, opts) => (await run(keys, specs, opts)).decision;

// What the Hebrew Whisper pass might return: the reading, then the translation.
const ENGLISH_AFTER = 'and Hashem appeared to Avraham by Mamre he was sitting by the tent door when it was hot';
const YIDDISH_AFTER = 'און השם האט זיך באוויזן צו אברהם ביי ממרא ער איז געזעסן ביים טיר פון געצעלט';
const good = (k, after = ENGLISH_AFTER) => ({ heard: F.HEARD[k] + ' ' + after });

// ---------- Hebrew comparison ----------
test('Hebrew matcher: tolerant of spelling/accent, strict about different words', () => {
  const p = F.PESUKIM['18_1'].hebrew;
  assert.equal(hebrewCoverage(p, F.HEARD['18_1']).coverage, 1);
  assert.ok(hebrewCoverage(p, F.HEARD['18_1_minor']).coverage >= 0.9, 'Ashkenazi sav/s and small slips still match');
  assert.ok(hebrewCoverage(p, F.HEARD['18_2']).coverage < THRESHOLDS.reading, 'a different pasuk does not count');
  assert.ok(hebrewCoverage(p, 'אני הולך לבית ספר היום עם אבא שלי').coverage < THRESHOLDS.reading, 'unrelated Hebrew does not count');
  assert.equal(hebrewCoverage(p, '').coverage, 0);
});

test('Hebrew matcher: counts the words said after the reading', () => {
  const p = F.PESUKIM['18_1'].hebrew;
  assert.equal(hebrewCoverage(p, F.HEARD['18_1']).wordsAfterReading, 0);
  assert.equal(hebrewCoverage(p, F.HEARD['18_1'] + ' ' + YIDDISH_AFTER).wordsAfterReading, YIDDISH_AFTER.split(' ').length);
  assert.equal(hebrewCoverage(p, 'blah blah ' + F.HEARD['18_1']).wordsAfterReading, 0, 'words BEFORE the reading are not a translation');
  assert.ok(hebrewCoverage(p, F.HEARD['18_1'].split(' ').reverse().join(' ')).coverage < THRESHOLDS.reading, 'scrambled words are not a reading');
});

// ---------- audio validity ----------
test('audio validity: speech ok, silence, noise and very short are recognised on the server', () => {
  assert.equal(classifyAudio(analyzePcm(F.synth('speech'))), 'ok');
  assert.equal(classifyAudio(analyzePcm(F.synth('silence'))), 'silent');
  assert.equal(classifyAudio(analyzePcm(F.synth('noise'))), 'noisy');
  assert.equal(classifyAudio(analyzePcm(F.synth('short'))), 'too_short');
});

// ---------- scenarios under the lenient rules ----------
test('1. reading + English translation -> Excellent', async () => {
  const d = await outcome(['18_1'], [good('18_1')]);
  assert.equal(d.outcome, 'excellent');
  assert.equal(d.message, 'Excellent job! You read and explained the pasuk beautifully!');
});

test('2. reading with a few minor errors + translation -> Excellent', async () => {
  assert.equal((await outcome(['18_1'], [{ heard: F.HEARD['18_1_minor'] + ' ' + ENGLISH_AFTER }])).outcome, 'excellent');
});

test('3/4. any wording of the translation is accepted (meaning is not judged)', async () => {
  assert.equal((await outcome(['18_1'], [good('18_1', 'G-d showed Himself to Avrohom near Mamre')])).outcome, 'excellent');
  assert.equal((await outcome(['18_1'], [good('18_1', 'Avraham was swimming with camels')])).outcome, 'excellent', 'lenient: a wrong translation still counts as an attempt');
});

test('5. Yiddish translation (heard in Hebrew letters) -> Excellent', async () => {
  assert.equal((await outcome(['18_1'], [good('18_1', YIDDISH_AFTER)])).outcome, 'excellent');
});

test('6. mixed English/Yiddish translation -> Excellent', async () => {
  assert.equal((await outcome(['18_1'], [good('18_1', 'Hashem appeared ער איז געזעסן by the tent')])).outcome, 'excellent');
});

test('7. reading with many mistakes still "roughly matches" -> Excellent when translated', async () => {
  assert.equal((await outcome(['18_1'], [{ heard: F.HEARD['18_1_major'] + ' ' + ENGLISH_AFTER }])).outcome, 'excellent');
});

test('8. reading the wrong pasuk -> Let\'s Try Again', async () => {
  const d = await outcome(['18_1'], [{ heard: F.HEARD['18_2'] + ' he lifted his eyes and saw three men' }]);
  assert.equal(d.outcome, 'try_again');
});

test('10. reading but nothing after it -> Almost There, reminded to explain', async () => {
  const d = await outcome(['18_1'], [{ heard: F.HEARD['18_1'] }]);
  assert.equal(d.outcome, 'almost');
  assert.match(d.tips.join(' '), /what it means/);
  assert.doesNotMatch(d.message, /correct/i);
});

test('10b. one or two words after the reading are not enough for a translation', async () => {
  assert.equal((await outcome(['18_1'], [{ heard: F.HEARD['18_1'] + ' um okay' }])).outcome, 'almost');
});

test('11. translation with no Hebrew reading -> Let\'s Try Again (no reading to come "after")', async () => {
  const d = await outcome(['18_1'], [{ heard: ENGLISH_AFTER }]);
  assert.equal(d.outcome, 'try_again');
  assert.match(d.tips.join(' '), /Hebrew/);
});

test('12. multi-pasuk: one pasuk skipped -> Almost There', async () => {
  const d = await outcome(['18_1', '18_2', '18_3'], [good('18_1'), { signal: 'short' }, good('18_3', 'he said my lords please do not pass by your servant')]);
  assert.equal(d.outcome, 'almost');
  assert.equal(d.reason, 'missing_pasuk');
  assert.deepEqual(d.pesukim.map(p => p.status), ['great', 'practice', 'great']);
});

test('12b. multi-pasuk: every pasuk read and translated -> Excellent', async () => {
  const d = await outcome(['18_1', '18_2'], [good('18_1'), good('18_2', 'he looked up and saw three men')]);
  assert.equal(d.outcome, 'excellent');
});

test('13. unrelated conversation -> Let\'s Try Again', async () => {
  assert.equal((await outcome(['18_1'], [{ heard: 'מה שלומך היום אני רוצה לשחק כדורגל עם החברים שלי' }])).outcome, 'try_again');
});

test('14. gibberish and silly sounds -> Let\'s Try Again', async () => {
  assert.equal((await outcome(['18_1'], [{ heard: 'בלה בלה בום בום לה לה לה' }])).outcome, 'try_again');
});

test('15. silence -> Let\'s Try Again, with a microphone tip', async () => {
  const d = await outcome(['18_1'], [{ signal: 'silence' }]);
  assert.equal(d.outcome, 'try_again');
  assert.equal(d.reason, 'silent');
  assert.match(d.tips.join(' '), /microphone/);
});

test('16. loud background noise -> Couldn\'t Hear Clearly', async () => {
  const d = await outcome(['18_1'], [{ signal: 'noise', ...good('18_1') }]);
  assert.equal(d.outcome, 'unclear');
  assert.equal(d.message, "I couldn't hear you clearly. Please try recording again!");
});

test('17. very short recording -> Let\'s Try Again, without running Whisper', async () => {
  const providers = F.fakeProviders();
  const out = await evaluateAttempt({ items: items(['18_1']), segments: [F.segment({ signal: 'short' })], providers });
  assert.equal(out.decision.outcome, 'try_again');
  assert.equal(out.decision.reason, 'too_short');
  assert.equal(providers.calls.recognize, 0);
});

test('18. clear voice but Whisper heard (almost) nothing -> Couldn\'t Hear Clearly, not blamed', async () => {
  assert.equal((await outcome(['18_1'], [{ heard: '' }])).outcome, 'unclear');
  assert.equal((await outcome(['18_1'], [{ heard: 'אה' }])).outcome, 'unclear');
});

test('a translated pasuk next to a noisy pasuk is never called a mistake', async () => {
  assert.equal((await outcome(['18_1', '18_2'], [good('18_1'), { signal: 'noise' }])).outcome, 'unclear');
});

test('one Hebrew Whisper pass per usable pasuk, nothing else', async () => {
  const providers = F.fakeProviders();
  await evaluateAttempt({ items: items(['18_1', '18_2']), segments: [F.segment(good('18_1')), F.segment(good('18_2'))], providers });
  assert.deepEqual(providers.calls.languages, ['he', 'he']);
});

test('decide: Excellent needs BOTH parts on every pasuk; one part = Almost; none = Try Again', () => {
  const row = (c, after, extra = {}) => ({ id: 'x', label: 'x', audioStatus: 'ok', readingCoverage: c, wordsAfterReading: after, ...extra });
  assert.equal(decide([row(1, 5)]).outcome, 'excellent');
  assert.equal(decide([row(0.31, 3)]).outcome, 'excellent');
  assert.equal(decide([row(1, 2)]).outcome, 'almost');
  assert.equal(decide([row(0.2, 9)]).outcome, 'try_again');
  assert.equal(decide([row(1, 5), row(1, 0)]).outcome, 'almost');
  assert.equal(decide([row(0, 0, { audioStatus: 'silent' }), row(0, 0, { audioStatus: 'too_short' })]).outcome, 'try_again');
  assert.equal(decide([row(1, 5, { audioStatus: 'noisy' })]).outcome, 'unclear');
  for (const d of [decide([row(1, 5)]), decide([row(1, 0)]), decide([row(0, 0)]), decide([row(0, 0, { audioStatus: 'noisy' })])])
    assert.doesNotMatch(JSON.stringify(d), /confidence|transcri|speech recognition|whisper|\bAI\b/i, 'no technical words for children');
});

// ---------- local Whisper provider ----------
test('Whisper provider: free local model, loaded once, Hebrew pass, hallucinations removed', async () => {
  assert.match(WHISPER_MODEL, /whisper/i);
  let loads = 0; const seen = [];
  const recognize = whisperRecognizer({ loadPipeline: async () => { loads++; return async (audio, opts) => { seen.push([audio, opts]); return { text: ' וירא אליו  תודה רבה' }; }; } });
  const pcm = new Int16Array([0, 16384, -32768]);
  const a = await recognize({ pcm, sampleRate: 16000, language: 'he' });
  await recognize({ pcm, sampleRate: 16000, language: 'he' });
  assert.equal(loads, 1, 'model loaded once per instance');
  assert.equal(a.transcript, 'וירא אליו', 'a known silence hallucination is removed');
  assert.equal(seen[0][1].language, 'hebrew');
  assert.equal(seen[0][1].task, 'transcribe');
  assert.ok(seen[0][0] instanceof Float32Array);
  assert.deepEqual(Array.from(seen[0][0]), [0, 0.5, -1]);
  assert.equal(cleanTranscript('Thanks for watching'), '');
  await assert.rejects(recognize({ pcm, sampleRate: 8000, language: 'he' }));
  let fails = 0;
  const flaky = whisperRecognizer({ loadPipeline: async () => { if (fails++ === 0) throw new Error('download failed'); return async () => ({ text: 'ok' }); } });
  await assert.rejects(flaky({ pcm, sampleRate: 16000, language: 'he' }));
  assert.equal((await flaky({ pcm, sampleRate: 16000, language: 'he' })).transcript, 'ok', 'a failed model load is retried next time');
});

test('no paid AI dependency remains in AI Practice', () => {
  for (const dir of ['backend/functions/chazara-ai', 'backend/chazara-ai-staging/chazara-ai']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, dir, f), 'utf8'), /anthropic|@google-cloud\/speech|claude-/i, dir + '/' + f);
  }
  for (const f of ['backend/functions/chazara-ai-practice.js', 'backend/chazara-ai-staging/index.js', 'backend/chazara-ai-staging/package.json', 'chazara/ai-practice-teacher.js'])
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /anthropic|ANTHROPIC_API_KEY|@google-cloud\/speech|kehot|meaning/i, f);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'backend/functions/package.json'), 'utf8'), /@anthropic-ai\/sdk/);
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

test('19a. Whisper failure (model load/out of memory) -> friendly "short break", not counted, retry allowed', async () => {
  const env = setup({ providers: F.fakeProviders({ recognizeFails: true }) });
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

test('19d. a clip over one minute is refused before running Whisper', async () => {
  const env = setup();
  const id = await makeAi(env);
  await assert.rejects(env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: reqId() }, files([{ ...good('18_1'), seconds: 63 }])), e => e.code === 413);
  assert.equal(env.prov.calls.recognize, 0);
  assert.equal(env.store.data.b3Private.chazaraAiPractice.inflight?.stu_a, undefined);
});

test('20. retries work; progress counts attempts; same request replays without re-checking', async () => {
  const env = setup();
  const id = await makeAi(env);
  const first = reqId();
  const r1 = await env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: first }, files([{ heard: F.HEARD['18_1'] }]));
  assert.equal(r1.outcome, 'almost');
  const calls = env.prov.calls.recognize;
  const again = await env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: first }, files([{ heard: F.HEARD['18_1'] }]));
  assert.equal(again.replayed, true);
  assert.equal(env.prov.calls.recognize, calls, 'duplicate request did not run Whisper again');
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
  const r = await env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: reqId(), meaning: 'blah', hebrew: 'בלה', outcome: 'excellent' }, files([{ heard: 'בלה בלה בום' }]));
  assert.equal(r.outcome, 'try_again');
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
  assert.equal(off.prov.calls.decode, 0, 'switched off = no processing at all');
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
  await env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: reqId() }, files([good('18_1')]));
  const report = await env.svc.usageReport({ uid: 'owner', email: 'simcha5770@gmail.com', email_verified: true });
  assert.equal(report.evaluations, 1);
  assert.equal(report.outcomes.excellent, 1);
  assert.ok(report.audioSeconds >= 11, 'audio seconds checked by Whisper are tracked');
  assert.ok(report.estimatedCostPerEvaluationUsd < 0.01, 'compute only, no per-request AI fee');
});

test('privacy: no audio or transcript is stored, and regular Chazara data is never touched', async () => {
  const env = setup();
  const id = await makeAi(env);
  await env.svc.evaluate(STUDENT_A, { assignmentId: id, requestId: reqId() }, files([good('18_1')]));
  const saved = JSON.stringify(env.store.data.b3Private.chazaraAiPractice.progress) + JSON.stringify(env.store.data.b3Private.chazaraAiPractice.inflight) + JSON.stringify(env.store.data.b3Private.chazaraAiPractice.usage);
  assert.doesNotMatch(saved, /וירא|Hashem appeared|transcript|heard|signal/);
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
