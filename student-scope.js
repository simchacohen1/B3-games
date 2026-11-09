/* Students: which school a student belongs to, and which classes they are in.
 *
 * Owner-managed record (owner/admin write only, like teacher records):
 *   b3Games/workspaces/<ws>/students/<studentId>
 *     schoolId   string   chosen by the owner; students cannot pick it
 *     classIds   { <classId>: true }   classes inside that school
 *     updatedAt  number
 *
 * PRIVACY: b3Games/workspaces is publicly readable, so this record never
 * stores a name or anything else personal. Names come from the class rosters
 * the owner panel already loads.
 *
 * Untouched: b3Games/students/<id>/profile, passcodes, memberships and the
 * sign-in function. Ticking a class enrols the student through the trusted
 * funTorahManageStudents "add"/"remove" actions (the same path teachers use),
 * so class access keeps working exactly as before.
 *
 * Shared by owner-admin.html and site-settings.js.
 */
(function (root) {
  'use strict';

  const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
  function validKey(id) { return ID_RE.test(String(id || '')); }

  function studentPath(workspaceId, studentId) {
    return 'b3Games/workspaces/' + String(workspaceId || '') + '/students/' + String(studentId || '');
  }
  function classIdsPath(workspaceId, studentId) { return studentPath(workspaceId, studentId) + '/classIds'; }

  // ---- pure helpers (unit tested) ------------------------------------------

  // A clean record: only schoolId and classIds survive (older records may carry a name; it is ignored).
  function normalizeRecord(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const classIds = {};
    if (r.classIds && typeof r.classIds === 'object') {
      Object.keys(r.classIds).forEach(function (c) { if (validKey(c) && r.classIds[c] === true) classIds[c] = true; });
    }
    return { schoolId: typeof r.schoolId === 'string' && validKey(r.schoolId) ? r.schoolId : '', classIds: classIds };
  }

  function normalizeRecords(raw) {
    const out = {};
    Object.keys(raw && typeof raw === 'object' ? raw : {}).forEach(function (id) {
      if (validKey(id)) out[id] = normalizeRecord(raw[id]);
    });
    return out;
  }

  // Students as the class rosters see them: { id: { name, classIds: { classId: true } } }.
  // Inactive members and teachers' demo students are left out.
  function rosterStudents(classData) {
    const out = {};
    Object.keys(classData || {}).forEach(function (cid) {
      const cls = classData[cid];
      if (!validKey(cid) || !cls || cls.active === false) return;
      const members = cls.members || {};
      Object.keys(members).forEach(function (sid) {
        const m = members[sid];
        if (!validKey(sid) || !m || m.active === false || m.demo === true || /^demo_/.test(sid)) return;
        const s = out[sid] || (out[sid] = { name: '', classIds: {} });
        if (!s.name && m.name) s.name = String(m.name).trim().slice(0, 120);
        s.classIds[cid] = true;
      });
    });
    Object.keys(out).forEach(function (sid) { if (!out[sid].name) out[sid].name = sid; });
    return out;
  }

  // Classes the owner may give a student in this school. Only classes that
  // belong to that school (a class with no school is never offered).
  function classesForSchool(classData, schoolId) {
    if (!schoolId) return [];
    return Object.keys(classData || {}).filter(function (cid) {
      const c = classData[cid];
      return validKey(cid) && c && c.active !== false && c.schoolId === schoolId;
    }).sort(function (a, b) {
      return String(classData[a].name || a).localeCompare(String(classData[b].name || b));
    });
  }

  // Moving a student to another school: they leave every class that is not in
  // the new school, and keep the ones that are.
  function planSchoolChange(currentClassIds, classData, newSchoolId) {
    const allowed = {};
    classesForSchool(classData, newSchoolId).forEach(function (c) { allowed[c] = true; });
    const keep = {}, remove = [];
    Object.keys(currentClassIds || {}).forEach(function (cid) {
      if (currentClassIds[cid] !== true) return;
      if (allowed[cid]) keep[cid] = true; else remove.push(cid);
    });
    return { keep: keep, remove: remove.sort() };
  }

  // One-time import: give every roster student without a record a record that
  // matches the classes they are already in. The school is filled in only when
  // all of their classes belong to the same school.
  function planImport(roster, records, classData, now) {
    const updates = {}, created = [], noSchool = [];
    Object.keys(roster || {}).sort().forEach(function (sid) {
      if (records && records[sid]) return;
      const classIds = Object.assign({}, roster[sid].classIds);
      const schools = {};
      Object.keys(classIds).forEach(function (cid) {
        const sc = classData && classData[cid] && classData[cid].schoolId;
        schools[sc && validKey(sc) ? sc : ''] = true;
      });
      const list = Object.keys(schools);
      const schoolId = list.length === 1 ? list[0] : '';
      updates[sid] = { schoolId: schoolId || null, classIds: classIds, updatedAt: now };
      created.push(sid);
      if (!schoolId) noSchool.push(sid);
    });
    return { updates: updates, created: created, noSchool: noSchool };
  }

  // Classes with no school yet (owner panel offers to put them in one school).
  function classesWithoutSchool(classData) {
    return Object.keys(classData || {}).filter(function (cid) {
      const c = classData[cid];
      return validKey(cid) && c && !c.schoolId;
    }).sort();
  }

  // People and things still in a school (a school cannot be deleted while any remain).
  function countSchoolUse(schoolId, classData, records) {
    let classes = 0, students = 0;
    Object.keys(classData || {}).forEach(function (cid) { if (classData[cid] && classData[cid].schoolId === schoolId) classes++; });
    Object.keys(records || {}).forEach(function (sid) { if (records[sid] && records[sid].schoolId === schoolId) students++; });
    return { classes: classes, students: students };
  }

  // ---- database helpers (owner panel) ---------------------------------------

  async function loadRecords(db, workspaceId) {
    const snap = await db.ref('b3Games/workspaces/' + String(workspaceId || '') + '/students').once('value');
    return normalizeRecords(snap.val());
  }

  // Write the student's school and the classes they keep. Never writes a name.
  async function saveSchool(db, workspaceId, studentId, schoolId, keepClassIds, now) {
    if (!validKey(studentId)) throw new Error('Invalid student id.');
    if (schoolId && !validKey(schoolId)) throw new Error('Invalid school.');
    const path = studentPath(workspaceId, studentId), updates = {};
    updates[path + '/schoolId'] = schoolId || null;
    updates[path + '/classIds'] = keepClassIds && Object.keys(keepClassIds).length ? keepClassIds : null;
    updates[path + '/updatedAt'] = now;
    await db.ref().update(updates);
  }

  async function setStudentClass(db, workspaceId, studentId, classId, assigned, now) {
    if (!validKey(studentId)) throw new Error('Invalid student id.');
    if (!validKey(classId)) throw new Error('Invalid class id.');
    const updates = {};
    updates[classIdsPath(workspaceId, studentId) + '/' + classId] = assigned ? true : null;
    updates[studentPath(workspaceId, studentId) + '/updatedAt'] = now;
    await db.ref().update(updates);
  }

  // ---- after sign-in (site-settings.js) -------------------------------------

  // The student's assigned classes, or [legacyClassId] when they have no record yet.
  async function getStudentClassIds(db, workspaceId, studentId, legacyClassId) {
    if (!db || !validKey(studentId)) return legacyClassId ? [legacyClassId] : [];
    try {
      const ids = Object.keys(normalizeRecord((await db.ref(studentPath(workspaceId, studentId)).once('value')).val()).classIds);
      if (ids.length) return ids;
    } catch (e) {
      console.warn('Could not read student class assignments:', e);
    }
    return legacyClassId ? [legacyClassId] : [];
  }

  const api = {
    validKey: validKey,
    studentPath: studentPath,
    classIdsPath: classIdsPath,
    normalizeRecord: normalizeRecord,
    normalizeRecords: normalizeRecords,
    rosterStudents: rosterStudents,
    classesForSchool: classesForSchool,
    planSchoolChange: planSchoolChange,
    planImport: planImport,
    classesWithoutSchool: classesWithoutSchool,
    countSchoolUse: countSchoolUse,
    loadRecords: loadRecords,
    saveSchool: saveSchool,
    setStudentClass: setStudentClass,
    getStudentClassIds: getStudentClassIds
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.B3StudentScope = api;
})(typeof window === 'object' ? window : globalThis);
