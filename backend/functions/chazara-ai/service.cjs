'use strict';
/**
 * Chazara AI Practice — server service (no HTTP, no Firebase SDK; store/providers injected).
 *
 * Data (all under b3Private/, which database rules deny to every browser):
 *   b3Private/chazaraAiPractice/config                          owner switch + limit overrides
 *   b3Private/chazaraAiPractice/assignments/{classId}/{id}      teacher-approved Hebrew text
 *   b3Private/chazaraAiPractice/progress/{classId}/{id}/{sid}   attempts / last outcome (no audio, no transcript)
 *   b3Private/chazaraAiPractice/inflight/{sid}                  one check at a time + duplicate-request replay
 *   b3Private/chazaraAiPractice/usage/limits                    shared rate counters
 *   b3Private/chazaraAiPractice/usage/months/{YYYY-MM}          cost/latency totals
 *
 * Regular (teacher-reviewed) Chazara data under posukPractice/chazara/** is never read or written here.
 */
const crypto = require('node:crypto');
const { evaluateAttempt } = require('./pipeline.cjs');

const WS = 'b3-2026';
const ROOT = 'b3Private/chazaraAiPractice';
const OWNER_EMAIL = 'simcha5770@gmail.com';
const KEY = /^[A-Za-z0-9_-]{1,100}$/;
const key = v => typeof v === 'string' && KEY.test(v);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const clean = (s, n) => String(s == null ? '' : s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f<>]/g, '').trim().slice(0, n);

const MAX_PESUKIM = 6;
const MAX_SEGMENT_BYTES = 1.5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 6 * 1024 * 1024;
const AUDIO_TYPES = /^audio\/(webm|ogg|mp4|mpeg|wav|x-wav|aac|x-m4a)(;.*)?$/i;
const INFLIGHT_MS = 120000;        // a check still running blocks a second one for this long
const REPLAY_MS = 10 * 60000;      // same requestId within this window returns the saved result
const COOLDOWN_MS = 4000;          // minimum gap between two checks by one student

const DEFAULT_LIMITS = { minute: 20, day: 150, month: 1500, studentDay: 15, classDay: 120 };
// List-price estimates used only for the owner's usage report (verify in the billing console).
// OpenAI gpt-4o-mini-transcribe list price (verify on the OpenAI pricing page).
// The function's own compute is a few seconds at 256 MiB and is not counted here.
const PRICES = { transcribePerMinute: 0.003 };

const SEFARIM = ['Bereishis', 'Shemos', 'Vayikra', 'Bamidbar', 'Devarim'];
const HEB_NUM = n => {
  const ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'], tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  n = Number(n); if (n === 15) return 'טו'; if (n === 16) return 'טז';
  const hundreds = n >= 100 ? 'ק' : ''; n %= 100;
  return hundreds + (tens[Math.floor(n / 10)] || '') + (ones[n % 10] || '');
};
const pasukLabel = (perek, posuk) => 'פרק ' + HEB_NUM(perek) + ' · פסוק ' + HEB_NUM(posuk);

const UNAVAILABLE = {
  outcome: 'unavailable',
  title: 'Taking a short break',
  message: 'The checker needs a short break. Please try again in a minute!',
  tips: [],
  pesukim: []
};

// ---------- identity & class scope ----------

async function teacherAccess(store, identity, classId) {
  if (!identity || !identity.uid || identity.email_verified !== true || identity.firebase?.sign_in_provider !== 'google.com')
    fail(403, 'Verified Google teacher sign-in required.');
  if (!key(classId)) fail(400, 'Choose a class.');
  const base = 'b3Games/workspaces/' + WS + '/classes/' + classId;
  const [active, grants, admin] = await Promise.all([
    store.get(base + '/active'), store.get(base + '/toolGrants'), store.get('b3Games/admins/' + identity.uid)
  ]);
  const owner = String(identity.email || '').toLowerCase() === OWNER_EMAIL || !!(admin && admin.active !== false);
  if (active === false || (active == null && grants == null && !owner)) fail(403, 'This class is not available.');
  if (!owner) {
    const row = await store.get('b3Games/workspaces/' + WS + '/teachers/' + identity.uid);
    if (!row || row.active === false || row.classIds?.[classId] !== true) fail(403, 'This class is not assigned to your teacher account.');
    if (!['et', 'wt'].includes(classId) && grants?.chazara !== true) fail(403, 'Chazara is not turned on for this class.');
  }
  return { uid: identity.uid, owner };
}

// ---------- config & limits ----------

async function config(store) {
  const c = (await store.get(ROOT + '/config')) || {};
  return { enabled: c.enabled === true, limits: { ...DEFAULT_LIMITS, ...(c.limits || {}) } };
}

