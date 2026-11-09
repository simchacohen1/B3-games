'use strict';
/*
 * Mishnayos Practice: line recordings, one Submit, teacher grading (issue #692).
 *
 * The student records each line of a mishna (reading and translating it in
 * the same recording). Each line's recording is a draft in the student's own
 * space, so he can leave and come back. Nothing reaches the teacher until he
 * presses Submit. He does not have to record every line: Submit sends the
 * lines he recorded (at least one). While a mishna waits for the teacher he cannot re-record it.
 * The teacher grades it: if it is not gold standard he can try again; if it
 * is gold standard the mishna is locked for one month.
 *
 * Points (paid straight into Student Rewards):
 *   5 for each Submit,
 *   10 for gold standard, minus 1 for each mistake (never below 0),
 *   plus any teacher bonus (no upper limit).
 *
 * Database paths (posukPractice/mishnayos/...):
 *   drafts/<studentId>/<key>/lines/<i>        student writes (rules block it while submitted or locked)
 *   submissions/<studentId>/<key>             written only here
 *   submissionHistory/<studentId>/<key>/<n>   written only here (every graded try)
 *   notices/<studentId>/<id>                  written here; the student may only mark one seen
 * Storage:
 *   posukPractice/<studentId>/mishnayosDrafts/<key>/...   student drafts
 *   mishnayosSubmitted/<studentId>/<key>/a<n>/line<i>.*   submitted copies (students cannot change them)
 *
 * Pure logic: `store` and `files` are injected so the tests need no Firebase.
 */
const LINE_COUNTS = require('./mishnayos-line-counts.json');

const ROOT = 'posukPractice/mishnayos';
const SR = 'studentRewards';
const WS = 'b3-2026';
const ADMIN_EMAIL = 'simcha5770@gmail.com';
const TOOL = 'posuk-practice-scroll';
const SUBMIT_POINTS = 5;
const GOLD_POINTS = 10;
const LOCK_DAYS = 30;
const LOCK_MS = LOCK_DAYS * 24 * 60 * 60 * 1000;
const MASECHES_LABELS = { berachos: { english: 'Berachos', hebrew: 'ברכות' } };

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const validId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v);

/* "berachos_1_2" -> maseches berachos, perek 1, mishnah 2 (with its line count). */
function parseKey(key) {
  const m = /^([a-z]{2,30})_(\d{1,3})_(\d{1,3})$/.exec(String(key || ''));
  if (!m) return null;
  const maseches = m[1], perek = Number(m[2]), mishnah = Number(m[3]);
  const lineCount = LINE_COUNTS[maseches]?.[perek - 1]?.[mishnah - 1];
  if (!Number.isInteger(lineCount) || lineCount < 1) return null;
  return { key: String(key), maseches, perek, mishnah, lineCount };
}
function refLabel(info) {
  const name = MASECHES_LABELS[info.maseches]?.english || info.maseches;
  return name + ' ' + info.perek + ':' + info.mishnah;
}

function draftPrefix(studentId, key) { return 'posukPractice/' + studentId + '/mishnayosDrafts/' + key + '/'; }
function submittedPath(studentId, key, attempt, lineIndex, ext) {
  return 'mishnayosSubmitted/' + studentId + '/' + key + '/a' + attempt + '/line' + (lineIndex + 1) + '.' + ext;
}
function extFor(entry) {
  const fromPath = /\.([a-z0-9]{2,5})$/i.exec(String(entry.path || ''))?.[1];
  if (fromPath) return fromPath.toLowerCase();
  const mime = String(entry.mime || '');
  return mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
}
/* A submission blocks re-recording while it waits for the teacher, and for
   a month after a gold-standard grade. */
function blockedReason(sub, now) {
  if (!sub) return '';
  if (sub.status === 'submitted' || sub.status === 'submitting') return 'waiting';
  if (Number(sub.lockedUntil) > now) return 'locked';
  return '';
}

