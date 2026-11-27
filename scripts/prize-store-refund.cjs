'use strict';
// Prize Store refund tool (owner use, run by hand).
//
//   node scripts/prize-store-refund.cjs report --project <id> [--out <file.json>]
//       READ ONLY. Lists every purchase and class-prize contribution each boy ever made and what he would get
//       back. Nothing is written.
//   node scripts/prize-store-refund.cjs apply --project <id> --confirm <project-id> [--batch <name>]
//       Refunds everything that has not been returned yet. One logged refund entry per purchase / contribution
//       (studentRewards/refundRequests/<student>/<item>, the same place the teacher page already reads refunds
//       from), the record itself is marked refunded (nothing is deleted), the boy's balance goes up by the sum,
//       and the class prize bars are reset to 0. Refuses to run while the Prize Store is open.
//
// It talks to the database through the logged-in Firebase CLI (`firebase login`), so it needs no keys in the
// repo. Balance changes use the database's atomic increment, so points earned while this runs are never lost.
// It never changes how points are earned and never touches stock (given prizes are not given back).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SR = 'studentRewards';
const RETURNED = new Set(['declined', 'canceled', 'refunded']); // points already went back to the boy
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const ms = v => { if (typeof v === 'number') return v; const t = Date.parse(v || ''); return Number.isFinite(t) ? t : (Number(v) || 0); };

