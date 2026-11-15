/* Owner as a teacher (#726).
 *
 * The site owner also teaches classes. The owner's Google account always has
 * full owner access; that is decided elsewhere (database rules, the Firebase
 * functions and site-settings.js) and nothing here changes it.
 *
 * "Teacher view" only NARROWS what the owner's own browser shows: while it is
 * on, pages treat the owner like a teacher of the classes the owner assigned
 * to their own email in Owner Admin (the ordinary teacher invitation at
 * b3Games/workspaces/<ws>/teacherInvites/<email key>). It can never widen
 * anyone's access:
 *   - it applies to the owner's verified Google email only;
 *   - the result is always role "teacher" with a subset of classes;
 *   - any doubt (no invitation, no class, a failed read) falls back to the
 *     normal owner view.
 * The choice is remembered per browser, so no sign-out is needed to switch.
 *
 * Shared by site-settings.js, Owner Admin, the Homework teacher page and Node tests.
 */
(function (root) {
  'use strict';
  const OWNER_EMAIL = 'simcha5770@gmail.com';
  const MODE_KEY = 'b3OwnerViewMode';
  const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

  const lower = v => String(v || '').trim().toLowerCase();
  // Same key Owner Admin uses for a teacher invitation.
  const inviteKey = email => lower(email).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  function isOwnerUser(user) {
    return Boolean(user && user.emailVerified === true && lower(user.email) === OWNER_EMAIL);
  }

  function storage() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }
  function getMode(store) {
    try { return (store || storage()).getItem(MODE_KEY) === 'teacher' ? 'teacher' : 'owner'; } catch (e) { return 'owner'; }
  }
  function setMode(mode, store) {
    try {
      const s = store || storage();
      if (mode === 'teacher') s.setItem(MODE_KEY, 'teacher'); else s.removeItem(MODE_KEY);
    } catch (e) {}
    return getMode(store);
  }

  // The classes the owner teaches: an active, ordinary teacher invitation for
  // the owner's own email. Principal invitations and "*" never count.
  function teachingClassIds(invite) {
    if (!invite || invite.active === false || lower(invite.email) !== OWNER_EMAIL) return [];
    if (invite.accountType === 'principal' || invite.role === 'principal') return [];
    const ids = invite.classIds || {};
    return Object.keys(ids).filter(id => id !== '*' && SAFE_ID.test(id) && ids[id] === true).sort();
  }

  // What Teacher view shows for this invitation, or null when it cannot apply.
  function teacherAccess(invite) {
    const classIds = teachingClassIds(invite);
    if (!classIds.length) return null;
    return { authorized: true, role: 'teacher', accountType: 'teacher', supervisedTeachers: {}, classIds,
      inviteId: inviteKey(OWNER_EMAIL), ownerTeacherView: true };
  }

  // Reads the owner's own invitation. Never throws: any problem means "not teaching".
  async function readTeaching(db, workspaceId, user) {
    const none = { classIds: [], access: null };
    if (!db || !isOwnerUser(user) || !SAFE_ID.test(String(workspaceId || ''))) return none;
    try {
      const snap = await db.ref('b3Games/workspaces/' + workspaceId + '/teacherInvites/' + inviteKey(OWNER_EMAIL)).once('value');
      const access = teacherAccess(snap.val());
      return access ? { classIds: access.classIds, access } : none;
    } catch (e) { return none; }
  }

  // The access Teacher view gives right now, or null to keep the normal owner view.
  async function resolve(db, workspaceId, user, store) {
    if (getMode(store) !== 'teacher') return null;
    return (await readTeaching(db, workspaceId, user)).access;
  }

  // Keep only the owner's own classes. `list` holds class ids or {id} rows.
  function narrow(list, classIds) {
    const mine = new Set(classIds || []);
    return (list || []).filter(row => mine.has(row && typeof row === 'object' ? row.id : row));
  }

  // Homework messages inbox: keep only the owner's own classes and recount unread.
  function narrowInbox(data, classIds) {
    const groups = narrow((data && data.groups) || [], classIds);
    const unread = groups.reduce((sum, g) => sum + (g.contacts || []).reduce((n, c) => n + Math.max(0, Number(c && c.unread) || 0), 0), 0);
    return Object.assign({}, data, { groups, unread });
  }

  const SITE_BASE = (function () {
    try { return new URL('.', root.document.currentScript.src).href; } catch (e) { return ''; }
  })();
  function go(mode, page, base) {
    setMode(mode);
    // Owner Admin can sit inside admin.html; switch the whole tab, not the frame.
    let target = root;
    try { if (root.top && root.top.location.origin === root.location.origin) target = root.top; } catch (e) {}
    target.location.href = (base || SITE_BASE) + page;
  }
  function toOwnerAdmin(base) { go('owner', 'owner-admin.html', base); }
  function toTeacherView(base) { go('teacher', 'teacher-home.html', base); }

  // Small always-visible reminder, with the way back, on every page in Teacher view.
  function mountBanner(base) {
    const doc = root.document;
    if (!doc || !doc.body || root.self !== root.top || doc.getElementById('b3OwnerTeacherView')) return;
    const bar = doc.createElement('div');
    bar.id = 'b3OwnerTeacherView';
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483000;display:flex;align-items:center;gap:10px;' +
      'background:#172033;color:#fff;border-radius:999px;padding:8px 10px 8px 16px;font:700 15px/1.2 system-ui,sans-serif;' +
      'box-shadow:0 6px 20px rgba(0,0,0,.3)';
    const label = doc.createElement('span');
    label.textContent = '👨‍🏫 Teacher view: your own classes';
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = 'Owner Admin';
    button.style.cssText = 'border:0;border-radius:999px;padding:8px 14px;background:#fff;color:#172033;font:inherit;cursor:pointer';
    button.onclick = function () { toOwnerAdmin(base); };
    bar.append(label, button);
    doc.body.append(bar);
  }
  function unmountBanner() {
    const bar = root.document && root.document.getElementById('b3OwnerTeacherView');
    if (bar) bar.remove();
  }

  // The way INTO Teacher view on the pages the owner lands on (home page and Admin),
  // so the switch is not only inside Owner Admin (#726 follow-up). Owner mode only,
  // the verified owner only, and one small read of the owner's own invitation.
  // With no class assigned yet it leads to Owner Admin, where the setup is explained.
  let switchPending = false;
  async function mountSwitch(db, workspaceId, user, base) {
    const doc = root.document;
    if (!doc || !doc.body || root.self !== root.top || !isOwnerUser(user) || getMode() !== 'owner') return;
    if (switchPending || doc.getElementById('b3OwnerTeacherSwitch')) return;
    switchPending = true;
    let teaches = false;
    try { teaches = (await readTeaching(db, workspaceId, user)).classIds.length > 0; } finally { switchPending = false; }
    if (doc.getElementById('b3OwnerTeacherSwitch') || getMode() !== 'owner') return;
    const button = doc.createElement('button');
    button.id = 'b3OwnerTeacherSwitch';
    button.type = 'button';
    button.textContent = teaches ? '👨‍🏫 Switch to Teacher view' : '👨‍🏫 Set up Teacher view';
    button.title = teaches ? 'Show only the classes you teach. You stay signed in.'
      : 'Add your own email as a teacher in Owner Admin and assign your classes.';
    button.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483000;border:0;border-radius:999px;padding:12px 18px;' +
      'background:#2563eb;color:#fff;font:700 15px/1.2 system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.3)';
    button.onclick = function () { if (teaches) toTeacherView(base); else toOwnerAdmin(base); };
    doc.body.append(button);
  }
  function unmountSwitch() {
    const button = root.document && root.document.getElementById('b3OwnerTeacherSwitch');
    if (button) button.remove();
  }

  const api = { OWNER_EMAIL, MODE_KEY, inviteKey, isOwnerUser, getMode, setMode, teachingClassIds, teacherAccess,
    readTeaching, resolve, narrow, narrowInbox, toOwnerAdmin, toTeacherView, mountBanner, unmountBanner, mountSwitch, unmountSwitch };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.B3OwnerTeacherView = api;
})(typeof window === 'undefined' ? globalThis : window);
