'use strict';
// Posuk Practice teacher review (Issue #694).
//
// The student makes ONE recording (reading + translation together) and
// submits it. There is no AI grading: the teacher listens and grades it.
//
//   submit  : −5 points (the balance may go negative). The posuk is then
//             "pending" and cannot be submitted again until it is graded.
//   grade   : gold standard  → +10 − 1 per mistake (never below 0) + bonus.
//                              The posuk is locked for 30 days.
//             not gold       → no points; the student may try again.
//
// Students can write their own attempt records, so nothing here trusts
// them for grades or points. Submissions, per-posuk review status and all
// point changes are written only by this server code (rules: write false).

const SUBMIT_COST = 5;
const GOLD_POINTS = 10;
const LOCK_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RANGE = 40;
const MAX_MISTAKES = 100;
const MAX_BONUS = 100000;
const SOURCES = Object.freeze({ submit: 'posuk-submit', gold: 'posuk-gold' });
// Per-word marks the teacher taps on the posuk (Issue #749). A word with no
// mark is correct. Must match record_pesukim/word-marks.js.
const WORD_MARKS = Object.freeze(['incorrect', 'readOkTransWrong', 'readWrongTransOk', 'bothWrong', 'skipped', 'review']);
const MAX_WORD_MARKS = 400;

const validKey = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v);
const validSelectionKey = v => typeof v === 'string' && /^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*_\d{1,3}_\d{1,3}(?:-\d{1,3})?$/.test(v) && v.length <= 120;
const fail = (message, code = 400) => { throw Object.assign(new Error(message), { code }); };

// "Vayeitzei_29_5-7" → ["Vayeitzei_29_5","Vayeitzei_29_6","Vayeitzei_29_7"]
function posukKeysForSelection(selectionKey){
  if(!validSelectionKey(selectionKey)) return null;
  const parts = selectionKey.split('_');
  const last = parts.pop(), perek = Number(parts.pop()), prefix = parts.join('_');
  const m = /^(\d+)(?:-(\d+))?$/.exec(last);
  const start = Number(m[1]), end = Number(m[2] || m[1]);
  if(!perek || !start || end < start || end - start + 1 > MAX_RANGE) return null;
  const out = [];
  for(let n = start; n <= end; n++) out.push(prefix + '_' + perek + '_' + n);
  return { prefix, perek, start, end, keys: out };
}

// Points for one graded submission. Bonus is only given with gold standard.
function pointsForGrade({ gold, mistakes, bonus }){
  if(!gold) return 0;
  return Math.max(0, GOLD_POINTS - mistakes) + bonus;
}

