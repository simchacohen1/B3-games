'use strict';
// Posuk Practice teacher review (Issue #694).
//
// The student makes ONE recording (reading + translation together) and
// submits it. There is no AI grading: the teacher listens and grades it.
//
//   submit  : −5 points (the balance may go negative). The posuk is then
//             "pending" and cannot be submitted again until it is graded.
//   grade   : the teacher taps a number from 0 to 10 and that number is the
//             student's points (10 points for a 10). 10 = gold standard: the
//             posuk is locked for 30 days. 1-9 = points, no lock (the student
//             may re-record for gold). 0 = no points, the student may retry.
//             The teacher can change the number later: the server pays or
//             takes back only the difference and updates the lock.
//             A re-record only pays the difference from the best score the
//             student already earned on that posuk (6 then 10 -> +4), so
//             points cannot be farmed.
//   discard : the teacher deletes a waiting recording without grading it.
//             The 5-point charge is always refunded, nothing is awarded,
//             the posuk is not locked and can be submitted again.
//
// Students can write their own attempt records, so nothing here trusts
// them for grades or points. Submissions, per-posuk review status and all
// point changes are written only by this server code (rules: write false).

const wordMarks = require('./posuk-word-marks-core.cjs');

const SUBMIT_COST = 5;
const GOLD_POINTS = 10;
const LOCK_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RANGE = 40;
const MAX_MISTAKES = 100;
const SOURCES = Object.freeze({ submit: 'posuk-submit', gold: 'posuk-gold', refund: 'posuk-refund' });

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

// Points to pay for one grade: only the part above the best score the student
// already earned on this posuk before this recording.
function pointsForGrade({ score, prior = 0 }){
  return Math.max(0, score - prior);
}
const statusForScore = score => score >= GOLD_POINTS ? 'gold' : score > 0 ? 'scored' : 'retry';