async function reserve(store, limits, studentId, classId, now) {
  const day = new Date(now).toISOString().slice(0, 10), month = day.slice(0, 7), minute = Math.floor(now / 60000);
  const sHash = crypto.createHash('sha256').update(studentId).digest('hex').slice(0, 24);
  let reason = '';
  const res = await store.tx(ROOT + '/usage/limits', cur => {
    reason = '';
    const c = cur || {};
    const sameDay = c.day === day;
    const students = sameDay ? { ...(c.students || {}) } : {};
    const classes = sameDay ? { ...(c.classes || {}) } : {};
    const m = c.minute === minute ? c.minuteCount || 0 : 0;
    const d = sameDay ? c.dayCount || 0 : 0;
    const mo = c.month === month ? c.monthCount || 0 : 0;
    if (m >= limits.minute) { reason = 'busy'; return; }
    if (d >= limits.day || mo >= limits.month) { reason = 'allowance'; return; }
    if ((students[sHash] || 0) >= limits.studentDay) { reason = 'student'; return; }
    if ((classes[classId] || 0) >= limits.classDay) { reason = 'class'; return; }
    students[sHash] = (students[sHash] || 0) + 1;
    classes[classId] = (classes[classId] || 0) + 1;
    return { minute, day, month, minuteCount: m + 1, dayCount: d + 1, monthCount: mo + 1, students, classes };
  });
  if (!res.committed) {
    if (reason === 'student') fail(429, "You've practiced a lot today! Come back tomorrow for more AI Practice.");
    if (reason === 'busy') fail(429, 'Lots of boys are practicing right now. Please try again in a minute.');
    fail(429, 'AI Practice has reached its limit for now. Please try again later or ask your teacher.');
  }
}

// ---------- assignment validation ----------

function cleanAssignment(input, existing) {
  if (!input || typeof input !== 'object') fail(400, 'Missing assignment.');
  const mode = input.mode === 'ai' ? 'ai' : 'regular'; // regular stays the default
  const sefer = SEFARIM.includes(input.sefer) ? input.sefer : 'Bereishis';
  const perek = Number(input.perek), from = Number(input.from), to = Number(input.to || input.from);
  if (!Number.isInteger(perek) || perek < 1 || perek > 50) fail(400, 'Choose a perek.');
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > 200) fail(400, 'Choose the pesukim.');
  if (to - from + 1 > MAX_PESUKIM) fail(400, 'An AI Practice assignment can have up to ' + MAX_PESUKIM + ' pesukim.');
  const given = input.pesukim && typeof input.pesukim === 'object' ? input.pesukim : {};
  const pesukim = {};
  for (let v = from; v <= to; v++) {
    const k = perek + '_' + v, row = given[k] || {};
    const hebrew = clean(row.hebrew, 700); // a meaning field, if sent, is ignored (no translation key)
    if (mode === 'ai' && !hebrew) fail(400, 'Add the Hebrew text for ' + pasukLabel(perek, v) + '.');
    if (hebrew && !/[א-ת]/.test(hebrew)) fail(400, 'The Hebrew text for ' + pasukLabel(perek, v) + ' must be in Hebrew letters.');
    pesukim[k] = { perek, posuk: v, hebrew };
  }
  const title = clean(input.title, 120) || (sefer + ' ' + perek + ':' + from + (to > from ? '-' + to : ''));
  return {
    title, mode, sefer, perek, from, to, pesukim,
    active: input.active === false ? false : true,
    createdAt: existing?.createdAt || null
  };
}

function orderedPesukim(a) {
  return Object.values(a.pesukim || {}).filter(p => p && Number.isInteger(p.posuk))
    .sort((x, y) => x.perek - y.perek || x.posuk - y.posuk);
}

function studentView(id, a, progress) {
  return {
    id, title: a.title, mode: a.mode, sefer: a.sefer, perek: a.perek, from: a.from, to: a.to,
    pesukim: orderedPesukim(a).map(p => ({ id: p.perek + '_' + p.posuk, perek: p.perek, posuk: p.posuk, label: pasukLabel(p.perek, p.posuk), hebrew: p.hebrew })),
    progress: progress ? { attempts: progress.attempts || 0, lastOutcome: progress.lastOutcome || null, excellent: (progress.excellentCount || 0) > 0 } : null
  };
}

// ---------- actions ----------