function intInRange(v, min, max){
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

const splitWords = text => String(text || '').trim().split(/\s+/).filter(Boolean);

// Checks the teacher's { wordIndex: markId } against the Hebrew text saved
// with the submission and returns [{ i, word, mark }] in posuk order, or
// null when nothing is marked. The word itself is copied in so the student
// page and reports never have to re-split the text.
function cleanWordMarks(raw, hebrewText){
  if(raw === undefined || raw === null) return null;
  if(typeof raw !== 'object' || Array.isArray(raw)) fail('Word marks are not valid.');
  const entries = Object.entries(raw);
  if(entries.length > MAX_WORD_MARKS) fail('Too many word marks.');
  const words = splitWords(hebrewText);
  const out = [];
  for(const [k, mark] of entries){
    if(!/^\d{1,4}$/.test(k) || Number(k) >= words.length) fail('A word mark does not match the posuk.');
    if(!WORD_MARKS.includes(mark)) fail('Unknown word mark.');
    out.push({ i: Number(k), word: words[Number(k)].slice(0, 80), mark });
  }
  out.sort((a, b) => a.i - b.i);
  return out.length ? out : null;
}

// Is this posuk blocked from a new submission right now?
function blockedReason(row, now){
  if(!row || typeof row !== 'object') return '';
  if(row.status === 'pending') return 'pending';
  if(row.status === 'gold' && Number(row.lockedUntil) > now) return 'gold';
  return '';
}

function createPosukReview({ rtdb, now = () => Date.now(), SR_ROOT = 'studentRewards', resolveRewardStudentId, studentInfo, fileExists }){
  const reviewsRef = sid => rtdb.ref(`posukPractice/reviews/${sid}`);
  const submissionRef = (sid, id) => rtdb.ref(`posukPractice/submissions/${sid}/${id}`);

  // Posts an already-authorized point change exactly once. Unlike the other
  // awards this does NOT clamp at zero: the owner wants the −5 submit charge
  // to be able to take a balance below zero, and a later gold award must add
  // its full amount to a negative balance.
  async function postPoints({ requestId, rewardStudentId, studentId, source, amount, reason, record }){
    const ref = rtdb.ref(`${SR_ROOT}/pointRequests/${requestId}`);
    const info = studentInfo ? await studentInfo(rewardStudentId) : { name: rewardStudentId, classId: null };
    const claimId = `${now()}_${Math.random().toString(36).slice(2)}`;
    const seed = { id: requestId, status: 'processing', automatic: true, amount, source, reason,
      practiceStudentId: studentId, studentId, rewardStudentId, studentName: info.name, classId: info.classId,
      createdAt: now(), claimId, ...record };
    const tx = await ref.transaction(cur => cur ? undefined : seed);
    const claimed = tx.committed && tx.snapshot.val()?.claimId === claimId;
    if(!claimed){
      const existing = (await ref.get()).val() || {};
      return { ok: true, newlyPosted: false, status: existing.status || 'approved', amount: Number(existing.actualAmount ?? existing.amount ?? amount) };
    }
    const bal = await rtdb.ref(`${SR_ROOT}/students/${rewardStudentId}/rewardBalance`).transaction(cur => Number(cur || 0) + amount);
    if(!bal.committed){
      await ref.update({ status: 'error', lastError: 'Balance update did not commit' });
      return { ok: false, error: 'Could not update the point balance.' };
    }
    const balanceAfter = Number(bal.snapshot.val() || 0);
    await ref.update({ status: 'approved', actualAmount: amount, balanceAfter, approvedAutomatically: true,
      reviewedBy: 'Posuk Practice teacher review', reviewedAt: now() });
    return { ok: true, newlyPosted: true, status: 'approved', amount, balanceAfter };
  }

  async function submit({ studentId, classId, selectionKey, attemptId, hebrewText, sefer }){
    if(!validKey(studentId)) fail('Student sign-in required.', 401);
    if(!validKey(attemptId)) fail('Missing recording.');
    const sel = posukKeysForSelection(String(selectionKey || ''));
    if(!sel) fail('Choose a valid posuk.');

    const attempt = (await rtdb.ref(`posukPractice/attempts/${studentId}/${selectionKey}/${attemptId}`).get()).val();
    const audioPath = String(attempt?.combinedAudioStoragePath || '');
    if(!attempt || !audioPath) fail('The recording was not saved. Please record again.', 409);
    if(!audioPath.startsWith(`posukPractice/${studentId}/`) || audioPath.includes('..')) fail('That recording does not belong to you.', 403);
    if(fileExists && !(await fileExists(audioPath))) fail('The recording file was not uploaded. Please record again.', 409);

    const existing = (await submissionRef(studentId, attemptId).get()).val();
    if(existing) return { ok: true, alreadySubmitted: true, submission: existing };

    // One transaction over this student's whole review node, so every posuk
    // in the selection is checked and marked pending together.
    const t = now();
    let blocked = null;
    const tx = await reviewsRef(studentId).transaction(cur => {
      blocked = null;
      const next = { ...(cur || {}) };
      for(const key of sel.keys){
        const why = blockedReason(next[key], t);
        if(why){ blocked = { key, why, lockedUntil: next[key].lockedUntil || null }; return; }
      }
      for(const key of sel.keys) next[key] = { status: 'pending', submissionId: attemptId, selectionKey, submittedAt: t };
      return next;
    });
    if(!tx.committed){
      if(blocked?.why === 'pending') fail('This posuk is waiting for your teacher to grade it.', 409);
      if(blocked?.why === 'gold') fail('This posuk is gold standard and locked until ' + new Date(Number(blocked.lockedUntil)).toDateString() + '.', 409);
      fail('Could not submit. Please try again.', 409);
    }

    const submission = {
      id: attemptId, studentId, classId: validKey(classId) ? classId : null, selectionKey,
      sefer: validKey(String(sefer || '')) ? String(sefer) : null,
      perek: sel.perek, startPosuk: sel.start, endPosuk: sel.end, posukKeys: sel.keys,
      hebrewText: String(hebrewText || '').slice(0, 4000),
      audioStoragePath: audioPath, mimeType: String(attempt.combinedAudioMimeType || '').slice(0, 60) || null,
      durationMs: Number(attempt.combinedDurationMs) || null,
      status: 'pending', submittedAt: t, submitCost: SUBMIT_COST
    };
    await submissionRef(studentId, attemptId).set(submission);

    let charge = { ok: false, error: 'No Student Rewards profile.' };
    const rewardStudentId = resolveRewardStudentId ? await resolveRewardStudentId(studentId) : null;
    if(rewardStudentId){
      charge = await postPoints({ requestId: `posuksubmit_${studentId}_${attemptId}`.slice(0, 220), rewardStudentId, studentId,
        source: SOURCES.submit, amount: -SUBMIT_COST, reason: `Posuk Practice submitted — Perek ${sel.perek} · Posuk ${sel.start}${sel.end > sel.start ? '–' + sel.end : ''}`,
        record: { submissionId: attemptId, selectionKey, perek: sel.perek, posuk: sel.start } });
    }
    await submissionRef(studentId, attemptId).update({ submitCharged: !!charge.ok, rewardStudentId: rewardStudentId || null });
    return { ok: true, submission: { ...submission, submitCharged: !!charge.ok }, pointsCharged: charge.ok ? SUBMIT_COST : 0, balanceAfter: charge.balanceAfter ?? null };
  }

  async function grade({ teacherEmail, scope, studentId, submissionId, gold, mistakes, bonus, note, wordMarks }){
    if(!validKey(studentId) || !validKey(submissionId)) fail('Missing submission.');
    if(scope && !scope.students?.[studentId]) fail('This student does not belong to your selected class.', 403);
    const isGold = gold === true;
    const m = intInRange(mistakes ?? 0, 0, MAX_MISTAKES);
    const b = intInRange(bonus ?? 0, 0, MAX_BONUS);
    if(m === null) fail('Mistakes must be a whole number from 0 to ' + MAX_MISTAKES + '.');
    if(b === null) fail('Bonus must be a whole number of 0 or more.');
    if(!isGold && b > 0) fail('Bonus points can only be given with gold standard.');
    const points = pointsForGrade({ gold: isGold, mistakes: m, bonus: b });
    const t = now();
    const ref = submissionRef(studentId, submissionId);
    const before = (await ref.get()).val();
    if(!before) fail('Submission not found.', 404);
    if(scope && scope.selected && before.classId && !(scope.students[studentId].classIds || [scope.students[studentId].classId]).includes(before.classId))
      fail('This submission belongs to another class.', 403);
    const marks = cleanWordMarks(wordMarks, before.hebrewText);

    const result = {
      status: isGold ? 'gold' : 'retry', mistakes: m, bonus: b, pointsAwarded: points,
      gradedAt: t, gradedBy: String(teacherEmail || '').slice(0, 200), lockedUntil: isGold ? t + LOCK_MS : null,
      teacherNote: String(note || '').slice(0, 500) || null,
      wordMarks: marks
    };
    const tx = await ref.transaction(cur => {
      if(cur === null) return null;
      if(cur.status !== 'pending') return;
      return { ...cur, ...result };
    });
    if(!tx.committed){
      const live = (await ref.get()).val() || {};
      if(live.status && live.status !== 'pending') fail('This recording was already graded.', 409);
      fail('Could not save the grade. Please try again.', 409);
    }
    const sub = tx.snapshot.val() || { ...before, ...result };

    // Update the per-posuk status, but only where this submission is still
    // the one on record.
    const keys = Array.isArray(sub.posukKeys) ? sub.posukKeys : (posukKeysForSelection(sub.selectionKey)?.keys || []);
    await reviewsRef(studentId).transaction(cur => {
      const next = { ...(cur || {}) };
      for(const key of keys){
        if(next[key] && next[key].submissionId !== submissionId) continue;
        next[key] = { status: result.status, submissionId, selectionKey: sub.selectionKey, submittedAt: sub.submittedAt || null,
          gradedAt: t, lockedUntil: result.lockedUntil, mistakes: m, bonus: b, pointsAwarded: points };
      }
      return next;
    });

    let award = { ok: true, amount: 0 };
    if(points > 0){
      const rewardStudentId = sub.rewardStudentId || (resolveRewardStudentId ? await resolveRewardStudentId(studentId) : null);
      if(rewardStudentId){
        award = await postPoints({ requestId: `posukgold_${studentId}_${submissionId}`.slice(0, 220), rewardStudentId, studentId,
          source: SOURCES.gold, amount: points,
          reason: `Gold standard${m ? ' (' + m + ' mistake' + (m === 1 ? '' : 's') + ')' : ''}${b ? ' + ' + b + ' bonus' : ''} — Perek ${sub.perek} · Posuk ${sub.startPosuk}${sub.endPosuk > sub.startPosuk ? '–' + sub.endPosuk : ''}`,
          record: { submissionId, selectionKey: sub.selectionKey, perek: sub.perek || null, posuk: sub.startPosuk || null, bonus: b, mistakes: m } });
      }else award = { ok: false, error: 'No Student Rewards profile.' };
      await ref.update({ pointsPosted: !!award.ok });
    }
    return { ok: true, submission: { ...sub, pointsPosted: points > 0 ? !!award.ok : null }, points, pointsPosted: !!award.ok };
  }

  return { submit, grade, postPoints };
}

module.exports = { createPosukReview, posukKeysForSelection, pointsForGrade, blockedReason, validSelectionKey, cleanWordMarks, WORD_MARKS,
  SUBMIT_COST, GOLD_POINTS, LOCK_MS, SOURCES };
