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
const hwItems = require('./homework-items-core.cjs');

const WS = 'b3-2026';
const key = s => typeof s === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(s);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
// Assignment label shown to teachers: 'homework' (default) or 'classwork' (Class Assignment).
const LABELS = ['homework', 'classwork'];
const labelOf = def => (def && def.label === 'classwork' ? 'classwork' : 'homework');
const cleanLabel = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (!LABELS.includes(value)) fail(400, 'Choose Homework or Class Assignment.');
  return value;
};
const text = (s, n) => String(s == null ? '' : s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f<>]/g, '').trim().slice(0, n);
const base = classId => 'assignmentCenter/workspaces/' + WS + '/classes/' + classId;
const OPEN = ['assigned', 'in_progress', 'returned'];

async function teacherAccess(store, identity, classId) {
  if (!identity || !identity.uid || identity.email_verified !== true ||
      !identity.firebase || !['google.com', 'password'].includes(identity.firebase.sign_in_provider))
    fail(403, 'Verified staging teacher sign-in required.');
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
  return { cls, id: identity.uid, owner };
}

// ---- class subjects --------------------------------------------------------
// Each class keeps its own subject list (e.g. Chumash, Mishnayos) and which of its
// teachers teach which subject. Every teacher of a class has the same rights here.
// Stored next to the homework (server-only tree); a class with no subjects works as before.
const SUBJECT_MAX = 30;
const SUBJECT_ACTIONS = ['addSubject', 'renameSubject', 'removeSubject', 'setTeacherSubjects'];
const settingsPath = classId => base(classId) + '/settings';
async function classSettings(store, classId) {
  const raw = (await store.get(settingsPath(classId))) || {};
  const subjects = {};
  for (const [id, s] of Object.entries(raw.subjects || {})) if (key(id) && s && text(s.name, 60)) subjects[id] = { name: text(s.name, 60), createdAt: s.createdAt || 0 };
  const teacherSubjects = {};
  for (const [uid, map] of Object.entries(raw.teacherSubjects || {})) {
    if (!key(uid) || !map) continue;
    const ids = Object.keys(map).filter(id => map[id] === true && has(subjects, id));
    if (ids.length) teacherSubjects[uid] = ids;
  }
  return { subjects, teacherSubjects };
}
const subjectList = settings => Object.entries(settings.subjects)
  .map(([id, s]) => ({ id, name: s.name, createdAt: s.createdAt }))
  .sort((a, b) => a.name.localeCompare(b.name)).map(({ id, name }) => ({ id, name }));
