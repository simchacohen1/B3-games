'use strict';
// Homework Portal service. Every read and write is authorized here with the
// Admin SDK; the browser never touches the assignmentCenter database tree
// (it has no client rules, so clients are denied by default).
// Students prove who they are with their own passcode (same check as the other
// student tools). Teachers prove who they are with a verified Google sign-in
// and must be assigned to the class (or be the owner/admin).
const crypto = require('node:crypto');
const policy = require('./homework-policy.cjs');
const { resolveStudent } = require('./student-login-core.cjs');
const { guarded } = require('./auth-attempts.cjs');

const WS = 'b3-2026';
const key = s => typeof s === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(s);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const text = (s, n) => String(s == null ? '' : s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f<>]/g, '').trim().slice(0, n);
const base = classId => 'assignmentCenter/workspaces/' + WS + '/classes/' + classId;
const OPEN = ['assigned', 'in_progress', 'returned'];

async function teacherAccess(store, identity, classId) {
  if (!identity || !identity.uid || identity.email_verified !== true ||
      !identity.firebase || identity.firebase.sign_in_provider !== 'google.com')
    fail(403, 'Verified Google teacher sign-in required.');
  if (!key(classId)) fail(400, 'Choose a class.');
  const cls = await store.get('b3Games/workspaces/' + WS + '/classes/' + classId);
  if (!cls || cls.active === false) fail(403, 'This class is not available.');
  if (cls.toolGrants?.homework !== true) fail(403, 'Homework is not turned on for this class.');
  const admin = await store.get('b3Games/admins/' + identity.uid);
  const owner = !!(admin && admin.active !== false);
  if (!owner) {
    const row = await store.get('b3Games/workspaces/' + WS + '/teachers/' + identity.uid);
    if (!row || row.active === false || row.classIds?.[classId] !== true)
      fail(403, 'This class is not assigned to your teacher account.');
  }
  return { cls, id: identity.uid };
}

async function authorizedClasses(store, identity) {
  if (!identity || !identity.uid || identity.email_verified !== true ||
      !identity.firebase || identity.firebase.sign_in_provider !== 'google.com')
    fail(403, 'Verified Google teacher sign-in required.');
  const admin = await store.get('b3Games/admins/' + identity.uid);
  let rows = {};
  if (admin && admin.active !== false) {
    rows = await store.get('b3Games/workspaces/' + WS + '/classes') || {};
  } else {
    const teacher = await store.get('b3Games/workspaces/' + WS + '/teachers/' + identity.uid);
    if (!teacher || teacher.active === false) fail(403, 'No classes are assigned to this teacher account.');
    const ids = Object.keys(teacher.classIds || {}).filter(id => key(id) && teacher.classIds[id] === true);
    const values = await Promise.all(ids.map(id => store.get('b3Games/workspaces/' + WS + '/classes/' + id)));
    ids.forEach((id, i) => { if (values[i]) rows[id] = values[i]; });
  }
  const classes = Object.keys(rows).filter(id => key(id) && rows[id] && rows[id].active !== false && rows[id].toolGrants?.homework === true)
    .map(id => ({ id, name: String(rows[id].name || id) }));
  return { ok: true, classes };
}
async function activeMembers(store, cls) {
  const out = {};
  for (const [sid, m] of Object.entries(cls.members || {})) {
    if (!key(sid) || m?.active === false) continue;
    const profile = await store.get('b3Games/students/' + sid + '/profile');
    if (profile?.active === false) continue;
    out[sid] = { name: profile?.name || m?.name || sid };
  }
  return out;
}

function ctxFor(classId, studentId, actorId, role) {
  return {
    workspaceId: WS, classId, classActive: true, studentActive: true, membershipActive: true,
    studentVerifiedId: role === 'student' ? actorId : studentId,
    teacherVerifiedId: role === 'teacher' ? actorId : null,
    teacherAuthorized: role === 'teacher', teacherAssignedToClass: role === 'teacher'
  };
}
const scopeOf = (classId, studentId) => ({ workspaceId: WS, classId, studentId });
const recordPath = (classId, sid, aid) => policy.assignmentPath(scopeOf(classId, sid), aid);
const newRecord = (def, now) => ({ assignmentId: def.id, status: 'assigned', draft: '', progress: 0, createdAt: now, updatedAt: now });
const isLate = (def, rec, now) => def.dueAt != null && now > def.dueAt && !['submitted', 'approved'].includes(rec.status);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const targets = (def, members) => def.audience === 'all' ? Object.keys(members) : (def.audience || []).filter(s => has(members, s));
const publicationState = def => def.publicationState || 'published'; // older definitions stay visible

