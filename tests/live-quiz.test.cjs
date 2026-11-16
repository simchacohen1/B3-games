'use strict';
// Live Quiz engine tests. Run: node --test tests/live-quiz.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Q = require('../live-quiz/engine.js');
const T = require('../live-quiz/transport.js');
const classic = require('../live-quiz/modes/classic.js');

const settle = () => new Promise(r => setImmediate(r));

function fakeClock() {
  const c = { t: 1000000, timers: [], nextId: 1 };
  c.now = () => c.t;
  c.timers_api = {
    set(fn, ms) { const id = c.nextId++; c.timers.push({ id, at: c.t + ms, fn }); return id; },
    clear(id) { c.timers = c.timers.filter(x => x.id !== id); }
  };
  c.advance = async (ms) => {
    const end = c.t + ms;
    for (;;) {
      c.timers.sort((a, b) => a.at - b.at);
      const nxt = c.timers[0];
      if (!nxt || nxt.at > end) break;
      c.timers.shift(); c.t = nxt.at; nxt.fn(); await settle();
    }
    c.t = end; await settle();
  };
  return c;
}

const QUIZ = {
  title: 'Test', timeLimitSec: 20,
  questions: [
    { q: 'Who built the Teivah?', choices: ['Adam', 'Noach', 'Avraham', 'Moshe'], answer: 1 },
    { q: 'מי היה האדם הראשון?', choices: ['אדם', 'נח', 'אברהם', 'משה'], answer: 0, time: 10 },
    { q: 'How many days of creation?', choices: ['5', '6', '7', '8'], answer: 1 }
  ]
};

async function setup(quiz = QUIZ) {
  const clock = fakeClock();
  const hub = T.createHub({ clock: clock.now });
  const mk = () => T.createMemoryTransport(hub);
  const host = Q.createHost({ transport: mk(), quiz, pin: '123456', timers: clock.timers_api });
  await host.open(); await settle();
  const join = async (id, name) => {
    const p = Q.createPlayer({ transport: mk(), pin: '123456', id });
    await p.join(name); await settle();
    return p;
  };
  return { clock, hub, host, join };
}

test('classic mode is registered', () => {
  assert.ok(Q.listModes().includes('classic'));
  assert.equal(Q.getMode('classic'), classic);
  assert.throws(() => Q.getMode('nope'));
});

test('a new mode can be plugged in without changing the engine', () => {
  Q.registerMode({
    id: 'dummy', initPlayer: () => ({ score: 0 }),
    scoreAnswer: (c) => ({ correct: c.choice === c.question.answer, gain: 1, next: { score: c.prev.score + 1 } })
  });
  assert.ok(Q.listModes().includes('dummy'));
  assert.throws(() => Q.registerMode({ id: 'bad' }));
});

test('classic scoring: speed, streak, reset', () => {
  const q = { answer: 2 };
  let rec = classic.initPlayer();
  let r = classic.scoreAnswer({ question: q, choice: 2, elapsedMs: 0, limitMs: 20000, prev: rec });
  assert.equal(r.gain, 1000); rec = r.next;
  r = classic.scoreAnswer({ question: q, choice: 2, elapsedMs: 20000, limitMs: 20000, prev: rec });
  assert.equal(r.gain, 500 + 100); assert.equal(r.next.streak, 2); rec = r.next;
  r = classic.scoreAnswer({ question: q, choice: 2, elapsedMs: 10000, limitMs: 20000, prev: rec });
  assert.equal(r.gain, 750 + 200); rec = r.next;
  r = classic.scoreAnswer({ question: q, choice: 1, elapsedMs: 100, limitMs: 20000, prev: rec });
  assert.equal(r.correct, false); assert.equal(r.gain, 0); assert.equal(r.next.streak, 0);
  assert.equal(r.next.score, 1000 + 600 + 950);
  r = classic.scoreAnswer({ question: q, choice: null, elapsedMs: 20000, limitMs: 20000, prev: rec });
  assert.equal(r.gain, 0);
});

