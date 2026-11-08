(function () {
  "use strict";

  // Phase 1 multi-class foundation:
  // keep the existing live settings path authoritative while mirroring the
  // same settings into this class workspace. This lets the current B3 site
  // keep working unchanged while we build the future multi-teacher structure.
  const APP_CONTEXT = window.B3_APP_CONTEXT || {};
  const WORKSPACE_ID = String(APP_CONTEXT.workspaceId || "b3-2026");
  const WORKSPACE_NAME = String(APP_CONTEXT.workspaceName || "B3 2026-27");
  const LEGACY_SETTINGS_KEY = "b3Games/siteSettings";
  const WORKSPACE_ROOT_KEY = "b3Games/workspaces/" + WORKSPACE_ID;
  const WORKSPACE_SETTINGS_KEY = WORKSPACE_ROOT_KEY + "/siteSettings";
  const TIME_ZONE = "America/New_York";
  const DAY_KEYS = ["sun","mon","tue","wed","thu","fri","sat"];

  // ---- Firebase service refs (lazy) ----------------------------------------
  let _db = null, _auth = null;
  function ensureFirebase() {
    if (!_db) {
      if (!window.firebase || !firebase.apps.length) throw new Error("Firebase not initialised before site-settings.js");
      _db = firebase.database();
      _auth = firebase.auth();
    }
  }
  const services = {
    get db()   { ensureFirebase(); return _db;   },
    get auth() { ensureFirebase(); return _auth; }
  };

  // ---- Default settings ----------------------------------------------------
  const DEFAULT_LOCK_WINDOWS = { sun:[],mon:[],tue:[],wed:[],thu:[],fri:[],sat:[] };
  function blankLockWindows() { return JSON.parse(JSON.stringify(DEFAULT_LOCK_WINDOWS)); }

  function defaultLockWindows(classId) {
    if (classId === "et") {
      return { sun:[],mon:[{s:"14:30",e:"21:00"}],tue:[{s:"14:30",e:"21:00"}],wed:[{s:"14:30",e:"21:00"}],thu:[{s:"14:30",e:"21:00"}],fri:[],sat:[] };
    }
    if (classId === "wt") {
      return { sun:[{s:"10:00",e:"13:00"},{s:"19:30",e:"22:00"}],mon:[{s:"19:30",e:"22:00"}],tue:[{s:"19:30",e:"22:00"}],wed:[{s:"19:30",e:"22:00"}],thu:[{s:"19:30",e:"22:00"}],fri:[],sat:[{s:"10:00",e:"13:00"}] };
    }
    return blankLockWindows();
  }

  const DEFAULT_SETTINGS = {
    siteEnabled: true,
    games: {},
    classGames: {},
    studentGameOverrides: {},
    classLockedGameOverrides: {},
    classModes: {},
    classLockWindows: {}
  };

  function cloneDefaultSettings() { return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); }
  function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function normalizeSettings(raw) {
    if (!raw || typeof raw !== "object") return cloneDefaultSettings();
    const s = cloneDefaultSettings();
    if (typeof raw.siteEnabled === "boolean") s.siteEnabled = raw.siteEnabled;
    if (raw.games && typeof raw.games === "object") s.games = raw.games;
    if (raw.classGames && typeof raw.classGames === "object") s.classGames = raw.classGames;
    if (raw.studentGameOverrides && typeof raw.studentGameOverrides === "object") s.studentGameOverrides = raw.studentGameOverrides;
    if (raw.classLockedGameOverrides && typeof raw.classLockedGameOverrides === "object") s.classLockedGameOverrides = raw.classLockedGameOverrides;
    if (raw.classModes && typeof raw.classModes === "object") s.classModes = raw.classModes;
    if (raw.classLockWindows && typeof raw.classLockWindows === "object") s.classLockWindows = raw.classLockWindows;
    return s;
  }

  // ---- Live settings cache -------------------------------------------------
  let currentSettings = cloneDefaultSettings();
  let listeners = [];
  let subscribed = false;

  function notifyListeners() {
    listeners.forEach(function (fn) { try { fn(deepClone(currentSettings)); } catch (e) { console.error(e); } });
  }

  function readOnce() {
    ensureFirebase();
    return Promise.all([
      services.db.ref(LEGACY_SETTINGS_KEY).once("value"),
      services.db.ref(WORKSPACE_SETTINGS_KEY).once("value")
    ]).then(function (snaps) {
      const legacy = normalizeSettings(snaps[0].val());
      const ws = normalizeSettings(snaps[1].val());
      currentSettings = mergeSettings(legacy, ws);
      return deepClone(currentSettings);
    });
  }

  function mergeSettings(legacy, ws) {
    const merged = deepClone(ws);
    if (typeof legacy.siteEnabled === "boolean" && typeof ws.siteEnabled !== "boolean") {
      merged.siteEnabled = legacy.siteEnabled;
    }
    Object.keys(legacy.games || {}).forEach(function (g) {
      if (!(g in (ws.games || {}))) merged.games[g] = legacy.games[g];
    });
    return merged;
  }

  function subscribe(fn) {
    if (typeof fn === "function") listeners.push(fn);
    if (!subscribed) {
      subscribed = true;
      ensureFirebase();
      services.db.ref(WORKSPACE_SETTINGS_KEY).on("value", function (snap) {
        const ws = normalizeSettings(snap.val());
        currentSettings = mergeSettings(currentSettings, ws);
        notifyListeners();
      });
    }
    return function () { listeners = listeners.filter(function (l) { return l !== fn; }); };
  }

  // ---- Write helpers -------------------------------------------------------
  function save(updates) {
    ensureFirebase();
    const prefixed = {};
    Object.keys(updates).forEach(function (k) { prefixed[WORKSPACE_SETTINGS_KEY + "/" + k] = updates[k]; });
    return services.db.ref().update(prefixed);
  }

  function updateSiteEnabled(enabled) { return save({ siteEnabled: enabled }); }

  function updateGameEnabled(gameId, enabled) {
    return save({ ["games/" + gameId]: enabled });
  }

  function updateClassGameEnabled(classId, gameId, enabled) {
    return save({ ["classGames/" + classId + "/" + gameId]: enabled });
  }

  function updateClassesGameEnabled(classIds, gameId, enabled) {
    const updates = {};
    classIds.forEach(function (cid) { updates["classGames/" + cid + "/" + gameId] = enabled; });
    return save(updates);
  }

  function isGameEnabledForClass(settings, gameId, classId) {
    if (!settings.siteEnabled) return false;
    const classGames = (settings.classGames || {})[classId] || {};
    if (gameId in classGames) return Boolean(classGames[gameId]);
    const globalGames = settings.games || {};
    if (gameId in globalGames) return Boolean(globalGames[gameId]);
    return true;
  }

  function updateStudentGameOverride(classId, studentId, gameId, value) {
    return save({ ["studentGameOverrides/" + classId + "/" + studentId + "/" + gameId]: value });
  }

  function studentHasGameOverride(settings, classId, studentId, gameId) {
    const overrides = ((settings.studentGameOverrides || {})[classId] || {})[studentId] || {};
    return gameId in overrides;
  }

  function updateClassLockedGameOverride(classId, gameId, value) {
    return save({ ["classLockedGameOverrides/" + classId + "/" + gameId]: value });
  }

  function classHasLockedGameOverride(settings, classId, gameId) {
    const overrides = (settings.classLockedGameOverrides || {})[classId] || {};
    return gameId in overrides;
  }

  function activeLockedGameList(settings, classId) {
    const base = (settings.classLockedGameOverrides || {})[classId] || {};
    return Object.keys(base).filter(function (g) { return base[g]; });
  }

  function lockedGameExpiry(settings, classId, gameId) {
    const base = (settings.classLockedGameOverrides || {})[classId] || {};
    const val = base[gameId];
    if (!val || typeof val !== "object") return null;
    return val.expiresAt || null;
  }

  function setClassLockedGame(classId, gameId, value) {
    return save({ ["classLockedGameOverrides/" + classId + "/" + gameId]: value });
  }

  function lockedGameList(settings, classId) {
    const base = (settings.classLockedGameOverrides || {})[classId] || {};
    return Object.keys(base);
  }

  function updateClassMode(classId, mode) {
    return save({ ["classModes/" + classId]: mode });
  }

  function updateClassLockWindows(classId, windows) {
    return save({ ["classLockWindows/" + classId]: windows });
  }

  // ---- Class access schedule -----------------------------------------------
  function isClassOpen(settings, classId, now) {
    const windows = (settings.classLockWindows || {})[classId];
    if (!windows) return true;
    const d = new Date(now || Date.now());
    const tz = TIME_ZONE;
    const local = new Date(d.toLocaleString("en-US", { timeZone: tz }));
    const day = DAY_KEYS[local.getDay()];
    const hhmm = local.getHours() * 60 + local.getMinutes();
    const dayWindows = windows[day] || [];
    if (!dayWindows.length) return true;
    return dayWindows.some(function (w) {
      const s = timeToMin(w.s), e = timeToMin(w.e);
      return hhmm >= s && hhmm < e;
    });
  }

  function timeToMin(hhmm) {
    if (!hhmm) return 0;
    const parts = String(hhmm).split(":");
    return parseInt(parts[0] || "0", 10) * 60 + parseInt(parts[1] || "0", 10);
  }

  function describeClassAccess(settings, classId, now) {
    const windows = (settings.classLockWindows || {})[classId];
    if (!windows) return "always open";
    const d = new Date(now || Date.now());
    const tz = TIME_ZONE;
    const local = new Date(d.toLocaleString("en-US", { timeZone: tz }));
    const day = DAY_KEYS[local.getDay()];
    const dayWindows = windows[day] || [];
    if (!dayWindows.length) return "open today (no lock windows)";
    const open = isClassOpen(settings, classId, now);
    if (open) return "open now";
    const next = dayWindows.find(function (w) { return timeToMin(w.s) > local.getHours() * 60 + local.getMinutes(); });
    if (next) return "opens at " + next.s;
    return "closed for today";
  }

  // ---- Auth ----------------------------------------------------------------
  const rememberedTeacherAuth = (function () {
    try {
      const raw = sessionStorage.getItem("b3TeacherRememberedAuth");
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  })();

  let teacherSignOutVersion = 0;
  let signOutVersion = 0;

  function getRememberedTeacherAuth() {
    if (!rememberedTeacherAuth) return null;
    // app remembers Google credentials. The default app
    // remains tab-scoped so a passcode login cannot replace a teacher elsewhere.
    return rememberedTeacherAuth;
  }

  async function signInWithGoogle() {
    ensureFirebase();
    await services.auth.setPersistence(window.firebase.auth.Auth.Persistence.SESSION);
    return services.auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
  }

  async function signOut() {
    teacherSignOutVersion++;
    clearStudentStorage();
    ensureFirebase();
    await services.auth.signOut();
  }

  // ---- Authorization -------------------------------------------------------
  let currentAccess = { authorized: false, role: null, accountType: null, supervisedTeachers: {}, classIds: [] };
  let authChecking = true;
  let authListeners = [];

  function notifyAuthListeners(access) {
    authListeners.forEach(function (fn) { try { fn(access); } catch (e) { console.error(e); } });
  }

  function isAuthorizedUser() { return currentAccess.authorized; }

  function onAuthStateChanged(fn) {
    if (typeof fn !== "function") return;
    authListeners.push(fn);
    if (!authChecking) fn(Object.assign({}, currentAccess));
  }

  // ---- Student session management ------------------------------------------
  const ACTING_KEY = "b3ActingAsStudent";
  const ACTING_ID = /^[A-Za-z0-9_-]{1,100}$/;
  const STUDENT_STORAGE_KEYS = ["b3Games_studentId", "b3Games_studentName", "b3Games_studentClass", "b3Games_classPin",
    "posukPractice_studentId", "posukPractice_studentName", "weeklyQuiz_classId"];
  const MANAGE_STUDENTS_URL = "https://us-central1-b3-games.cloudfunctions.net/funTorahManageStudents";
  const SITE_BASE = (function () {
    try {
      const own = document.currentScript && document.currentScript.src;
      const tag = own || Array.prototype.map.call(document.getElementsByTagName("script"), function (s) { return s.src; })
        .find(function (src) { return /site-settings\.js(\?|$)/.test(src || ""); });
      return new URL(".", tag || location.href).href;
    } catch (e) { return ""; }
  })();

  const STUDENT_PAGES = {
    index: ["index.html"],
    student: ["student.html", "students/student.html"]
  };
  const NEXT_PATH = /^[a-zA-Z0-9_\-./]+\.html$/;

  function isStudentTab() {
    return Boolean(sessionStorage.getItem("b3Games_studentId") || sessionStorage.getItem("b3ActingAsStudent"));
  }

  // A tab where a student pressed "Switch student" must not quietly turn into
  // the teacher's tab just because the teacher's Google login is remembered
  // on this computer. Only pressing Teacher Sign-in in this tab lifts this.
  const NO_RESTORE_KEY = "b3NoTeacherRestore";
  function teacherRestoreBlocked() {
    try { return sessionStorage.getItem(NO_RESTORE_KEY) === "1"; } catch (_) { return false; }
  }

  function clearStudentStorage() {
    try {
      STUDENT_STORAGE_KEYS.forEach(function (k) { sessionStorage.removeItem(k); });
      sessionStorage.removeItem(ACTING_KEY);
    } catch (_) {}
  }

  function getActingStudent() {
    try {
      const raw = sessionStorage.getItem(ACTING_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !ACTING_ID.test(data.id || "")) return null;
      return data;
    } catch (_) { return null; }
  }

  async function endStudentSession() {
    try { sessionStorage.setItem(NO_RESTORE_KEY, "1"); } catch (_) {}
    try { STUDENT_STORAGE_KEYS.forEach(function (k) { sessionStorage.removeItem(k); }); } catch (_) {}
    try { sessionStorage.removeItem(ACTING_KEY); } catch (_) {}
    ensureFirebase();
    try { await services.auth.signOut(); } catch (_) {}
  }

  async function listStudentsForActing(classId) {
    if (!classId) return [];
    ensureFirebase();
    const snap = await services.db.ref(WORKSPACE_ROOT_KEY + "/classes/" + classId + "/members").once("value");
    const members = snap.val() || {};
    return Object.entries(members)
      .filter(function (e) { return e[1] && e[1].active !== false; })
      .map(function (e) { return { id: e[0], name: String(e[1].name || e[0]) }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  async function startActingAsStudent(studentId, classId, studentTab, nextPath) {
    ensureFirebase();
    const user = services.auth.currentUser;
    if (!user) throw new Error("No teacher signed in.");
    const snap = await services.db.ref(WORKSPACE_ROOT_KEY + "/teacherInvites/" + user.email.toLowerCase().replace(/\./g, ",")).once("value");
    const teacher = snap.val();
    if (!teacher || !teacher.active) throw new Error("Your account is not assigned to any class.");
    const classIds = Object.keys(teacher.classIds || {}).filter(function (id) { return teacher.classIds[id]; });
    if (!classIds.includes(classId)) throw new Error("That class is not assigned to your teacher account.");
    const cls = (await services.db.ref(WORKSPACE_ROOT_KEY + "/classes/" + classId).once("value")).val();
    const member = cls && cls.members && cls.members[studentId];
    if (!cls || cls.active === false || !member || member.active === false) throw new Error("That student is not active in this class.");
    const response = await fetch(MANAGE_STUDENTS_URL, {
      method:"POST", signal:AbortSignal.timeout(15000),
      headers:{ "Content-Type":"application/json", "Authorization":"Bearer " + await user.getIdToken() },
      body:JSON.stringify({ action:"list", classId:classId })
    });
    const result = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(result.error || "Could not open this student's account.");
    const pin = String((result.passcodes || {})[studentId] || "").trim();
    if (!pin) throw new Error("This student doesn't have a passcode yet. Set one in Manage Class first.");
    const name = String(member.name || studentId);
    // The student opens in a different tab, with its own Firebase session.
    // Migrate the teacher's existing LOCAL login to SESSION before the child
    // signs in; otherwise Firebase would broadcast the student's identity
    // to every teacher tab using the same browser-wide auth persistence.
    if (studentTab) {
      if (studentTab.closed) throw new Error("The student tab was closed. Please try again.");
      await services.auth.setPersistence(window.firebase.auth.Auth.Persistence.SESSION);
    }
    const studentSession = studentTab ? studentTab.sessionStorage : sessionStorage;
    if (studentTab) studentSession.clear();
    else clearStudentStorage();
    studentSession.setItem("b3Games_studentId", studentId);
    studentSession.setItem("b3Games_studentName", name);
    studentSession.setItem("b3Games_studentClass", classId);
    studentSession.setItem("b3Games_classPin", pin);
    studentSession.setItem("posukPractice_studentId", studentId);
    studentSession.setItem("posukPractice_studentName", name);
    studentSession.setItem("weeklyQuiz_classId", classId);
    studentSession.setItem("b3Games_workspaceId", WORKSPACE_ID);
    studentSession.removeItem("b3TeacherBypass");
    if (nextPath && NEXT_PATH.test(nextPath)) studentSession.setItem("b3ActAsNext", nextPath);
    studentSession.setItem(ACTING_KEY, JSON.stringify({ id:studentId, name:name, classId:classId, className:String(cls.name || classId.toUpperCase()), startedAt:Date.now() }));
    if (studentTab) {
      studentSession.setItem("b3ActAsSeparateTab", "1");
      // Do not leave a cross-tab opener path back into the teacher dashboard.
      studentTab.opener = null;
      studentTab.location.replace(SITE_BASE + "index.html?v=20261019-student-tab");
    } else {
      location.href = SITE_BASE + "index.html?v=20261019-student-tab";
    }
  }

  async function stopActingAsStudent() {
    clearStudentStorage();
    ensureFirebase();
    try { await services.auth.signOut(); } catch (_) {}
    const acting = getActingStudent();
    if (acting && acting.separateTab) {
      window.close();
      setTimeout(function () { if (!window.closed) location.href = SITE_BASE + "index.html"; }, 150);
    } else {
      location.href = SITE_BASE + "teacher-home.html";
    }
  }

  function actingEsc(s) { const d = document.createElement("div"); d.textContent = String(s || ""); return d.innerHTML; }

  function openActAsStudentPicker(classId) {
    if (!classId) return;
    // Open or find the student picker dialog.
    let picker = document.getElementById("b3ActAsStudentPicker");
    if (!picker) {
      picker = document.createElement("dialog");
      picker.id = "b3ActAsStudentPicker";
      picker.innerHTML = '<form method="dialog"><h3 style="margin:0 0 12px">Open as student</h3><div id="b3ActAsStudentList" style="max-height:300px;overflow:auto"></div><div style="margin-top:12px;text-align:right"><button value="cancel">Cancel</button></div></form>';
      document.body.appendChild(picker);
    }
    const list = document.getElementById("b3ActAsStudentList");
    list.innerHTML = "Loading…";
    picker.showModal && picker.showModal();
    listStudentsForActing(classId).then(function (students) {
      if (!students.length) { list.innerHTML = "<p>No students in this class.</p>"; return; }
      list.innerHTML = students.map(function (s) {
        return '<button type="button" data-student-id="' + actingEsc(s.id) + '" style="display:block;width:100%;text-align:left;padding:8px;margin:2px 0;border:1px solid #ddd;border-radius:6px;cursor:pointer">' + actingEsc(s.name) + "</button>";
      }).join("");
      list.querySelectorAll("button[data-student-id]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          picker.close && picker.close();
          startActingAsStudent(btn.dataset.studentId, classId, null, null).catch(function (e) {
            alert("Could not open student: " + e.message);
          });
        });
      });
    }).catch(function (e) { list.innerHTML = "<p>Error: " + actingEsc(e.message) + "</p>"; });
  }

  // ---- Demo student (teacher's own demo account) ---------------------------
  async function openMyDemoStudent(classId, nextPath) {
    ensureFirebase();
    const user = services.auth.currentUser;
    if (!user) throw new Error("No teacher signed in.");
    const teacherKey = user.email.toLowerCase().replace(/\./g, ",");
    const demoId = "demo-" + teacherKey.replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    const demoName = "Demo " + String(user.displayName || user.email).split(" ")[0];
    const memberPath = WORKSPACE_ROOT_KEY + "/classes/" + classId + "/members/" + demoId;
    const profilePath = "b3Games/students/" + demoId + "/profile";
    const updates = {};
    updates[memberPath] = { name: demoName, active: true, demo: true };
    updates[profilePath] = { name: demoName, active: true, classId: classId, demo: true, updatedAt: firebase.database.ServerValue.TIMESTAMP };
    await services.db.ref().update(updates);
    return startActingAsStudent(demoId, classId, null, nextPath);
  }

  // ---- Back-to-home link injector (for student tabs) ----------------------
  function showBackToHome() {
    if (!isStudentTab()) return;
    const acting = getActingStudent();
    const links = acting && acting.id ? [
      { href: SITE_BASE + "index.html", text: "Home" },
      { href: SITE_BASE + "student.html", text: "My Progress" }
    ] : [];
    if (!links.length) return;
    const bar = document.createElement("nav");
    bar.style.cssText = "position:fixed;top:0;left:0;right:0;background:#1d1d1f;z-index:9999;display:flex;gap:12px;padding:8px 16px;align-items:center;";
    links.forEach(function (l) {
      const link = document.createElement("a");
      link.href = l.href;
      link.textContent = l.text;
      link.style.cssText = "color:#f5f5f7;font-size:.85rem;text-decoration:none;";
      if (acting && acting.separateTab) {
        link.title = 'Preview the student version with your teacher login; student progress is not saved';
      }
      bar.appendChild(link);
    });
    document.body.prepend(bar);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showBackToHome, { once: true });
  else showBackToHome();

  // ---- Student class lookup (for student login pages) ---------------------
  // After a successful name+passcode login, call this to get the student's
  // assigned class IDs. Returns array of classId strings. Falls back to
  // legacyClassId if the student has no workspace record yet.
  async function getStudentAssignedClassIds(db, studentId, legacyClassId) {
    if (window.B3StudentScope && db && studentId) {
      return B3StudentScope.getStudentClassIds(db, WORKSPACE_ID, studentId, legacyClassId);
    }
    return legacyClassId ? [legacyClassId] : [];
  }

  window.B3SiteSettings = {
    defaultSettings: cloneDefaultSettings(),
    normalizeSettings: normalizeSettings,
    readOnce: readOnce,
    subscribe: subscribe,
    save: save,
    updateSiteEnabled: updateSiteEnabled,
    updateGameEnabled: updateGameEnabled,
    updateClassGameEnabled: updateClassGameEnabled,
    updateClassesGameEnabled: updateClassesGameEnabled,
    isGameEnabledForClass: isGameEnabledForClass,
    updateStudentGameOverride: updateStudentGameOverride,
    studentHasGameOverride: studentHasGameOverride,
    updateClassLockedGameOverride: updateClassLockedGameOverride,
    classHasLockedGameOverride: classHasLockedGameOverride,
    activeLockedGameList: activeLockedGameList,
    lockedGameExpiry: lockedGameExpiry,
    setClassLockedGame: setClassLockedGame,
    lockedGameList: lockedGameList,
    updateClassMode: updateClassMode,
    updateClassLockWindows: updateClassLockWindows,
    getDefaultClassLockWindows: function (classId) {
      if (!["et", "wt"].includes(classId)) return blankLockWindows();
      return deepClone(defaultLockWindows(classId));
    },
    isClassOpen: isClassOpen,
    describeClassAccess: describeClassAccess,
    signInWithGoogle: signInWithGoogle,
    signOut: signOut,
    onAuthStateChanged: onAuthStateChanged,
    isAuthorizedUser: isAuthorizedUser,
    getCurrentAccess: function(){ return {authorized:currentAccess.authorized,role:currentAccess.role,accountType:currentAccess.accountType||"teacher",supervisedTeachers:currentAccess.supervisedTeachers||{},classIds:currentAccess.classIds.slice()}; },
    workspaceId: WORKSPACE_ID,
    timeZone: TIME_ZONE,
    dayKeys: DAY_KEYS.slice(),
    getMode: function () { ensureFirebase(); return activeMode; },
    getActingStudent: getActingStudent,
    endStudentSession: endStudentSession,
    listStudentsForActing: listStudentsForActing,
    startActingAsStudent: startActingAsStudent,
    stopActingAsStudent: stopActingAsStudent,
    openActAsStudentPicker: openActAsStudentPicker,
    openMyDemoStudent: openMyDemoStudent,
    getStudentAssignedClassIds: getStudentAssignedClassIds
  };
  // Pages that never ask about sign-in still need their sign-in screens shown.
  if (authChecking) {
    ensureFirebase();
    let activeMode = null;
    services.auth.onAuthStateChanged(async function (user) {
      signOutVersion++;
      if (!user) {
        currentAccess = { authorized: false, role: null, accountType: null, supervisedTeachers: {}, classIds: [] };
        authChecking = false;
        notifyAuthListeners(Object.assign({}, currentAccess));
        return;
      }
      if (isStudentTab() || teacherRestoreBlocked() || isGoogleUser(services.auth.currentUser)) return false;
      // Restore Firebase identity before reading protected teacher records.
      // onAuthStateChanged still checks current authorization before granting UI access.
      if (isStudentTab() || isGoogleUser(services.auth.currentUser) || signOutVersion !== teacherSignOutVersion) return false;
      await services.auth.setPersistence(window.firebase.auth.Auth.Persistence.SESSION);
      if (isStudentTab() || teacherRestoreBlocked() || isGoogleUser(services.auth.currentUser) || signOutVersion !== teacherSignOutVersion) return false;

      try {
        const email = user.email ? user.email.toLowerCase() : null;
        if (!email) {
          currentAccess = { authorized: false, role: null, accountType: null, supervisedTeachers: {}, classIds: [] };
          authChecking = false;
          notifyAuthListeners(Object.assign({}, currentAccess));
          return;
        }
        const teacherKey = email.replace(/\./g, ",");
        const snap = await services.db.ref(WORKSPACE_ROOT_KEY + "/teacherInvites/" + teacherKey).once("value");
        const teacher = snap.val();
        if (!teacher || !teacher.active) {
          currentAccess = { authorized: false, role: null, accountType: null, supervisedTeachers: {}, classIds: [] };
          authChecking = false;
          notifyAuthListeners(Object.assign({}, currentAccess));
          return;
        }
        const classIds = Object.keys(teacher.classIds || {}).filter(function (id) { return teacher.classIds[id]; });
        const accountType = teacher.accountType || "teacher";
        const supervisedTeachers = teacher.supervisedTeachers || {};
        currentAccess = { authorized: true, role: teacher.role || "teacher", accountType: accountType, supervisedTeachers: supervisedTeachers, classIds: classIds };
        authChecking = false;
        notifyAuthListeners(Object.assign({}, currentAccess));
      } catch (e) {
        console.error("Auth check failed:", e);
        currentAccess = { authorized: false, role: null, accountType: null, supervisedTeachers: {}, classIds: [] };
        authChecking = false;
        notifyAuthListeners(Object.assign({}, currentAccess));
      }
    });
  }

  function isGoogleUser(user) {
    if (!user) return false;
    return (user.providerData || []).some(function (p) { return p && p.providerId === "google.com"; });
  }
})();
