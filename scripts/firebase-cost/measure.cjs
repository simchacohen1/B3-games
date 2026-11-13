'use strict';
// Firebase cost measurement (Issue #51).
//
// Measures the bytes the Realtime Database sends to a browser for a few
// classroom workflows, with the read pattern each page used BEFORE and AFTER
// the cost changes. It runs only against the LOCAL database emulator with a
// made-up fixture. It never touches staging or production.
//
// Bytes are counted on the wire by a small TCP proxy placed between the
// Firebase client and the emulator (server -> client direction), so they
// include WebSocket framing. They are not Firebase billing numbers: real
// sizes depend on how much real data each class has.
//
// Run:
//   java -jar ~/.cache/firebase/emulators/firebase-database-emulator-v4.11.2.jar --host 127.0.0.1 --port 9123
//   node scripts/firebase-cost/measure.cjs            (prints a table)
//   node scripts/firebase-cost/measure.cjs --json     (machine-readable)
const net = require('node:net');
const firebase = require('@firebase/app-compat').default || require('@firebase/app-compat');
require('@firebase/database-compat');

const EMULATOR = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9123';
const [EMU_HOST, EMU_PORT] = EMULATOR.split(':');
const NS = 'demo-b3-cost';
const SHORASHIM = 'posukPractice/shorashimLearning/classes/test-alef';
const REWARDS = 'studentRewards';
const QUIZ = 'b3Quiz';
const SID = 'fictional_student_01';

// ---------- made-up fixture ----------
const filler = (n, seed) => { let s = ''; while (s.length < n) s += 'lorem-' + seed + '-'; return s.slice(0, n); };
const range = n => Array.from({ length: n }, (_, i) => i);
const keyed = (n, prefix, make) => Object.fromEntries(range(n).map(i => [prefix + String(i).padStart(4, '0'), make(i)]));

