/* Schools: which school a teacher belongs to, and whether that school syncs to Nigri.
 *
 * Data (owner-written only; the workspace rules already block teachers from writing here):
 *   b3Games/workspaces/<ws>/schools/<schoolId>          {name, syncsToNigri, createdAt, updatedAt}
 *   b3Games/workspaces/<ws>/teacherInvites/<id>/schoolId  the ONE place a teacher's school is stored
 *
 * The invitation is the source of truth because the teacher-claim server rebuilds
 * teachers/<uid> from scratch on every sign-in; a copy kept there would be wiped.
 *
 * This only decides what the page SHOWS. The NigriSync server must make the same
 * check on every login save and every sync, because hiding a button is not security.
 * Shared by Owner Admin, the Nigri pages, and Node tests.
 */
(function (root) {
  'use strict';
  const OWNER_EMAIL = 'simcha5770@gmail.com';
  const DEFAULT_SCHOOL = Object.freeze({ id: 'negri_shluchim', name: 'Negri Shluchim Online School', syncsToNigri: true });
  const ID_RE = /^[a-z0-9_]{1,60}$/;

  function inviteKey(email) {
    return String(email || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }
  function schoolKey(name) {
    return String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
  }
  function cleanName(name) {
    return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  function principal(record) {
    return !!record && (record.accountType === 'principal' || record.role === 'principal');
  }

  // Only well-formed school records count; anything else is ignored.
  function normalizeSchools(raw) {
    const out = {};
    Object.keys(raw || {}).forEach(id => {
      const s = raw[id];
      if (!ID_RE.test(id) || !s || typeof s !== 'object') return;
      const name = cleanName(s.name);
      if (!name) return;
      out[id] = { name, syncsToNigri: s.syncsToNigri === true };
    });
    return out;
  }

  // A new id for a school name that does not clash with an existing one.
  function newSchoolId(name, schools) {
    const base = schoolKey(name) || 'school';
    if (!(schools || {})[base]) return base;
    for (let i = 2; i < 1000; i++) if (!schools[base + '_' + i]) return base + '_' + i;
    return base + '_' + Date.now().toString(36);
  }

  // How many teachers/principals are in each school (used to block deleting a school that still has people).
  function countBySchool(invites) {
    const counts = {};
    Object.values(invites || {}).forEach(inv => {
      const id = inv && inv.schoolId;
      if (typeof id === 'string' && id) counts[id] = (counts[id] || 0) + 1;
    });
    return counts;
  }

  /* Decide whether this person sees Nigri options.
   * isOwner: the owner (or an active admin) always sees them.
   * invite:  the person's own teacherInvites record. */
  function nigriAccess({ isOwner, invite, schools }) {
    if (isOwner) return { allowed: true, reason: 'owner', schoolId: '', schoolName: '' };
    if (!invite || invite.active === false) return { allowed: false, reason: 'no-invite', schoolId: '', schoolName: '' };
    const schoolId = typeof invite.schoolId === 'string' ? invite.schoolId : '';
    if (!schoolId) return { allowed: false, reason: 'no-school', schoolId: '', schoolName: '' };
    const school = normalizeSchools(schools)[schoolId];
    if (!school) return { allowed: false, reason: 'unknown-school', schoolId, schoolName: '' };
    if (principal(invite)) return { allowed: false, reason: 'principal', schoolId, schoolName: school.name };
    if (!school.syncsToNigri) return { allowed: false, reason: 'school-off', schoolId, schoolName: school.name };
    return { allowed: true, reason: 'ok', schoolId, schoolName: school.name };
  }

  /* One-time move: create the default school (if missing) and put everyone
   * (teachers and principals, signed in or not) who has no school yet into it.
   * Returns a preview plus the exact updates, relative to the workspace root. */
  function planDefaultMove(invites, schools, now) {
    const updates = {};
    const existing = (schools || {})[DEFAULT_SCHOOL.id];
    const createSchool = !existing;
    if (createSchool) {
      updates['schools/' + DEFAULT_SCHOOL.id] = { name: DEFAULT_SCHOOL.name, syncsToNigri: true, createdAt: now, updatedAt: now };
    }
    const assign = [];
    let alreadyAssigned = 0;
    Object.keys(invites || {}).sort().forEach(id => {
      const inv = invites[id];
      if (!inv || typeof inv !== 'object') return;
      if (typeof inv.schoolId === 'string' && inv.schoolId) { alreadyAssigned++; return; }
      assign.push({ inviteId: id, name: String(inv.name || inv.email || id), principal: principal(inv), signedIn: !!inv.claimedUid });
      updates['teacherInvites/' + id + '/schoolId'] = DEFAULT_SCHOOL.id;
    });
    return { schoolId: DEFAULT_SCHOOL.id, schoolName: existing ? cleanName(existing.name) : DEFAULT_SCHOOL.name, createSchool, assign, alreadyAssigned, updates };
  }

  /* Move one teacher to another school. When the school actually changes, any saved
   * Nigri login is marked for removal: the browser cannot touch the encrypted login
   * itself (b3Private is closed to every browser), so NigriSync treats a login saved
   * before nigriLoginResetAt as gone and deletes it. */
  function planMoveTeacher(inviteId, invite, newSchoolId, now) {
    if (!invite || !ID_RE.test(String(newSchoolId || ''))) return null;
    if (invite.schoolId === newSchoolId) return {};
    const base = 'teacherInvites/' + inviteId;
    const updates = { [base + '/schoolId']: newSchoolId };
    if (invite.schoolId) updates[base + '/nigriLoginResetAt'] = now;
    return updates;
  }

  // Browser only: decide for the signed-in user. Every read here is of the user's own records.
  async function checkNigri({ db, user, workspaceId }) {
    if (!db || !user) return { allowed: false, reason: 'signed-out', schoolId: '', schoolName: '' };
    const ws = 'b3Games/workspaces/' + String(workspaceId || 'b3-2026');
    const email = String(user.email || '').trim().toLowerCase();
    if (user.emailVerified === true && email === OWNER_EMAIL) return nigriAccess({ isOwner: true });
    const read = async path => { try { return (await db.ref(path).once('value')).val(); } catch (e) { return undefined; } };
    const admin = await read('b3Games/admins/' + user.uid);
    if (admin && admin.active !== false) return nigriAccess({ isOwner: true });
    const teacher = await read(ws + '/teachers/' + user.uid);
    if (teacher && teacher.active === false) return { allowed: false, reason: 'no-invite', schoolId: '', schoolName: '' };
    const inviteId = (teacher && typeof teacher.inviteId === 'string' && teacher.inviteId) || inviteKey(email);
    if (!inviteId || user.emailVerified !== true) return { allowed: false, reason: 'no-invite', schoolId: '', schoolName: '' };
    const invite = await read(ws + '/teacherInvites/' + inviteId);
    if (invite === undefined) return { allowed: false, reason: 'check-failed', schoolId: '', schoolName: '' };
    // The invitation must really be this person's.
    if (!invite || String(invite.email || '').trim().toLowerCase() !== email) return { allowed: false, reason: 'no-invite', schoolId: '', schoolName: '' };
    const schoolId = typeof invite.schoolId === 'string' ? invite.schoolId : '';
    const schools = schoolId && ID_RE.test(schoolId) ? { [schoolId]: await read(ws + '/schools/' + schoolId) } : {};
    return nigriAccess({ isOwner: false, invite, schools });
  }

  const MESSAGES = {
    'school-off': 'Nigri sync is not turned on for your school.',
    'no-school': 'Nigri sync is not turned on for your school.',
    'unknown-school': 'Nigri sync is not turned on for your school.',
    principal: 'Nigri sync is for classroom teachers.',
    'no-invite': 'This page is for teachers whose school syncs to Nigri.',
    'signed-out': 'Sign in with your teacher Google account to continue.',
    'check-failed': 'Could not check your school right now. Refresh the page to try again.'
  };
  function message(reason) { return MESSAGES[reason] || MESSAGES['no-invite']; }

  const api = { OWNER_EMAIL, DEFAULT_SCHOOL, inviteKey, schoolKey, cleanName, normalizeSchools, newSchoolId, countBySchool, nigriAccess, planDefaultMove, planMoveTeacher, checkNigri, message };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.B3SchoolScope = api;
})(typeof window === 'object' ? window : globalThis);
