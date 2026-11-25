/* Students: which school a student belongs to, and which classes they are in.
 *
 * Owner-managed record (owner/admin write only, like teacher records):
 *   b3Games/workspaces/<ws>/students/<studentId>
 *     schoolId   string   chosen by the owner; students cannot pick it
 *     classIds   { <classId>: true }   owner-panel copy of the student's classes.
 *                Not authoritative: the real many-to-many link is
 *                b3Games/students/<id>/memberships <-> classes/<id>/members,
 *                which every sign-in, rule and teacher tool reads.
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


  /* Move one class (or several that must travel together) to another school WITH their people,
   * so a class never ends up in a school its students and teachers are not in.
   *   classIdOrIds: the class to move, or an array of classes moved together
   *   classes:      classId -> class record (needs schoolId, members, teacherIds)
   *   invites:      inviteId -> teacherInvites record (schoolId, classIds, claimedUid, accountType)
   *   records:      studentId -> owner student record ({schoolId, classIds})
   *   memberships:  studentId -> [classId, ...] the student's real (authoritative) classes
   * Returns { ok, classIds, blockers, students, teachers, updates }.
   * A person who is also in a class that STAYS in another school is a blocker: nobody is
   * split between two schools, and nothing is planned until the owner sorts that out.
   * updates are paths relative to the workspace root, to be written one at a time in order
   * (people first, the classes last, so a failed move can simply be run again). A moved
   * teacher's saved Nigri login is marked for removal (nigriLoginResetAt) when they had a school. */
  function planClassMove(classIdOrIds, classes, invites, records, memberships, toSchoolId, now) {
    const ids = (Array.isArray(classIdOrIds) ? classIdOrIds : [classIdOrIds]).filter(function (c, i, a) { return a.indexOf(c) === i; });
    const empty = { ok: false, classIds: ids, blockers: { teachers: [], students: [] }, students: [], teachers: [], updates: {} };
    if (!ids.length || !validKey(toSchoolId) || !ids.every(function (c) { return validKey(c) && (classes || {})[c]; })) return empty;
    const moving = {}; ids.forEach(function (c) { moving[c] = true; });
    const schoolOf = function (cid) { const c = (classes || {})[cid]; return c && c.schoolId; };
    // A class that is not loaded or has no school cannot be proven to stay elsewhere, so it does not block;
    // a class known to be in a different school does.
    const staysElsewhere = function (cid) { return !moving[cid] && !!schoolOf(cid) && schoolOf(cid) !== toSchoolId; };
    const teacherUids = {};
    ids.forEach(function (c) { Object.keys(classes[c].teacherIds || {}).forEach(function (u) { if (classes[c].teacherIds[u] === true) teacherUids[u] = true; }); });
    const teachers = [], blockT = [];
    Object.keys(invites || {}).sort().forEach(function (iid) {
      const inv = invites[iid];
      if (!inv || typeof inv !== 'object' || inv.accountType === 'principal' || inv.role === 'principal') return;
      const onClass = ids.some(function (c) { return (inv.classIds || {})[c] === true; }) || (inv.claimedUid && teacherUids[inv.claimedUid]);
      if (!onClass) return;
      const others = Object.keys(inv.classIds || {}).filter(function (c) { return inv.classIds[c] === true && staysElsewhere(c); });
      if (others.length) blockT.push({ inviteId: iid, name: String(inv.name || inv.email || iid), classIds: others.sort() });
      else teachers.push(iid);
    });
    const memberOf = {};
    ids.forEach(function (c) {
      Object.keys(classes[c].members || {}).forEach(function (sid) {
        if (validKey(sid) && classes[c].members[sid] && classes[c].members[sid].active !== false) (memberOf[sid] = memberOf[sid] || {})[c] = true;
      });
    });
    const students = [], blockS = [];
    Object.keys(memberOf).sort().forEach(function (sid) {
      const rec = (records || {})[sid] || {};
      const all = {};
      Object.keys(rec.classIds || {}).forEach(function (c) { if (rec.classIds[c] === true) all[c] = true; });
      ((memberships || {})[sid] || []).forEach(function (c) { all[c] = true; });
      const others = Object.keys(all).filter(staysElsewhere);
      if (others.length) blockS.push({ studentId: sid, classIds: others.sort() }); else students.push(sid);
    });
    const out = { ok: !blockT.length && !blockS.length, classIds: ids, blockers: { teachers: blockT, students: blockS }, students: students, teachers: teachers, updates: {} };
    if (!out.ok) return out;
    teachers.forEach(function (iid) {
      const inv = invites[iid], base = 'teacherInvites/' + iid;
      if (inv.schoolId === toSchoolId) return;
      out.updates[base + '/schoolId'] = toSchoolId;
      if (inv.schoolId) out.updates[base + '/nigriLoginResetAt'] = now;
    });
    students.forEach(function (sid) {
      const rec = (records || {})[sid] || {}, base = 'students/' + sid;
      const keep = {};
      Object.keys(rec.classIds || {}).forEach(function (c) { if (rec.classIds[c] === true && !staysElsewhere(c)) keep[c] = true; });
      Object.keys(memberOf[sid]).forEach(function (c) { keep[c] = true; });
      out.updates[base + '/schoolId'] = toSchoolId;
      out.updates[base + '/classIds'] = keep;
      out.updates[base + '/updatedAt'] = now;
    });
    ids.forEach(function (c) { out.updates['classes/' + c + '/schoolId'] = toSchoolId; });
    return out;
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

  // The student's classes, or [legacyClassId] when they have none yet.
  // Read from the authoritative membership list (b3Games/students/<id>/memberships,
  // mirrored by classes/<id>/members), NOT from this record's classIds: teachers
  // add and remove students through funTorahManageStudents, which never touches
  // this owner record, so its classIds can be out of date.
  async function getStudentClassIds(db, workspaceId, studentId, legacyClassId) {
    if (!db || !validKey(studentId)) return legacyClassId ? [legacyClassId] : [];
    try {
      const rows = (await db.ref('b3Games/students/' + studentId + '/memberships').once('value')).val() || {};
      const ids = [];
      Object.keys(rows).forEach(function (k) {
        const m = rows[k];
        if (m && m.active !== false && m.workspaceId === workspaceId && validKey(m.classId) && ids.indexOf(m.classId) < 0) ids.push(String(m.classId));
      });
      if (ids.length) return ids;
      // A student whose classes were all removed on purpose has none; never revive the legacy class.
      if (Object.keys(rows).length) return [];
    } catch (e) {
      console.warn('Could not read student class memberships:', e);
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
    planClassMove: planClassMove,
    countSchoolUse: countSchoolUse,
    loadRecords: loadRecords,
    saveSchool: saveSchool,
    setStudentClass: setStudentClass,
    getStudentClassIds: getStudentClassIds
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.B3StudentScope = api;
})(typeof window === 'object' ? window : globalThis);