test('streak bonus is capped at +500', () => {
  let rec = classic.initPlayer(), last;
  for (let i = 0; i < 12; i++) {
    last = classic.scoreAnswer({ question: { answer: 0 }, choice: 0, elapsedMs: 0, limitMs: 1000, prev: rec });
    rec = last.next;
  }
  assert.equal(last.gain, 1500);
});

test('quiz validation catches mistakes', () => {
  assert.ok(Q.validateQuiz(QUIZ).ok);
  assert.ok(!Q.validateQuiz({}).ok);
  assert.ok(!Q.validateQuiz({ questions: [{ q: 'x', choices: ['a'], answer: 0 }] }).ok);
  assert.ok(!Q.validateQuiz({ questions: [{ q: 'x', choices: ['a', 'b'], answer: 5 }] }).ok);
  assert.ok(!Q.validateQuiz({ questions: [{ q: 'x', choices: ['a', 'b'], answer: 0, time: 1 }] }).ok);
  assert.ok(Q.validateQuiz({ questions: [{ q: 'T/F', choices: ['True', 'False'], answer: 0 }] }).ok);
});

test('the sample question file is valid', () => {
  const quiz = JSON.parse(fs.readFileSync(path.join(__dirname, '../live-quiz/questions/sample.json'), 'utf8'));
  const r = Q.validateQuiz(quiz);
  assert.deepEqual(r.errors, []);
});

test('pin is 6 digits; names are cleaned and made unique', () => {
  for (let i = 0; i < 50; i++) assert.match(Q.generatePin(), /^[1-9]\d{5}$/);
  assert.equal(Q.cleanName('  Dov   <b>Ber</b> '), 'Dov bBerb');
  assert.ok(!/[<>]/.test(Q.cleanName('<script>')));
  assert.equal(Q.cleanName('   '), '');
  assert.equal(Q.cleanName('x'.repeat(40)).length, Q.MAX_NAME);
  assert.equal(Q.cleanName('שמעון'), 'שמעון');
  assert.equal(Q.uniqueName('Dov', ['dov']), 'Dov 2');
  assert.equal(Q.uniqueName('Dov', ['Dov', 'Dov 2']), 'Dov 3');
});

test('full game: join, answer, reveal, leaderboard, podium', async () => {
  const { clock, host, join } = await setup();
  const a = await join('a', 'Avi'), b = await join('b', 'Binyomin'), c = await join('c', 'Chaim');
  assert.equal(host.snapshot().playerCount, 3);
  assert.equal(host.snapshot().phase, 'lobby');

  await host.start(); await settle();
  assert.equal(host.snapshot().phase, 'question');
  assert.equal(a.snapshot().phase, 'question');
  assert.equal(a.snapshot().question.prompt, 'Who built the Teivah?');
  assert.equal(a.snapshot().question.answer, undefined, 'correct answer must not reach players early');

  await clock.advance(2000); await a.answer(1);    // fast and right
  await clock.advance(8000); await b.answer(1);    // slower and right
  await settle();
  assert.equal(host.snapshot().answeredCount, 2);
  await clock.advance(5000); await c.answer(0);    // wrong; now everyone answered, ends early
  await settle();

  let s = host.snapshot();
  assert.equal(s.phase, 'reveal');
  assert.deepEqual(s.reveal.counts, [1, 2, 0, 0]);
  assert.equal(s.reveal.correct, 1);
  assert.equal(s.scores.a.score, 950);
  assert.equal(s.scores.b.score, 750);
  assert.equal(s.scores.c.score, 0);
  assert.equal(a.snapshot().result.c, 1);
  assert.equal(c.snapshot().result.c, 0);
  assert.equal(a.snapshot().rank, 1);
  assert.equal(b.snapshot().rank, 2);
  assert.equal(c.snapshot().rank, 3);

  await host.next(); await settle();
  assert.equal(host.snapshot().phase, 'leaderboard');
  assert.equal(host.snapshot().leaderboard[0].name, 'Avi');

  await host.next(); await settle();                // question 2 (10 second limit)
  assert.equal(host.snapshot().limitMs, 10000);
  await a.answer(0); await clock.advance(11000);    // timer ends the question; b and c did not answer
  s = host.snapshot();
  assert.equal(s.phase, 'reveal');
  assert.equal(s.scores.a.streak, 2);
  assert.equal(s.scores.b.streak, 0);
  assert.equal(b.snapshot().result.ch, -1);

  await host.next(); await host.next(); await settle();   // leaderboard -> question 3
  await b.answer(1); await a.answer(3); await c.answer(1);
  await settle();
  assert.equal(host.snapshot().phase, 'reveal');
  await host.next(); await settle();
  assert.equal(host.snapshot().phase, 'podium');
  assert.equal(c.snapshot().phase, 'podium');
  const board = host.snapshot().leaderboard;
  assert.equal(board.length, 3);
  assert.ok(board[0].score >= board[1].score && board[1].score >= board[2].score);
});