function createService({ store, providers, now = () => Date.now(), newId = () => crypto.randomBytes(9).toString('base64url') }) {
  async function teacherList(identity, body) {
    await teacherAccess(store, identity, body.classId);
    const [assignments, progress] = await Promise.all([
      store.get(ROOT + '/assignments/' + body.classId),
      store.get(ROOT + '/progress/' + body.classId)
    ]);
    const list = Object.entries(assignments || {}).filter(([id, a]) => key(id) && a).map(([id, a]) => ({
      id, ...a, pesukim: orderedPesukim(a),
      completion: Object.fromEntries(Object.entries((progress || {})[id] || {}).map(([sid, p]) => [sid, {
        attempts: p.attempts || 0, lastOutcome: p.lastOutcome || null, lastAt: p.lastAt || null, excellent: (p.excellentCount || 0) > 0
      }]))
    })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const cfg = await config(store);
    return { ok: true, assignments: list, aiEnabled: cfg.enabled };
  }

  async function teacherSave(identity, body) {
    const access = await teacherAccess(store, identity, body.classId);
    const id = body.assignmentId ? String(body.assignmentId) : newId();
    if (!key(id)) fail(400, 'Invalid assignment.');
    const path = ROOT + '/assignments/' + body.classId + '/' + id;
    const existing = body.assignmentId ? await store.get(path) : null;
    if (body.assignmentId && !existing) fail(404, 'That assignment was not found.');
    const a = cleanAssignment(body.assignment, existing);
    const t = now();
    const record = { ...a, createdAt: a.createdAt || t, createdBy: existing?.createdBy || access.uid, updatedAt: t, updatedBy: access.uid };
    await store.set(path, record);
    return { ok: true, id, assignment: { id, ...record, pesukim: orderedPesukim(record) } };
  }

  async function teacherArchive(identity, body) {
    await teacherAccess(store, identity, body.classId);
    if (!key(body.assignmentId)) fail(400, 'Invalid assignment.');
    const path = ROOT + '/assignments/' + body.classId + '/' + body.assignmentId;
    if (!(await store.get(path))) fail(404, 'That assignment was not found.');
    await store.update({ [path + '/active']: body.active === true, [path + '/updatedAt']: now() });
    return { ok: true };
  }

  async function usageReport(identity) {
    const admin = identity?.uid ? await store.get('b3Games/admins/' + identity.uid) : null;
    const owner = identity?.email_verified === true && (String(identity.email || '').toLowerCase() === OWNER_EMAIL || !!(admin && admin.active !== false));
    if (!owner) fail(403, 'Owner only.');
    const month = new Date(now()).toISOString().slice(0, 7);
    const u = (await store.get(ROOT + '/usage/months/' + month)) || {};
    const evaluations = u.evaluations || 0;
    const cost = (u.audioSeconds || 0) / 60 * PRICES.transcribePerMinute;
    return { ok: true, month, ...u, estimatedCostUsd: Math.round(cost * 100) / 100,
      estimatedCostPerEvaluationUsd: evaluations ? Math.round(cost / evaluations * 1000) / 1000 : null,
      averageMs: evaluations ? Math.round((u.totalMs || 0) / evaluations) : null, config: await config(store) };
  }

  async function studentList(student) {
    const [assignments, cfg] = await Promise.all([store.get(ROOT + '/assignments/' + student.classId), config(store)]);
    const active = Object.entries(assignments || {}).filter(([id, a]) => key(id) && a && a.active !== false);
    const progress = await Promise.all(active.map(([id, a]) => a.mode === 'ai'
      ? store.get(ROOT + '/progress/' + student.classId + '/' + id + '/' + student.studentId) : null));
    return { ok: true, aiEnabled: cfg.enabled,
      assignments: active.map(([id, a], i) => studentView(id, a, progress[i])).sort((x, y) => x.perek - y.perek || x.from - y.from) };
  }

  async function evaluate(student, body, files) {
    const assignmentId = String(body.assignmentId || ''), requestId = String(body.requestId || '');
    if (!key(assignmentId) || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) fail(400, 'Please record again.');
    const cfg = await config(store);
    if (!cfg.enabled) fail(503, 'AI Practice is not switched on yet. Ask your teacher.');

    // The pasuk text comes from the server, never from the browser.
    const a = await store.get(ROOT + '/assignments/' + student.classId + '/' + assignmentId);
    if (!a || a.active === false || a.mode !== 'ai') fail(404, 'This AI Practice is not available.');
    const pesukim = orderedPesukim(a);
    if (!pesukim.length || pesukim.some(p => !p.hebrew)) fail(409, 'Your teacher has not finished this AI Practice yet.');

    if (!Array.isArray(files) || files.length !== pesukim.length) fail(400, 'Please record every pasuk, then press Finish.');
    let total = 0;
    for (const f of files) {
      if (!f || !Buffer.isBuffer(f.buffer) || !f.buffer.length) fail(400, 'A recording was empty. Please record again.');
      if (f.buffer.length > MAX_SEGMENT_BYTES) fail(413, 'That recording is too long. Keep each pasuk under one minute.');
      if (!AUDIO_TYPES.test(f.mimeType || '')) fail(415, 'This recording type is not supported.');
      total += f.buffer.length;
    }
    if (total > MAX_TOTAL_BYTES) fail(413, 'That recording is too long.');
    // Recording lengths from the browser are used ONLY for the cost report (clamped to 0–60 s).
    let durations = [];
    try { durations = JSON.parse(String(body.durations || '[]')); } catch (_) { durations = []; }
    durations = files.map((_, i) => Math.min(60000, Math.max(0, Number(Array.isArray(durations) ? durations[i] : 0) || 0)));

    // One check at a time per student; a repeated requestId replays the saved result (no new cost).
    const t = now();
    const inflightPath = ROOT + '/inflight/' + student.studentId;
    let replay = null, blocked = '';
    const claim = await store.tx(inflightPath, cur => {
      replay = null; blocked = '';
      if (cur && cur.requestId === requestId) {
        if (cur.result && t - (cur.finishedAt || 0) < REPLAY_MS) { replay = cur.result; return; }
        if (!cur.result && t - (cur.startedAt || 0) < INFLIGHT_MS) { blocked = 'running'; return; }
      } else if (cur && !cur.result && t - (cur.startedAt || 0) < INFLIGHT_MS) { blocked = 'running'; return; }
      else if (cur && cur.finishedAt && t - cur.finishedAt < COOLDOWN_MS) { blocked = 'cooldown'; return; }
      return { requestId, assignmentId, startedAt: t };
    });
    if (replay) return { ok: true, ...replay, replayed: true };
    if (!claim.committed) fail(429, blocked === 'cooldown' ? 'One moment, then try again.' : 'Still checking your last recording…');

    let result, usage = null, elapsedMs = 0, countable = true;
    try {
      await reserve(store, cfg.limits, student.studentId, student.classId, t);
    } catch (e) {
      await store.set(inflightPath, null);
      throw e;
    }
    try {
      const out = await evaluateAttempt({
        items: pesukim.map(p => ({ id: p.perek + '_' + p.posuk, label: pasukLabel(p.perek, p.posuk) })),
        clips: files.map((f, i) => ({ buffer: f.buffer, mimeType: f.mimeType, durationMs: durations[i] })), providers
      });
      result = out.decision; usage = out.usage; elapsedMs = out.elapsedMs;
    } catch (e) {
      if (e && Number.isInteger(e.code) && e.code >= 400 && e.code < 500) { await store.set(inflightPath, null); throw e; }
      // The transcription service could not read the audio file itself (e.g. a cut-off upload).
      if (e && e.code === 'transcribe_failed' && e.status === 400) { await store.set(inflightPath, null); fail(422, "That recording didn't save properly — please try again."); }
      console.error('chazaraAiPractice evaluate failed', e && (e.code || e.message));
      result = UNAVAILABLE; countable = false;
    }

    const finishedAt = now();
    // A failed check is not saved for replay, so "Check Again" really checks again.
    const writes = [store.set(inflightPath, countable ? { requestId, assignmentId, startedAt: t, finishedAt, result } : null)];
    if (countable) {
      writes.push(store.tx(ROOT + '/progress/' + student.classId + '/' + assignmentId + '/' + student.studentId, cur => {
        const c = cur || {};
        return { attempts: (c.attempts || 0) + 1, lastOutcome: result.outcome, lastAt: finishedAt,
          excellentCount: (c.excellentCount || 0) + (result.outcome === 'excellent' ? 1 : 0),
          firstExcellentAt: c.firstExcellentAt || (result.outcome === 'excellent' ? finishedAt : null) };
      }));
    }
    const month = new Date(finishedAt).toISOString().slice(0, 7);
    writes.push(store.tx(ROOT + '/usage/months/' + month, cur => {
      const c = cur || {}, outcomes = { ...(c.outcomes || {}) };
      outcomes[result.outcome] = (outcomes[result.outcome] || 0) + 1;
      return { evaluations: (c.evaluations || 0) + 1, outcomes,
        audioSeconds: Math.round(((c.audioSeconds || 0) + (usage?.audioSeconds || 0)) * 10) / 10,
        totalMs: (c.totalMs || 0) + elapsedMs };
    }));
    await Promise.all(writes);
    return { ok: true, ...result };
  }

  return { teacherList, teacherSave, teacherArchive, usageReport, studentList, evaluate };
}

module.exports = { createService, teacherAccess, cleanAssignment, studentView, pasukLabel, DEFAULT_LIMITS, PRICES, ROOT, UNAVAILABLE };