function present(def, rec, now) {
  return {
    id: def.id, type: def.type, title: def.title, details: def.details, assignedAt: def.assignedAt ?? def.createdAt,
    dueAt: def.dueAt ?? null, targetAmount: def.targetAmount ?? def.targetMinutes ?? null,
    targetUnit: def.targetUnit || (def.targetMinutes ? 'minutes' : ''),
    status: rec.status, late: isLate(def, rec, now),
    draft: rec.draft || '', progress: rec.progress || 0, answer: rec.answer || '',
    submittedAt: rec.submittedAt || null, feedback: rec.feedback || '', stars: rec.stars ?? null,
    updatedAt: rec.updatedAt || null,
    messages: Array.isArray(rec.messages) ? rec.messages.map(message => ({ id: message.id, role: message.role,
      text: message.text || '', voice: !!message.voice, createdAt: message.createdAt })) : []
  };
}

function cleanVoiceData(value) {
  if (typeof value !== 'string') fail(400, 'Record a short voice note first.');
  const match = value.match(/^data:(audio\/(?:webm|ogg|mp4|mpeg));base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) fail(400, 'Use a supported audio recording.');
  const audio = Buffer.from(match[2], 'base64');
  if (!audio.length || audio.length > 100000 || audio.toString('base64') !== match[2])
    fail(413, 'Voice notes must be shorter than 15 seconds. Please record a shorter note.');
  const mime = match[1].toLowerCase();
  const validAudio = mime === 'audio/webm' ? audio.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'))
    : mime === 'audio/ogg' ? audio.subarray(0, 4).toString('ascii') === 'OggS'
      : mime === 'audio/mp4' ? audio.subarray(4, 8).toString('ascii') === 'ftyp'
        : audio.length > 1 && audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0;
  if (!validAudio) fail(400, 'That file is not a valid voice recording. Please record it again.');
  return value;
}
function messageInput(body, role, now, newId) {
  const messageText = text(body.text, 500);
  const voiceData = body.voiceDataURL == null ? null : cleanVoiceData(body.voiceDataURL);
  if (!messageText && !voiceData) fail(400, 'Write a note or record a voice note before sending.');
  const id = newId();
  if (!key(id)) fail(500, 'Could not send the note.');
  return { id, role, text: messageText, voice: !!voiceData, voiceData, createdAt: now };
}
async function addMessage(store, path, message) {
  let limit = false;
  const tx = await store.tx(path, cur => {
    const messages = Array.isArray(cur?.messages) ? cur.messages : [];
    if (messages.length >= 30 || (message.voiceData && messages.filter(item => item.voice).length >= 6)) { limit = true; return undefined; }
    return { ...(cur || {}),
    messages: [...messages,
      { id: message.id, role: message.role, text: message.text, voice: message.voice, createdAt: message.createdAt }],
    ...(message.voiceData ? { voiceNotes: { ...(cur?.voiceNotes || {}), [message.id]: message.voiceData } } : {})
  };
  });
  if (limit) fail(429, message.voiceData ? 'This homework has reached its voice-note limit.' : 'This homework has reached its comment limit.');
  if (!tx || tx.committed === false) fail(409, 'The note could not be saved. Please try again.');
}

