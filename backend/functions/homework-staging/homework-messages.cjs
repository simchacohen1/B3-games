'use strict';
// Homework Messages (#647): one-on-one conversations between a student and each of their
// teachers. WhatsApp-style: text or voice, voice up to 5 minutes. A principal or the owner can
// write to a student first and the student can then answer; a student cannot start one (#730).
// Callers in homework-core.cjs have already proved who the student or teacher is; this file
// only decides who may talk to whom and stores the messages.
//
// Database (Admin SDK only; clients have no rules for these paths):
//   assignmentCenter/workspaces/<ws>/classes/<class>/dm/<student>/<adultUid>
//       { messages: [ {id, role, text, voice, durationMs, assignmentId, assignmentTitle, createdAt} ],
//         readAt: { student, teacher } }
//   assignmentCenter/workspaces/<ws>/dmSummary/adults/<adultUid>/<class>/<student>   (adult's inbox row)
//   assignmentCenter/workspaces/<ws>/dmSummary/students/<class>/<student>/<adultUid>  (student's inbox row)
// Voice audio lives in Cloud Storage at homeworkMessages/<class>/<student>/<adultUid>/<messageId>
// (no client rules, so only these functions can read or write it).

const VOICE_MAX_BYTES = 3 * 1000 * 1000;   // ~5 minutes even when a browser ignores the bitrate request
const VOICE_MAX_MS = 5 * 60 * 1000;
const THREAD_MAX = 200;                    // newest messages kept per conversation
const BURST = 20, BURST_MS = 10 * 60 * 1000;

const key = s => typeof s === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(s);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const text = (s, n) => String(s == null ? '' : s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f<>]/g, '').trim().slice(0, n);
const root = ws => 'assignmentCenter/workspaces/' + ws;
const threadPath = (ws, classId, sid, uid) => root(ws) + '/classes/' + classId + '/dm/' + sid + '/' + uid;
const adultRow = (ws, uid, classId, sid) => root(ws) + '/dmSummary/adults/' + uid + '/' + classId + '/' + sid;
const studentRow = (ws, classId, sid, uid) => root(ws) + '/dmSummary/students/' + classId + '/' + sid + '/' + uid;
const audioPath = (classId, sid, uid, id) => 'homeworkMessages/' + classId + '/' + sid + '/' + uid + '/' + id;

// A readable name for a teacher. Never shows a full email address to students.
function adultName(row, fallback) {
  const raw = String(row?.displayName || row?.name || '').trim();
  if (raw && !raw.includes('@')) return raw.slice(0, 80);
  const local = String(row?.email || (raw.includes('@') ? raw : '')).split('@')[0];
  const nice = local.replace(/[._-]+/g, ' ').replace(/\d+/g, '').trim()
    .replace(/\b\w/g, c => c.toUpperCase());
  return nice || fallback;
}
const isPrincipal = row => row && (row.accountType === 'principal' || row.role === 'principal');

// Teachers and principals with access to a class, from the teacher records the owner manages.
// A principal holds the classes of every teacher they supervise, so being listed here does not
// make someone the student's teacher: studentContacts() decides who a student may write to.
async function classAdults(store, ws, classId) {
  const rows = (await store.get('b3Games/workspaces/' + ws + '/teachers')) || {};
  const out = {};
  for (const [uid, row] of Object.entries(rows)) {
    if (!key(uid) || !row || row.active === false || row.classIds?.[classId] !== true) continue;
    const kind = isPrincipal(row) ? 'principal' : 'teacher';
    // `supervisor`: a principal who has this class only through a teacher they supervise. A
    // principal given a class of their own (not through a teacher) is that class's teacher.
    const supervisor = kind === 'principal' &&
      Object.values(row.supervisedTeachers || {}).some(t => t && t.classIds?.[classId] === true);
    out[uid] = { id: uid, kind, name: adultName(row, kind === 'principal' ? 'Principal' : 'Teacher'), ...(supervisor ? { supervisor } : {}) };
  }
  return out;
}