// Teachers never see each other's e-mail addresses through this; a display name that is
// only an address is shortened to the part before the @.
const teacherName = row => {
  const n = text(row && (row.displayName || row.name), 80);
  return n.includes('@') ? n.split('@')[0] : n || 'Teacher';
};
async function classTeachers(store, classId, cls) {
  const ids = Object.keys(cls.teacherIds || {}).filter(uid => key(uid) && cls.teacherIds[uid] === true);
  const rows = await Promise.all(ids.map(uid => store.get('b3Games/workspaces/' + WS + '/teachers/' + uid)));
  const out = {};
  ids.forEach((uid, i) => {
    const row = rows[i];
    if (row && row.active !== false && row.classIds?.[classId] === true) out[uid] = { name: teacherName(row) };
  });
  return out;
}
// Name of whoever posted a homework (for the student "Teacher" filter and teacher reports).
async function posterNames(store, defs, known) {
  const names = { ...known };
  const missing = [...new Set(defs.map(d => d.createdBy).filter(uid => key(uid) && !has(names, uid)))];
  const rows = await Promise.all(missing.map(uid => store.get('b3Games/workspaces/' + WS + '/teachers/' + uid)));
  missing.forEach((uid, i) => { names[uid] = { name: teacherName(rows[i]) }; });
  return names;
}
const subjectOf = (def, settings) => (def.subjectId && settings.subjects[def.subjectId]?.name) || def.subject || '';
const hasSubject = def => !!(def.subjectId || def.subject);
// A teacher sees homework they posted and every homework without a subject; the owner sees all.
const visibleTo = (def, actorId, owner) => owner || !hasSubject(def) || def.createdBy === actorId;
// Which subjects this teacher may tag homework with. A teacher with no subjects linked
// in this class may use any of them (so a new class works before links are set up).
function allowedSubjectIds(settings, actorId, owner) {
  const mine = settings.teacherSubjects[actorId];
  return owner || !mine ? Object.keys(settings.subjects) : mine;
}
// Resolves {subjectId, subject} from a create/edit request. undefined = keep / not sent.
function pickSubject(body, settings, actorId, owner, current) {
  if (body.subjectId === undefined && body.subject === undefined) return current;
  const sid = body.subjectId == null ? '' : String(body.subjectId);
  if (sid) {
    if (!key(sid) || !has(settings.subjects, sid)) fail(400, 'Choose a subject from this class\'s list.');
    if (!allowedSubjectIds(settings, actorId, owner).includes(sid) && sid !== current.subjectId)
      fail(403, 'You are not linked to that subject in this class.');
    return { subjectId: sid, subject: settings.subjects[sid].name };
  }
  // Free-text subjects are only kept for classes that have not set up a subject list yet.
  const free = body.subjectId === undefined ? text(body.subject, 60) : '';
  if (free && Object.keys(settings.subjects).length) fail(400, 'Choose a subject from this class\'s list.');
  return { subjectId: '', subject: free };
}
async function subjectAction(store, classId, cls, body, actorId, now, newId) {
  const raw = (await store.get(settingsPath(classId))) || {};
  const subjects = { ...(raw.subjects || {}) };
  const sameName = (name, except) => Object.entries(subjects).some(([id, s]) => id !== except && String(s?.name || '').toLowerCase() === name.toLowerCase());
  if (body.action === 'addSubject' || body.action === 'renameSubject') {
    const name = text(body.name, 60);
    if (!name) fail(400, 'Type a subject name.');
    const id = body.action === 'addSubject' ? newId() : String(body.subjectId || '');
    if (body.action === 'renameSubject' && (!key(id) || !has(subjects, id))) fail(404, 'That subject was not found.');
    if (body.action === 'addSubject' && (!key(id) || Object.keys(subjects).length >= SUBJECT_MAX)) fail(429, 'This class already has ' + SUBJECT_MAX + ' subjects.');
    if (sameName(name, id)) fail(409, 'This class already has a subject with that name.');
    await store.set(settingsPath(classId) + '/subjects/' + id,
      { ...(subjects[id] || { createdAt: now, createdBy: actorId }), name, updatedAt: now, updatedBy: actorId });
    return { ok: true, id };
  }
  if (body.action === 'removeSubject') {
    const id = String(body.subjectId || '');
    if (!key(id) || !has(subjects, id)) fail(404, 'That subject was not found.');
    // Homework already tagged keeps its subject name, so nothing a student did is lost.
    const tx = await store.tx(settingsPath(classId), cur => {
      const next = { ...(cur || {}), subjects: { ...(cur?.subjects || {}) }, teacherSubjects: {} };
      delete next.subjects[id];
      for (const [uid, map] of Object.entries(cur?.teacherSubjects || {})) {
        const kept = { ...(map || {}) };
        delete kept[id];
        if (Object.keys(kept).length) next.teacherSubjects[uid] = kept;
      }
      return next;
    });
    if (!tx || tx.committed === false) fail(409, 'The subject could not be removed. Please try again.');
    return { ok: true };
  }
  if (body.action === 'setTeacherSubjects') {
    const uid = String(body.teacherId || '');
    const teachers = await classTeachers(store, classId, cls);
    if (!key(uid) || !has(teachers, uid)) fail(404, 'That teacher is not in this class.');
    if (!Array.isArray(body.subjectIds)) fail(400, 'Choose subjects.');
    const ids = [...new Set(body.subjectIds.map(String))];
    if (ids.some(id => !key(id) || !has(subjects, id))) fail(400, 'Choose subjects from this class\'s list.');
    await store.set(settingsPath(classId) + '/teacherSubjects/' + uid, ids.length ? Object.fromEntries(ids.map(id => [id, true])) : null);
    return { ok: true };
  }
  fail(400, 'Unknown action.');
}