function fixture() {
  const studentIds = range(24).map(i => 'fictional_student_' + String(i + 1).padStart(2, '0'));
  const shorashimStudent = i => ({
    name: 'Fictional Student ' + (i + 1), lastActive: 1760000000000 + i, totalActiveSeconds: 3600 + i,
    learned: keyed(48, 'card', c => ({ itemKey: 'shorashim:' + c, itemType: 'shorashim', learnedAt: 1760000000000 + c,
      design: { backgroundColor: '#fff9e8', hebrewSize: 58, drawing: 'data:image/png;base64,' + filler(1500, 'd' + i + c) },
      attempts: range(6).map(a => ({ at: 1760000000000 + a, ok: a % 2 === 0 })) }))
  });
  const rewardsByStudentDay = make => Object.fromEntries(range(2).map(c => ['class' + c,
    Object.fromEntries(range(40).map(d => ['2026-09-' + String(d + 1).padStart(2, '0'),
      Object.fromEntries(studentIds.map(id => [id, make(d)]))]))]));
  return {
    posukPractice: {
      shorashimLearning: { classes: { 'test-alef': {
        catalog: { shorashim: keyed(300, 'w', i => ({ front: 'שרש' + i, english: 'meaning ' + i, perek: 1 + (i % 20), listName: 'Main List', hint: filler(120, 'h' + i) })) },
        settings: { minReviewMs: 500, studentSiteOpen: true, namedLists: { main: { name: 'Main List' } } },
        students: Object.fromEntries(studentIds.map((id, i) => [id, shorashimStudent(i)])),
        leaderboards: { match: { 8: Object.fromEntries(studentIds.map((id, i) => [id, { name: 'Fictional ' + i, time: 20000 + i }])) } }
      } } },
      chazara: {
        students: { [SID]: { goal: 100, name: 'Fictional Student 1', reviews: keyed(120, 'p', i => ({ count: 1 + (i % 5), lastAt: 1760000000000 + i })) } },
        events: { [SID]: keyed(200, 'ev', i => ({ id: 'ev' + i, studentId: SID, key: '1_' + i, reviewApplied: true, pointRequestId: 'pr' + i, at: 1760000000000 + i, note: filler(180, 'e' + i) })) }
      },
      attempts: { [SID]: keyed(150, 'at', i => ({ perek: 1, posuk: i, score: 90, at: 1760000000000 + i, words: filler(320, 'a' + i) })) },
      submissions: { [SID]: keyed(20, 'sub', i => ({ perek: 1, posuk: i, grade: 'A', at: 1760000000000 + i })) }
    },
    [REWARDS]: {
      classes: { class0: { name: 'TEST-ALEF', active: true }, class1: { name: 'TEST-BEIS', active: true } },
      students: Object.fromEntries(studentIds.map((id, i) => [id, { name: 'Fictional Student ' + (i + 1), initials: 'FS', color: '#24344a', classId: 'class' + (i % 2), rewardBalance: 100 + i }])),
      categories: keyed(8, 'cat', i => ({ name: 'Category ' + i, max: 5 })),
      rewards: keyed(25, 'rw', i => ({ name: 'Reward ' + i, cost: 50 + i, icon: '🎁', description: filler(120, 'r' + i), active: true })),
      classRewardCatalog: keyed(8, 'cr', i => ({ name: 'Class reward ' + i, costPerStudent: 100, active: true })),
      settings: { rewardStoreEnabled: true, rewardModelV2Seeded: true },
      dailyRatings: rewardsByStudentDay(d => ({ cat0000: 5, cat0001: 4, cat0002: 5, cat0003: 3, by: 'teacher', at: 1760000000000 + d })),
      dailyAwards: rewardsByStudentDay(d => ({ points: 3, reason: 'Great work ' + d })),
      dailyAttendance: rewardsByStudentDay(() => ({ present: true })),
      commentsByStudent: Object.fromEntries(studentIds.map(id => [id, keyed(10, 'c', i => ({ text: filler(140, 'c' + i), at: 1760000000000 + i }))])),
      redemptionsByStudent: Object.fromEntries(studentIds.map(id => [id, keyed(6, 'rd', i => ({ rewardId: 'rw000' + i, cost: 50, status: 'approved', at: 1760000000000 + i }))])),
      enrollments: { class0: Object.fromEntries(studentIds.map(id => [id, true])), class1: {} },
      pointAdjustments: keyed(1500, 'adj', i => ({ studentId: studentIds[i % 24], points: 2, reason: filler(60, 'j' + i), at: 1760000000000 + i })),
      audit: keyed(2000, 'au', i => ({ action: 'award', actor: 'teacher', detail: filler(110, 'u' + i), at: 1760000000000 + i })),
      pointRequests: keyed(3000, 'pr', i => ({ studentId: studentIds[i % 24], source: 'chazara', points: 1, status: 'approved', eventId: 'ev' + i, at: 1760000000000 + i })),
      classRewardContributionsByStudent: Object.fromEntries(studentIds.map(id => [id, keyed(4, 'cb', i => ({ roundId: 'round' + i, points: 10 }))])),
      refundRequests: Object.fromEntries(studentIds.map(id => [id, keyed(1, 'rf', () => ({ status: 'closed' }))])),
      classRewardRounds: { class0: keyed(5, 'round', i => ({ rewardId: 'cr000' + i, status: 'open', total: 100 * i })) }
    },
    [QUIZ]: {
      quizzes: keyed(30, 'quiz', i => ({ title: 'Quiz ' + i, questions: range(20).map(q => ({ q: filler(140, 'q' + i + q), choices: ['a', 'b', 'c', 'd'].map(c => filler(40, c + q)), answer: 1 })) })),
      launches: keyed(60, 'launch', i => ({ quizId: 'quiz00' + String(i % 30).padStart(2, '0'), classId: 'class0', started: false, endedAt: 1760000000000 + i,
        questions: range(20).map(q => ({ q: filler(140, 'l' + i + q), choices: ['a', 'b', 'c', 'd'].map(c => filler(40, c + q)), answer: 1 })) })),
      responses: keyed(60, 'launch', () => Object.fromEntries(studentIds.map(id => [id, Object.fromEntries(range(20).map(q => ['q' + q, { choice: 1, correct: true, at: 1760000000000 + q }]))]))),
      completions: keyed(60, 'launch', () => Object.fromEntries(studentIds.map(id => [id, { correct: 18, total: 20, at: 1760000000000 }]))),
      audit: keyed(5000, 'qa', i => ({ studentId: studentIds[i % 24], event: 'answer', detail: filler(120, 'qa' + i), at: 1760000000000 + i })),
      settings: { activeLaunchByClass: { class0: '' } }
    }
  };
}

