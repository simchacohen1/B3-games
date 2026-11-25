/* Owner as a teacher (#726, reworked).
 *
 * The site owner also teaches classes. There is no longer a switch between
 * "Owner Admin" and "Teacher view": the owner signs in once, lands on their own
 * Teacher Home, and every admin tool is in the owner-only sidebar there.
 *
 * The owner's Google account always has full owner access on every page; that
 * is decided elsewhere (database rules, the Firebase functions and
 * site-settings.js) and nothing here widens or narrows it.
 *
 * This file only answers "which classes does the owner teach?": the ordinary
 * teacher invitation for the owner's own email
 * (b3Games/workspaces/<ws>/teacherInvites/<email key>). Teacher Home shows those
 * classes. Any doubt (no invitation, no class, a failed read) means "none".
 *
 * Shared by site-settings.js, Teacher Home, Owner Admin, the Homework teacher
 * page and Node tests.
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

  // The old per-browser "Teacher view" choice no longer exists. The mode is always
  // "owner" (full access); setMode only clears a leftover value from older visits.
  function storage() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }
  function getMode() { return 'owner'; }
  function setMode(mode, store) {
    try { (store || storage()).removeItem(MODE_KEY); } catch (e) {}
    return 'owner';
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

  // Retained for older callers: nobody is narrowed any more, so this is always null.
  async function resolve() { return null; }

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

  const api = { OWNER_EMAIL, MODE_KEY, inviteKey, isOwnerUser, getMode, setMode, teachingClassIds, teacherAccess,
    readTeaching, resolve, narrow, narrowInbox };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.B3OwnerTeacherView = api;
})(typeof window === 'undefined' ? globalThis : window);