// ---- teacher actions -------------------------------------------------------
async function teacherDo(store, identity, body, now, newId) {
  const classId = body.classId;
  const { cls, id: actorId } = await teacherAccess(store, identity, classId);
  const members = await activeMembers(store, cls);
  const defs = (await store.get(base(classId) + '/definitions')) || {};
  const allRecords = (await store.get(base(classId) + '/students')) || {};
  const teacher = { id: actorId, role: 'teacher', authenticated: true };

  if (body.action === 'teacherList') {
    const rows = [];
    for (const def of Object.values(defs).sort((a, b) => b.createdAt - a.createdAt)) {
      const students = {};
      const counts = { assigned: 0, in_progress: 0, submitted: 0, approved: 0, returned: 0, missing: 0 };
      for (const sid of targets(def, members)) {
        const rec = allRecords[sid]?.assignments?.[def.id] || newRecord(def, now);
        counts[rec.status]++;
        const late = isLate(def, rec, now);
        if (late) counts.missing++;
        students[sid] = { name: members[sid].name, status: rec.status, late, answer: rec.answer || '',
          progress: rec.progress || 0, submittedAt: rec.submittedAt || null, feedback: rec.feedback || '', stars: rec.stars ?? null,
          messages: Array.isArray(rec.messages) ? rec.messages.map(message => ({ id: message.id, role: message.role,
            text: message.text || '', voice: !!message.voice, createdAt: message.createdAt })) : [] };
      }
      rows.push({ id: def.id, type: def.type, title: def.title, details: def.details,
        assignedAt: def.assignedAt ?? def.createdAt, dueAt: def.dueAt ?? null,
        targetAmount: def.targetAmount ?? def.targetMinutes ?? null,
        targetUnit: def.targetUnit || (def.targetMinutes ? 'minutes' : ''),
        publicationState: publicationState(def), createdAt: def.createdAt, counts, students });
    }
    return { ok: true, students: members, assignments: rows };
  }

  if (body.action === 'create') {
    let def;
    try { def = policy.cleanDefinition({ type: body.type, title: body.title, details: body.details || '', dueAt: body.dueAt ?? null }); }
    catch (e) { fail(400, 'Check the type, title (up to 120 letters) and instructions.'); }
    const rawTarget = body.targetAmount == null || body.targetAmount === '' ? body.targetMinutes : body.targetAmount;
    const targetAmount = rawTarget == null || rawTarget === '' ? null : Number(rawTarget);
    if (targetAmount !== null && !(Number.isInteger(targetAmount) && targetAmount >= 1 && targetAmount <= 240)) fail(400, 'Target must be 1 to 240.');
    const targetUnit = String(body.targetUnit || (body.type === 'shorashim' ? 'minutes' : body.type === 'weeklyQuiz' ? 'questions' : ''));
    if (targetAmount !== null && !['minutes', 'questions', 'rounds', 'items'].includes(targetUnit)) fail(400, 'Choose a supported target unit.');
    const assignedAt = body.assignedAt == null ? now : Number(body.assignedAt);
    if (!Number.isSafeInteger(assignedAt) || assignedAt < 0) fail(400, 'Choose a valid assigned date.');
    if (def.dueAt != null && def.dueAt < assignedAt) fail(400, 'Due date must be on or after the assigned date.');
    if (Object.keys(defs).length >= 300) fail(429, 'Too many assignments in this class. Delete old ones first.');
    let audience = 'all';
    if (Array.isArray(body.studentIds) && body.studentIds.length) {
      audience = [...new Set(body.studentIds)].filter(s => key(s) && has(members, s));
      if (!audience.length) fail(400, 'Choose students who are in this class.');
    }
    const id = newId();
    if (!key(id)) fail(500, 'Could not create the assignment.');
    const full = { id, ...def, assignedAt, targetAmount, targetUnit,
      targetMinutes: targetUnit === 'minutes' ? targetAmount : null,
      audience, publicationState: 'draft', createdAt: now, createdBy: actorId };
    await store.set(base(classId) + '/definitions/' + id, full);
    return { ok: true, id };
  }

  const def = key(body.assignmentId) && has(defs, body.assignmentId) ? defs[body.assignmentId] : null;
  if (!def) fail(404, 'That assignment was not found.');

  if (body.action === 'comment' || body.action === 'voiceRead') {
    const sid = body.studentId;
    if (!key(sid) || !has(members, sid) || !targets(def, members).includes(sid)) fail(404, 'That student is not assigned this homework.');
    const path = recordPath(classId, sid, def.id);
    if (body.action === 'comment') {
      const message = messageInput(body, 'teacher', now, newId);
      await addMessage(store, path, message);
      return { ok: true, message: { id: message.id, role: message.role, text: message.text, voice: message.voice, createdAt: now } };
    }
    const rec = await store.get(path), message = (rec?.messages || []).find(item => item.id === body.messageId && item.voice);
    if (!message) fail(404, 'That voice note is no longer available.');
    const voiceDataURL = await store.get(path + '/voiceNotes/' + message.id);
    if (!voiceDataURL) fail(404, 'That voice note is no longer available.');
    return { ok: true, voiceDataURL };
  }

  if (body.action === 'publish') {
    if (publicationState(def) === 'archived') fail(409, 'Archived assignments must be restored before publishing.');
    const next = { ...def, publicationState: 'published', publishedAt: now, publishedBy: actorId };
    await store.set(base(classId) + '/definitions/' + def.id, next);
    for (const sid of targets(next, members)) {
      const path = recordPath(classId, sid, def.id);
      if (!(await store.get(path))) await store.set(path, newRecord(next, now));
    }
    return { ok: true };
  }
  if (body.action === 'unpublish') {
    if (publicationState(def) === 'archived') fail(409, 'Archived assignments cannot be unpublished.');
    await store.set(base(classId) + '/definitions/' + def.id,
      { ...def, publicationState: 'draft', unpublishedAt: now, unpublishedBy: actorId });
    return { ok: true };
  }
  if (body.action === 'archive') {
    await store.set(base(classId) + '/definitions/' + def.id,
      { ...def, publicationState: 'archived', archivedAt: now, archivedBy: actorId });
    return { ok: true };
  }

  if (body.action === 'delete') {
    if (publicationState(def) !== 'draft') fail(409, 'Archive published assignments so student work is kept.');
    await store.set(base(classId) + '/definitions/' + def.id, null);
    for (const sid of Object.keys(cls.members || {})) if (key(sid)) await store.set(recordPath(classId, sid, def.id), null);
    return { ok: true };
  }
  if (body.action === 'edit') {
    if (publicationState(def) === 'archived') fail(409, 'Archived assignments are read only.');
    let next;
    try {
      next = policy.cleanDefinition({ type: def.type, title: body.title ?? def.title, details: body.details ?? def.details,
        dueAt: body.dueAt === undefined ? def.dueAt : body.dueAt });
    } catch (e) { fail(400, 'Check the title, instructions and due date.'); }
    const assignedAt = body.assignedAt === undefined ? def.assignedAt : Number(body.assignedAt);
    if (assignedAt != null && (!Number.isSafeInteger(assignedAt) || assignedAt < 0)) fail(400, 'Choose a valid assigned date.');
    if (next.dueAt != null && assignedAt != null && next.dueAt < assignedAt) fail(400, 'Due date must be on or after the assigned date.');
    const rawTarget = body.targetAmount === undefined ? def.targetAmount ?? def.targetMinutes : body.targetAmount;
    const targetAmount = rawTarget == null || rawTarget === '' ? null : Number(rawTarget);
    if (targetAmount !== null && !(Number.isInteger(targetAmount) && targetAmount >= 1 && targetAmount <= 240)) fail(400, 'Target must be 1 to 240.');
    const targetUnit = String(body.targetUnit === undefined ? def.targetUnit || (def.targetMinutes ? 'minutes' : '') : body.targetUnit);
    if (targetAmount !== null && !['minutes', 'questions', 'rounds', 'items'].includes(targetUnit)) fail(400, 'Choose a supported target unit.');
    await store.set(base(classId) + '/definitions/' + def.id, { ...def, ...next, assignedAt, targetAmount,
      targetUnit, targetMinutes: targetUnit === 'minutes' ? targetAmount : null, editedAt: now, editedBy: actorId });
    return { ok: true };
  }
  if (body.action === 'approve' || body.action === 'return') {
    const sid = body.studentId;
    if (!key(sid) || !has(members, sid)) fail(404, 'That student is not in this class.');
    const feedback = text(body.feedback, 500);
    if (body.action === 'return' && !feedback) fail(400, 'Write a short note so the student knows what to fix.');
    let stars = null;
    if (body.action === 'approve' && body.stars != null && body.stars !== '') {
      stars = Number(body.stars);
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) fail(400, 'Stars must be 1 to 5.');
    }
    let error = null;
    const tx = await store.tx(recordPath(classId, sid, def.id), cur => {
      if (!cur) { error = true; return undefined; }
      try {
        const next = policy.transition(cur, body.action, teacher, scopeOf(classId, sid), ctxFor(classId, sid, actorId, 'teacher'), now);
        return { ...next, feedback, stars, reviewedAt: now };
      } catch (e) { error = e; return undefined; }
    });
    if (error || !tx || tx.committed === false) fail(409, 'That work is not waiting for review.');
    return { ok: true };
  }
  fail(400, 'Unknown action.');
}