// ---------- emulator plumbing ----------
async function rest(method, path, body) {
  const res = await fetch(`http://${EMULATOR}/${path}?ns=${NS}`, { method, headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(method + ' ' + path + ' failed: ' + res.status + ' ' + await res.text());
}
const counter = { down: 0 };
function startProxy() {
  return new Promise(resolve => {
    const server = net.createServer(client => {
      const upstream = net.connect(Number(EMU_PORT), EMU_HOST);
      upstream.on('data', chunk => { counter.down += chunk.length; });
      client.pipe(upstream); upstream.pipe(client);
      const close = () => { client.destroy(); upstream.destroy(); };
      client.on('error', close); upstream.on('error', close); client.on('close', close); upstream.on('close', close);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let appSeq = 0;
// One fresh connection per run, so nothing is carried over between runs.
async function measure(proxyPort, run) {
  const app = firebase.initializeApp({ databaseURL: `http://127.0.0.1:${proxyPort}/?ns=${NS}` }, 'cost-' + (++appSeq));
  const db = app.database();
  counter.down = 0;
  try { await run(db); await sleep(400); return counter.down; }
  finally { await app.delete(); }
}
const once = (db, path) => db.ref(path).once('value');
// Attach a listener and wait for its first event, like a page that renders from it.
const listen = (db, path, event = 'value') => new Promise((resolve, reject) => {
  const timer = event === 'value' ? null : setTimeout(resolve, 600); // child events: an empty list sends nothing
  db.ref(path).on(event, () => { if (timer) clearTimeout(timer); resolve(); }, reject);
});
const noop = () => {};
// The fix under test: hold the path open so a read followed by a listener
// (or by another read) is one download instead of two.
const hold = (db, paths) => paths.forEach(p => db.ref(p).on('value', noop, noop));

// ---------- workflows: each returns the same reads the page performs ----------
const workflows = [
  { id: 'shorashim-student-open', label: 'Shorashim: student opens the page', run: async (db, fixed) => {
    const paths = [SHORASHIM + '/catalog', SHORASHIM + '/settings'];
    if (fixed) hold(db, paths);
    await Promise.all([...paths.map(p => once(db, p)), once(db, SHORASHIM + '/students/' + SID)]);
    await Promise.all(paths.map(p => listen(db, p)));
  } },
  { id: 'shorashim-teacher-open', label: 'Shorashim: teacher opens the class page', run: async (db, fixed) => {
    const paths = ['catalog', 'settings', 'students', 'leaderboards'].map(p => SHORASHIM + '/' + p);
    if (fixed) hold(db, paths);
    await Promise.all(paths.map(p => once(db, p)));
    await Promise.all([listen(db, paths[0]), listen(db, paths[1]), listen(db, paths[2], 'child_added'), listen(db, SHORASHIM + '/leaderboards/match', 'child_added')]);
    db.ref(paths[2]).on('child_changed', noop); db.ref(SHORASHIM + '/leaderboards/match').on('child_changed', noop);
    await sleep(300);
  } },
  { id: 'chazara-student-open', label: 'Chazara: student opens the page', run: async (db, fixed) => {
    const attempts = 'posukPractice/attempts/' + SID, events = 'posukPractice/chazara/events/' + SID;
    if (fixed) hold(db, [attempts, events]);
    await Promise.all([once(db, 'posukPractice/chazara/students/' + SID), once(db, attempts), once(db, events)]);
    await Promise.all([listen(db, 'posukPractice/submissions/' + SID), listen(db, attempts), listen(db, events)]);
    await once(db, events); // retryPendingPointSyncs()
  } },
  { id: 'rewards-student-open', label: 'Student Rewards: student opens the page', run: async (db, fixed) => {
    const own = n => `${REWARDS}/${n}/${SID}`;
    const again = [`${REWARDS}/students/${SID}`, own('redemptionsByStudent'), own('classRewardContributionsByStudent'), own('refundRequests'), `${REWARDS}/rewards`, `${REWARDS}/settings/rewardStoreEnabled`];
    if (fixed) hold(db, again);
    await Promise.all([...again, own('commentsByStudent'), `${REWARDS}/categories`].map(p => once(db, p)));
    await Promise.all([...again, `${REWARDS}/classRewardCatalog`].map(p => listen(db, p)));
  } },
  { id: 'rewards-owner-10min', label: 'Student Rewards: owner page open 10 minutes (1 load + 20 refreshes, one rating saved between each)', run: async (db, fixed) => {
    const roots = ['classes', 'students', 'categories', 'rewards', 'classRewardCatalog', 'settings', 'dailyRatings', 'dailyAwards', 'dailyAttendance', 'commentsByStudent', 'redemptionsByStudent', 'enrollments', 'pointAdjustments', 'audit', 'pointRequests', 'classRewardContributionsByStudent', 'refundRequests', 'classRewardRounds'].map(p => REWARDS + '/' + p);
    for (let poll = 0; poll <= 20; poll++) {
      if (fixed && poll === 0) hold(db, roots);
      await Promise.all(roots.map(p => once(db, p)));
      // Another device saves one rating, as happens during class.
      await rest('PUT', `${REWARDS}/dailyRatings/class0/2026-09-01/${SID}/cat0000.json`, 1 + (poll % 5));
      await sleep(50);
    }
  } },
  { id: 'parent-dashboard-call', label: 'Parent Dashboard API: quiz data for one sync call', run: async (db, fixed) => {
    if (fixed) await Promise.all(['launches', 'responses', 'completions'].map(p => once(db, QUIZ + '/' + p)));
    else await once(db, QUIZ);
  } }
];

async function seed() {
  await rest('PUT', '.settings/rules.json', { rules: { '.read': true, '.write': true } }); // local emulator only
  await rest('PUT', '.json', fixture());
}
async function main() {
  await seed();
  const proxy = await startProxy(), port = proxy.address().port, rows = [];
  for (const w of workflows) {
    const before = await measure(port, db => w.run(db, false));
    const after = await measure(port, db => w.run(db, true));
    rows.push({ id: w.id, workflow: w.label, beforeBytes: before, afterBytes: after, savedPercent: Math.round((1 - after / before) * 1000) / 10 });
  }
  proxy.close();
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
  else {
    const kb = n => (n / 1024).toFixed(1).padStart(10) + ' KB';
    for (const r of rows) console.log(`${kb(r.beforeBytes)} -> ${kb(r.afterBytes)}  ${String(r.savedPercent).padStart(5)}% less  ${r.workflow}`);
  }
  return rows;
}
if (require.main === module) main().then(() => process.exit(0), err => { console.error(err); process.exit(1); });
module.exports = { main, seed, startProxy, measure, rest, SID };
