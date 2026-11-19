'use strict';
// Teacher actions on a class's locks. Every write goes through here (the database rules forbid direct writes), so a
// student can never forge a lock, an override or a schedule. The rules themselves are in student-lock-core.js.
const lockCore = require('./student-lock-core.js');

const WS = 'b3-2026';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const MIN_OVERRIDE_MINUTES = 1, MAX_OVERRIDE_MINUTES = 240, OPENED_THROTTLE_MS = 60 * 1000;

const nameOf = (teacher, identity) => String(teacher?.displayName || teacher?.name || identity?.name || String(identity?.email || '').split('@')[0] || 'Teacher').slice(0, 60);
const classRoot = classId => `b3Games/workspaces/${WS}/classes/${classId}`;

// Who is asking, and are they allowed to touch this class?
async function authorize(store, identity, classId, { ownerEmail } = {}) {
  if (!identity?.uid) fail(401, 'Sign-in required.');
  if (!validId(classId)) fail(400, 'Choose a valid class.');
  const [admin, teacher, cls] = await Promise.all([
    store.get(`b3Games/admins/${identity.uid}`),
    store.get(`b3Games/workspaces/${WS}/teachers/${identity.uid}`),
    store.get(classRoot(classId))
  ]);
  if (!cls || cls.active === false) fail(404, 'This class is unavailable.');
  const isOwner = !!ownerEmail && String(identity.email || '').toLowerCase() === ownerEmail.toLowerCase() && identity.email_verified === true;
  const isAdmin = isOwner || Boolean(admin && admin.active !== false);
  const assigned = teacher?.active !== false && (teacher?.classIds?.[classId] === true || cls?.teacherIds?.[identity.uid] === true);
  if (!isAdmin && !assigned) fail(403, 'You are not assigned to this class.');
  const teacherUids = Object.keys(cls.teacherIds || {}).filter(uid => cls.teacherIds[uid] === true);
  return { isAdmin, assigned, teacher, cls, teacherUids, name: nameOf(teacher, identity) };
}

// The teacher names the panel shows ("Mr. Cohen has this class now").
async function teacherNames(store, uids) {
  const rows = await Promise.all(uids.map(uid => store.get(`b3Games/workspaces/${WS}/teachers/${uid}`)));
  return uids.map((uid, i) => ({ uid, name: nameOf(rows[i], { email: '' }) }));
}

function summary(locks, auth, identity, now, names) {
  const holder = lockCore.holderOf(locks, auth.teacherUids, now);
  return {
    ok: true, now, classId: null,
    locks: { features: locks?.features || {}, schedules: locks?.schedules || {}, overrides: locks?.overrides || {}, opened: locks?.opened || {} },
    teachers: names, holder: holder ? { ...holder, name: names.find(n => n.uid === holder.uid)?.name || 'A teacher' } : null,
    me: { uid: identity.uid, isHolder: holder?.uid === identity.uid, isAdmin: auth.isAdmin }
  };
}

const liveOverrides = (overrides, now) => Object.fromEntries(Object.entries(overrides || {}).filter(([, o]) => o && Number(o.until) > now));

