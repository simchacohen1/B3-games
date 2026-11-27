'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const core = require('../backend/functions/shorashim-words-core.cjs');
const { toolForSource } = require('../backend/functions/student-practice-auth.cjs');

function memoryStore() {
  const data = {};
  const get = async p => (p in data ? JSON.parse(JSON.stringify(data[p])) : null);
  const tx = async (p, fn) => { const next = fn(p in data ? JSON.parse(JSON.stringify(data[p])) : null); if (next === undefined) return { committed: false }; data[p] = next; return { committed: true }; };
  return { data, get, tx };
}
const awarder = (paid = []) => async ({ requestId, point }) => {
  const already = paid.some(r => r.requestId === requestId);
  if (!already) paid.push({ requestId, point });
  return { ok: true, newlyAwarded: !already, amount: 1 };
};
const T0 = Date.parse('2026-11-25T14:00:00Z');
const S = 1000;

test('100 words pay 1 point, progress shows words toward the next point', async () => {
  const store = memoryStore(), paid = [];
  let t = T0, r;
  for (let i = 0; i < 6; i++) { t += 60 * S; r = await core.report({ store, award: awarder(paid), studentId: 'a', words: 16, batchId: 'b' + i, nowMs: t }); }
  assert.equal(r.words, 96); assert.equal(r.points, 0); assert.equal(r.intoNextPoint, 96); assert.equal(paid.length, 0);
  t += 60 * S; r = await core.report({ store, award: awarder(paid), studentId: 'a', words: 8, batchId: 'b9', nowMs: t });
  assert.equal(r.words, 104); assert.equal(r.points, 1); assert.equal(r.intoNextPoint, 4); assert.equal(paid.length, 1);
});
test('a replayed batch id is not counted twice', async () => {
  const store = memoryStore(); let r;
  await core.report({ store, award: awarder(), studentId: 'a', words: 20, batchId: 'same', nowMs: T0 });
  r = await core.report({ store, award: awarder(), studentId: 'a', words: 20, batchId: 'same', nowMs: T0 + 60 * S });
  assert.equal(r.words, 20); assert.equal(r.accepted, 0);
});
test('fast flipping cannot jump ahead: a batch is limited by real time', async () => {
  const store = memoryStore();
  await core.report({ store, award: awarder(), studentId: 'a', words: 1, batchId: 'x', nowMs: T0 });
  const r = await core.report({ store, award: awarder(), studentId: 'a', words: 100, batchId: 'y', nowMs: T0 + 2 * S });
  assert.ok(r.words <= 1 + 2 * 2 + 5, 'only ' + r.words);
  assert.equal(r.points, 0);
});
test('never more than 10 points a day, each point paid once', async () => {
  const store = memoryStore(), paid = []; let t = T0, r;
  for (let i = 0; i < 40; i++) { t += 300 * S; r = await core.report({ store, award: awarder(paid), studentId: 'a', words: 100, batchId: 'c' + i, nowMs: t }); }
  assert.equal(r.points, 10); assert.equal(r.words, 1000); assert.equal(r.intoNextPoint, 0); assert.equal(paid.length, 10);
  assert.equal(new Set(paid.map(p => p.requestId)).size, 10);
});
test('bad input, off switch and read-only status', async () => {
  const store = memoryStore();
  assert.equal((await core.report({ store, award: awarder(), studentId: 'a', words: -3, nowMs: T0 })).ok, false);
  assert.equal((await core.report({ store, award: awarder(), studentId: 'a', words: 101, nowMs: T0 })).ok, false);
  assert.equal((await core.report({ store, award: awarder(), studentId: 'a', words: 20, enabled: false, nowMs: T0 })).paused, true);
  const s = await core.report({ store, award: awarder(), studentId: 'a', nowMs: T0 });
  assert.equal(s.words, 0); assert.equal(s.maxPoints, 10);
});
test('the source maps to the Shorashim tool and both function copies are wired and identical', () => {
  assert.equal(toolForSource(core.SOURCE), 'shorashim');
  for (const dir of ['functions', 'functions-staging']) {
    const src = fs.readFileSync(`backend/${dir}/student-rewards-auto-award.js`, 'utf8');
    assert.match(src, /shorashim-words-report/); assert.match(src, /shorashim-words-core\.cjs/);
  }
  assert.equal(fs.readFileSync('backend/functions/shorashim-words-core.cjs', 'utf8'), fs.readFileSync('backend/functions-staging/shorashim-words-core.cjs', 'utf8'));
});
