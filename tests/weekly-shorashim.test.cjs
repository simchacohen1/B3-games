'use strict';

// Weekly Shorashim (staging): word data, grade / week rules, game questions, saved progress, and scope checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const root = path.join(__dirname, '..');
const Data = require('../weekly-shorashim/data.js');
const L = require('../weekly-shorashim/logic.js');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const at = (y, m, d, h = 12) => {
  // A moment given as US Eastern wall-clock time.
  const guess = Date.UTC(y, m - 1, d, h + 5);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(guess));
  return guess - ((hour - h + 24) % 24) * 3600000;
};

test('word data is an exact copy of the source: 30 weeks, 360 words, grades 2-6, Quizlet links', () => {
  // Hash of JSON.stringify(SHOROSHIM_WEEKS) taken from rabbimkosofsky-droid/school-games src/data/shoroshim.js.
  const hash = crypto.createHash('sha256').update(JSON.stringify(Data.WEEKS)).digest('hex');
  assert.equal(hash, '4e1468b2e646589fcff0a7098320cfa4d3d12a625073a281a55e088f8461f27c');
  assert.equal(Data.WEEKS.length, 30);
  assert.deepEqual(Data.WEEKS.map(w => w.week), Array.from({ length: 30 }, (_, i) => i + 1));
  const words = Data.WEEKS.flatMap(w => w.words);
  assert.equal(words.length, 360);
  assert.equal(new Set(words.map(w => w.id)).size, 360);
  assert.deepEqual([...new Set(words.map(w => w.grade))].sort(), [2, 3, 4, 5, 6]);
  assert.ok(words.every(w => L.WORD_ID.test(w.id) && w.hebrew && w.english));
  assert.ok(Data.WEEKS.every(w => ['B2', 'B3', 'B4', 'B5', 'B6'].every(g => w.quizlet[g] && 'single' in w.quizlet[g] && 'cumulative' in w.quizlet[g])));
  const links = Data.WEEKS.flatMap(w => Object.values(w.quizlet).flatMap(g => [g.single, g.cumulative])).filter(Boolean);
  assert.equal(links.length, 272);
  assert.ok(links.every(link => /^https:\/\/quizlet\.com\//.test(link)));
});

test('grades are cumulative: B3 sees grade <= 3, and et / wt / unset classes are B3', () => {
  assert.deepEqual(L.weekCards(Data.WEEKS, 1, 'B2').map(c => c.id), ['w1_1', 'w1_2', 'w1_3', 'w1_4']);
  assert.deepEqual(L.weekCards(Data.WEEKS, 1, 'B3').map(c => c.id), ['w1_1', 'w1_2', 'w1_3', 'w1_4', 'w1_5', 'w1_6']);
  assert.equal(L.weekCards(Data.WEEKS, 1, 'B6').length, 12);
  for (const grade of L.GRADES) {
    const max = Number(grade.slice(1));
    const ids = new Set(L.weekCards(Data.WEEKS, 7, grade).map(c => c.id));
    for (const w of Data.WEEKS[6].words) assert.equal(ids.has(w.id), w.grade <= max);
  }
  assert.equal(L.resolveGrade(null), 'B3');
  assert.equal(L.resolveGrade(undefined), 'B3');
  assert.equal(L.resolveGrade('B7'), 'B3');
  assert.equal(L.resolveGrade('B5'), 'B5');
  assert.deepEqual(L.GRADES, ['B2', 'B3', 'B4', 'B5', 'B6']);
});

test('All Weeks So Far removes repeats by Hebrew and stops at the chosen week', () => {
  const weeks = [
    { week: 1, words: [{ id: 'w1_1', hebrew: 'א', english: 'one', grade: 2 }, { id: 'w1_2', hebrew: 'ב', english: 'two', grade: 3 }] },
    { week: 2, words: [{ id: 'w2_1', hebrew: 'א', english: 'one again', grade: 2 }, { id: 'w2_2', hebrew: 'ג', english: 'three', grade: 2 }] },
    { week: 3, words: [{ id: 'w3_1', hebrew: 'ד', english: 'four', grade: 2 }] }
  ];
  assert.deepEqual(L.cumulativeCards(weeks, 2, 'B3').map(c => c.id), ['w1_1', 'w1_2', 'w2_2']);
  assert.deepEqual(L.cumulativeCards(weeks, 2, 'B2').map(c => c.id), ['w1_1', 'w2_2']);
  assert.deepEqual(L.cumulativeCards(weeks, 3, 'B2').map(c => c.id), ['w1_1', 'w2_2', 'w3_1']);
  const real = L.cumulativeCards(Data.WEEKS, 30, 'B6');
  assert.equal(new Set(real.map(c => c.hebrew)).size, real.length);
  assert.ok(real.length <= 360 && real.length > 300);
});

test('Quizlet buttons use the original grade shift: B4->B3, B5->B4, B6->B5', () => {
  assert.deepEqual(['B2', 'B3', 'B4', 'B5', 'B6'].map(L.quizletGrade), ['B2', 'B3', 'B3', 'B4', 'B5']);
  const week = Data.WEEKS.find(w => w.quizlet.B3.single && w.quizlet.B4.single && w.quizlet.B3.single !== w.quizlet.B4.single);
  assert.ok(week, 'a week with different B3 and B4 Quizlet sets exists');
  assert.deepEqual(L.quizletLinks(Data.WEEKS, week.week, 'B4'), week.quizlet.B3);
  assert.deepEqual(L.quizletLinks(Data.WEEKS, week.week, 'B5'), week.quizlet.B4);
  assert.deepEqual(L.quizletLinks(Data.WEEKS, week.week, 'B3'), week.quizlet.B3);
  assert.deepEqual(L.quizletLinks(Data.WEEKS, 30, 'B3'), { single: null, cumulative: null });
});

test('current week moves up every Sunday (US Eastern), is capped at 30, and stays put when held', () => {
  const wed = at(2026, 11, 11, 10);                       // Wednesday
  assert.equal(L.currentWeek(null, wed), 1);
  assert.equal(L.currentWeek({ week: 5, setAt: wed, held: false }, wed), 5);
  assert.equal(L.currentWeek({ week: 5, setAt: wed, held: false }, at(2026, 11, 14, 23)), 5);   // Saturday 11 pm Eastern
  assert.equal(L.currentWeek({ week: 5, setAt: wed, held: false }, at(2026, 11, 15, 0)), 6);    // Sunday 12 am Eastern
  assert.equal(L.currentWeek({ week: 5, setAt: wed, held: false }, at(2026, 11, 21, 23)), 6);
  assert.equal(L.currentWeek({ week: 5, setAt: wed, held: false }, at(2026, 11, 22, 1)), 7);
  // Saturday night in New York is already Sunday in UTC — it must not count yet.
  assert.equal(L.currentWeek({ week: 5, setAt: wed, held: false }, Date.UTC(2026, 10, 15, 3)), 5);
  // Set on a Sunday: that Sunday does not count, the next one does.
  const sun = at(2026, 11, 15, 9);
  assert.equal(L.currentWeek({ week: 2, setAt: sun, held: false }, at(2026, 11, 21, 12)), 2);
  assert.equal(L.currentWeek({ week: 2, setAt: sun, held: false }, at(2026, 11, 22, 0)), 3);
  // Across the clock change in March.
  assert.equal(L.currentWeek({ week: 10, setAt: at(2027, 3, 10, 12), held: false }, at(2027, 3, 14, 12)), 11);
  // Held: never moves. Cap: never past 30.
  assert.equal(L.currentWeek({ week: 5, setAt: wed, held: true }, at(2027, 6, 1)), 5);
  assert.equal(L.currentWeek({ week: 28, setAt: wed, held: false }, at(2027, 6, 1)), 30);
  assert.equal(L.currentWeek({ week: 99, setAt: wed, held: false }, wed), 30);
  // A clock that is behind the saved time never moves the week backwards.
  assert.equal(L.currentWeek({ week: 5, setAt: at(2026, 11, 22, 12), held: false }, wed), 5);
  assert.deepEqual(L.weekSetting(7, true, 1234.9), { week: 7, setAt: 1234, held: true });
  assert.deepEqual(L.weekSetting(0, undefined, 10), { week: 1, setAt: 10, held: false });
});

test('Chumash Racer fix: every word gets its own 3 lanes and its right meaning is always one of them', () => {
  for (const grade of L.GRADES) {
    for (const week of [1, 9, 30]) {
      const cards = L.cumulativeCards(Data.WEEKS, week, grade);
      for (const card of cards) {
        const q = L.buildQuestion(card, cards, 3);
        assert.equal(q.choices.length, 3);
        assert.equal(q.choices.filter(c => c === card.english).length, 1, card.id + ' has exactly one right lane');
        assert.equal(new Set(q.choices).size, 3, card.id + ' has three different lanes');
      }
    }
  }
  // The original built its lanes from the first 3 meanings only; here later words are answerable too.
  const cards = L.weekCards(Data.WEEKS, 1, 'B6');
  const firstThree = L.uniqueMeanings(cards).slice(0, 3);
  const late = cards.find(c => !firstThree.includes(c.english));
  assert.ok(L.buildChoices(late, cards, 3).includes(late.english));
  const source = read('weekly-shorashim/games.js');
  assert.match(source, /L\.buildQuestion\(card, o\.cards, 3\)/);
});

test('questions: wrong choices are different meanings, short lists are padded, pickCards fills the count', () => {
  const cards = [{ id: 'w1_1', hebrew: 'א', english: 'same' }, { id: 'w1_2', hebrew: 'ב', english: 'same' }, { id: 'w1_3', hebrew: 'ג', english: 'other' }];
  const q = L.buildQuestion(cards[0], cards, 4);
  assert.equal(q.choices.length, 4);
  assert.equal(q.choices.filter(c => c === 'same').length, 1);
  assert.equal(q.choices.filter(c => c === '—').length, 2);
  assert.equal(L.pickCards(cards, 10).length, 10);
  assert.equal(L.pickCards([], 10).length, 0);
  assert.deepEqual(L.shuffle([1, 2, 3, 4]).sort(), [1, 2, 3, 4]);
});

test('saved progress: best score kept, plays counted, right and missed words added up', () => {
  const first = L.mergeProgress(null, { score: 40, correct: { w1_1: 2 }, missed: { w1_5: 1 } }, 1000);
  assert.deepEqual(first, { bestScore: 40, timesPlayed: 1, lastPlayed: 1000, wordsCorrect: { w1_1: 2 }, wordsMissed: { w1_5: 1 } });
  const second = L.mergeProgress(first, { score: 30, correct: { w1_1: 1, w1_2: 1 }, missed: { w1_5: 2, 'bad key': 4, w1_6: 0 } }, 2000);
  assert.deepEqual(second, { bestScore: 40, timesPlayed: 2, lastPlayed: 2000, wordsCorrect: { w1_1: 3, w1_2: 1 }, wordsMissed: { w1_5: 3 } });
  assert.equal(L.mergeProgress(second, { score: 90 }, 3000).bestScore, 90);
  assert.deepEqual(L.mergeProgress(null, { score: -5 }, 5), { bestScore: 0, timesPlayed: 1, lastPlayed: 5 });
  assert.deepEqual(L.missedTotals([
    { racer: { wordsMissed: { w1_5: 2, w1_6: 1 } }, quiz: { wordsMissed: { w1_5: 1 } } },
    { lava: { wordsMissed: { w1_6: 5 } } }, null
  ]), [{ id: 'w1_6', count: 6 }, { id: 'w1_5', count: 3 }]);
});

test('the seven games are the ones asked for; Hebrew Hop and Shas Milim are not ported', () => {
  assert.deepEqual(L.GAMES.map(g => g.label), ['Chumash Racer', 'Lava Traveler', 'Matching', 'Multiple Choice', 'True or False', 'Flashcards', 'Practice Quiz']);
  const rules = JSON.parse(read('staging/database.rules.json'));
  const game = rules.rules.b3Games.workspaces.$workspaceId.classes.$classId.weeklyShorashim.progress.$studentId.$week.$game;
  for (const g of L.GAMES) assert.ok(game['.validate'].includes(g.id), g.id + ' is accepted by the rules');
  for (const file of fs.readdirSync(path.join(root, 'weekly-shorashim'))) {
    assert.doesNotMatch(read('weekly-shorashim/' + file).replace(/^\s*(\/\/|\*).*$/gm, ''), /frog|hebrew-hop|shas\s*mil/i, file);
  }
});

test('student and teacher pages use the class data model, the shared class resolver, and run on staging only', () => {
  const app = read('weekly-shorashim/app.js'), teacher = read('weekly-shorashim/teacher.js'), page = read('weekly-shorashim/index.html');
  assert.match(app, /FunTorahStudentClass\.resolve\(/);
  assert.match(app, /B3_DATA_MODEL/);
  assert.match(app, /'\/weeklyShorashimGrade'/);
  assert.match(teacher, /B3_DATA_MODEL\.class\(/);
  assert.match(teacher, /'\/weeklyShorashimGrade'/);
  for (const source of [app, teacher]) {
    assert.match(source, /fun-torah-tools-staging/);
    assert.match(source, /only available on the staging site/);
  }
  assert.match(page, /student-class\.js/);
  // The student id comes from the verified sign-in, never from something a student can type.
  assert.match(app, /claims\.b3StudentId/);
  assert.doesNotMatch(app, /getItem\(['"]b3Games_studentId/);
});

test('scope: nothing outside weekly-shorashim/ links to it, and production rules are untouched', () => {
  assert.doesNotMatch(read('index.html'), /weekly-shorashim/);
  assert.doesNotMatch(read('teacher-home.html'), /weekly-shorashim/);
  for (const file of ['firebase-rules.json', 'firebase-rules.hardened.json']) {
    assert.doesNotMatch(read(file), /weeklyShorashim/, file);
  }
  const rules = JSON.parse(read('staging/database.rules.json'));
  const cls = rules.rules.b3Games.workspaces.$workspaceId.classes.$classId;
  assert.ok(cls.weeklyShorashimGrade && cls.weeklyShorashim);
  // Progress has no rule that lets one student reach another: read and write both name $studentId.
  const student = cls.weeklyShorashim.progress.$studentId;
  assert.match(student['.read'], /auth\.token\.b3StudentId == \$studentId && auth\.token\.b3ClassId == \$classId/);
  assert.match(student.$week.$game['.write'], /auth\.token\.b3StudentId == \$studentId && auth\.token\.b3ClassId == \$classId/);
  assert.equal(cls.weeklyShorashim.progress['.read'], undefined);
  assert.equal(cls.weeklyShorashim.progress['.write'], undefined);
  assert.equal(cls.weeklyShorashim['.read'], undefined);
  assert.equal(cls.weeklyShorashim['.write'], undefined);
});
