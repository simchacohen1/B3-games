'use strict';
// Firebase cost (Issue #51): runs the REAL loadRoot() from student-rewards/teacher.js,
// once as it is on origin/main and once as it is in this checkout, with the real
// Firebase client against the local emulator. It simulates the owner view left open
// for 10 minutes (1 load + 20 refreshes, one rating saved between each) and prints
// the bytes the database sent, and whether both versions end with identical data.
// Local emulator and made-up data only. See measure.cjs for how to start the emulator.
const fs = require('node:fs'), vm = require('node:vm'), { execSync } = require('node:child_process');
const m = require('./measure.cjs');

async function run(label, source, port) {
  const from = source.includes('const OWNER_ROOT_PATHS=') ? source.indexOf('const OWNER_ROOT_PATHS=') : source.indexOf('async function loadRoot(');
  const code = source.slice(from, source.indexOf('async function ensureRewardModelV2(')) + ';loadRoot';
  let finalState = '';
  const bytes = await m.measure(port, async db => {
    const ctx = { ROOT: 'studentRewards', state: { teacherMode: false, classId: 'class0' }, setTimeout: () => {}, db,
      prepareDraft() {}, renderClassSelect() {}, setHeader() {}, buildNav() {}, sweepAutomaticPosukPoints() {},
      activeClasses: () => [], requestedClassId: () => '', B3ClassGate: { choose: async () => 'class0' } };
    const loadRoot = vm.runInNewContext(code, ctx);
    for (let i = 0; i <= 20; i++) {
      await loadRoot();
      await m.rest('PUT', `studentRewards/dailyRatings/class0/2026-09-01/${m.SID}/cat0000.json`, 1 + (i % 5));
      await new Promise(r => setTimeout(r, 60));
    }
    await loadRoot();
    finalState = JSON.stringify(ctx.state.root);
  });
  console.log(`${label}: ${(bytes / 1024).toFixed(1)} KB sent by the database`);
  return { bytes, finalState };
}

(async () => {
  await m.seed();
  const proxy = await m.startProxy(), port = proxy.address().port;
  const before = await run('origin/main  ', execSync('git show origin/main:student-rewards/teacher.js', { maxBuffer: 1e8 }).toString(), port);
  const after = await run('this checkout', fs.readFileSync('student-rewards/teacher.js', 'utf8'), port);
  console.log(`saved: ${(100 * (1 - after.bytes / before.bytes)).toFixed(1)}%`);
  console.log('both versions end with identical data, including the last saved rating:', before.finalState === after.finalState);
  process.exit(before.finalState === after.finalState ? 0 : 1);
})().catch(err => { console.error(err); process.exit(1); });