test('a player can answer only once per question', async () => {
  const { host, join } = await setup();
  const a = await join('a', 'Avi'); await join('b', 'Binyomin');
  await host.start(); await settle();
  assert.equal(await a.answer(1), true);
  assert.equal(await a.answer(2), false);
  await settle();
  const { counts } = (await (async () => { await host.endQuestion(); await settle(); return host.snapshot().reveal; })());
  assert.deepEqual(counts, [0, 1, 0, 0]);
});

test('answers after the time limit are ignored', async () => {
  const { clock, host, join } = await setup();
  const a = await join('a', 'Avi'); await join('b', 'Binyomin');
  await host.start(); await settle();
  clock.t += 20000 + Q.LATE_GRACE_MS + 500;       // far past the end, but the host timer has not fired yet
  await a.answer(1); await settle();
  await host.endQuestion(); await settle();
  assert.equal(host.snapshot().scores.a.score, 0);
});

test('duplicate names get a number; reload keeps the same player', async () => {
  const { host, join } = await setup();
  await join('a', 'Avi');
  const second = await join('b', 'Avi');
  assert.equal(second.snapshot().name, 'Avi 2');
  const again = await join('a', 'Something else');
  assert.equal(again.snapshot().name, 'Avi');
  assert.equal(host.snapshot().playerCount, 2);
});

test('joining a missing game or with no name fails', async () => {
  const { hub } = await setup();
  const p = Q.createPlayer({ transport: T.createMemoryTransport(hub), pin: '999999', id: 'z' });
  await assert.rejects(p.join('Avi'), /no-game/);
  const p2 = Q.createPlayer({ transport: T.createMemoryTransport(hub), pin: '123456', id: 'y' });
  await assert.rejects(p2.join('   '), /bad-name/);
});

test('start does nothing with no players; late joiners can still join', async () => {
  const { host, join } = await setup();
  await host.start(); await settle();
  assert.equal(host.snapshot().phase, 'lobby');
  const a = await join('a', 'Avi');
  await host.start(); await settle();
  const late = await join('l', 'Late'); await settle();
  assert.equal(late.snapshot().phase, 'question');
  assert.equal(host.snapshot().playerCount, 2);
  assert.equal(a.snapshot().phase, 'question');
});

test('closing a game removes it from the database', async () => {
  const { hub, host } = await setup();
  assert.ok(hub.read('games/123456'));
  await host.close();
  assert.equal(hub.read('games/123456'), null);
});

test('the memory database replaces the server-time marker', async () => {
  const hub = T.createHub({ clock: () => 42 });
  const t = T.createMemoryTransport(hub);
  await t.set('x/y', { at: Q.SV });
  assert.equal((await t.get('x/y')).at, 42);
  await t.set('x/y', null);
  assert.equal(hub.read('x'), null);
});

test('safety: pages never use innerHTML with game data and live in their own database folder', () => {
  const dir = path.join(__dirname, '../live-quiz');
  for (const f of ['host.js', 'player.js', 'ui.js']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/\.innerHTML\s*=/.test(src), f + ' must not assign innerHTML');
  }
  const cfg = fs.readFileSync(path.join(dir, 'config.js'), 'utf8');
  assert.match(cfg, /liveQuizTest/);
});
