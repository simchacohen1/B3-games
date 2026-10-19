'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Static-contract regression tests: no API credentials or student audio required.
// These are NOT a substitute for graded audio/semantic integration tests.
function readTranslationHandler() {
  const source = fs.readFileSync(path.join(__dirname, '../backend/functions/index.js'), 'utf8')
    .replace(/\r\n/g, '\n');
  const start = source.indexOf('exports.gradeTranslationChunk = onRequest(');
  const end = source.indexOf('const FRUM_BIBLICAL_NAME_PRONUNCIATIONS', start);
  assert.ok(start >= 0 && end > start, 'translation handler must exist');
  const handler = source.slice(start, end);
  const promptStart = handler.indexOf('const systemPrompt = `');
  const promptEnd = handler.indexOf('`;\n\n    const userPrompt', promptStart);
  assert.ok(promptStart >= 0 && promptEnd > promptStart, 'system prompt must be present');
  return { handler, prompt: handler.slice(promptStart, promptEnd) };
}

test('translation requires phonetic evidence rather than position or answer hints', () => {
  const { prompt } = readTranslationHandler();
  assert.match(prompt, /Do NOT assume the student said the correct name merely because/);
  assert.match(prompt, /Require positive phonetic evidence/);
  assert.match(prompt, /Name hints or the answer key cannot prove/);
  assert.doesNotMatch(prompt, /If a word in the student's answer sits in the same spot as a name.*assume/);
});
test('distinct valid translations are independent, without mixing incomplete sources', () => {
  const { prompt } = readTranslationHandler();
  assert.match(prompt, /independent valid interpretation ONLY/);
  assert.match(prompt, /Never splice unrelated words from multiple sources/);
  assert.match(prompt, /corresponding to the exact Hebrew chunk/);
});
test('grammar and referents are required even when general story meaning matches', () => {
  const { prompt } = readTranslationHandler();
  assert.match(prompt, /pronouns replaced with names/);
  assert.match(prompt, /tense, singular\/plural, negation/);
  assert.match(prompt, /Never accept a vague thematic similarity/);
});
test('translation grading preserves explicit correct/incorrect response contract', () => {
  const { handler } = readTranslationHandler();
  assert.match(handler, /\["correct", "incorrect"\]\.includes\(parsed\.verdict\)/);
  assert.match(handler, /verdict: parsed\.verdict/);
});
test('speech recognition failures do not return an incorrect grade', () => {
  const { handler } = readTranslationHandler();
  assert.match(handler, /status\(502\)\.json\(\{ error: "Could not understand the recording/);
  assert.match(handler, /verdict: "no_speech"/);
});
test('proposed model response is parsed and checked before returning a score', () => {
  const { handler } = readTranslationHandler();
  assert.match(handler, /JSON\.parse\(cleaned\)/);
  assert.match(handler, /Unexpected grading result/);
});
