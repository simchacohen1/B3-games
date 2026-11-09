/* Students: which school a student belongs to, and which classes they are assigned to.
 *
 * Data layout (owner-written only):
 *   b3Games/workspaces/<ws>/students/<studentId>              { name, schoolId, active, createdAt }
 *   b3Games/workspaces/<ws>/students/<studentId>/classIds/<classId>  true
 *
 * The student's core profile and passcode remain at:
 *   b3Games/students/<studentId>/profile   (unchanged)
 *   b3Private/passcodes/<studentId>        (unchanged, server only)
 *
 * The workspace record is the owner-managed layer: school assignment and class
 * assignment live here. The existing login (name + passcode) is never touched.
 *
 * Shared by owner-admin.html and site-settings.js (class picker after login).
 */
(function (root) {
  'use strict';

  const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

  function validKey(id) {
    return ID_RE.test(String(id || ''));
  }

  // ---- path helpers -------------------------------------------------------

  function studentPath(workspaceId, studentId) {
    return 'b3Games/workspaces/' + String(workspaceId || '') + '/students/' + String(studentId || '');
  }

  function classIdsPath(workspaceId, studentId) {
    return studentPath(workspaceId, studentId) + '/classIds';
  }

  // ---- normalisation -------------------------------------------------------

  // Returns a clean student workspace record. Unknown fields are dropped.
  function normalizeStudent(raw, studentId) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      name: String(raw.name || studentId || '').trim().slice(0, 120),
      schoolId: typeof raw.schoolId === 'string' ? raw.schoolId : '',
      active: raw.active !== false,
      createdAt: raw.createdAt || null
    };
  }

  // Returns the list of classIds assigned to this student (true values only).
  function classIdsFromRecord(record) {
    if (!record || typeof record.classIds !== 'object' || !record.classIds) return [];
    return Object.keys(record.classIds).filter(function (k) {
      return validKey(k) && record.classIds[k] === true;
    });
  }

  // ---- browser helpers (owner-admin) --------------------------------------

  // Load all workspace student records.
  // Returns { <studentId>: { name, schoolId, active, classIds: { <classId>: true } } }
  async function loadWorkspaceStudents(db, workspaceId) {
    const snap = await db.ref('b3Games/workspaces/' + String(workspaceId || '') + '/students').once('value');
    const raw = snap.val() || {};
    const out = {};
    Object.keys(raw).forEach(function (id) {
      if (!validKey(id) || !raw[id] || typeof raw[id] !== 'object') return;
      out[id] = Object.assign({}, normalizeStudent(raw[id], id), {
        classIds: raw[id].classIds && typeof raw[id].classIds === 'object' ? raw[id].classIds : {}
      });
    });
    return out;
  }

  // Assign (or un-assign) a student to a school.
  // Setting schoolId to '' removes the school; existing classIds are cleared too
  // since they may no longer belong to the new school.
  async function setStudentSchool(db, workspaceId, studentId, schoolId, now) {
    if (!validKey(studentId)) throw new Error('Invalid student id.');
    const path = studentPath(workspaceId, studentId);
    const updates = {};
    updates[path + '/schoolId'] = schoolId || null;
    // Clear class assignments when moving schools — they belonged to the old school.
    if (schoolId) {
      updates[path + '/active'] = true;
    }
    updates[path + '/updatedAt'] = now || Date.now();
    // Also wipe classIds so the owner re-assigns to the new school's classes.
    updates[path + '/classIds'] = null;
    await db.ref().update(updates);
  }

  // Assign or unassign a student to/from a class.
  async function setStudentClass(db, workspaceId, studentId, classId, assigned, now) {
    if (!validKey(studentId)) throw new Error('Invalid student id.');
    if (!validKey(classId)) throw new Error('Invalid class id.');
    const updates = {};
    updates[classIdsPath(workspaceId, studentId) + '/' + classId] = assigned ? true : null;
    updates[studentPath(workspaceId, studentId) + '/updatedAt'] = now || Date.now();
    await db.ref().update(updates);
  }

  // Create or update the workspace-level record for a student.
  // Does NOT touch b3Games/students/<id>/profile or passcodes.
  async function upsertWorkspaceStudent(db, workspaceId, studentId, name, schoolId, now) {
    if (!validKey(studentId)) throw new Error('Invalid student id.');
    const path = studentPath(workspaceId, studentId);
    const existing = (await db.ref(path).once('value')).val();
    const updates = {};
    updates[path + '/name'] = String(name || studentId).trim().slice(0, 120);
    updates[path + '/schoolId'] = schoolId || '';
    updates[path + '/active'] = true;
    updates[path + '/updatedAt'] = now || Date.now();
    if (!existing) updates[path + '/createdAt'] = now || Date.now();
    await db.ref().update(updates);
  }

  // ---- student login helper (site-settings.js) ----------------------------

  // After a successful name+passcode login, look up the student's assigned
  // classes from the workspace record. Returns an array of classId strings.
  // Falls back to the legacy single classId if no workspace record exists.
  async function getStudentClassIds(db, workspaceId, studentId, legacyClassId) {
    if (!db || !validKey(studentId)) return legacyClassId ? [legacyClassId] : [];
    try {
      const snap = await db.ref(classIdsPath(workspaceId, studentId)).once('value');
      const raw = snap.val();
      if (raw && typeof raw === 'object') {
        const ids = Object.keys(raw).filter(function (k) { return validKey(k) && raw[k] === true; });
        if (ids.length) return ids;
      }
    } catch (e) {
      // If the read fails, fall back gracefully to the legacy class.
      console.warn('Could not read student class assignments:', e);
    }
    return legacyClassId ? [legacyClassId] : [];
  }

  const api = {
    validKey: validKey,
    studentPath: studentPath,
    classIdsPath: classIdsPath,
    normalizeStudent: normalizeStudent,
    classIdsFromRecord: classIdsFromRecord,
    loadWorkspaceStudents: loadWorkspaceStudents,
    setStudentSchool: setStudentSchool,
    setStudentClass: setStudentClass,
    upsertWorkspaceStudent: upsertWorkspaceStudent,
    getStudentClassIds: getStudentClassIds
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.B3StudentScope = api;
})(typeof window === 'object' ? window : globalThis);
