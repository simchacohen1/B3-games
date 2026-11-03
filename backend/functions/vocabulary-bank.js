'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const core = require('./vocabulary-bank-core.cjs');
if (!admin.apps.length) admin.initializeApp();
const cors = ['https://simchacohen1.github.io', 'https://funtorahtools.com', 'https://www.funtorahtools.com'];
const ROOT = 'b3Games/workspaces/b3-2026/classes';
const STUDENT_BANK = 'studentVocabulary';
const err = (status, message) => Object.assign(new Error(message), { status });
function isOwner(identity) { return String(identity.email || '').toLowerCase() === 'simcha5770@gmail.com' && identity.email_verified === true; }
async function classContext(db, identity, classId, studentId, teacherRequired = false) {
  if (!core.validId(classId)) throw err(400, 'Invalid class.');
  const [clsSnap, adminSnap, teacherSnap] = await Promise.all([
    db.ref(`${ROOT}/${classId}`).get(), db.ref(`b3Games/admins/${identity.uid}/active`).get(),
    db.ref(`b3Games/workspaces/b3-2026/teachers/${identity.uid}`).get()
  ]);
  const cls = clsSnap.val(), adminUser = adminSnap.val() === true, teacher = teacherSnap.val();
  if (!cls || cls.active === false) throw err(403, 'Active class access required.');
  if (teacherRequired && studentId && (!cls.members?.[studentId] || cls.members[studentId].active === false)) throw err(403, 'That student is not active in this class.');
  const owner = isOwner(identity), assigned = teacher?.active === true && teacher?.classIds?.[classId] === true;
  if (teacherRequired) {
    if (!(owner || adminUser || assigned)) throw err(403, 'You are not assigned to this class.');
  } else {
    const member = cls.members?.[studentId];
    if (!member || member.active === false) throw err(403, 'This student is not active in the selected class.');
    if (identity.b3StudentRole === 'student') {
      if (identity.b3StudentId !== studentId || identity.b3ClassId !== classId) throw err(403, 'Student and class do not match this sign-in.');
    } else if (!(owner || adminUser || assigned)) throw err(403, 'Student sign-in required.');
  }
  return { cls, owner, adminUser, teacher: assigned };
}
function publicBank(bank) { return Object.fromEntries(Object.entries(bank || {}).map(([key, row]) => [row?.id || key, row])); }
function rosterRows(cls, classId, banks) {
  return Object.entries(cls.members || {}).filter(([, member]) => !member || member.active !== false).map(([id, member]) => {
    const bank = banks[id] || {};
    return { id, name: String(member?.name || id), classId, ...core.summary(bank) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
exports.funTorahVocabularyBank = onRequest({ region: 'us-central1', cors, maxInstances: 10 }, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (Buffer.byteLength(JSON.stringify(req.body || {})) > 20000) return res.status(413).json({ error: 'Request too large.' });
  const bearer = String(req.headers.authorization || '');
  if (!bearer.startsWith('Bearer ')) return res.status(401).json({ error: 'Sign in required.' });
  try {
    const identity = await admin.auth().verifyIdToken(bearer.slice(7), true), db = admin.database(), body = req.body || {};
    const action = String(body.action || ''), classId = String(body.classId || identity.b3ClassId || ''), studentId = String(body.studentId || identity.b3StudentId || '');
    if (action === 'collect' || action === 'collectBatch' || action === 'read' || action === 'review') {
      if (identity.b3StudentRole !== 'student' || !core.validId(studentId) || identity.b3StudentId !== studentId || identity.b3ClassId !== classId) throw err(403, 'Student sign-in required.');
      const { cls } = await classContext(db, identity, classId, studentId);
      const ref = db.ref(`${ROOT}/${classId}/${STUDENT_BANK}/${studentId}`);
      if (action === 'read') { const bank = (await ref.get()).val() || {}; return res.json({ ok: true, bank: publicBank(bank), summary: core.summary(bank) }); }
      if (action === 'collect' || action === 'collectBatch') {
        const items = action === 'collect' ? [{ lesson: body.lesson, words: body.words }] : body.items;
        if (!Array.isArray(items) || !items.length || items.length > 20) throw err(400, 'Invalid collection batch.');
        let result;
        await ref.transaction(current => {
          result = current || {};
          for (const item of items) result = core.mergeCollection(result, item.lesson, item.words);
          return result;
        });
        return res.json({ ok: true, summary: core.summary(result || {}) });
      }
      const correct = body.correct === true;
      let result;
      await ref.transaction(current => { result = core.updatePractice(current, String(body.wordId || ''), correct); return result; });
      return res.json({ ok: true, bank: publicBank(result || {}), summary: core.summary(result || {}) });
    }
    if (action === 'teacherRoster' || action === 'teacherRead' || action === 'teacherEdit') {
      if (!core.validId(studentId) && action !== 'teacherRoster') throw err(400, 'Invalid student.');
      const { cls } = await classContext(db, identity, classId, studentId, true);
      if (action === 'teacherRoster') {
        const ids = Object.keys(cls.members || {}).filter(id => core.validId(id));
        const banks = Object.fromEntries(await Promise.all(ids.map(async id => [id, (await db.ref(`${ROOT}/${classId}/${STUDENT_BANK}/${id}`).get()).val() || {}])));
        return res.json({ ok: true, students: rosterRows(cls, classId, banks) });
      }
      const ref = db.ref(`${ROOT}/${classId}/${STUDENT_BANK}/${studentId}`);
      if (action === 'teacherRead') { const bank = (await ref.get()).val() || {}; return res.json({ ok: true, bank: publicBank(bank), summary: core.summary(bank) }); }
      let result;
      await ref.transaction(current => { result = core.editWord(current, String(body.wordId || ''), body.change || {}); return result; });
      return res.json({ ok: true, bank: publicBank(result || {}), summary: core.summary(result || {}) });
    }
    throw err(400, 'Unknown vocabulary action.');
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error('funTorahVocabularyBank', error);
    return res.status(status).json({ error: status >= 500 ? 'Could not save the word bank. Please try again.' : error.message });
  }
});