async function authorizedClasses(store, identity) {
  if (!identity || !identity.uid || identity.email_verified !== true ||
      !identity.firebase || !['google.com', 'password'].includes(identity.firebase.sign_in_provider))
    fail(403, 'Verified staging teacher sign-in required.');
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

// Messages as one side sees them. "unread" = sent by the other side after this side last read the thread.
function publicMessages(rec, viewer) {
  const readAt = Number(rec?.readAt?.[viewer]) || 0;
  return Array.isArray(rec?.messages) ? rec.messages.map(message => ({ id: message.id, role: message.role,
    text: message.text || '', voice: !!message.voice, createdAt: message.createdAt,
    unread: message.role !== viewer && Number(message.createdAt) > readAt })) : [];
}
function present(def, rec, now, settings = { subjects: {} }, posters = {}) {
  return {
    id: def.id, type: def.type, title: def.title, details: def.details,
    subject: subjectOf(def, settings), subjectId: def.subjectId || '',
    teacherId: def.createdBy || '', teacher: posters[def.createdBy]?.name || '', assignedAt: def.assignedAt ?? def.createdAt,
    dueAt: def.dueAt ?? null, targetAmount: def.targetAmount ?? def.targetMinutes ?? null,
    targetUnit: def.targetUnit || (def.targetMinutes ? 'minutes' : ''),
    status: rec.status, late: isLate(def, rec, now),
    draft: rec.draft || '', progress: rec.progress || 0, answer: rec.answer || '',
    submittedAt: rec.submittedAt || null, feedback: rec.feedback || '', stars: rec.stars ?? null,
    updatedAt: rec.updatedAt || null,
    items: hwItems.itemsOf(def), itemsDone: hwItems.doneMap(def, rec),
    messages: publicMessages(rec, 'student')
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
    readAt: { ...(cur?.readAt || {}), [message.role]: message.createdAt },
    ...(message.voiceData ? { voiceNotes: { ...(cur?.voiceNotes || {}), [message.id]: message.voiceData } } : {})
  };
  });
  if (limit) fail(429, message.voiceData ? 'This homework has reached its voice-note limit.' : 'This homework has reached its comment limit.');
  if (!tx || tx.committed === false) fail(409, 'The note could not be saved. Please try again.');
}
// ---- standalone messages (not tied to an assignment) -----------------------
// One thread per student per class. It keeps the newest 30 messages and newest 6 voice notes
// (older ones roll off, audio included), so it never fills up the way an assignment thread does.
const GENERAL_MAX = 30, GENERAL_VOICE_MAX = 6, GENERAL_BURST = 10, GENERAL_BURST_MS = 10 * 60 * 1000;
const generalPath = (classId, sid) => base(classId) + '/messages/' + sid;
const isGeneral = body => body.assignmentId === undefined || body.assignmentId === null || body.assignmentId === '';
async function addGeneralMessage(store, path, message) {
  let busy = false;
  const tx = await store.tx(path, cur => {
    const recent = (Array.isArray(cur?.messages) ? cur.messages : []).filter(item =>
      item.role === message.role && message.createdAt - Number(item.createdAt) < GENERAL_BURST_MS);
    if (recent.length >= GENERAL_BURST) { busy = true; return undefined; }
    let messages = [...(Array.isArray(cur?.messages) ? cur.messages : []),
      { id: message.id, role: message.role, text: message.text, voice: message.voice, createdAt: message.createdAt }];
    while (messages.filter(item => item.voice).length > GENERAL_VOICE_MAX) {
      const oldest = messages.findIndex(item => item.voice);
      messages = messages.filter((item, i) => i !== oldest);
    }
    if (messages.length > GENERAL_MAX) messages = messages.slice(-GENERAL_MAX);
    const voiceNotes = {};
    for (const item of messages) {
      if (!item.voice) continue;
      const audio = item.id === message.id ? message.voiceData : cur?.voiceNotes?.[item.id];
      if (audio) voiceNotes[item.id] = audio;
    }
    return { messages, readAt: { ...(cur?.readAt || {}), [message.role]: message.createdAt },
      ...(Object.keys(voiceNotes).length ? { voiceNotes } : {}) };
  });
  if (busy) fail(429, 'That is a lot of messages in a few minutes. Please wait a little and try again.');
  if (!tx || tx.committed === false) fail(409, 'The note could not be saved. Please try again.');
}
// comment / voiceRead / markRead on the standalone thread. Same size limits and checks as assignment notes.
async function generalAction(store, path, body, role, now, newId) {
  if (body.action === 'markRead') return markRead(store, path, role, now);
  if (body.action === 'comment') {
    const message = messageInput(body, role, now, newId);
    await addGeneralMessage(store, path, message);
    return { ok: true, message: { id: message.id, role: message.role, text: message.text, voice: message.voice, createdAt: now } };
  }
  if (body.action === 'voiceRead') return readVoice(store, path, body.messageId);
  fail(400, 'Unknown action.');
}
async function readVoice(store, path, messageId) {
  if (!key(messageId)) fail(404, 'That voice note is no longer available.');
  const rec = await store.get(path + '/messages'), message = (Array.isArray(rec) ? rec : []).find(item => item.id === messageId && item.voice);
  if (!message) fail(404, 'That voice note is no longer available.');
  const voiceDataURL = await store.get(path + '/voiceNotes/' + message.id);
  if (!voiceDataURL) fail(404, 'That voice note is no longer available.');
  return { ok: true, voiceDataURL };
}
// Thread metadata only (never the audio), as one side sees it.
async function generalThread(store, path, viewer) {
  const [messages, readAt] = await Promise.all([store.get(path + '/messages'), store.get(path + '/readAt')]);
  return publicMessages({ messages: Array.isArray(messages) ? messages : [], readAt }, viewer);
}

