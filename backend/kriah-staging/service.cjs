'use strict';
const crypto = require('node:crypto');
const Core = require('./core.js');
const PROJECT = 'fun-torah-tools-staging';
const ROOT = 'b3Private/kriahAssessmentCenter/classes/';
const WS = 'b3Games/workspaces/b3-2026/';
const MAX_BYTES = 2 * 1024 * 1024;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const key = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const safeKey = value => { if (!key(value)) fail(400, 'Invalid record identifier.'); return value; };
const base = classId => ROOT + classId;
const recordPath = (classId, sid, id) => base(classId) + '/students/' + safeKey(sid) + '/records/' + safeKey(id);
const newId = now => String(now).padStart(13, '0') + '-' + crypto.randomUUID();
const copy = value => JSON.parse(JSON.stringify(value));

function createService({ projectId, store, audio, now = Date.now }) {
  if (projectId !== PROJECT) throw new Error('Kriah service is staging only.');
  async function teacher(identity, classId) {
    if (!identity?.uid || identity.email_verified !== true || identity.firebase?.sign_in_provider !== 'google.com') fail(403, 'Verified Google teacher sign-in required.');
    const [admin, row] = await Promise.all([store.get('b3Games/admins/' + safeKey(identity.uid)), store.get(WS + 'teachers/' + identity.uid)]);
    const owner = identity.email === 'owner@funtorahtools-staging.test';
    if (!owner && admin?.active !== true && (row?.active !== true || row.classIds?.[classId] !== true)) fail(403, 'Class is not assigned to this teacher.');
    return true;
  }
  async function member(classId, sid, cls) {
    safeKey(sid);
    const [profile, memberships] = await Promise.all([store.get('b3Games/students/' + sid + '/profile'), store.get('b3Games/students/' + sid + '/memberships')]);
    const current = Object.values(memberships || {}).some(m => m?.active === true && m.workspaceId === 'b3-2026' && m.classId === classId);
    if (cls.members?.[sid]?.active !== true || profile?.active !== true || profile.kriahSynthetic !== true || !current) fail(403, 'Student is not an active fictional member of this class.');
    return { id: sid, name: String(profile.name || sid) };
  }
  async function access(identity, classId, sid, teacherOnly = false) {
    if (!identity?.uid) fail(401, 'Sign in on the staging site.');
    if (!key(classId) || !classId.startsWith('kriah-test-')) fail(403, 'Only Kriah fictional test classes are enabled.');
    const cls = await store.get(WS + 'classes/' + classId);
    if (cls?.active !== true || cls.kriahSynthetic !== true || cls.toolGrants?.['kriah-assessment'] !== true) fail(403, 'This fictional class is not enabled for Kriah.');
    const student = identity.b3StudentRole === 'student';
    if (student) {
      if (teacherOnly || identity.b3ClassId !== classId || identity.b3StudentId !== sid) fail(403, 'You can open only your own work.');
      await member(classId, sid, cls);
    } else { await teacher(identity, classId); if (sid) await member(classId, sid, cls); }
    return { cls, student };
  }
  function visible(record, student) {
    if (!student) return record;
    const r = { id: record.id, studentId: record.studentId, exercise: record.exercise, status: record.status === 'in_progress' ? 'submitted' : record.status, revision: record.revision, createdAt: record.createdAt, submittedAt: record.submittedAt || null, audio: record.audio ? { size: record.audio.size, type: record.audio.type, duration: record.audio.duration } : null, parentId: record.parentId || null };
    if (record.status === 'reviewed' && record.shareFeedback) Object.assign(r, { feedback: record.feedback, recommendation: record.recommendation, summary: record.summary, reviewedAt: record.reviewedAt });
    return r;
  }
  async function readRecord(classId, sid, id) {
    const row = await store.get(recordPath(classId, sid, id));
    if (!row || row.status === 'deleting') fail(404, 'Assessment not found.');
    return row;
  }
  async function handle(identity, body) {
    if (!body || typeof body !== 'object') fail(400, 'Invalid request.');
    const { action, classId, studentId: sid, id } = body;
    if (action === 'classes') {
      if (!identity?.uid) fail(401, 'Sign in on staging.');
      if (identity.b3StudentRole === 'student') {
        const { cls } = await access(identity, identity.b3ClassId, identity.b3StudentId);
        return { classes: [{ id: identity.b3ClassId, name: cls.name }], studentId: identity.b3StudentId, role: 'student' };
      }
      // Teacher rows also hold principal's derived, owner-managed classIds.
      const row = await store.get(WS + 'teachers/' + safeKey(identity.uid));
      const admin = await store.get('b3Games/admins/' + identity.uid);
      let ids = Object.keys(row?.classIds || {}).filter(k => row.classIds[k] === true && k.startsWith('kriah-test-') && key(k));
      if (identity.email === 'owner@funtorahtools-staging.test' || admin?.active === true) ids = Object.keys(await store.list(WS + 'classes', { prefix: 'kriah-test-', limit: 100 }));
      const classes = [];
      for (const cid of ids.slice(0, 100)) {
        try { const { cls } = await access(identity, cid, null, true); classes.push({ id: cid, name: String(cls.name || cid) }); } catch (e) { if (e.code !== 403) throw e; }
      }
      return { classes, role: 'teacher' };
    }
    const teacherActions = ['openClass', 'saveExercise', 'assign', 'grade', 'delete', 'setSkill'];
    const auth = await access(identity, classId, sid, teacherActions.includes(action));
    if (action === 'openClass') {
      const students = [];
      for (const studentId of Object.keys(auth.cls.members || {}).slice(0, 100)) {
        try { students.push(await member(classId, studentId, auth.cls)); } catch (e) { if (e.code !== 403) throw e; }
      }
      const library = await store.list(base(classId) + '/library', { limit: 100 });
      return { students, library: Object.values(library) };
    }
    if (action === 'saveExercise') {
      const ex = Core.exercise(body.exercise), eid = body.exerciseId ? safeKey(body.exerciseId) : newId(now());
      await store.set(base(classId) + '/library/' + eid, { ...ex, id: eid });
      return { id: eid };
    }
    if (action === 'assign') {
      if (!Array.isArray(body.studentIds) || !body.studentIds.length || body.studentIds.length > 30 || new Set(body.studentIds).size !== body.studentIds.length) fail(400, 'Select 1–30 students.');
      const ex = await store.get(base(classId) + '/library/' + safeKey(body.exerciseId));
      if (!ex) fail(404, 'Exercise not found.');
      const clean = Core.exercise(ex), changes = {}, assigned = [];
      for (const studentId of body.studentIds) {
        await member(classId, studentId, auth.cls);
        const rid = newId(now()); assigned.push({ studentId, id: rid });
        changes[recordPath(classId, studentId, rid)] = { id: rid, studentId, exercise: clean, status: 'assigned', revision: 0, marks: [], createdAt: now(), assignedBy: identity.uid };
      }
      // Recheck authorization after reading all selected students.
      await access(identity, classId, null, true);
      await store.update(changes);
      return { assigned };
    }
    if (!sid) fail(400, 'Choose a student.');
    if (action === 'skills') {
      const rows = await store.list(base(classId) + '/students/' + sid + '/mastery', { limit: 100 });
      return { skills: Object.fromEntries(Object.entries(rows).filter(([, row]) => !auth.student || row.shared === true)) };
    }
    if (action === 'setSkill') {
      const skill = Core.skillId(body.kind, body.label);
      if (!['mastered', 'needs-practice', 'not-assessed'].includes(body.state)) fail(400, 'Choose a mastery state.');
      await store.set(base(classId) + '/students/' + sid + '/mastery/' + skill, { kind: body.kind, label: body.label, state: body.state, shared: body.shared === true, updatedAt: now(), teacherId: identity.uid });
      return { saved: true };
    }
    if (action === 'list') {
      const limit = body.limit == null ? 25 : body.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 25) fail(400, 'Page size must be 1–25.');
      if (body.before != null) safeKey(body.before);
      const rows = await store.list(base(classId) + '/students/' + sid + '/records', { limit: limit + 1, before: body.before });
      const ordered = Object.values(rows).sort((a, b) => b.id.localeCompare(a.id));
      const page = ordered.slice(0, limit);
      return { records: page.filter(r => r.status !== 'deleting').map(r => {
        const v = visible(r, auth.student);
        // List/report metadata never returns internal mark notes or audio bytes.
        const out = { id: v.id, studentId: sid, exercise: { title: v.exercise.title, level: v.exercise.level, type: v.exercise.type }, status: v.status, createdAt: v.createdAt, submittedAt: v.submittedAt || null, reviewedAt: v.reviewedAt || null, feedback: v.feedback || '', recommendation: v.recommendation || '', summary: v.summary || null };
        return out;
      }), next: ordered.length > limit ? page[page.length - 1].id : null };
    }
    // Deletion is resumable after an object-store outage, including orphaned
    // uploads whose metadata write never completed.
    if (action === 'delete') {
      safeKey(id);
      if (body.confirm !== id) fail(400, 'Confirm the assessment identifier.');
      await store.change(recordPath(classId, sid, id), row => row && ({ ...row, status: 'deleting' }));
      await audio.remove('kriah/' + classId + '/' + sid + '/' + id);
      await store.set(recordPath(classId, sid, id), null);
      return { deleted: true };
    }
    const current = await readRecord(classId, sid, id);
    if (action === 'get') return { record: visible(current, auth.student) };
    if (action === 'audioRead') {
      if (!current.audio) fail(404, 'No recording submitted yet.');
      return { audio: await audio.read(current.audio.path), type: current.audio.type };
    }
    if (action === 'submit') {
      if (!auth.student) fail(403, 'Only the assigned student can submit.');
      if (typeof body.audio !== 'string' || body.audio.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.audio)) fail(400, 'Invalid recording (maximum 2 MiB).');
      const bytes = Buffer.from(body.audio, 'base64');
      const type = String(body.type || '').split(';')[0];
      const magic = type === 'audio/webm' ? bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) : type === 'audio/ogg' ? bytes.subarray(0, 4).toString() === 'OggS' : type === 'audio/mp4' ? bytes.subarray(4, 8).toString() === 'ftyp' : false;
      if (!magic || bytes.length < 16 || bytes.length > MAX_BYTES || !Number.isFinite(body.duration) || body.duration <= 0 || body.duration > 300) fail(400, 'Use a supported audio recording up to 5 minutes / 2 MiB.');
      const hash = crypto.createHash('sha256').update(bytes).digest('hex');
      if (current.audio) {
        if (current.audio.hash === hash) return { id, duplicate: true };
        fail(409, 'The original recording is preserved. Start a new attempt to record again.');
      }
      if (current.status !== 'assigned') fail(409, 'This attempt cannot accept a recording.');
      const path = 'kriah/' + classId + '/' + sid + '/' + id;
      // Conditional object creation makes concurrent retries preserve the original.
      await audio.create(path, bytes, type, hash);
      try {
        await access(identity, classId, sid);
        await store.change(recordPath(classId, sid, id), row => {
        if (!row || row.status === 'deleting') fail(404, 'Assessment not found.');
        if (row.audio) { if (row.audio.hash !== hash) fail(409, 'A different recording was already submitted.'); return row; }
        if (row.status !== 'assigned') fail(409, 'Attempt changed; reload.');
        return { ...row, audio: { path, hash, size: bytes.length, type, duration: body.duration }, status: 'submitted', submittedAt: now(), revision: row.revision + 1 };
        });
      } catch (error) {
        const latest = await store.get(recordPath(classId, sid, id));
        if (!latest || latest.status === 'deleting') await audio.remove(path);
        throw error;
      }
      return { id };
    }
    if (action === 'retry') {
      if (!auth.student || !current.audio) fail(409, 'Submit this attempt before starting another.');
      const rid = newId(now());
      // Deterministic link, transaction makes repeated network retries idempotent.
      const row = await store.change(recordPath(classId, sid, id), value => {
        if (!value || value.status === 'deleting') fail(404, 'Assessment not found.');
        return value.retryId ? value : { ...value, retryId: rid };
      });
      const nextId = row.retryId;
      await store.change(recordPath(classId, sid, nextId), value => value || { id: nextId, studentId: sid, parentId: id, exercise: copy(current.exercise), status: 'assigned', revision: 0, marks: [], createdAt: now(), assignedBy: current.assignedBy });
      return { id: nextId };
    }
    if (action === 'grade') {
      const cleanMarks = Core.marks(current.exercise, body.marks);
      if (!current.audio) fail(409, 'Wait for the student recording.');
      const timing = body.timing?.confirmed === true ? { confirmed: true, seconds: Number(body.timing.seconds) } : null;
      if (timing && (!Number.isFinite(timing.seconds) || timing.seconds <= 0 || timing.seconds > 300)) fail(400, 'Confirm a valid 1–300 second timing.');
      const updated = await store.change(recordPath(classId, sid, id), row => {
        if (!row || row.status === 'deleting') fail(404, 'Assessment not found.');
        if (row.revision !== body.revision) fail(409, 'Someone changed this assessment. Reload before saving.');
        const ex = { ...row.exercise, countSelfCorrection: body.countSelfCorrection === true };
        return { ...row, exercise: ex, marks: cleanMarks, timing, status: body.final === true ? 'reviewed' : 'in_progress', reviewedAt: body.final === true ? now() : null, feedback: String(body.feedback || '').slice(0, 1000), recommendation: String(body.recommendation || '').slice(0, 500), shareFeedback: body.shareFeedback === true, summary: Core.summary(ex, cleanMarks, timing), gradedBy: identity.uid, revision: row.revision + 1 };
      });
      return { record: updated };
    }
    fail(400, 'Unknown Kriah action.');
  }
  return { handle };
}
module.exports = { createService, PROJECT, ROOT, WS, MAX_BYTES, recordPath };
