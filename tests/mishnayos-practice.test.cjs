'use strict';
// Mishnayos Practice (issue #634): the Silverstein translation is the teacher's
// answer key and must never reach a student. These tests check the data files,
// the pure helpers, the student page, and the Cloud Function handlers (with
// Firebase and the AI provider mocked).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const HE = require(path.join(ROOT, 'record-mishnayos/data/berachos.he.json'));
const EN = require(path.join(ROOT, 'backend/functions/data/mishnayos/berachos.en.json'));
const core = require(path.join(ROOT, 'backend/functions/mishnayos-practice-core.cjs'));
const studentHtml = fs.readFileSync(path.join(ROOT, 'record-mishnayos/student.html'), 'utf8');

test('the public Hebrew file has all 9 perakim of Berachos and no English', () => {
  assert.equal(HE.perakim.length, 9);
  assert.equal(HE.perakim.reduce((n, p) => n + p.mishnayos.length, 0), 57);
  const raw = JSON.stringify(HE.perakim);
  assert.ok(!/[A-Za-z]{4,}/.test(raw.replace(/"(mishnah|text|lines|sections|perek|name|mishnayos)"/g, '')),
    'no English words in the public Hebrew data');
  assert.ok(!fs.readdirSync(path.join(ROOT, 'record-mishnayos/data')).some(f => /\.en\./.test(f)),
    'the English answer key is not in the website folder');
});

test('every Mishnah\'s lines and sections cover its whole text exactly', () => {
  HE.perakim.forEach(p => p.mishnayos.forEach(m => {
    assert.equal(m.lines.join(' '), m.text);
    const joined = m.sections.map(([a, b]) => m.lines.slice(a, b).join(' ')).join(' ');
    assert.equal(joined, m.text, `Berachos ${p.perek}:${m.mishnah}`);
    m.sections.forEach(([a, b]) => assert.ok(b > a));
  }));
});

test('server answer key matches the public Hebrew section by section', () => {
  HE.perakim.forEach((p, pi) => p.mishnayos.forEach((m, mi) => {
    const en = EN.perakim[pi].mishnayos[mi];
    assert.ok(en.translation.length > 20, `translation for ${p.perek}:${m.mishnah}`);
    assert.ok(!en.translation.includes('['), 'Bartenura brackets removed from the plain translation');
    assert.deepEqual(en.sections, m.sections.map(([a, b]) => m.lines.slice(a, b).join(' ')));
  }));
});

test('sections are numbered straight through a perek', () => {
  const s = core.resolveSection('berachos', 1, 4);
  assert.equal(s.key, 'Berachos_1_4');
  assert.equal(s.mishnah, 2);
  assert.equal(s.part, 1);
  assert.equal(core.resolveSection('berachos', 1, 999), null);
  assert.equal(core.resolveSection('shabbos', 1, 1), null);
});

test('public views strip the hidden English', () => {
  const levels = [{ chunks: [{ hebrew: 'מֵאֵימָתַי', english: ['From when'] }] }];
  assert.deepEqual(core.publicTranslationLevels(levels), [{ chunks: [{ hebrew: 'מֵאֵימָתַי' }] }]);
  const items = [{ question: 'Q?', expectedAnswer: 'secret', sourceFact: 'secret', answerHebrewPhrases: ['א'], answerWordSets: [[0]] }];
  const pub = core.publicQuestionItems(items)[0];
  assert.equal(pub.expectedAnswer, undefined);
  assert.equal(pub.sourceFact, undefined);
});

test('chunk levels must tile the exact section', () => {
  const s = core.resolveSection('berachos', 1, 4);
  const words = s.hebrew.split(' ');
  const good = [{ chunks: [{ hebrew: words.slice(0, 3).join(' '), english: ['x'] }, { hebrew: words.slice(3).join(' '), english: ['y'] }] },
    { chunks: [{ hebrew: s.hebrew, english: ['z'] }] }];
  assert.ok(core.validTranslationLevels(good, s.hebrew));
  const missing = [{ chunks: [{ hebrew: words.slice(1).join(' '), english: ['x'] }] }];
  assert.ok(!core.validTranslationLevels(missing, s.hebrew));
});