/* ---------- Student Rewards ---------- */
async function resolveRewardStudentId(store, studentId) {
  // Filter in code: Student Rewards has no index on b3StudentId.
  const all = await store.get(SR + '/students') || {};
  const links = Object.keys(all).filter(id => all[id]?.b3StudentId === studentId && all[id]?.active !== false);
  if (links.length === 1) return links[0];
  if (links.length > 1) return '';
  return all[studentId] ? studentId : '';
}
/* Pays points once per requestId (a repeated call never pays twice). */
async function award(store, { requestId, rewardStudentId, studentId, studentName, classId, amount, source, reason, now }) {
  if (!rewardStudentId || !(amount > 0)) return { paid: 0, ok: !!rewardStudentId };
  const path = SR + '/pointRequests/' + requestId;
  const seed = { id: requestId, status: 'processing', automatic: true, amount, source, reason,
    practiceStudentId: studentId, rewardStudentId, studentName: studentName || studentId, classId: classId || '', createdAt: now };
  const claim = await store.tx(path, cur => cur ? undefined : seed);
  if (!claim.committed) {
    const existing = await store.get(path) || {};
    return { paid: Number(existing.actualAmount ?? 0), ok: true, already: true };
  }
  let applied = 0;
  const bal = await store.tx(SR + '/students/' + rewardStudentId + '/rewardBalance', cur => {
    const old = Number(cur || 0), next = Math.max(0, old + amount); applied = next - old; return next;
  });
  if (!bal.committed) {
    await store.update({ [path + '/status']: 'error', [path + '/lastError']: 'Balance update did not commit' });
    return { paid: 0, ok: false };
  }
  await store.update({ [path + '/status']: 'approved', [path + '/actualAmount']: applied,
    [path + '/balanceAfter']: Number(bal.snapshot.val() || 0), [path + '/approvedAutomatically']: true, [path + '/reviewedAt']: now });
  return { paid: applied, ok: true };
}

/* ---------- Student: Submit ---------- */
async function submit(store, files, student, body, now) {
  const { studentId, classId } = student;
  if (!validId(studentId)) fail(401, 'Student sign-in required.');
  const info = parseKey(body?.key);
  if (!info) fail(400, 'Unknown mishna.');
  const subPath = ROOT + '/submissions/' + studentId + '/' + info.key;
  const draftPath = ROOT + '/drafts/' + studentId + '/' + info.key;

  const before = await store.get(subPath);
  const blocked = blockedReason(before, now);
  if (blocked === 'waiting') fail(409, 'This mishna is already waiting for your teacher.');
  if (blocked === 'locked') fail(409, 'This mishna is locked until ' + new Date(Number(before.lockedUntil)).toDateString() + '.');

  // The student chooses which lines to record: at least one, not necessarily
  // all. Each recorded line must really be in the student's own drafts.
  const draft = await store.get(draftPath + '/lines') || {};
  const prefix = draftPrefix(studentId, info.key);
  const lines = [];
  for (let i = 0; i < info.lineCount; i++) {
    const entry = draft[i] ?? draft[String(i)];
    if (!entry) continue;
    const p = String(entry.path || '');
    if (!p.startsWith(prefix) || p.includes('..') || !(await files.exists(p))) {
      fail(400, 'Line ' + (i + 1) + ' did not save properly. Record it again, then submit.');
    }
    lines.push({ index: i, path: p, mime: String(entry.mime || '').slice(0, 60), durationMs: Math.max(0, Math.round(Number(entry.durationMs) || 0)) });
  }
  if (!lines.length) fail(400, 'Record at least one line before you submit.');

  // Claim the submission so two Submit presses cannot both go through.
  const attempt = Number(before?.attempt || 0) + 1;
  const claim = await store.tx(subPath, cur => {
    if (blockedReason(cur, now)) return undefined;
    return { ...(cur || {}), key: info.key, status: 'submitting', attempt, claimedAt: now };
  });
  if (!claim.committed) fail(409, 'This mishna is already waiting for your teacher.');

  const copied = [];
  try {
    for (let i = 0; i < lines.length; i++) {
      const dst = submittedPath(studentId, info.key, attempt, lines[i].index, extFor(lines[i]));
      await files.copy(lines[i].path, dst);
      copied.push({ ...lines[i], draftPath: lines[i].path, path: dst });
    }
  } catch (error) {
    // Put things back exactly as they were; the drafts are untouched.
    await store.update({ [subPath]: before || null });
    for (const c of copied) await files.remove(c.path).catch(() => {});
    throw error;
  }

  const profile = await store.get('b3Games/students/' + studentId + '/profile') || {};
  const studentName = String(profile.name || student.name || studentId).slice(0, 120);
  const rewardStudentId = await resolveRewardStudentId(store, studentId);
  const submission = {
    key: info.key, maseches: info.maseches, perek: info.perek, mishnah: info.mishnah, lineCount: info.lineCount,
    status: 'submitted', attempt, recordedCount: copied.length, submittedAt: now, classId: classId || '', studentName, rewardStudentId: rewardStudentId || '',
    // Keyed by the line's place in the mishna; lines he did not record are absent.
    lines: Object.fromEntries(copied.map(c => [c.index, { path: c.path, mime: c.mime, durationMs: c.durationMs }])),
    // The last grade stays visible to the teacher in the history, not here.
    grade: null, lockedUntil: null
  };
  const paid = await award(store, { requestId: 'mishnayos_submit_' + studentId + '_' + info.key + '_a' + attempt, rewardStudentId,
    studentId, studentName, classId, amount: SUBMIT_POINTS, source: 'mishnayos-submit', reason: 'Mishnayos: submitted ' + refLabel(info), now });
  submission.submitPoints = paid.paid;
  const noticeId = 'n_' + now + '_s_' + info.key;
  await store.update({
    [subPath]: submission,
    [draftPath]: null,
    [ROOT + '/notices/' + studentId + '/' + noticeId]: { kind: 'submitted', key: info.key, label: refLabel(info), points: paid.paid,
      pointsNotAdded: !paid.ok || null, createdAt: now, seen: false }
  });
  for (const c of copied) await files.remove(c.draftPath).catch(() => {});
  return { ok: true, status: 'submitted', attempt, points: paid.paid, pointsNotAdded: !paid.ok };
}