async function manageLocks(store, identity, body, options = {}, now = Date.now()) {
  const classId = String(body?.classId || '');
  const auth = await authorize(store, identity, classId, options);
  const root = classRoot(classId) + '/locks';
  const action = String(body?.action || '');
  const locks = (await store.get(root)) || {};

  if (action === 'state') {
    const names = await teacherNames(store, auth.teacherUids);
    return { ...summary(locks, auth, identity, now, names), classId, className: String(auth.cls.name || classId) };
  }

  // Opening the class is what makes a teacher the holder when no schedule covers the moment.
  if (action === 'opened') {
    if (!auth.assigned) return { ok: true, skipped: true };
    const last = Number(locks.opened?.[identity.uid]) || 0;
    if (now - last >= OPENED_THROTTLE_MS) await store.update({ [`${root}/opened/${identity.uid}`]: now });
    return { ok: true };
  }

  if (action === 'setFeature') {
    const feature = lockCore.FEATURES.find(f => f.id === body.featureId);
    if (!feature || typeof body.locked !== 'boolean') fail(400, 'Invalid lock setting.');
    await store.update({ [`${root}/features/${feature.id}`]: body.locked ? { locked: true, by: identity.uid, at: now } : null });
    return { ok: true };
  }
  if (action === 'setAll') {
    if (typeof body.locked !== 'boolean') fail(400, 'Invalid lock setting.');
    const updates = {};
    for (const f of lockCore.FEATURES) updates[`${root}/features/${f.id}`] = body.locked ? { locked: true, by: identity.uid, at: now } : null;
    await store.update(updates);
    return { ok: true };
  }

  // Each teacher keeps his own weekly schedule for the class.
  if (action === 'saveSchedule') {
    if (!auth.assigned) fail(403, 'Only a teacher of this class has a schedule.');
    let rules;
    try { rules = lockCore.normalizeRules(body.rules || []); } catch (error) { fail(400, error.message); }
    const empty = Object.keys(rules).length === 0;
    await store.update({ [`${root}/schedules/${identity.uid}`]: empty ? null : { name: auth.name, rules, updatedAt: now } });
    return { ok: true, rules };
  }

  // Temporary manual unlock (or lock): only the teacher who has the class right now (or the owner/admin).
  if (action === 'override' || action === 'clearOverride') {
    const holder = lockCore.holderOf(locks, auth.teacherUids, now);
    if (!auth.isAdmin && holder?.uid !== identity.uid) {
      const names = await teacherNames(store, holder ? [holder.uid] : []);
      fail(403, holder ? `${names[0].name} has this class right now (${holder.why === 'scheduled' ? 'it is on his schedule' : 'he opened it most recently'}). Only he can change it for now.`
        : 'Open this class first so you hold it.');
    }
    const targets = (Array.isArray(body.targets) ? body.targets : []).filter((t, i, a) => lockCore.isTarget(t) && a.indexOf(t) === i);
    if (!targets.length) fail(400, 'Choose what to change.');
    const updates = {};
    // Old, ended overrides are tidied away on every change.
    for (const key of Object.keys(locks.overrides || {})) if (!(Number(locks.overrides[key]?.until) > now)) updates[`${root}/overrides/${key}`] = null;
    if (action === 'clearOverride') {
      for (const t of targets) updates[`${root}/overrides/${t}`] = null;
      await store.update(updates);
      return { ok: true };
    }
    if (!['open', 'locked'].includes(body.state)) fail(400, 'Choose unlock or lock.');
    let until, label;
    if (body.endOfClass === true) {
      const end = lockCore.endOfClass(locks, identity.uid, now);
      until = end.until; label = end.fromSchedule ? 'until the end of class' : `for ${lockCore.DEFAULT_CLASS_MINUTES} min (no schedule set)`;
    } else {
      const minutes = Number(body.minutes);
      if (!Number.isFinite(minutes) || minutes < MIN_OVERRIDE_MINUTES || minutes > MAX_OVERRIDE_MINUTES) fail(400, `Choose between ${MIN_OVERRIDE_MINUTES} and ${MAX_OVERRIDE_MINUTES} minutes.`);
      until = now + Math.round(minutes) * 60000; label = `${Math.round(minutes)} min`;
    }
    const names = await teacherNames(store, [identity.uid]);
    for (const t of targets) updates[`${root}/overrides/${t}`] = { state: body.state, until, by: identity.uid, byName: names[0].name || auth.name, label, at: now };
    await store.update(updates);
    return { ok: true, until, label };
  }

  fail(400, 'Unknown lock action.');
}

// For other functions (the Arcade, Class Pointer tickets): is this feature locked for a student of this class right now?
async function featureLockedForClass(store, classId, featureId, now = Date.now(), workspaceId = WS) {
  if (!validId(classId) || !validId(workspaceId)) return { locked: false };
  const locks = (await store.get(`b3Games/workspaces/${workspaceId}/classes/${classId}/locks`)) || {};
  const feature = lockCore.FEATURES.find(f => f.id === featureId);
  if (!feature) return { locked: false };
  const state = lockCore.featureState(locks, feature, now);
  return { locked: state.locked === true, state, message: state.locked ? 'Locked by your teacher.' : '' };
}

module.exports = { manageLocks, featureLockedForClass, authorize, liveOverrides, MAX_OVERRIDE_MINUTES, OPENED_THROTTLE_MS };
