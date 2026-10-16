'use strict';
// Private teacher <-> student messaging (text + voice notes), one continuous thread per
// workspace + class + student. All access is decided here with the Admin SDK; the browser
// never touches the assignmentCenter tree (no client rules => denied by default).
//
// Who may do what:
//  - student: their own thread only (proved with their individual passcode); read, send, mark read, report
//  - teacher: threads of students in classes assigned to them (verified Google account); read, send, mark read, report
//  - owner/admin: safeguarding read-only access to any class thread; cannot send
// Messaging is OFF for a class until toolGrants.messages === true.
const crypto = require('node:crypto');
const policy = require('./messages-policy.cjs');
const { resolveStudent } = require('./student-login-core.cjs');

const WS = 'b3-2026';
const OWNER_EMAIL = 'simcha5770@gmail.com';
const DAY = 86400000;
const LIMITS = {
  textChars: 1000,
  voiceBytes: 512 * 1024,          // ~60 s of opus
  voiceSeconds: 60,
  voiceThreadBytes: 25 * 1024 * 1024, // total stored voice per conversation
  voicePerDay: 20,                 // per sender per conversation
  messagesPerHour: 60,             // per sender per conversation
  minGapMs: 700,
  retentionMs: 365 * DAY,
  pageDefault: 30, pageMax: 50
};
const MIME_EXT = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' };
const key = s => typeof s === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(s);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const text = (s, n) => String(s == null ? '' : s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f<>]/g, '').trim().slice(0, n);
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const classPath = c => 'assignmentCenter/workspaces/' + WS + '/classes/' + c;
const threadPath = (c, s) => policy.threadPath({ workspaceId: WS, classId: c, studentId: s });
const voicePath = (c, s, id, ext) => 'assignmentCenter/voice/' + WS + '/' + c + '/' + s + '/' + id + '.' + ext;

function sniff(buf, mime) {
  if (mime === 'audio/webm') return buf.length > 4 && buf.readUInt32BE(0) === 0x1a45dfa3;
  if (mime === 'audio/ogg') return buf.length > 4 && buf.toString('latin1', 0, 4) === 'OggS';
  if (mime === 'audio/mp4') return buf.length > 12 && buf.toString('latin1', 4, 8) === 'ftyp';
  return false;
}

// ---- who is asking ---------------------------------------------------------
async function classFor(store, classId) {
  if (!key(classId)) fail(400, 'Choose a class.');
  const cls = await store.get('b3Games/workspaces/' + WS + '/classes/' + classId);
  if (!cls || cls.active === false) fail(403, 'This class is not available.');
  if (cls.toolGrants?.messages !== true) fail(403, 'Messages are not turned on for this class.');
  return cls;
}
async function memberOk(store, cls, studentId) {
  if (!key(studentId) || !cls.members?.[studentId] || cls.members[studentId].active === false) return null;
  const profile = await store.get('b3Games/students/' + studentId + '/profile');
  if (!profile || profile.active === false) return null;
  return profile;
}

async function actorFor(store, auth, body) {
  if (auth && auth.identity) { // adult: verified Google account
    const id = auth.identity;
    if (!id.uid || id.email_verified !== true || id.firebase?.sign_in_provider !== 'google.com')
      fail(403, 'Verified Google teacher sign-in required.');
    const classId = body.classId;
    const cls = await classFor(store, classId);
    const admin = await store.get('b3Games/admins/' + id.uid);
    const owner = String(id.email || '').toLowerCase() === OWNER_EMAIL || !!(admin && admin.active !== false);
    const row = await store.get('b3Games/workspaces/' + WS + '/teachers/' + id.uid);
    const assigned = !!row && row.active !== false && row.classIds?.[classId] === true;
    if (!owner && !assigned) fail(403, 'This class is not assigned to your teacher account.');
    return { role: 'teacher', id: id.uid, owner, readOnly: !assigned, classId, cls,
      name: text(id.name || String(id.email || '').split('@')[0] || 'Teacher', 60) };
  }
  const st = await resolveStudent(store.get, { b3StudentId: body.studentId, name: body.studentName, pin: body.pin, classId: body.classId });
  if (!key(st.id) || !key(st.classId)) fail(403, 'Choose your class and sign in again.');
  const cls = await classFor(store, st.classId);
  if (!cls.members?.[st.id] || cls.members[st.id].active === false) fail(403, 'Not allowed.');
  return { role: 'student', id: st.id, classId: st.classId, cls, studentId: st.id, name: text(st.profile?.name || 'Student', 60) };
}