function decodeVoice(value) {
  if (typeof value !== 'string') fail(400, 'Record a voice message first.');
  const match = value.match(/^data:(audio\/(?:webm|ogg|mp4|mpeg));base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) fail(400, 'Use a supported audio recording.');
  const audio = Buffer.from(match[2], 'base64');
  if (!audio.length || audio.toString('base64') !== match[2]) fail(400, 'That recording could not be read. Please record it again.');
  if (audio.length > VOICE_MAX_BYTES) fail(413, 'Voice messages can be up to 5 minutes. Please record a shorter message.');
  const mime = match[1].toLowerCase();
  const ok = mime === 'audio/webm' ? audio.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'))
    : mime === 'audio/ogg' ? audio.subarray(0, 4).toString('ascii') === 'OggS'
      : mime === 'audio/mp4' ? audio.subarray(4, 8).toString('ascii') === 'ftyp'
        : audio.length > 1 && audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0;
  if (!ok) fail(400, 'That file is not a valid voice recording. Please record it again.');
  return { mime, audio };
}

function publicMessage(m, viewer, readAt) {
  return { id: m.id, role: m.role, text: m.text || '', voice: !!m.voice, durationMs: m.durationMs || 0,
    assignmentId: m.assignmentId || null, assignmentTitle: m.assignmentTitle || '',
    createdAt: m.createdAt, unread: m.role !== viewer && Number(m.createdAt) > (Number(readAt?.[viewer]) || 0) };
}
function preview(m) {
  return { lastAt: m.createdAt, lastRole: m.role, lastVoice: !!m.voice, lastDurationMs: m.durationMs || 0,
    lastText: (m.text || '').slice(0, 80), lastAssignmentTitle: (m.assignmentTitle || '').slice(0, 80) };
}
function rowOut(row) {
  return { unread: Math.max(0, Number(row?.unread) || 0), lastAt: row?.lastAt || null, lastRole: row?.lastRole || '',
    lastVoice: !!row?.lastVoice, lastDurationMs: row?.lastDurationMs || 0, lastText: row?.lastText || '',
    lastAssignmentTitle: row?.lastAssignmentTitle || '' };
}

// ---- shared thread operations ------------------------------------------------
// t = { ws, classId, sid, uid, viewer: 'student'|'teacher', adult: {name, kind}, studentName, className }
async function readThread(store, t) {
  const cur = (await store.get(threadPath(t.ws, t.classId, t.sid, t.uid))) || {};
  const messages = Array.isArray(cur.messages) ? cur.messages : [];
  return messages.map(m => publicMessage(m, t.viewer, cur.readAt));
}

async function send(store, t, body, now, newId, link) {
  const messageText = text(body.text, 1000);
  const voice = body.voiceDataURL == null ? null : decodeVoice(body.voiceDataURL);
  if (!messageText && !voice) fail(400, 'Write a message or record a voice message first.');
  const id = newId();
  if (!key(id)) fail(500, 'Could not send the message.');
  const durationMs = voice ? Math.max(0, Math.min(VOICE_MAX_MS + 5000, Math.round(Number(body.durationMs) || 0))) : 0;
  const message = { id, role: t.viewer, text: messageText, voice: !!voice, durationMs,
    ...(link ? { assignmentId: link.id, assignmentTitle: text(link.title, 120) } : {}), createdAt: now };
  // Audio first: a message never points at audio that failed to save.
  if (voice) {
    if (!store.putFile) fail(503, 'Voice messages are not available yet. Please type your message.');
    await store.putFile(audioPath(t.classId, t.sid, t.uid, id), voice.audio, voice.mime);
  }
  let busy = false, dropped = [];
  const tx = await store.tx(threadPath(t.ws, t.classId, t.sid, t.uid), cur => {
    const list = Array.isArray(cur?.messages) ? cur.messages : [];
    if (list.filter(m => m.role === t.viewer && now - Number(m.createdAt) < BURST_MS).length >= BURST) { busy = true; return undefined; }
    let messages = [...list, message];
    dropped = messages.length > THREAD_MAX ? messages.slice(0, messages.length - THREAD_MAX) : [];
    messages = messages.slice(-THREAD_MAX);
    return { messages, readAt: { ...(cur?.readAt || {}), [t.viewer]: now } }; // replying counts as reading
  });
  if (busy || !tx || tx.committed === false) {
    if (voice && store.deleteFile) await store.deleteFile(audioPath(t.classId, t.sid, t.uid, id)).catch(() => {});
    if (busy) fail(429, 'That is a lot of messages in a few minutes. Please wait a little and try again.');
    fail(409, 'The message could not be saved. Please try again.');
  }
  for (const old of dropped) if (old.voice && store.deleteFile)
    await store.deleteFile(audioPath(t.classId, t.sid, t.uid, old.id)).catch(() => {});
  // Inbox rows: the other side gets one more unread; the sender's own row is caught up.
  const p = preview(message);
  const mine = t.viewer === 'student' ? studentRow(t.ws, t.classId, t.sid, t.uid) : adultRow(t.ws, t.uid, t.classId, t.sid);
  const theirs = t.viewer === 'student' ? adultRow(t.ws, t.uid, t.classId, t.sid) : studentRow(t.ws, t.classId, t.sid, t.uid);
  await store.tx(mine, cur => ({ ...(cur || {}), ...p, unread: 0 }));
  await store.tx(theirs, cur => ({ ...(cur || {}), ...p, unread: Math.max(0, Number(cur?.unread) || 0) + 1 }));
  if (t.viewer === 'teacher') {
    // The student's row remembers who this adult is, in case an owner/admin (not on the
    // class teacher list) writes first; the student can then see and answer them.
    await store.tx(studentRow(t.ws, t.classId, t.sid, t.uid), cur => ({ ...(cur || {}), adultName: t.adult.name, adultKind: t.adult.kind }));
  }
  return publicMessage(message, t.viewer, { [t.viewer]: now });
}