function cli(args) {
  const r = spawnSync('firebase', args, { shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`firebase ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || r.stdout || '').trim().slice(0, 400)}`);
  return r.stdout;
}
function dbGet(project, p) {
  const out = path.join(os.tmpdir(), 'prize-refund-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json');
  try {
    cli(['database:get', p, '--project', project, '--output', out]);
    const t = fs.readFileSync(out, 'utf8').trim();
    return t ? JSON.parse(t) : null;
  } finally { try { fs.unlinkSync(out); } catch {} }
}
function dbUpdate(project, p, data) {
  const f = path.join(os.tmpdir(), 'prize-refund-up-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(f, JSON.stringify(data));
  try { cli(['database:update', p, f, '--project', project, '--force']); } finally { try { fs.unlinkSync(f); } catch {} }
}

function storeIsOpen(settings) {
  const v = settings && settings.rewardStoreEnabled;
  if (v === true || String(v) === 'true') return true;
  return Object.values((settings && settings.classStoreEnabled) || {}).some(x => x === true);
}

// Everything one boy ever spent, as plain rows.
function rowsFor(sid, data) {
  const rows = [];
  for (const [key, r0] of Object.entries(data.redemptionsByStudent[sid] || {})) {
    const r = r0 || {}, status = String(r.status || 'pending');
    const reward = data.rewards[r.rewardId] || data.catalog[r.rewardId] || {};
    rows.push({
      kind: 'purchase', key, when: ms(r.requestedAt), item: r.rewardName || reward.name || 'Prize', points: Math.max(0, num(r.cost)),
      status, prize: RETURNED.has(status) ? 'returned earlier' : status === 'collected' ? 'given' : 'waiting',
      alreadyReturned: RETURNED.has(status), classId: r.classId || null
    });
  }
  for (const [key, c0] of Object.entries(data.contributionsByStudent[sid] || {})) {
    const c = c0 || {}, won = c.winner && typeof c.winner === 'object';
    rows.push({
      kind: 'contribution', key, when: ms(c.createdAt), item: (c.rewardName || 'Class prize') + (Array.isArray(c.modeNames) && c.modeNames.length ? ' — ' + c.modeNames.join(', ') : ''),
      points: Math.abs(num(c.amount)), status: c.refundedAt ? 'refunded' : won ? 'won' : 'given to the bar',
      prize: c.refundedAt ? 'returned earlier' : won ? 'this gift won the prize' : 'on the class bar',
      alreadyReturned: Boolean(c.refundedAt), classId: c.classId || null
    });
  }
  return rows.sort((a, b) => a.when - b.when);
}

function load(project) {
  const get = p => dbGet(project, '/' + SR + '/' + p) || {};
  return {
    students: get('students'), classes: get('classes'), enrollments: get('enrollments'), rewards: get('rewards'), catalog: get('classRewardCatalog'),
    settings: get('settings'), redemptionsByStudent: get('redemptionsByStudent'), contributionsByStudent: get('classRewardContributionsByStudent'),
    refundRequests: get('refundRequests'), rounds: get('classRewardRounds')
  };
}

function plan(data) {
  const classNames = id => (data.classes[id] && data.classes[id].name) || id;
  const classesOf = sid => Object.entries(data.enrollments).filter(([, m]) => m && m[sid] === true).map(([c]) => classNames(c));
  const ids = new Set([...Object.keys(data.students), ...Object.keys(data.redemptionsByStudent), ...Object.keys(data.contributionsByStudent)]);
  const boys = [];
  for (const sid of ids) {
    const s = data.students[sid] || {}, rows = rowsFor(sid, data);
    if (!rows.length) continue;
    const refundable = rows.filter(r => !r.alreadyReturned);
    const classIds = Object.entries(data.enrollments).filter(([, m]) => m && m[sid] === true).map(([c]) => c);
    boys.push({
      id: sid, name: s.name || sid, active: s.active !== false, classes: classesOf(sid).concat(classesOf(sid).length ? [] : [classNames(s.classId)]).filter(Boolean),
      classIds, balanceNow: num(s.rewardBalance), rawBalance: s.rewardBalance === undefined ? null : s.rewardBalance,
      spentAllTime: rows.reduce((a, r) => a + r.points, 0), returnedEarlier: rows.filter(r => r.alreadyReturned).reduce((a, r) => a + r.points, 0),
      refund: refundable.reduce((a, r) => a + r.points, 0), refundCount: refundable.length, rows
    });
  }
  return boys.sort((a, b) => String(a.classes[0] || '').localeCompare(String(b.classes[0] || '')) || a.name.localeCompare(b.name));
}

function printReport(boys) {
  const fmt = t => t ? new Date(t).toISOString().slice(0, 10) : 'unknown date';
  let total = 0, count = 0;
  for (const b of boys) {
    total += b.refund; count += b.refundCount;
    console.log(`\n${b.name} (${b.classes.join(' / ') || 'no class'}) — balance now ${b.balanceNow} ★ → would become ${b.balanceNow + b.refund} ★; gets back ${b.refund} ★ (${b.refundCount} item${b.refundCount === 1 ? '' : 's'})`);
    for (const r of b.rows) console.log(`   ${fmt(r.when)}  ${r.kind === 'purchase' ? 'bought' : 'gave to class prize'}: ${r.item} — ${r.points} ★ — ${r.alreadyReturned ? 'ALREADY RETURNED earlier (not counted)' : r.prize}`);
  }
  console.log(`\nTOTAL: ${boys.filter(b => b.refund).length} boys, ${count} items, ${total} ★ to return.`);
}

function buildUpdates(data, boys, who, batchId, nowMs) {
  const updates = {}, stamp = nowMs, who2 = who;
  for (const b of boys) {
    const todo = b.rows.filter(r => !r.alreadyReturned);
    if (!todo.length) continue;
    const u = {};
    for (const r of todo) {
      if (r.kind === 'purchase') {
        const rec = data.redemptionsByStudent[b.id][r.key];
        u[`redemptionsByStudent/${b.id}/${r.key}/status`] = 'refunded';
        u[`redemptionsByStudent/${b.id}/${r.key}/refundedAt`] = stamp;
        u[`redemptionsByStudent/${b.id}/${r.key}/refundedBy`] = who2;
        u[`redemptionsByStudent/${b.id}/${r.key}/statusBeforeRefund`] = String(rec.status || 'pending');
      } else {
        u[`classRewardContributionsByStudent/${b.id}/${r.key}/refundedAt`] = stamp;
        u[`classRewardContributionsByStudent/${b.id}/${r.key}/refundedBy`] = who2;
        u[`classRewardContributionsByStudent/${b.id}/${r.key}/refundedAmount`] = r.points;
      }
      const old = (data.refundRequests[b.id] || {})[r.key] || {};
      u[`refundRequests/${b.id}/${r.key}`] = {
        itemKey: r.key, kind: r.kind, status: 'approved', amount: r.points, requestedAt: old.requestedAt || stamp,
        reviewedAt: stamp, reviewedBy: who2, by: old.requestedAt ? old.by || 'student' : 'bulk-refund', batchId,
        note: 'Prize Store closed: every purchase and class contribution returned.', error: null
      };
    }
    u[`students/${b.id}/rewardBalance`] = { '.sv': { increment: b.refund } };
    updates[b.id] = u;
  }
  return updates;
}

function roundResets(data, nowMs) {
  const u = {};
  for (const [classId, byReward] of Object.entries(data.rounds)) for (const [rewardId, r] of Object.entries(byReward || {})) {
    const p = `classRewardRounds/${classId}/${rewardId}`;
    u[`${p}/totalContributed`] = 0; u[`${p}/byStudent`] = null; u[`${p}/status`] = 'active';
    u[`${p}/completedAt`] = null; u[`${p}/cooldownUntil`] = null; u[`${p}/updatedAt`] = nowMs;
    u[`${p}/modeVoters`] = null;
    for (const m of Object.keys((r && r.modeTotals) || {})) u[`${p}/modeTotals/${m}`] = 0;
  }
  return u;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2), opt = {};
  for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, '')] = rest[i + 1];
  if (!['report', 'apply'].includes(cmd) || !opt.project) { console.error('Usage: report|apply --project <id> [--out file] [--confirm <id>] [--batch name]'); process.exit(2); }
  const data = load(opt.project), boys = plan(data);
  if (cmd === 'report') {
    printReport(boys);
    console.log(`\nPrize Store open right now: ${storeIsOpen(data.settings) ? 'YES' : 'no (closed)'}`);
    const odd = boys.filter(b => b.rawBalance !== null && typeof b.rawBalance !== 'number');
    if (odd.length) console.log('WARNING balances that are not plain numbers: ' + odd.map(b => b.name).join(', '));
    if (opt.out) fs.writeFileSync(opt.out, JSON.stringify(boys, null, 1));
    return;
  }
  if (opt.confirm !== opt.project) { console.error('Refusing: pass --confirm ' + opt.project + ' to really refund.'); process.exit(2); }
  if (storeIsOpen(data.settings)) { console.error('Refusing: the Prize Store is still open. Close it first.'); process.exit(2); }
  const nowMs = Date.now(), batchId = opt.batch || ('prize-store-refund-' + new Date(nowMs).toISOString().slice(0, 10));
  const updates = buildUpdates(data, boys, 'Owner (Prize Store refund)', batchId, nowMs);
  const planned = boys.reduce((t, b) => t + b.refund, 0);
  if (opt.expect !== undefined && Number(opt.expect) !== planned) { console.error(`Refusing: the plan now totals ${planned} ★, not the ${opt.expect} ★ that was approved.`); process.exit(2); }
  let done = 0, total = 0, items = 0;
  for (const b of boys) {
    const u = updates[b.id]; if (!u) continue;
    dbUpdate(opt.project, '/' + SR, u);
    done++; total += b.refund; items += b.refundCount;
    console.log(`refunded ${b.name}: ${b.refund} ★ (${b.refundCount} items)`);
  }
  // A re-run with nothing left to refund must not overwrite the first run's summary.
  dbUpdate(opt.project, '/' + SR, { ...roundResets(data, nowMs), ...(done ? { [`refundBatches/${batchId}`]: { at: nowMs, boys: done, items, points: total, by: 'Owner' } } : {}) });
  console.log(`\nDONE: ${done} boys, ${items} items, ${total} ★ returned. Class prize bars reset to 0.`);
}

module.exports = { plan, rowsFor, buildUpdates, roundResets, storeIsOpen };
if (require.main === module) main();