// Policy check on every call with trusted data only.
function authorizeThread(actor, studentId) {
  const thread = { workspaceId: WS, classId: actor.classId, studentId };
  const context = {
    workspaceId: WS, classId: actor.classId, classActive: true, studentActive: true, membershipActive: true,
    studentVerifiedId: actor.role === 'student' ? actor.id : null,
    teacherVerifiedId: actor.role === 'teacher' ? actor.id : null,
    teacherAuthorized: actor.role === 'teacher', teacherAssignedToClass: actor.role === 'teacher'
  };
  const d = policy.authorize({ actor: { id: actor.id, role: actor.role, authenticated: true }, thread, context });
  if (!d.allowed) fail(403, 'Not allowed.');
  return thread;
}

// ---- helpers ---------------------------------------------------------------
const publicMessage = m => ({
  id: m.id, senderRole: m.senderRole, senderName: m.senderName, type: m.type, text: m.text || '',
  replyTo: m.replyTo || null, createdAt: m.createdAt,
  voice: m.voice ? { seconds: m.voice.seconds, mime: m.voice.mime } : null, voiceExpired: !!m.voiceExpired
});
const quote = m => m ? { id: m.id, senderRole: m.senderRole, senderName: m.senderName,
  preview: m.type === 'voice' ? '🎙 Voice message' : String(m.text || '').slice(0, 80) } : null;

async function purgeExpired(store, actor, studentId, messages, now) {
  for (const m of messages) {
    if (m.voice && m.voice.expiresAt <= now) {
      try { await store.delFile(m.voice.path); } catch (e) { /* already gone */ }
      const mp = threadPath(actor.classId, studentId) + '/messages/' + m.id;
      await store.set(mp + '/voice', null);
      await store.set(mp + '/voiceExpired', true);
      m.voice = null; m.voiceExpired = true;
    }
  }
}

async function listMessages(store, actor, studentId, body, now) {
  const limit = body.limit == null ? LIMITS.pageDefault : Number(body.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.pageMax) fail(400, 'Bad page size.');
  if (body.before != null && !key(body.before)) fail(400, 'Bad page marker.');
  const rows = await store.page(threadPath(actor.classId, studentId) + '/messages', { limit, before: body.before || null });
  await purgeExpired(store, actor, studentId, rows, now);
  const byId = Object.fromEntries(rows.map(m => [m.id, m]));
  const out = [];
  for (const m of rows) {
    const pm = publicMessage(m);
    if (m.replyTo) {
      const src = byId[m.replyTo] || await store.get(threadPath(actor.classId, studentId) + '/messages/' + m.replyTo);
      pm.replyTo = quote(src);
    }
    out.push(pm);
  }
  const meta = (await store.get(threadPath(actor.classId, studentId) + '/meta')) || {};
  return { ok: true, messages: out, hasMore: rows.length === limit, oldest: rows[0]?.id || null,
    studentReadAt: meta.studentReadAt || 0, teacherReadAt: meta.teacherReadAt || 0,
    unread: actor.role === 'student' ? meta.unreadStudent || 0 : meta.unreadTeacher || 0 };
}

async function sendMessage(store, actor, studentId, body, now) {
  if (actor.readOnly) fail(403, 'The owner view is read-only.');
  const clientId = body.clientId;
  if (!key(clientId) || clientId.length > 64) fail(400, 'Missing message id.');
  const hasVoice = body.voice != null;
  const msgText = text(body.text, LIMITS.textChars);
  if (!hasVoice && !msgText) fail(400, 'Type a message first.');
  if (hasVoice && (typeof body.voice !== 'object' || msgText.length > LIMITS.textChars)) fail(400, 'Bad voice message.');
  const tp = threadPath(actor.classId, studentId);

  // Repeat tap or reconnect retry: claim this client id atomically, so two devices or a retry
  // that races the first attempt can never both create a message.
  const dedupePath = tp + '/dedupe/' + sha(actor.role + ':' + actor.id + ':' + clientId).slice(0, 40);
  const claim = await store.tx(dedupePath, cur => cur ? undefined : 'pending');
  if (claim.committed === false) {
    const seen = await store.get(dedupePath);
    const m = seen && seen !== 'pending' ? await store.get(tp + '/messages/' + seen) : null;
    if (m) return { ok: true, message: publicMessage(m), duplicate: true };
    fail(409, 'That message is still sending. Please wait a moment.');
  }
  try {
    return await sendClaimed(store, actor, studentId, body, now, { tp, dedupePath, clientId, hasVoice, msgText });
  } catch (e) { // free the claim so a retry can try again
    await store.set(dedupePath, null);
    throw e;
  }
}