// ---- student actions -------------------------------------------------------
async function studentDo(store, body, now, ip, newId) {
  const student = await guarded(store, { ip, studentKey: body.studentName || body.studentId }, now,
    () => resolveStudent(store.get, { b3StudentId: body.studentId, name: body.studentName, pin: body.pin, classId: body.classId }));
  const sid = student.id, classId = student.classId;
  if (!key(sid) || !key(classId)) fail(403, 'Choose your class and sign in again.');
  const actor = { id: sid, role: 'student', authenticated: true };
  const ctx = ctxFor(classId, sid, sid, 'student');
  const scope = scopeOf(classId, sid);
  if (!policy.authorized(actor, scope, ctx, 'read')) fail(403, 'Not allowed.');
  const cls = await store.get('b3Games/workspaces/' + WS + '/classes/' + classId);
  if (!cls || cls.active === false || cls.toolGrants?.homework !== true) fail(403, 'Homework is not turned on for your class.');
  const defs = (await store.get(base(classId) + '/definitions')) || {};
  const mine = def => (def.audience === 'all' || (Array.isArray(def.audience) && def.audience.includes(sid))) &&
    publicationState(def) === 'published' && (def.assignedAt == null || def.assignedAt <= now);

  if (body.action === 'studentList') {
    const out = [];
    for (const def of Object.values(defs)) {
      if (!mine(def)) continue;
      let rec = await store.get(recordPath(classId, sid, def.id));
      if (!rec) { rec = newRecord(def, now); await store.set(recordPath(classId, sid, def.id), rec); }
      out.push(present(def, rec, now));
    }
    const order = { returned: 0, assigned: 1, in_progress: 1, submitted: 2, approved: 3 };
    out.sort((a, b) => order[a.status] - order[b.status] || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
    return { ok: true, name: student.profile?.name || '', assignments: out,
      openCount: out.filter(a => OPEN.includes(a.status)).length };
  }

  const def = key(body.assignmentId) && has(defs, body.assignmentId) && mine(defs[body.assignmentId]) ? defs[body.assignmentId] : null;
  if (!def || !mine(def)) fail(404, 'That assignment was not found.');
  const path = recordPath(classId, sid, def.id);
  if (body.action === 'comment') {
    const message = messageInput(body, 'student', now, newId);
    await addMessage(store, path, message);
    return { ok: true, message: { id: message.id, role: message.role, text: message.text, voice: message.voice, createdAt: now } };
  }
  if (body.action === 'voiceRead') {
    const rec = await store.get(path), message = (rec?.messages || []).find(item => item.id === body.messageId && item.voice);
    if (!message) fail(404, 'That voice note is no longer available.');
    const voiceDataURL = await store.get(path + '/voiceNotes/' + message.id);
    if (!voiceDataURL) fail(404, 'That voice note is no longer available.');
    return { ok: true, voiceDataURL };
  }
  const minutes = v => {
    if (v == null || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 1440) fail(400, 'Minutes must be 0 to 1440.');
    return n;
  };
  let error = null;

  if (body.action === 'save') {
    const draft = text(body.draft, 2000), progress = minutes(body.progress);
    await store.tx(path, cur => {
      const rec = cur || newRecord(def, now);
      if (['submitted', 'approved'].includes(rec.status)) { error = true; return undefined; }
      const next = { ...rec, draft, updatedAt: now };
      if (progress !== null) next.progress = progress;
      if (rec.status === 'assigned') next.status = 'in_progress';
      return next;
    });
    if (error) fail(409, 'This work was already handed in.');
    return { ok: true };
  }
  if (body.action === 'submit') {
    const answer = text(body.answer, 2000), progress = minutes(body.progress);
    if (!answer && !def.targetMinutes) fail(400, 'Write a short note about what you did.');
    await store.tx(path, cur => {
      const rec = cur || newRecord(def, now);
      if (rec.status === 'submitted' && rec.answer === answer) return rec; // repeat tap: same result
      try {
        const next = policy.transition(rec.status === 'assigned' ? { ...rec, status: 'in_progress' } : rec,
          'submit', actor, scope, ctx, now);
        return { ...next, answer, draft: '', submittedAt: now, feedback: '', stars: null,
          progress: progress === null ? rec.progress || 0 : progress };
      } catch (e) { error = e; return undefined; }
    });
    if (error) fail(409, 'This work was already handed in.');
    return { ok: true };
  }
  fail(400, 'Unknown action.');
}

async function homeworkApi(store, auth, body, now = Date.now(), newId = () => crypto.randomBytes(9).toString('base64url')) {
  if (!body || typeof body !== 'object') fail(400, 'Bad request.');
  const a = body.action;
  if (a === 'authorizedClasses') {
    if (!auth || !auth.identity) fail(401, 'Teacher sign-in required.');
    return authorizedClasses(store, auth.identity);
  }
  if (['teacherList', 'create', 'delete', 'edit', 'publish', 'unpublish', 'archive', 'approve', 'return'].includes(a)) {
    if (!auth || !auth.identity) fail(401, 'Teacher sign-in required.');
    return teacherDo(store, auth.identity, body, now, newId);
  }
  if (['comment', 'voiceRead'].includes(a) && auth && auth.identity)
    return teacherDo(store, auth.identity, body, now, newId);
  if (['studentList', 'save', 'submit', 'comment', 'voiceRead'].includes(a)) return studentDo(store, body, now, auth && auth.ip, newId);
  fail(400, 'Unknown action.');
}
module.exports = { homeworkApi };