test('feedback that quotes the hidden translation is detected', () => {
  const t = 'From which time may the Shema be recited in the evenings?';
  assert.ok(core.feedbackLeaksTranslation('It means from which time may the Shema be recited.', t));
  assert.ok(!core.feedbackLeaksTranslation('Look again at the first word.', t));
});

test('the student page never fetches Sefaria or sends a translation', () => {
  assert.ok(!/sefaria\.org\/api/.test(studentHtml), 'no live Sefaria calls');
  assert.ok(!/acceptedTranslations/.test(studentHtml), 'chunk English is never sent from the browser');
  assert.ok(!/formData\.append\('posukTranslation'/.test(studentHtml));
  assert.ok(!/posukTranslation:\s*\(part/.test(studentHtml));
  assert.ok(/generateMishnahTranslationChunks/.test(studentHtml));
  assert.ok(/'posukPractice\/mishnayos\/attempts\/'/.test(studentHtml));
  assert.ok(!/'posukPractice\/attempts\//.test(studentHtml), 'Mishnayos never writes Posuk attempts');
});

/* ---------- Cloud Function handlers, with Firebase + AI mocked ---------- */
function loadHandlers({ aiReplies, dbInit = {} }) {
  const dbData = JSON.parse(JSON.stringify(dbInit));
  const get = p => p.split('/').reduce((o, k) => (o == null ? undefined : o[k]), dbData);
  const set = (p, v) => {
    const keys = p.split('/'); const last = keys.pop(); let o = dbData;
    keys.forEach(k => { o = o[k] ??= {}; }); o[last] = JSON.parse(JSON.stringify(v));
  };
  const fakeAdmin = { apps: [1], initializeApp() {}, database: () => ({ ref: p => ({ get: async () => ({ val: () => get(p) ?? null }), set: async v => set(p, v) }) }) };
  const replies = [...aiReplies];
  const prompts = [];
  global.fetch = async (url, opts) => {
    prompts.push(JSON.parse(opts.body));
    const value = replies.shift();
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(value) }] }) };
  };
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'firebase-admin') return fakeAdmin;
    if (request === 'firebase-functions/v2/https') return { onRequest: (_, h) => h };
    if (request === './paid-api') return { paidHandler: (_, __, h) => h, ALLOWED_ORIGINS: [] };
    return origLoad.apply(this, arguments);
  };
  const modPath = path.join(ROOT, 'backend/functions/mishnayos-practice.js');
  delete require.cache[modPath];
  let factory;
  try { factory = require(modPath); } finally { Module._load = origLoad; }
  const handlers = factory({
    ANTHROPIC_API_KEY: { value: () => 'test' }, setCors() {},
    parseMultipart: async req => req.multipart,
    transcribeAudio: async (_b, _f, _e, opts) => opts && opts.nameAware ? { transcript: req0.said, segments: [], nameHints: [] } : req0.said
  });
  const req0 = { said: '' };
  return { handlers, dbData, prompts, req0 };
}
function call(handler, req) {
  return new Promise(resolve => {
    const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(v) { this.value = v; resolve(this); return this; }, send() { resolve(this); return this; }, set() {} };
    Promise.resolve(handler({ method: 'POST', headers: {}, ...req }, res));
  });
}

test('chunk generation returns Hebrew only and keeps the English in the teacher answer key', async () => {
  const s = core.resolveSection('berachos', 1, 4);
  const w = s.hebrew.split(' ');
  const levels = [{ chunks: [{ hebrew: w.slice(0, 4).join(' '), english: ['SECRET ONE'] }, { hebrew: w.slice(4).join(' '), english: ['SECRET TWO'] }] },
    { chunks: [{ hebrew: s.hebrew, english: ['SECRET ALL'] }] }];
  const { handlers, dbData, prompts } = loadHandlers({ aiReplies: [{ levels }] });
  const res = await call(handlers.generateMishnahTranslationChunks, { body: { maseches: 'berachos', perek: 1, section: 4 } });
  assert.equal(res.statusCode, 200);
  assert.ok(!JSON.stringify(res.value).includes('SECRET'), 'student response has no English');
  assert.ok(prompts[0].messages[0].content.includes(s.translation.slice(0, 30)), 'AI is grounded in Silverstein');
  const pub = dbData.posukPractice.mishnayos.translationChunks.Berachos_1_4;
  assert.ok(!JSON.stringify(pub).includes('SECRET'));
  assert.ok(JSON.stringify(dbData.posukPractice.mishnayos.answerKey.translationChunks.Berachos_1_4).includes('SECRET ONE'));
});