async function markRead(store, t, now) {
  await store.tx(threadPath(t.ws, t.classId, t.sid, t.uid), cur => cur ? { ...cur, readAt: { ...(cur.readAt || {}), [t.viewer]: now } } : undefined);
  const row = t.viewer === 'student' ? studentRow(t.ws, t.classId, t.sid, t.uid) : adultRow(t.ws, t.uid, t.classId, t.sid);
  await store.tx(row, cur => cur ? { ...cur, unread: 0 } : undefined);
  return { ok: true };
}

async function readVoice(store, t, messageId) {
  if (!key(messageId)) fail(404, 'That voice message is no longer available.');
  const messages = await store.get(threadPath(t.ws, t.classId, t.sid, t.uid) + '/messages');
  const m = (Array.isArray(messages) ? messages : []).find(x => x && x.id === messageId && x.voice);
  if (!m || !store.getFile) fail(404, 'That voice message is no longer available.');
  const file = await store.getFile(audioPath(t.classId, t.sid, t.uid, m.id));
  if (!file) fail(404, 'That voice message is no longer available.');
  return { ok: true, voiceDataURL: 'data:' + (file.contentType || 'audio/webm') + ';base64,' + Buffer.from(file.data).toString('base64') };
}

// ---- student side ------------------------------------------------------------
// s = { ws, classId, sid, studentName, defs, mine(def) }
async function studentContacts(store, s) {
  const [adults, rows] = await Promise.all([classAdults(store, s.ws, s.classId),
    store.get(root(s.ws) + '/dmSummary/students/' + s.classId + '/' + s.sid)]);
  const contacts = {};
  for (const [uid, { supervisor, ...adult }] of Object.entries(adults)) {
    // The teachers of the student's class: the only people a student can write to first.
    if (!supervisor) { contacts[uid] = adult; continue; }
    // This principal supervises the class but does not teach it. The student sees the principal
    // only once the principal has written to them, and can then answer. Messages a student
    // sent to the principal before this rule stay readable, with no new sending.
    const row = rows?.[uid];
    if (!row?.lastAt && !row?.adultKind) continue;
    const wrote = row.adultKind === 'principal' || row.lastRole === 'teacher' ||
      ((await store.get(threadPath(s.ws, s.classId, s.sid, uid) + '/messages')) || []).some(m => m && m.role === 'teacher');
    contacts[uid] = wrote ? adult : { ...adult, readOnly: true };
  }
  // Someone not on the teacher list (the owner or an admin) who already wrote to this student.
  for (const [uid, row] of Object.entries(rows || {}))
    if (!contacts[uid] && key(uid) && row?.adultKind === 'admin') contacts[uid] = { id: uid, kind: 'admin', name: row.adultName || 'Teacher' };
  return { contacts, rows: rows || {} };
}
async function studentApi(store, s, body, now, newId) {
  const { contacts, rows } = await studentContacts(store, s);
  if (body.action === 'dmInbox' || body.action === 'dmUnread') {
    const list = Object.values(contacts).map(c => ({ ...c, ...rowOut(rows[c.id]) }))
      .sort((a, b) => (a.kind === 'principal') - (b.kind === 'principal') || (b.lastAt || 0) - (a.lastAt || 0) || a.name.localeCompare(b.name));
    const unread = list.reduce((n, c) => n + c.unread, 0);
    if (body.action === 'dmUnread') return { ok: true, unread };
    return { ok: true, unread, groups: [{ id: s.classId, name: 'My teachers', contacts: list }] };
  }
  const uid = body.teacherId;
  if (!key(uid) || !contacts[uid]) fail(404, 'You can only message your own teachers.');
  const t = { ws: s.ws, classId: s.classId, sid: s.sid, uid, viewer: 'student', adult: contacts[uid] };
  if (body.action === 'dmThread') return { ok: true, contact: contacts[uid], messages: await readThread(store, t) };
  if (body.action === 'dmRead') return markRead(store, t, now);
  if (body.action === 'dmVoice') return readVoice(store, t, body.messageId);
  if (body.action === 'dmSend') {
    if (contacts[uid].readOnly) fail(403, 'You can only message your own teachers.');
    let link = null;
    if (body.assignmentId != null && body.assignmentId !== '') {
      const def = key(body.assignmentId) ? s.defs[body.assignmentId] : null;
      if (!def || !s.mine(def)) fail(404, 'That homework was not found.');
      link = { id: def.id, title: def.title };
    }
    return { ok: true, message: await send(store, t, body, now, newId, link) };
  }
  fail(400, 'Unknown action.');
}