function intInRange(v, min, max){
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
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
      for(const key of sel.keys) next[key] = { status: 'pending', submissionId: attemptId, selectionKey, submittedAt: t, bestPoints: Number(next[key]?.bestPoints) || 0 };
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

  // Shared by grade and discard: the teacher must own this student and class.
  async function loadForTeacher({ scope, studentId, submissionId }){
    if(!validKey(studentId) || !validKey(submissionId)) fail('Missing submission.');
    if(scope && !scope.students?.[studentId]) fail('This student does not belong to your selected class.', 403);
    const ref = submissionRef(studentId, submissionId);
    const before = (await ref.get()).val();
    if(!before) fail('Submission not found.', 404);
    if(scope && scope.selected && before.classId && !(scope.students[studentId].classIds || [scope.students[studentId].classId]).includes(before.classId))
      fail('This submission belongs to another class.', 403);
    return { ref, before };
  }
  const keysOf = sub => Array.isArray(sub.posukKeys) ? sub.posukKeys : (posukKeysForSelection(sub.selectionKey)?.keys || []);
  const refLabel = sub => `Perek ${sub.perek} · Posuk ${sub.startPosuk}${sub.endPosuk > sub.startPosuk ? '–' + sub.endPosuk : ''}`;

  // points: a whole number 0-10. Can be called again to change the grade.
  // (Old cached pages that send gold + mistakes still work.)
  async function grade({ teacherEmail, scope, studentId, submissionId, points: picked, gold, mistakes }){
    let score;
    if(picked !== undefined && picked !== null){
      score = intInRange(picked, 0, GOLD_POINTS);
      if(score === null) fail('Pick a grade from 0 to 10.');
    }else{
      const m = intInRange(mistakes ?? 0, 0, MAX_MISTAKES);
      if(m === null) fail('Mistakes must be a whole number from 0 to ' + MAX_MISTAKES + '.');
      score = gold === true ? Math.max(0, GOLD_POINTS - m) : 0;
    }
    const t = now();
    const { ref, before } = await loadForTeacher({ scope, studentId, submissionId });
    if(before.status === 'deleted') fail('This recording was deleted.', 409);

    // The best score earned on these posuk(im) BEFORE this recording. It was
    // copied into the review row when the student sent it; once saved here it
    // stays on the submission so a later change of grade still has it.
    let prior = Number(before.priorPoints);
    if(before.priorPoints === undefined || before.priorPoints === null || !Number.isFinite(prior)){
      const reviewRows = (await reviewsRef(studentId).get()).val() || {};
      prior = keysOf(before).reduce((best, key) => {
        const row = reviewRows[key];
        return row && row.submissionId === submissionId ? Math.max(best, Number(row.bestPoints) || 0) : best;
      }, 0);
    }
    // A change of an already-saved grade: bestPoints in the row then includes
    // this recording's own score, so only trust it for a first grade.
    if(before.status !== 'pending' && !(before.priorPoints !== undefined && before.priorPoints !== null)) prior = 0;
    const status = statusForScore(score);
    const target = pointsForGrade({ score, prior });
    let delta = 0, seq = 0, paidBefore = 0;
    const tx = await ref.transaction(cur => {
      if(cur === null) return null;
      if(cur.status === 'deleted') return;
      // Older grades only recorded pointsAwarded (gold + any bonus), so that is what was paid.
      paidBefore = cur.status === 'pending' ? 0 : Number.isFinite(Number(cur.pointsPaid)) ? Number(cur.pointsPaid) : (Number(cur.pointsAwarded) || 0);
      delta = target - paidBefore;
      seq = (Number(cur.gradeSeq) || 0) + 1;
      return { ...cur, status, score, mistakes: 0, bonus: 0, pointsAwarded: target, pointsPaid: target, priorPoints: prior, gradeSeq: seq,
        gradedAt: t, gradedBy: String(teacherEmail || '').slice(0, 200), lockedUntil: status === 'gold' ? t + LOCK_MS : null, teacherNote: null };
    });
    if(!tx.committed){
      const live = (await ref.get()).val() || {};
      if(live.status === 'deleted') fail('This recording was deleted.', 409);
      fail('Could not save the grade. Please try again.', 409);
    }
    const sub = tx.snapshot.val() || { ...before };

    // Update the per-posuk status, but only where this submission is still the one on record.
    await reviewsRef(studentId).transaction(cur => {
      const next = { ...(cur || {}) };
      for(const key of keysOf(sub)){
        if(next[key] && next[key].submissionId !== submissionId) continue;
        next[key] = { status, submissionId, selectionKey: sub.selectionKey, submittedAt: sub.submittedAt || null,
          gradedAt: t, lockedUntil: sub.lockedUntil || null, score, bestPoints: Math.max(prior, score),
          mistakes: 0, bonus: 0, pointsAwarded: target };
      }
      return next;
    });

    let award = { ok: true, amount: 0 };
    if(delta !== 0){
      const rewardStudentId = sub.rewardStudentId || (resolveRewardStudentId ? await resolveRewardStudentId(studentId) : null);
      if(rewardStudentId){
        award = await postPoints({ requestId: `posukgrade_${studentId}_${submissionId}_${seq}`.slice(0, 220), rewardStudentId, studentId,
          source: SOURCES.gold, amount: delta,
          reason: `Posuk Practice grade ${score}/10${prior ? ' (already had ' + prior + ')' : ''}${paidBefore ? ' — grade changed' : ''} — ${refLabel(sub)}`,
          record: { submissionId, selectionKey: sub.selectionKey, perek: sub.perek || null, posuk: sub.startPosuk || null, score, priorPoints: prior } });
      }else award = { ok: false, error: 'No Student Rewards profile.' };
      if(!award.ok){
        // Nothing was posted, so keep the record of what was paid honest.
        await ref.transaction(cur => cur ? { ...cur, pointsPaid: (Number(cur.pointsPaid) || 0) - delta } : cur);
      }
      await ref.update({ pointsPosted: !!award.ok });
    }
    return { ok: true, submission: { ...sub, pointsPosted: delta !== 0 ? !!award.ok : null }, points: delta, pointsTotal: target,
      pointsPosted: !!award.ok, score, priorPoints: prior, status };
  }

  // The teacher deletes a waiting recording without grading it. The record is
  // kept (status "deleted"), nothing is awarded, the posuk is not locked, and
  // the 5-point submit charge is always refunded.
  async function discard({ teacherEmail, scope, studentId, submissionId }){
    const t = now();
    const { ref } = await loadForTeacher({ scope, studentId, submissionId });
    const tx = await ref.transaction(cur => {
      if(cur === null) return null;
      if(cur.status !== 'pending') return;
      return { ...cur, status: 'deleted', deletedAt: t, deletedBy: String(teacherEmail || '').slice(0, 200), pointsAwarded: 0 };
    });
    if(!tx.committed){
      const live = (await ref.get()).val() || {};
      if(live.status === 'deleted') fail('This recording was already deleted.', 409);
      if(live.status && live.status !== 'pending') fail('This recording was already graded, so it can no longer be deleted.', 409);
      fail('Could not delete the recording. Please try again.', 409);
    }
    const sub = tx.snapshot.val();

    // Put each posuk back the way it was before this recording was sent.
    await reviewsRef(studentId).transaction(cur => {
      const next = { ...(cur || {}) };
      for(const key of keysOf(sub)){
        const row = next[key];
        if(!row || row.submissionId !== submissionId) continue;
        const best = Number(row.bestPoints) || 0;
        if(best > 0) next[key] = { status: statusForScore(best), score: best, bestPoints: best, lockedUntil: null, mistakes: 0, pointsAwarded: 0 };
        else delete next[key];
      }
      return Object.keys(next).length ? next : null;
    });

    let refund = { ok: true, amount: 0 };
    if(sub.submitCharged === true){
      const rewardStudentId = sub.rewardStudentId || (resolveRewardStudentId ? await resolveRewardStudentId(studentId) : null);
      refund = rewardStudentId
        ? await postPoints({ requestId: `posukrefund_${studentId}_${submissionId}`.slice(0, 220), rewardStudentId, studentId,
            source: SOURCES.refund, amount: SUBMIT_COST, reason: `Posuk Practice recording deleted by teacher, 5 points refunded — ${refLabel(sub)}`,
            record: { submissionId, selectionKey: sub.selectionKey, perek: sub.perek || null, posuk: sub.startPosuk || null } })
        : { ok: false, error: 'No Student Rewards profile.' };
      await ref.update({ refundPosted: !!refund.ok });
    }
    return { ok: true, refunded: refund.ok && sub.submitCharged === true ? SUBMIT_COST : 0, refundPosted: !!refund.ok };
  }

  // The teacher taps words of the posuk (read wrong / translated wrong). This only stores the marks and the SUGGESTED
  // score worked out from them. It never touches status, score, points, the lock or the Student Rewards balance.
  async function saveWordMarks({ teacherEmail, scope, studentId, submissionId, readWrong, translationWrong }){
    const { ref, before } = await loadForTeacher({ scope, studentId, submissionId });
    if(before.status === 'deleted') fail('This recording was deleted.', 409);
    const record = wordMarks.build(before.hebrewText, readWrong, translationWrong);
    const t = now();
    const tx = await ref.transaction(cur => {
      if(cur === null) return null;
      if(cur.status === 'deleted') return;
      return { ...cur, wordReview: { ...record, markedAt: t, markedBy: String(teacherEmail || '').slice(0, 200) } };
    });
    if(!tx.committed) fail('Could not save the word marks. Please try again.', 409);
    return { ok: true, total: record.total, suggested: record.suggested, markedAt: t };
  }

  return { submit, grade, discard, postPoints, saveWordMarks };
}

module.exports = { createPosukReview, posukKeysForSelection, pointsForGrade, statusForScore, blockedReason, validSelectionKey,
  SUBMIT_COST, GOLD_POINTS, LOCK_MS, SOURCES };