/* ---------- Teacher ---------- */
async function teacherAccess(store, identity) {
  if (!identity?.uid || identity.email_verified !== true) fail(403, 'Verified Google teacher sign-in required.');
  const email = String(identity.email || '').toLowerCase();
  const adminRow = await store.get('b3Games/admins/' + identity.uid);
  if (email === ADMIN_EMAIL || (adminRow && adminRow.active === true)) return { email, access: { authorized: true, role: 'admin' } };
  if (identity.firebase?.sign_in_provider !== 'google.com') fail(403, 'Verified Google teacher sign-in required.');
  const row = await store.get('b3Games/workspaces/' + WS + '/teachers/' + identity.uid);
  if (!row || row.active === false) fail(403, 'Your teacher account is not active.');
  const classIds = Object.keys(row.classIds || {}).filter(id => id !== '*' && row.classIds[id] === true);
  return { email, access: { authorized: true, role: 'teacher', classIds } };
}
async function teacherRoster(store, scopeLib, identity, classId) {
  const { email, access } = await teacherAccess(store, identity);
  if (classId && !validId(classId)) fail(400, 'Choose a valid class.');
  let scope;
  try { scope = await scopeLib.roster(store.get, access, classId || '', TOOL); }
  catch (error) { fail(403, error.message); }
  return { email, scope };
}
function publicSubmission(studentId, student, sub) {
  return { studentId, studentName: sub.studentName || student?.name || studentId, className: student?.className || '',
    key: sub.key, maseches: sub.maseches, perek: sub.perek, mishnah: sub.mishnah, lineCount: sub.lineCount,
    recordedCount: sub.recordedCount ?? Object.values(sub.lines || {}).filter(Boolean).length,
    status: sub.status, attempt: sub.attempt, submittedAt: sub.submittedAt || null, lines: sub.lines || {},
    grade: sub.grade || null, lockedUntil: sub.lockedUntil || null };
}
async function teacherList(store, scopeLib, identity, body) {
  const { scope } = await teacherRoster(store, scopeLib, identity, String(body?.classId || ''));
  const out = [];
  await Promise.all(Object.entries(scope.students).map(async ([sid, student]) => {
    const subs = await store.get(ROOT + '/submissions/' + sid) || {};
    for (const sub of Object.values(subs)) {
      if (sub && typeof sub === 'object' && sub.key && ['submitted', 'graded'].includes(sub.status)) out.push(publicSubmission(sid, student, sub));
    }
  }));
  out.sort((a, b) => (a.status === 'submitted' ? 0 : 1) - (b.status === 'submitted' ? 0 : 1)
    || (a.status === 'submitted' ? (a.submittedAt || 0) - (b.submittedAt || 0) : (b.grade?.gradedAt || 0) - (a.grade?.gradedAt || 0)));
  return { ok: true, submissions: out, students: Object.keys(scope.students).length };
}
function wholeNumber(v, label, max) {
  const n = Number(v ?? 0);
  if (!Number.isSafeInteger(n) || n < 0 || (max != null && n > max)) fail(400, label);
  return n;
}
async function teacherGrade(store, scopeLib, identity, body, now) {
  const { email, scope } = await teacherRoster(store, scopeLib, identity, String(body?.classId || ''));
  const studentId = String(body?.studentId || '');
  if (!validId(studentId) || !scope.students[studentId]) fail(403, 'This student is not in your class.');
  const info = parseKey(body?.key);
  if (!info) fail(400, 'Unknown mishna.');
  const gold = body?.gold === true;
  const mistakes = wholeNumber(body?.mistakes, 'Mistakes must be a whole number from 0 to 999.', 999);
  const bonus = wholeNumber(body?.bonus, 'Bonus must be a whole number, 0 or more.');
  const comment = String(body?.comment || '').trim().slice(0, 1000);
  const attempt = Number(body?.attempt);
  const gradePoints = gold ? Math.max(0, GOLD_POINTS - mistakes) : 0;
  const lockedUntil = gold ? now + LOCK_MS : null;
  const grade = { gold, mistakes, bonus, gradePoints, totalPoints: gradePoints + bonus, comment, gradedAt: now, gradedBy: email };

  const subPath = ROOT + '/submissions/' + studentId + '/' + info.key;
  let graded = null;
  const claim = await store.tx(subPath, cur => {
    if (!cur || cur.status !== 'submitted' || Number(cur.attempt) !== attempt) return undefined;
    graded = { ...cur, status: 'graded', grade, lockedUntil };
    return graded;
  });
  if (!claim.committed || !graded) fail(409, 'This submission was already graded or replaced. Reload the list.');

  const student = scope.students[studentId];
  const rewardStudentId = graded.rewardStudentId || await resolveRewardStudentId(store, studentId);
  const base = { rewardStudentId, studentId, studentName: graded.studentName || student.name, classId: graded.classId || student.classId, now };
  const tag = studentId + '_' + info.key + '_a' + attempt;
  const gradePaid = await award(store, { ...base, requestId: 'mishnayos_grade_' + tag, amount: gradePoints, source: 'mishnayos-gold',
    reason: 'Mishnayos: gold standard on ' + refLabel(info) + (mistakes ? ' (' + mistakes + ' mistake' + (mistakes === 1 ? '' : 's') + ')' : '') });
  const bonusPaid = await award(store, { ...base, requestId: 'mishnayos_bonus_' + tag, amount: bonus, source: 'mishnayos-bonus',
    reason: 'Mishnayos: teacher bonus on ' + refLabel(info) });
  const pointsNotAdded = (gradePoints + bonus) > 0 && !(gradePaid.ok && bonusPaid.ok);
  await store.update({
    [subPath + '/grade/pointsPaid']: gradePaid.paid + bonusPaid.paid,
    [ROOT + '/submissionHistory/' + studentId + '/' + info.key + '/' + attempt]: { ...graded, grade: { ...grade, pointsPaid: gradePaid.paid + bonusPaid.paid } },
    [ROOT + '/notices/' + studentId + '/n_' + now + '_g_' + info.key]: { kind: 'graded', key: info.key, label: refLabel(info), gold, mistakes,
      gradePoints: gradePaid.paid, bonus: bonusPaid.paid, points: gradePaid.paid + bonusPaid.paid, comment: comment || null,
      lockedUntil, pointsNotAdded: pointsNotAdded || null, createdAt: now, seen: false }
  });
  return { ok: true, status: 'graded', gold, gradePoints: gradePaid.paid, bonus: bonusPaid.paid, lockedUntil, pointsNotAdded };
}

/* One entry point. `who` is { role:'student', studentId, classId } or { role:'teacher', identity }. */
async function mishnayosSubmissions({ store, files, scopeLib, who, body, now = Date.now() }) {
  const action = String(body?.action || '');
  if (who?.role === 'student') {
    if (action === 'submit') return submit(store, files, who, body, now);
    fail(400, 'Unknown action.');
  }
  if (who?.role === 'teacher') {
    if (action === 'teacher-list') return teacherList(store, scopeLib, who.identity, body);
    if (action === 'teacher-grade') return teacherGrade(store, scopeLib, who.identity, body, now);
    fail(400, 'Unknown action.');
  }
  fail(401, 'Sign-in required.');
}

module.exports = { mishnayosSubmissions, parseKey, blockedReason, SUBMIT_POINTS, GOLD_POINTS, LOCK_MS, LOCK_DAYS, ROOT };