test('question generation hides expected answers from students', async () => {
  const s = core.resolveSection('berachos', 1, 1);
  const phrase = s.hebrew.split(' ').slice(0, 1).join(' ');
  const { handlers, dbData } = loadHandlers({ aiReplies: [{ items: [{ question: 'When may Shema be said?', expectedAnswer: 'SECRET ANSWER', sourceFact: 'SECRET FACT', answerHebrewPhrases: [phrase] }] }] });
  const res = await call(handlers.generateMishnahQuestions, { body: { maseches: 'berachos', perek: 1, section: 1 } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.value.items.length, 1);
  assert.deepEqual(res.value.items[0].answerWordSets, [[0]]);
  assert.ok(!JSON.stringify(res.value).includes('SECRET'));
  assert.ok(!JSON.stringify(dbData.posukPractice.mishnayos.generatedQuestions).includes('SECRET'));
  assert.ok(JSON.stringify(dbData.posukPractice.mishnayos.answerKey.generatedQuestions).includes('SECRET ANSWER'));
});

test('a failed question generation is a 422 so the page uses its fallback question', async () => {
  const { handlers } = loadHandlers({ aiReplies: [{ items: [{ question: 'Q?', expectedAnswer: 'a', sourceFact: 'f', answerHebrewPhrases: ['לא בפסוק'] }] }] });
  const res = await call(handlers.generateMishnahQuestions, { body: { maseches: 'berachos', perek: 1, section: 1 } });
  assert.equal(res.statusCode, 422);
});

test('grading replaces feedback that would reveal the hidden translation', async () => {
  const s = core.resolveSection('berachos', 1, 1);
  const leaking = 'It means: ' + s.translation.split(' ').slice(0, 10).join(' ');
  const { handlers } = loadHandlers({ aiReplies: [{ verdict: 'incorrect', feedback: leaking, answerHebrewPhrases: [] }] });
  const res = await call(handlers.gradeMishnahQuestionAnswer, { body: { maseches: 'berachos', perek: 1, section: 1, question: 'Who?', selectionIndices: [0] } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.value.verdict, 'incorrect');
  assert.ok(!res.value.feedback.includes(s.translation.split(' ').slice(0, 6).join(' ')));
});

test('a translation piece is graded against the server answer key, not the request', async () => {
  const s = core.resolveSection('berachos', 1, 4);
  const w = s.hebrew.split(' ');
  const levels = [{ chunks: [{ hebrew: w.slice(0, 4).join(' '), english: ['KEYED ANSWER'] }, { hebrew: w.slice(4).join(' '), english: ['b'] }] },
    { chunks: [{ hebrew: s.hebrew, english: ['c'] }] }];
  const { handlers, prompts, req0 } = loadHandlers({
    aiReplies: [{ verdict: 'correct', feedback: 'You got it!' }],
    dbInit: { posukPractice: { mishnayos: { answerKey: { translationChunks: { Berachos_1_4: { version: 'c_v1', levels } } } } } }
  });
  req0.said = 'whatever he said';
  const res = await call(handlers.gradeMishnahTranslationChunk, { multipart: {
    fields: { maseches: 'berachos', perek: '1', section: '4', chunkHebrew: w.slice(0, 4).join(' '), levelIndex: '0', chunkIndex: '0', acceptedTranslations: '["FAKE"]' },
    audioBuffer: Buffer.from('x'), audioFilename: 'a.webm' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.value.verdict, 'correct');
  assert.ok(prompts[0].messages[0].content.includes('KEYED ANSWER'));
  assert.ok(!prompts[0].messages[0].content.includes('FAKE'), 'browser-sent answers are ignored');
});