// ---- teacher side ------------------------------------------------------------
// a = { ws, uid, kind, name, classes: [{id, name}], members(classId) -> {sid:{name}}, defs(classId) }
async function teacherInbox(store, a) {
  const rows = (await store.get(root(a.ws) + '/dmSummary/adults/' + a.uid)) || {};
  const groups = [];
  let unread = 0;
  for (const cls of a.classes) {
    const members = await a.members(cls.id);
    const contacts = Object.entries(members).map(([sid, m]) => ({ id: sid, classId: cls.id, kind: 'student', name: m.name,
      ...rowOut(rows[cls.id]?.[sid]) }))
      .sort((x, y) => (y.lastAt || 0) - (x.lastAt || 0) || x.name.localeCompare(y.name));
    contacts.forEach(c => { unread += c.unread; });
    groups.push({ id: cls.id, name: cls.name, contacts });
  }
  return { ok: true, unread, groups };
}
async function teacherUnread(store, ws, uid, classIds) {
  const rows = (await store.get(root(ws) + '/dmSummary/adults/' + uid)) || {};
  let unread = 0;
  for (const classId of classIds) for (const row of Object.values(rows[classId] || {})) unread += Math.max(0, Number(row?.unread) || 0);
  return { ok: true, unread };
}
// One student thread for an adult already authorized for t.classId with the student on its roster.
async function teacherThreadApi(store, t, body, now, newId, defs) {
  if (body.action === 'dmThread') return { ok: true, contact: { id: t.sid, classId: t.classId, kind: 'student', name: t.studentName }, messages: await readThread(store, t) };
  if (body.action === 'dmRead') return markRead(store, t, now);
  if (body.action === 'dmVoice') return readVoice(store, t, body.messageId);
  if (body.action === 'dmSend') {
    let link = null;
    if (body.assignmentId != null && body.assignmentId !== '') {
      const def = key(body.assignmentId) ? defs[body.assignmentId] : null;
      if (!def) fail(404, 'That assignment was not found.');
      link = { id: def.id, title: def.title };
    }
    return { ok: true, message: await send(store, t, body, now, newId, link) };
  }
  fail(400, 'Unknown action.');
}

const DM_ACTIONS = ['dmInbox', 'dmUnread', 'dmThread', 'dmSend', 'dmRead', 'dmVoice'];
module.exports = { DM_ACTIONS, VOICE_MAX_BYTES, VOICE_MAX_MS, adultName, classAdults, studentApi, teacherInbox, teacherUnread, teacherThreadApi };