async function sendClaimed(store, actor, studentId, body, now, { tp, dedupePath, hasVoice, msgText }) {
  let replyTo = null;
  if (body.replyTo != null) {
    if (!key(body.replyTo) || !(await store.get(tp + '/messages/' + body.replyTo))) fail(404, 'The message you replied to was not found.');
    replyTo = body.replyTo;
  }

  let voice = null, bytes = null;
  if (hasVoice) {
    const mime = String(body.voice.mime || '').split(';')[0].trim().toLowerCase();
    const seconds = Number(body.voice.seconds);
    if (!MIME_EXT[mime]) fail(415, 'This recording type is not supported.');
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > LIMITS.voiceSeconds) fail(400, 'Voice messages can be 1 to 60 seconds.');
    const b64 = String(body.voice.data || '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length > Math.ceil(LIMITS.voiceBytes * 4 / 3) + 8) fail(413, 'This recording is too big.');
    bytes = Buffer.from(b64, 'base64');
    if (!bytes.length || bytes.length > LIMITS.voiceBytes) fail(413, 'This recording is too big.');
    if (!sniff(bytes, mime)) fail(415, 'That file is not a valid recording.');
    voice = { mime, seconds, bytes: bytes.length };
  }

  // Limits for this sender in this conversation (atomic).
  let refusal = null;
  await store.tx(tp + '/meta/rate/' + actor.role + '_' + sha(actor.id).slice(0, 16), cur => {
    const r = cur && now - cur.windowStart < 3600000 ? cur : { windowStart: now, count: 0, last: 0, voiceDay: 0, dayStart: now };
    const day = now - (r.dayStart || 0) < DAY ? r : { ...r, dayStart: now, voiceDay: 0 };
    if (now - (r.last || 0) < LIMITS.minGapMs) { refusal = [429, 'Please wait a moment before sending again.']; return undefined; }
    if (r.count >= LIMITS.messagesPerHour) { refusal = [429, 'Too many messages this hour. Please try again later.']; return undefined; }
    if (voice && day.voiceDay >= LIMITS.voicePerDay) { refusal = [429, 'Too many voice messages today.']; return undefined; }
    return { ...day, windowStart: r.windowStart, count: r.count + 1, last: now, voiceDay: (day.voiceDay || 0) + (voice ? 1 : 0) };
  });
  if (refusal) fail(refusal[0], refusal[1]);

  if (voice) { // reserve thread storage first so concurrent uploads cannot overshoot the cap
    let full = false;
    await store.tx(tp + '/meta/voiceBytes', cur => {
      if ((cur || 0) + voice.bytes > LIMITS.voiceThreadBytes) { full = true; return undefined; }
      return (cur || 0) + voice.bytes;
    });
    if (full) fail(413, 'This conversation has reached its voice-message limit.');
  }

  const id = 'm' + now.toString(36).padStart(9, '0') + '_' + crypto.randomBytes(3).toString('hex');
  try {
    if (voice) {
      voice.path = voicePath(actor.classId, studentId, id, MIME_EXT[voice.mime]);
      voice.expiresAt = now + LIMITS.retentionMs;
      await store.putFile(voice.path, bytes, voice.mime);
    }
    const record = { id, senderId: actor.id, senderRole: actor.role, senderName: actor.name,
      type: voice ? 'voice' : 'text', text: msgText, replyTo, createdAt: now, voice };
    await store.set(tp + '/messages/' + id, record);
    await store.set(dedupePath, id);
    const unreadField = actor.role === 'student' ? 'unreadTeacher' : 'unreadStudent';
    await store.tx(tp + '/meta', cur => ({ ...(cur || {}), lastAt: now, lastSenderRole: actor.role,
      lastType: record.type, lastPreview: voice ? '🎙 Voice message' : msgText.slice(0, 60),
      studentName: actor.role === 'student' ? actor.name : (cur || {}).studentName,
      [unreadField]: ((cur || {})[unreadField] || 0) + 1 }));
    return { ok: true, message: publicMessage(record) };
  } catch (e) { // roll back the reservation so a failed upload does not eat the quota
    if (voice) await store.tx(tp + '/meta/voiceBytes', cur => Math.max(0, (cur || 0) - voice.bytes));
    throw e;
  }
}