async function markRead(store, path, role, now) {
  await store.tx(path, cur => cur ? { ...cur, readAt: { ...(cur.readAt || {}), [role]: now } } : undefined);
  return { ok: true };
}

// ---- teacher actions -------------------------------------------------------
async function teacherDo(store, identity, body, now, newId) {
  const classId = body.classId;
  const { cls, id: actorId, owner } = await teacherAccess(store, identity, classId);
  if (SUBJECT_ACTIONS.includes(body.action)) return subjectAction(store, classId, cls, body, actorId, now, newId);
  const settings = await classSettings(store, classId);
  const members = await activeMembers(store, cls);
  const allDefs = (await store.get(base(classId) + '/definitions')) || {};
  // Everything below only ever sees homework this teacher may see (see visibleTo).
  const defs = Object.fromEntries(Object.entries(allDefs).filter(([, d]) => d && visibleTo(d, actorId, owner)));
  const allRecords = (await store.get(base(classId) + '/students')) || {};
  const teacher = { id: actorId, role: 'teacher', authenticated: true };

  if (body.action === 'teacherList') {
    const rows = [];
    const teachers = await classTeachers(store, classId, cls);
    const posters = await posterNames(store, Object.values(defs), teachers);
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
          itemsDone: hwItems.doneMap(def, rec), messages: publicMessages(rec, 'teacher') };
      }
      rows.push({ id: def.id, type: def.type, label: labelOf(def), title: def.title, details: def.details,
        subject: subjectOf(def, settings), subjectId: def.subjectId || '', createdBy: def.createdBy || '',
        postedBy: posters[def.createdBy]?.name || '', mine: def.createdBy === actorId,
        assignedAt: def.assignedAt ?? def.createdAt, dueAt: def.dueAt ?? null,
        targetAmount: def.targetAmount ?? def.targetMinutes ?? null,
        targetUnit: def.targetUnit || (def.targetMinutes ? 'minutes' : ''),
        publicationState: publicationState(def), createdAt: def.createdAt, publishedAt: def.publishedAt ?? null,
        items: hwItems.itemsOf(def), counts, students });
    }
    const sids = Object.keys(members);
    const threads = await Promise.all(sids.map(sid => generalThread(store, generalPath(classId, sid), 'teacher')));
    const messages = {};
    sids.forEach((sid, i) => { messages[sid] = threads[i]; });
    const teacherRows = {};
    for (const [uid, t] of Object.entries(teachers)) teacherRows[uid] = { name: t.name, subjectIds: settings.teacherSubjects[uid] || [] };
    return { ok: true, students: members, assignments: rows, messages, subjects: subjectList(settings), teachers: teacherRows,
      me: { id: actorId, owner, subjectIds: allowedSubjectIds(settings, actorId, owner), linked: !!settings.teacherSubjects[actorId] } };
  }

  if (body.action === 'create') {
    const items = hwItems.cleanItems(body.items, newId);
    let def;
    try { def = policy.cleanDefinition({ type: items ? items[0].type : body.type, title: body.title, details: body.details || '', dueAt: body.dueAt ?? null }); }
    catch (e) { fail(400, 'Check the type, title (up to 120 letters) and instructions.'); }
    const rawTarget = body.targetAmount == null || body.targetAmount === '' ? body.targetMinutes : body.targetAmount;
    const targetAmount = rawTarget == null || rawTarget === '' ? null : Number(rawTarget);
    if (targetAmount !== null && !(Number.isInteger(targetAmount) && targetAmount >= 1 && targetAmount <= 240)) fail(400, 'Target must be 1 to 240.');
    const targetUnit = String(body.targetUnit || (body.type === 'shorashim' ? 'minutes' : body.type === 'weeklyQuiz' ? 'questions' : ''));
    if (targetAmount !== null && !['minutes', 'questions', 'rounds', 'items'].includes(targetUnit)) fail(400, 'Choose a supported target unit.');
    const label = cleanLabel(body.label, 'homework');
    const subject = pickSubject(body, settings, actorId, owner, { subjectId: '', subject: '' }); // optional, e.g. Chumash, Mishnayos
    const assignedAt = body.assignedAt == null ? now : Number(body.assignedAt);
    if (!Number.isSafeInteger(assignedAt) || assignedAt < 0) fail(400, 'Choose a valid assigned date.');
    if (def.dueAt != null && def.dueAt < assignedAt) fail(400, 'Due date must be on or after the assigned date.');
    if (Object.keys(allDefs).length >= 300) fail(429, 'Too many assignments in this class. Delete old ones first.');
    let audience = 'all';
    if (Array.isArray(body.studentIds) && body.studentIds.length) {
      audience = [...new Set(body.studentIds)].filter(s => key(s) && has(members, s));
      if (!audience.length) fail(400, 'Choose students who are in this class.');
    }
    const id = newId();
    if (!key(id)) fail(500, 'Could not create the assignment.');
    const full = { id, ...def, ...(items ? { items } : {}), label, ...subject, assignedAt, targetAmount, targetUnit,
      targetMinutes: targetUnit === 'minutes' ? targetAmount : null,
      audience, publicationState: 'draft', createdAt: now, createdBy: actorId };
    await store.set(base(classId) + '/definitions/' + id, full);
    return { ok: true, id };
  }

  if (['comment', 'voiceRead', 'markRead'].includes(body.action) && isGeneral(body)) {
    const sid = body.studentId;
    if (!key(sid) || !has(members, sid)) fail(404, 'That student is not in this class.');
    return generalAction(store, generalPath(classId, sid), body, 'teacher', now, newId);
  }
  const def = key(body.assignmentId) && has(defs, body.assignmentId) ? defs[body.assignmentId] : null;
  if (!def) fail(404, 'That assignment was not found.');

  if (body.action === 'comment' || body.action === 'voiceRead' || body.action === 'markRead') {
    const sid = body.studentId;
    if (!key(sid) || !has(members, sid) || !targets(def, members).includes(sid)) fail(404, 'That student is not assigned this homework.');
    const path = recordPath(classId, sid, def.id);
    if (body.action === 'markRead') return markRead(store, path, 'teacher', now);
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
    // Unpublishing does not undo publication: preserve every student's work and history.
    // The record check also covers legacy definitions without a publishedAt marker,
    // including records belonging to students since removed from the class roster.
    const hasStudentRecord = Object.values(allRecords).some(row =>
      row?.assignments && Object.prototype.hasOwnProperty.call(row.assignments, def.id));
    if (publicationState(def) !== 'draft' || def.publishedAt != null || hasStudentRecord)
      fail(409, 'Archive homework that was published or has student work, so nothing is lost.');
    await store.set(base(classId) + '/definitions/' + def.id, null);
    return { ok: true };
  }
  if (body.action === 'edit') {
    if (publicationState(def) === 'archived') fail(409, 'Archived assignments are read only.');
    // items: undefined keeps the current list, an empty list removes it (back to a plain assignment).
    const items = body.items === undefined ? hwItems.itemsOf(def) : hwItems.cleanItems(body.items, newId) || [];
    let next;
    try {
      next = policy.cleanDefinition({ type: items.length ? items[0].type : def.type, title: body.title ?? def.title, details: body.details ?? def.details,
        dueAt: body.dueAt === undefined ? def.dueAt : body.dueAt });
    } catch (e) { fail(400, 'Check the title, instructions and due date.'); }
    const label = cleanLabel(body.label, labelOf(def));
    const subject = pickSubject(body, settings, actorId, owner, { subjectId: def.subjectId || '', subject: def.subject || '' });
    const assignedAt = body.assignedAt === undefined ? def.assignedAt : Number(body.assignedAt);
    if (assignedAt != null && (!Number.isSafeInteger(assignedAt) || assignedAt < 0)) fail(400, 'Choose a valid assigned date.');
    if (next.dueAt != null && assignedAt != null && next.dueAt < assignedAt) fail(400, 'Due date must be on or after the assigned date.');
    const rawTarget = body.targetAmount === undefined ? def.targetAmount ?? def.targetMinutes : body.targetAmount;
    const targetAmount = rawTarget == null || rawTarget === '' ? null : Number(rawTarget);
    if (targetAmount !== null && !(Number.isInteger(targetAmount) && targetAmount >= 1 && targetAmount <= 240)) fail(400, 'Target must be 1 to 240.');
    const targetUnit = String(body.targetUnit === undefined ? def.targetUnit || (def.targetMinutes ? 'minutes' : '') : body.targetUnit);
    if (targetAmount !== null && !['minutes', 'questions', 'rounds', 'items'].includes(targetUnit)) fail(400, 'Choose a supported target unit.');
    const kept = { ...def };
    delete kept.items;
    await store.set(base(classId) + '/definitions/' + def.id, { ...kept, ...next, ...(items.length ? { items } : {}), label, ...subject, assignedAt, targetAmount,
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
// Every class this student may open homework in, for the class switcher. Same checks as
// sign-in (active membership on both sides, active class) plus Homework turned on.
async function studentClasses(store, sid, profile) {
  const memberships = (await store.get('b3Games/students/' + sid + '/memberships')) || {};
  const ids = new Set(Object.values(memberships).filter(m => m && m.active !== false && m.workspaceId === WS && key(m.classId)).map(m => m.classId));
  if (!Object.keys(memberships).length && ['et', 'wt'].includes(profile?.classId)) ids.add(profile.classId);
  const rows = await Promise.all([...ids].map(async id => [id, await store.get('b3Games/workspaces/' + WS + '/classes/' + id)]));
  return rows.filter(([, c]) => c && c.active !== false && c.toolGrants?.homework === true && c.members?.[sid] && c.members[sid].active !== false)
    .map(([id, c]) => ({ id, name: String(c.name || id) })).sort((a, b) => a.name.localeCompare(b.name));
}
async function studentDo(store, body, now, ip, newId) {
  const student = await guarded(store, { ip, studentKey: body.studentName || body.studentId }, now,
    () => resolveStudent(store.get, { b3StudentId: body.studentId, name: body.studentName, pin: body.pin, classId: body.classId }));
  const sid = student.id, classId = student.classId;
  // A class named by the browser must be the student's own active class (checked here so shared sign-in code stays untouched).
  if (body.classId && String(body.classId) !== classId) fail(403, 'Choose an active class on the main site first.');
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
    const shown = Object.values(defs).filter(mine);
    const [settings, posters, classes] = await Promise.all([classSettings(store, classId),
      posterNames(store, shown, {}), studentClasses(store, sid, student.profile)]);
    for (const def of shown) {
      let rec = await store.get(recordPath(classId, sid, def.id));
      if (!rec) { rec = newRecord(def, now); await store.set(recordPath(classId, sid, def.id), rec); }
      out.push(present(def, rec, now, settings, posters));
    }
    const order = { returned: 0, assigned: 1, in_progress: 1, submitted: 2, approved: 3 };
    out.sort((a, b) => order[a.status] - order[b.status] || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
    return { ok: true, name: student.profile?.name || '', classId, classes, assignments: out,
      openCount: out.filter(a => OPEN.includes(a.status)).length,
      general: { messages: await generalThread(store, generalPath(classId, sid), 'student') } };
  }
  if (['comment', 'voiceRead', 'markRead'].includes(body.action) && isGeneral(body))
    return generalAction(store, generalPath(classId, sid), body, 'student', now, newId);

  const def = key(body.assignmentId) && has(defs, body.assignmentId) && mine(defs[body.assignmentId]) ? defs[body.assignmentId] : null;
  if (!def || !mine(def)) fail(404, 'That assignment was not found.');
  const path = recordPath(classId, sid, def.id);
  if (body.action === 'comment') {
    const message = messageInput(body, 'student', now, newId);
    await addMessage(store, path, message);
    return { ok: true, message: { id: message.id, role: message.role, text: message.text, voice: message.voice, createdAt: now } };
  }
  if (body.action === 'markRead') return markRead(store, path, 'student', now);
  if (body.action === 'itemDone') {
    // Sent by the activity page (homework mode) when the student finishes one checklist item.
    const item = hwItems.itemsOf(def).find(x => x.id === body.itemId);
    if (!item) fail(404, 'That homework item was not found.');
    let result = null;
    const tx = await store.tx(path, cur => {
      const rec = cur || newRecord(def, now);
      const itemsDone = { ...(rec.itemsDone || {}) };
      if (!itemsDone[item.id]) itemsDone[item.id] = now;
      const next = { ...rec, itemsDone, updatedAt: now };
      if (rec.status === 'assigned') next.status = 'in_progress';
      result = next;
      return next;
    });
    if (!tx || tx.committed === false || !result) fail(409, 'Could not save. Please try again.');
    return { ok: true, itemsDone: hwItems.doneMap(def, result), allDone: hwItems.allDone(def, result) };
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
    if (!answer && def.targetUnit !== 'minutes' && !def.targetMinutes &&
        !hwItems.allDone(def, await store.get(path))) fail(400, 'Write a short note about what you did.');
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
  if (['teacherList', 'create', 'delete', 'edit', 'publish', 'unpublish', 'archive', 'approve', 'return', ...SUBJECT_ACTIONS].includes(a)) {
    if (!auth || !auth.identity) fail(401, 'Teacher sign-in required.');
    return teacherDo(store, auth.identity, body, now, newId);
  }
  if (['comment', 'voiceRead', 'markRead'].includes(a) && auth && auth.identity)
    return teacherDo(store, auth.identity, body, now, newId);
  if (['studentList', 'save', 'submit', 'itemDone', 'comment', 'voiceRead', 'markRead'].includes(a)) return studentDo(store, body, now, auth && auth.ip, newId);
  fail(400, 'Unknown action.');
}
module.exports = { homeworkApi };
