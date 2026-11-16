'use strict';
// Turns Student Rewards points into the batches SOLS Tokens accepts, and works out
// which ones still need sending. Pure functions: no database or network calls here.
const crypto = require('node:crypto');

const BATCH_SIZE = 500;
const STATE_PATH = 'b3Private/solsTokensSync/sent';

function ymdSchoolDate(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(n));
  const v = t => parts.find(p => p.type === t)?.value || '';
  return `${v('year')}-${v('month')}-${v('day')}`;
}
function clip(text, max) { return String(text ?? '').slice(0, max); }

// Student Rewards keeps these categories only on Daily Points; activity points carry a source.
function categoryForSource(source) {
  const s = String(source || '').toLowerCase();
  if (s.startsWith('chazara')) return 'Chazara';
  if (s.startsWith('shorashim')) return 'Shorashim';
  if (s.startsWith('rashi')) return 'Rashi';
  if (/^(reading|translation|understand|posuk)/.test(s)) return 'Posuk';
  return 'Other';
}

function classNameFor(root, studentId, classId) {
  const classes = root.classes || {};
  if (classId && classes[classId]?.name) return clip(classes[classId].name, 100);
  const enrolled = Object.keys(classes).filter(cid => root.enrollments?.[cid]?.[studentId] === true).sort();
  return enrolled.length ? clip(classes[enrolled[0]]?.name || enrolled[0], 100) : '';
}

// Every point Student Rewards has recorded, in SOLS Tokens' format. Reward-store spending and
// class-reward contributions are left out on purpose (SOLS Tokens has its own store).
// An undone point is its own negative entry with status "added": SOLS Tokens subtracts it.
function collectPoints(root, { classNames = null } = {}) {
  const students = root.students || {};
  const wanted = classNames ? new Set(classNames.map(c => String(c).trim().toLowerCase())) : null;
  const out = [];
  const push = (studentId, p) => {
    const s = students[studentId];
    if (!s || s.active === false) return;
    const amount = Math.trunc(Number(p.amount));
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 10000) return;
    const cls = classNameFor(root, studentId, p.classId);
    if (wanted && !wanted.has(cls.toLowerCase())) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) return;
    out.push({
      point_id: clip(p.id, 128), student_id: clip(studentId, 128), student_name: clip(s.name || s.displayName || studentId, 200),
      class: cls, date: p.date, category: clip(p.category || 'Other', 60), reason: clip(p.reason || '', 500),
      amount, status: 'added',
    });
  };

  for (const [studentId, byClass] of Object.entries(root.dailyAwards || {})) {
    for (const [classId, byDate] of Object.entries(byClass || {})) {
      for (const [date, award] of Object.entries(byDate || {})) {
        const total = Number(award?.points || 0);
        if (!total) continue;
        const parts = award.byCategory && typeof award.byCategory === 'object'
          ? Object.values(award.byCategory).filter(x => x && x.category && Number(x.points)) : [];
        if (parts.length && parts.reduce((t, x) => t + Number(x.points), 0) === total) {
          for (const x of parts) {
            const key = String(x.category).replace(/[^A-Za-z0-9_-]+/g, '_');
            push(studentId, { id: `daily:${studentId}:${classId}:${date}:${key}`, classId, date, category: x.category, amount: x.points, reason: `Daily Points · ${x.category}` });
          }
        } else {
          push(studentId, { id: `daily:${studentId}:${classId}:${date}`, classId, date, category: 'Daily Points', amount: total, reason: 'Daily Points' });
        }
      }
    }
  }
  for (const [id, r] of Object.entries(root.pointRequests || {})) {
    if (!r || String(r.status || '') !== 'approved' || !r.rewardStudentId) continue;
    push(r.rewardStudentId, {
      id: `request:${id}`, classId: r.classId, date: ymdSchoolDate(r.reviewedAt || r.createdAt),
      category: categoryForSource(r.source), amount: r.actualAmount ?? r.amount, reason: r.reason || r.source || 'Activity points',
    });
  }
  for (const [id, a] of Object.entries(root.pointAdjustments || {})) {
    if (!a || !a.studentId) continue;
    push(a.studentId, { id: `adjust:${id}`, classId: a.classId, date: ymdSchoolDate(a.createdAt), category: 'Adjustments', amount: a.amount, reason: a.reason || 'Teacher adjustment' });
  }
  return out;
}

function stateKey(pointId) { return crypto.createHash('sha1').update(String(pointId)).digest('hex'); }

// Only points never sent, or whose amount changed since the last send (a re-saved day).
function pointsToSend(points, sentState) {
  const sent = sentState || {};
  return points.filter(p => sent[stateKey(p.point_id)] !== p.amount);
}
function toBatches(points, size = BATCH_SIZE) {
  const out = [];
  for (let i = 0; i < points.length; i += size) out.push(points.slice(i, i + size));
  return out;
}

// After a reply, remember what SOLS Tokens has: applied, unchanged and held points are kept on
// its side (held ones apply once a person confirms the student). Rejected ones are retried.
function sentUpdatesFromReply(batch, reply) {
  const updates = {};
  const rejected = [];
  (reply?.results || []).forEach((r, i) => {
    const p = batch[i];
    if (!p) return;
    // The reply's per-point word is one of applied / unchanged / held / rejected; the exact
    // field name is confirmed against the first practice reply.
    const word = r && (r.status ?? r.result ?? r.outcome);
    if (word === 'rejected') rejected.push({ point_id: p.point_id, detail: r });
    else if (['applied', 'unchanged', 'held'].includes(word)) updates[stateKey(p.point_id)] = p.amount;
  });
  return { updates, rejected };
}

module.exports = { BATCH_SIZE, STATE_PATH, collectPoints, pointsToSend, toBatches, sentUpdatesFromReply, categoryForSource, stateKey, ymdSchoolDate };