async function markRead(store, actor, studentId, now) {
  const tp = threadPath(actor.classId, studentId);
  if (actor.readOnly) return { ok: true }; // owner viewing does not clear the teacher's unread
  const mine = actor.role === 'student' ? 'student' : 'teacher';
  await store.tx(tp + '/meta', cur => ({ ...(cur || {}), [mine === 'student' ? 'unreadStudent' : 'unreadTeacher']: 0,
    [mine + 'ReadAt']: now }));
  return { ok: true };
}

async function getVoice(store, actor, studentId, body, now) {
  if (!key(body.messageId)) fail(404, 'Not found.');
  const m = await store.get(threadPath(actor.classId, studentId) + '/messages/' + body.messageId);
  if (!m || !m.voice) fail(404, 'This voice message is no longer available.');
  if (m.voice.expiresAt <= now) { await purgeExpired(store, actor, studentId, [m], now); fail(404, 'This voice message is no longer available.'); }
  const buf = await store.getFile(m.voice.path);
  return { ok: true, mime: m.voice.mime, seconds: m.voice.seconds, data: buf.toString('base64') };
}

async function report(store, actor, studentId, body, now) {
  if (!key(body.messageId)) fail(404, 'Not found.');
  const tp = threadPath(actor.classId, studentId);
  const m = await store.get(tp + '/messages/' + body.messageId);
  if (!m) fail(404, 'Not found.');
  const rid = sha(actor.role + actor.id + m.id).slice(0, 24);
  await store.set(classPath(actor.classId) + '/reports/' + rid, { threadStudentId: studentId, messageId: m.id,
    reportedBy: actor.id, reporterRole: actor.role, reason: text(body.reason, 300), createdAt: now });
  return { ok: true };
}

async function inbox(store, actor) {
  if (actor.role !== 'teacher') fail(403, 'Teachers only.');
  const out = [];
  for (const sid of Object.keys(actor.cls.members || {})) {
    const profile = await memberOk(store, actor.cls, sid);
    if (!profile) continue;
    authorizeThread(actor, sid);
    const meta = (await store.get(threadPath(actor.classId, sid) + '/meta')) || {};
    out.push({ studentId: sid, name: profile.name || sid, unread: meta.unreadTeacher || 0,
      lastAt: meta.lastAt || 0, lastPreview: meta.lastPreview || '', lastSenderRole: meta.lastSenderRole || null });
  }
  out.sort((a, b) => (b.unread > 0) - (a.unread > 0) || b.lastAt - a.lastAt || a.name.localeCompare(b.name));
  return { ok: true, students: out, readOnly: !!actor.readOnly };
}

async function messagesApi(store, auth, body, now = Date.now()) {
  if (!body || typeof body !== 'object') fail(400, 'Bad request.');
  const action = body.action;
  if (!['inbox', 'list', 'send', 'read', 'voice', 'report', 'unread'].includes(action)) fail(400, 'Unknown action.');
  const actor = await actorFor(store, auth, body);
  if (action === 'inbox') return inbox(store, actor);
  let studentId;
  if (actor.role === 'student') studentId = actor.id;
  else {
    studentId = body.studentId;
    if (!(await memberOk(store, actor.cls, studentId))) fail(404, 'That student is not in this class.');
  }
  authorizeThread(actor, studentId);
  if (action === 'unread') {
    const meta = (await store.get(threadPath(actor.classId, studentId) + '/meta')) || {};
    return { ok: true, unread: actor.role === 'student' ? meta.unreadStudent || 0 : meta.unreadTeacher || 0 };
  }
  if (action === 'list') return listMessages(store, actor, studentId, body, now);
  if (action === 'send') return sendMessage(store, actor, studentId, body, now);
  if (action === 'read') return markRead(store, actor, studentId, now);
  if (action === 'voice') return getVoice(store, actor, studentId, body, now);
  return report(store, actor, studentId, body, now);
}
module.exports = { messagesApi, LIMITS };
