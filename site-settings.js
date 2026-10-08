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
  const SETTINGS_KEY = LEGACY_SETTINGS_KEY;
  const LOCAL_FALLBACK_KEY = "b3SiteSettingsFallback";
  // Bootstrap owner only. After sign-in, authorization is read from Firebase.
  // Keeping this one bootstrap identity prevents a rules migration from locking
  // the existing owner out before the admin record exists.
  const BOOTSTRAP_ADMIN_EMAIL = "simcha5770@gmail.com";
  const TIME_ZONE = "America/New_York";

  // ---------------------------------------------------------------------
  // No sign-in flash for teachers. Firebase takes a second or two to restore
  // a saved Google sign-in, and pages showed their sign-in screen during that
  // wait. If this browser had a teacher signed in last time, keep sign-in
  // screens hidden until the normal check finishes. This only affects what
  // is shown while waiting; access is still decided by the full check.
  // ---------------------------------------------------------------------
  const SIGNED_IN_HINT_KEY = "b3TeacherWasSignedIn";
  let authChecking = false;
  function setSignedInHint(on) {
    try { if (on) localStorage.setItem(SIGNED_IN_HINT_KEY, "1"); else localStorage.removeItem(SIGNED_IN_HINT_KEY); } catch (e) {}
  }
  function endAuthChecking() {
    if (!authChecking) return;
    authChecking = false;
    document.documentElement.classList.remove("b3-auth-checking");
  }
  try { authChecking = localStorage.getItem(SIGNED_IN_HINT_KEY) === "1"; } catch (e) {}
  if (authChecking) {
    document.documentElement.classList.add("b3-auth-checking");
    const style = document.createElement("style");
    style.textContent = "html.b3-auth-checking :is(#loginCard,#loginView,#signIn,#signInBtn,#signInButton,#lockGoogle,#googleBtn,#teacherLogin){visibility:hidden !important}";
    (document.head || document.documentElement).appendChild(style);
    setTimeout(endAuthChecking, 8000); // never hide sign-in for long
  }

  function workspacePath(relativePath) {
    const clean = String(relativePath || "").replace(/^\/+/, "");
    return clean ? WORKSPACE_ROOT_KEY + "/" + clean : WORKSPACE_ROOT_KEY;
  }

  const GAME_DEFAULTS = {
    "tzitzis-game": true,
    "tzitzis-quest-arcade": true,
    "kahoot-word-quiz": true,
    "kodesh-construct": true,
    "chumash-quiz": true,
    "posuk-practice-scroll": true,
    "rashi-letters": true,
    "shorashim": true,
    "class-gallery": true,
    "game-show": true,
    "weekly-quiz": true,
    "work-timer": true,
    "elul-yom-kippur-slides": true,
    "dvarim-game": true
  };

  const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

  function blankLockWindows() {
    const result = {};
    DAY_KEYS.forEach(function (day) { result[day] = []; });
    return result;
  }

  // Automatic access follows the B3 master schedule.
  // The site is OPEN by default; these are the periods when it is LOCKED.
  // ET gets the first 2 minutes of each 10-minute recess for non-game break time.
  // WT can open immediately when each 10-minute recess starts.
  function defaultLockWindows(classId) {
    const result = blankLockWindows();

    if (classId === "et") {
      ["mon", "tue", "wed", "thu"].forEach(function (day) {
        result[day] = [
          { start: "08:45", end: "10:17" },
          { start: "10:25", end: "11:07" },
          { start: "11:15", end: "12:00" },
          { start: "12:45", end: "13:30" },
          { start: "13:40", end: "14:25" },
          { start: "14:35", end: "15:15" }
        ];
      });
      result.fri = [
        { start: "08:45", end: "10:17" },
        { start: "10:25", end: "11:07" },
        { start: "11:15", end: "12:00" }
      ];
    } else {
      ["mon", "tue", "wed", "thu"].forEach(function (day) {
        result[day] = [
          { start: "12:20", end: "13:52" },
          { start: "14:00", end: "14:47" },
          { start: "14:55", end: "15:35" },
          { start: "16:15", end: "17:00" },
          { start: "17:10", end: "17:55" },
          { start: "18:05", end: "18:45" }
        ];
      });
      result.fri = [
        { start: "11:00", end: "12:30" },
        { start: "12:40", end: "13:25" },
        { start: "13:35", end: "14:15" }
      ];
    }
    return result;
  }

  // This is the previous automatic schedule. Detect it so an existing Firebase
  // record that was never customized automatically upgrades to the new recess
  // schedule instead of continuing to lock the entire class block.
  function previousDefaultLockWindows(classId) {
    const result = blankLockWindows();
    ["mon", "tue", "wed", "thu"].forEach(function (day) {
      result[day] = classId === "et"
        ? [{ start: "08:45", end: "12:00" }, { start: "12:45", end: "15:15" }]
        : [{ start: "12:20", end: "15:35" }, { start: "16:15", end: "18:45" }];
    });
    return result;
  }

  // Master schedule used immediately before the September 24 update.
  // If an existing Firebase day still exactly matches one of these old defaults,
  // upgrade that day to the new master schedule. Custom-edited days are preserved.
  function immediatelyPreviousDefaultLockWindows(classId) {
    const result = blankLockWindows();

    if (classId === "et") {
      ["mon", "tue", "wed", "thu"].forEach(function (day) {
        result[day] = [
          { start: "08:45", end: "10:17" },
          { start: "10:25", end: "11:07" },
          { start: "11:15", end: "12:00" },
          { start: "12:45", end: "13:32" },
          { start: "13:40", end: "14:27" },
          { start: "14:35", end: "15:15" }
        ];
      });
    } else {
      ["mon", "tue", "wed", "thu"].forEach(function (day) {
        result[day] = [
          { start: "12:20", end: "13:50" },
          { start: "14:00", end: "14:45" },
          { start: "14:55", end: "15:35" },
          { start: "16:15", end: "17:00" },
          { start: "17:10", end: "17:55" },
          { start: "18:05", end: "18:45" }
        ];
      });
    }

    return result;
  }

  function dayLockWindowsEqual(a, b) {
    const aa = Array.isArray(a) ? a : [];
    const bb = Array.isArray(b) ? b : [];
    if (aa.length !== bb.length) return false;
    return aa.every(function (r, i) {
      return r && bb[i] && r.start === bb[i].start && r.end === bb[i].end;
    });
  }

  function lockWindowsEqual(a, b) {
    return DAY_KEYS.every(function (day) {
      const aa = Array.isArray(a && a[day]) ? a[day] : [];
      const bb = Array.isArray(b && b[day]) ? b[day] : [];
      if (aa.length !== bb.length) return false;
      return aa.every(function (r, i) {
        return r && bb[i] && r.start === bb[i].start && r.end === bb[i].end;
      });
    });
  }

  const defaultSettings = {
    siteEnabled: true,
    games: GAME_DEFAULTS,
    // Per-class activity switches. Existing global game switches remain the master
    // switch, while these let ET and WT be controlled independently.
    classGames: {
      et: Object.assign({}, GAME_DEFAULTS),
      wt: Object.assign({}, GAME_DEFAULTS)
    },
    // Per-student exceptions. A true value lets that student use only that
    // activity while the master/class lock is active. Individual activity
    // switches still win, so a game explicitly turned off stays off.
    studentGameOverrides: {},
    // One class-wide exception per ET/WT class. When the site/class is locked,
    // this one activity may stay open for every student in that class.
    classLockedGameOverride: { et: "", wt: "" },
    classAccess: {
      et: { mode: "auto", lockWindows: defaultLockWindows("et") },
      wt: { mode: "auto", lockWindows: defaultLockWindows("wt") }
    }
  };

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function cloneDefaultSettings() {
    return deepClone(defaultSettings);
  }

  function validTime(value) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
  }

  function normalizeRange(value) {
    if (!value || typeof value !== "object") return null;
    if (!validTime(value.start) || !validTime(value.end)) return null;
    return { start: value.start, end: value.end };
  }

  function normalizeDayLockWindows(value, fallback) {
    if (!Array.isArray(value)) return deepClone(fallback || []);
    return value.map(normalizeRange).filter(Boolean).slice(0, 6);
  }

  function legacyScheduleIsOldAllDay(schedule) {
    if (!schedule || typeof schedule !== "object") return false;
    return DAY_KEYS.every(function (day) {
      const r = schedule[day];
      return r && r.enabled !== false && r.start === "00:00" && r.end === "23:59";
    });
  }

  // Compatibility with the first ET/WT build. That version stored the times
  // when a class was OPEN. This converts a customized old open window into the
  // equivalent locked periods. The untouched old all-day default is migrated
  // to Rabbi Cohen's new default lock periods instead.
  function legacyOpenScheduleToLockWindows(schedule, fallback) {
    if (!schedule || typeof schedule !== "object") return deepClone(fallback);
    if (legacyScheduleIsOldAllDay(schedule)) return deepClone(fallback);

    const result = blankLockWindows();
    DAY_KEYS.forEach(function (day) {
      const r = schedule[day];
      if (!r || r.enabled === false) {
        result[day] = [{ start: "00:00", end: "00:00" }]; // locked all day
        return;
      }
      const start = validTime(r.start) ? r.start : "00:00";
      const end = validTime(r.end) ? r.end : "23:59";
      if (start === end || (start === "00:00" && end === "23:59")) {
        result[day] = [];
        return;
      }
      if (start < end) {
        const ranges = [];
        if (start !== "00:00") ranges.push({ start: "00:00", end: start });
        if (end !== "23:59") ranges.push({ start: end, end: "00:00" });
        result[day] = ranges;
      } else {
        // Old open period crossed midnight, so the locked gap is end -> start.
        result[day] = [{ start: end, end: start }];
      }
    });
    return result;
  }

  function normalizeClassAccess(value, fallback, classId) {
    const source = value && typeof value === "object" ? value : {};
    const mode = ["auto", "open", "locked"].includes(source.mode) ? source.mode : fallback.mode;
    let lockWindows;

    if (source.lockWindows && typeof source.lockWindows === "object") {
      lockWindows = {};
      DAY_KEYS.forEach(function (day) {
        lockWindows[day] = normalizeDayLockWindows(source.lockWindows[day], fallback.lockWindows[day]);
      });
      if (classId && lockWindowsEqual(lockWindows, previousDefaultLockWindows(classId))) {
        lockWindows = deepClone(fallback.lockWindows);
      } else if (classId) {
        // Upgrade each Mon-Thu day independently if it is still using either
        // of the two older master schedules. This preserves any day Rabbi Cohen
        // already edited manually (such as the new Monday schedule).
        const veryOldMaster = previousDefaultLockWindows(classId);
        const oldMaster = immediatelyPreviousDefaultLockWindows(classId);
        ["mon", "tue", "wed", "thu"].forEach(function (day) {
          if (
            dayLockWindowsEqual(lockWindows[day], veryOldMaster[day]) ||
            dayLockWindowsEqual(lockWindows[day], oldMaster[day])
          ) {
            lockWindows[day] = deepClone(fallback.lockWindows[day]);
          }
        });
      }
    } else if (source.schedule && typeof source.schedule === "object") {
      lockWindows = legacyOpenScheduleToLockWindows(source.schedule, fallback.lockWindows);
    } else {
      lockWindows = deepClone(fallback.lockWindows);
    }

    return { mode: mode, lockWindows: lockWindows };
  }

  function normalizeStudentGameOverrides(value) {
    const result = {};
    if (!value || typeof value !== "object") return result;

    Object.keys(value).forEach(function (studentId) {
      const raw = value[studentId];
      if (!raw || typeof raw !== "object") return;
      const clean = {};
      Object.keys(raw).forEach(function (gameId) {
        if (raw[gameId] === true) clean[gameId] = true;
      });
      if (Object.keys(clean).length) result[studentId] = clean;
    });
    return result;
  }

  function normalizeSettings(settings) {
    const source = settings && typeof settings === "object" ? deepClone(settings) : {};
    const normalized = deepClone(source);
    const sourceGames = source.games && typeof source.games === "object" ? source.games : {};
    const sourceClassGames = source.classGames && typeof source.classGames === "object" ? source.classGames : {};
    const sourceClassAccess = source.classAccess && typeof source.classAccess === "object" ? source.classAccess : {};
    const sourceClassLockedGameOverride = source.classLockedGameOverride && typeof source.classLockedGameOverride === "object"
      ? source.classLockedGameOverride
      : {};

    normalized.siteEnabled = typeof source.siteEnabled === "boolean" ? source.siteEnabled : true;

    normalized.games = Object.assign({}, GAME_DEFAULTS);
    Object.keys(sourceGames).forEach(function (gameId) {
      if (typeof sourceGames[gameId] === "boolean") normalized.games[gameId] = sourceGames[gameId];
    });

    normalized.classGames = { et: Object.assign({}, GAME_DEFAULTS), wt: Object.assign({}, GAME_DEFAULTS) };
    ["et","wt"].forEach(function(classId){
      const raw = sourceClassGames[classId] && typeof sourceClassGames[classId] === "object" ? sourceClassGames[classId] : {};
      Object.keys(raw).forEach(function(gameId){
        if (typeof raw[gameId] === "boolean") normalized.classGames[classId][gameId] = raw[gameId];
      });
    });

    normalized.studentGameOverrides = normalizeStudentGameOverrides(source.studentGameOverrides);
    normalized.classLockedGameOverride = {
      et: typeof sourceClassLockedGameOverride.et === "string" ? sourceClassLockedGameOverride.et.trim() : "",
      wt: typeof sourceClassLockedGameOverride.wt === "string" ? sourceClassLockedGameOverride.wt.trim() : ""
    };
    const sourceUntil = source.classLockedGameOverrideUntil && typeof source.classLockedGameOverrideUntil === "object"
      ? source.classLockedGameOverrideUntil
      : {};
    normalized.classLockedGameOverrideUntil = {};
    ["et", "wt"].forEach(function (classId) {
      const raw = sourceUntil[classId] && typeof sourceUntil[classId] === "object" ? sourceUntil[classId] : {};
      const clean = {};
      lockedGameList(normalized.classLockedGameOverride[classId]).forEach(function (id) {
        const ms = Number(raw[id]);
        if (ms > 0) clean[id] = ms;
      });
      normalized.classLockedGameOverrideUntil[classId] = clean;
    });

    const fallbackAccess = cloneDefaultSettings().classAccess;
    normalized.classAccess = {
      et: normalizeClassAccess(sourceClassAccess.et, fallbackAccess.et, "et"),
      wt: normalizeClassAccess(sourceClassAccess.wt, fallbackAccess.wt, "wt")
    };

    return normalized;
  }

  function getConfiguredFirebaseOptions() {
    const config = window.B3_FIREBASE_CONFIG || {};
    const requiredKeys = ["apiKey", "authDomain", "databaseURL", "projectId", "storageBucket", "messagingSenderId", "appId"];
    const isConfigured = requiredKeys.every(function (key) {
      const value = config[key];
      return typeof value === "string" && value.trim() !== "" && value !== "REPLACE_ME";
    });
    return isConfigured ? config : null;
  }

  let firebaseDb = null;
  let firebaseAuth = null;
  let activeMode = "local-preview";

  function ensureFirebase() {
    const config = getConfiguredFirebaseOptions();
    if (!config || !window.firebase || !window.firebase.database) return null;

    if (!window.firebase.apps.length) window.firebase.initializeApp(config);
    if (!firebaseDb) firebaseDb = window.firebase.database();
    if (window.firebase.auth && !firebaseAuth) firebaseAuth = window.firebase.auth();
    activeMode = "firebase";
    return { db: firebaseDb, auth: firebaseAuth };
  }

  function readLocalFallback() {
    try {
      return normalizeSettings(JSON.parse(localStorage.getItem(LOCAL_FALLBACK_KEY) || "{}"));
    } catch (error) {
      return cloneDefaultSettings();
    }
  }

  function writeLocalFallback(settings) {
    localStorage.setItem(LOCAL_FALLBACK_KEY, JSON.stringify(normalizeSettings(settings)));
  }

  let currentAccess = { authorized: false, role: "", classIds: [] };

  function isBootstrapAdmin(user) {
    return Boolean(user && user.email && user.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase());
  }

  function readUserAccess(user) {
    const services = ensureFirebase();
    if (!services || !services.db || !user) return Promise.resolve({ authorized:false, role:"", classIds:[] });
    if (isBootstrapAdmin(user)) return Promise.resolve({ authorized:true, role:"admin", classIds:["*"] });

    // Established admins/teachers are the common case. Resolve those two small
    // records first instead of always downloading the entire teacherInvites
    // collection before the Teacher Center can decide who the user is.
    return Promise.all([
      services.db.ref("b3Games/admins/" + user.uid).once("value"),
      services.db.ref(WORKSPACE_ROOT_KEY + "/teachers/" + user.uid).once("value")
    ]).then(function (snaps) {
      const admin = snaps[0].val();
      const teacher = snaps[1].val();
      if (admin && admin.active !== false) return { authorized:true, role:"admin", classIds:["*"] };
      if (teacher && teacher.active === false) return { authorized:false, role:"", classIds:[] };
      if (teacher && teacher.active !== false) {
        const classIds = teacher.classIds ? Object.keys(teacher.classIds).filter(function(k){return k !== "*" && teacher.classIds[k] === true;}) : [];
        return { authorized:true, role:"teacher", classIds:classIds };
      }

      // Only unclaimed accounts need the invitations collection.
      return services.db.ref(WORKSPACE_ROOT_KEY + "/teacherInvites").once("value").then(function(inviteSnap){
        const email = String(user.email || "").trim().toLowerCase();
        const invites = inviteSnap.val() || {};
        const inviteEntry = Object.keys(invites).map(function (id) {
          return { id:id, value:invites[id] || {} };
        }).find(function (entry) {
          return entry.value.active !== false &&
            String(entry.value.email || "").trim().toLowerCase() === email;
        });
        if (inviteEntry && user.emailVerified === true) {
          const invite = inviteEntry.value;
          const classIds = invite.classIds ? Object.keys(invite.classIds).filter(function(k){return k !== "*" && invite.classIds[k] === true;}) : [];
          return user.getIdToken().then(function(token){
            return fetch("https://us-central1-b3-games.cloudfunctions.net/funTorahTeacherClaim",{
              method:"POST",signal:AbortSignal.timeout(10000),headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:"{}"
            });
          }).then(async function(response){
            if(!response.ok){const error=new Error("Teacher account linking is awaiting backend deployment.");error.status=response.status;throw error;}
            const claimed=await response.json();
            return {authorized:claimed.authorized===true,role:"teacher",classIds:(claimed.classIds||[]).filter(id=>id!=="*"),inviteId:inviteEntry.id};
          }).catch(function(error){
            if(error.status&&error.status!==404&&error.status!==503)return {authorized:false,role:"",classIds:[]};
            return {authorized:true,role:"teacher",classIds:classIds,inviteId:inviteEntry.id,claimPending:true,claimError:error.message};
          });
        }
        return { authorized:false, role:"", classIds:[] };
      });
    }).catch(function(){ return { authorized:false, role:"", classIds:[] }; });
  }

  function isAuthorizedUser(user) {
    if (getActingStudent()) return false;
    return Boolean(user && (isBootstrapAdmin(user) || currentAccess.authorized));
  }

  function requireAuthorizedUser() {
    const services = ensureFirebase();
    if (!services || !services.auth) return Promise.resolve();
    const user = services.auth.currentUser;
    return readUserAccess(user).then(function(access){
      currentAccess = access;
      if (!access.authorized) throw new Error("This account is not authorized for Fun Torah Tools.");
      return user.getIdToken(true).then(function () { return undefined; });
    });
  }

  function readOnce() {
    const services = ensureFirebase();
    if (!services) return Promise.resolve(readLocalFallback());
    return services.db.ref(SETTINGS_KEY).once("value").then(function (snapshot) {
      return normalizeSettings(snapshot.val());
    });
  }

  function subscribe(callback) {
    const services = ensureFirebase();
    if (!services) {
      callback(readLocalFallback());
      return function unsubscribe() {};
    }

    const ref = services.db.ref(SETTINGS_KEY);
    const handler = function (snapshot) { callback(normalizeSettings(snapshot.val())); };
    const errorHandler = function (error) {
      console.error("Could not read B3 site settings:", error);
      callback(readLocalFallback());
    };
    ref.on("value", handler, errorHandler);
    return function unsubscribe() { ref.off("value", handler); };
  }

  function mirrorWorkspaceSettings(services, settings) {
    if (!services || !services.db) return Promise.resolve();
    const payload = {
      meta: {
        workspaceId: WORKSPACE_ID,
        name: WORKSPACE_NAME,
        migrationPhase: 2,
        legacyCompatibility: true,
        legacySettingsPath: LEGACY_SETTINGS_KEY
      },
      siteSettings: normalizeSettings(settings)
    };
    return services.db.ref(WORKSPACE_ROOT_KEY).update(payload).catch(function (error) {
      console.warn("Could not mirror B3 settings into workspace " + WORKSPACE_ID + ":", error);
    });
  }

  // One-time bridge for legacy B3 students whose allowedStudents rows predate classId.
  // This exists only to seed Firebase memberships; normal access never depends on it.
  const LEGACY_CLASS_MIGRATION = {
    et: ["chaim_chaikin","mayer_chaim_chaikin","yossi_gourarie","sholom_huebner","sholom_dovber_huebner","moshe_lapine","kehos_notik","yisroel_oirechman","moshe_raichman","moshe_tuvia_raichman","avrohom_rosenfeld","levi_rozmarin","arik_traxler","simcha_cohen"],
    wt: ["ari_greenberg","zev_rosenfeld","levi_schtroks","yisroel_aryeh_simmonds","leibel_vogel","leib_wolf"]
  };
  function legacyMigrationClass(studentId) {
    if (LEGACY_CLASS_MIGRATION.et.indexOf(studentId) !== -1) return "et";
    if (LEGACY_CLASS_MIGRATION.wt.indexOf(studentId) !== -1) return "wt";
    return "";
  }

  // Safe, repeatable migration: copy existing Firebase student/class data into
  // the new teacher -> class -> membership model. No student names or PINs are
  // embedded in source code. Legacy records remain in place until every app has
  // switched to the new paths.
  function migrateWorkspaceData(services, user) {
    if (!services || !services.db || !user || !isBootstrapAdmin(user)) return Promise.resolve();
    return Promise.all([
      services.db.ref("posukPractice/allowedStudents").once("value"),
      services.db.ref("posukPractice/settings/classPin").once("value"),
      services.db.ref("b3Games/students").once("value"),
      services.db.ref(WORKSPACE_ROOT_KEY+"/classes").once("value")
    ]).then(function (snapshots) {
      const students = snapshots[0].val() || {};
      const legacyPin = snapshots[1].val();
      const centralStudents = snapshots[2].val() || {};
      const existingClasses = snapshots[3].val() || {};
      const updates = {};
      const now = new Date().toISOString();

      updates["b3Games/admins/" + user.uid] = {
        uid: user.uid, email: user.email || "", displayName: user.displayName || "Administrator",
        role: "admin", active: true, updatedAt: now
      };
      updates["b3Games/teachers/" + user.uid] = {
        uid: user.uid, email: user.email || "", displayName: user.displayName || "Teacher",
        role: "teacher", active: true, updatedAt: now
      };
      updates[WORKSPACE_ROOT_KEY + "/teachers/" + user.uid] = { role: "owner", active: true };

      ["et", "wt"].forEach(function (classId) {
        updates[WORKSPACE_ROOT_KEY + "/classes/" + classId + "/id"] = classId;
        updates[WORKSPACE_ROOT_KEY + "/classes/" + classId + "/name"] = classId.toUpperCase();
        updates[WORKSPACE_ROOT_KEY + "/classes/" + classId + "/teacherIds/" + user.uid] = true;
        if (legacyPin !== null && legacyPin !== undefined && legacyPin !== "") {
          updates[WORKSPACE_ROOT_KEY + "/classes/" + classId + "/classPin"] = String(legacyPin);
        }
      });

      Object.keys(students).forEach(function (studentId) {
        const row = students[studentId] || {};
        let classId = String(row.classId || "").toLowerCase();
        if (classId !== "et" && classId !== "wt") classId = legacyMigrationClass(studentId);
        if (classId !== "et" && classId !== "wt") return;
        const profile = { id: studentId, name: row.name || studentId, active: row.active !== false };
        if(!centralStudents[studentId]?.profile)updates["b3Games/students/" + studentId + "/profile"] = profile;
        // Passcodes are stored privately by the backend; never write them here.
        if(!centralStudents[studentId]?.memberships?.[WORKSPACE_ID+"_"+classId])updates["b3Games/students/" + studentId + "/memberships/" + WORKSPACE_ID + "_" + classId] = {
          workspaceId: WORKSPACE_ID, classId: classId, active: true
        };
        if(!existingClasses[classId]?.members?.[studentId])updates[WORKSPACE_ROOT_KEY + "/classes/" + classId + "/members/" + studentId] = {
          studentId: studentId, name: row.name || studentId, active: row.active !== false
        };
      });

      updates[WORKSPACE_ROOT_KEY + "/meta/membershipMigrationAt"] = now;
      return services.db.ref().update(updates);
    }).catch(function (error) {
      console.warn("Could not migrate B3 class memberships:", error);
    });
  }

  function save(settings) {
    const normalized = normalizeSettings(settings);
    const services = ensureFirebase();

    if (!services) {
      writeLocalFallback(normalized);
      return Promise.resolve(normalized);
    }

    return requireAuthorizedUser()
      .then(function () {
        if(currentAccess.role !== "admin") throw new Error("Only an administrator can change global site settings.");
        return services.db.ref(SETTINGS_KEY).set(normalized).then(function () {
          return mirrorWorkspaceSettings(services, normalized);
        });
      })
      .then(function () { return normalized; });
  }

  function updateSiteEnabled(enabled) {
    return readOnce().then(function (settings) {
      settings.siteEnabled = Boolean(enabled);
      return save(settings);
    });
  }

  function updateGameEnabled(gameId, enabled) {
    return readOnce().then(function (settings) {
      settings.games[gameId] = Boolean(enabled);
      return save(settings);
    });
  }

  function updateClassGameEnabled(classId, gameId, enabled) {
    if (!["et", "wt"].includes(classId)) return Promise.reject(new Error("Unknown class."));
    return readOnce().then(function (settings) {
      settings.classGames = settings.classGames || { et: {}, wt: {} };
      settings.classGames[classId] = settings.classGames[classId] || {};
      settings.classGames[classId][gameId] = Boolean(enabled);
      return save(settings);
    });
  }

  function updateClassesGameEnabled(classIds, gameId, enabled) {
    if (!Array.isArray(classIds) || !classIds.length || classIds.some(function (id) { return !["et", "wt"].includes(id); })) {
      return Promise.reject(new Error("Unknown class."));
    }
    return readOnce().then(function (settings) {
      classIds.forEach(function (classId) {
        settings.classGames[classId][gameId] = Boolean(enabled);
      });
      // One save prevents separate read/modify/write calls overwriting each other.
      return save(settings);
    });
  }

  function isGameEnabledForClass(settings, classId, gameId) {
    const normalized = normalizeSettings(settings);
    if (normalized.games && normalized.games[gameId] === false) return false;
    if (!["et","wt"].includes(classId)) return false;
    return normalized.classGames[classId][gameId] !== false;
  }

  function studentHasGameOverride(settings, studentId, gameId) {
    if (!studentId || !gameId) return false;
    const normalized = normalizeSettings(settings);
    return Boolean(
      normalized.studentGameOverrides &&
      normalized.studentGameOverrides[studentId] &&
      normalized.studentGameOverrides[studentId][gameId] === true
    );
  }

  function updateStudentGameOverride(studentId, gameId, enabled) {
    studentId = String(studentId || "").trim();
    gameId = String(gameId || "").trim();
    if (!studentId) return Promise.reject(new Error("Student is required."));
    if (!gameId) return Promise.reject(new Error("Activity is required."));

    return readOnce().then(function (settings) {
      settings.studentGameOverrides = settings.studentGameOverrides || {};
      settings.studentGameOverrides[studentId] = settings.studentGameOverrides[studentId] || {};

      if (enabled) {
        settings.studentGameOverrides[studentId][gameId] = true;
      } else {
        delete settings.studentGameOverrides[studentId][gameId];
        if (!Object.keys(settings.studentGameOverrides[studentId]).length) {
          delete settings.studentGameOverrides[studentId];
        }
      }
      return save(settings);
    });
  }

  // Games that stay open while a class is locked. Stored as one
  // comma-separated string (e.g. "shorashim,yiddish") so older single-game
  // values keep working.
  function lockedGameList(value) {
    return String(value || "").split(",").map(function (v) { return v.trim(); }).filter(Boolean);
  }

  // Each star remembers when it should switch itself off, so a star that is
  // forgotten does not keep a game open through later locks.
  // classLockedGameOverrideUntil = { et: { gameId: epochMs }, wt: {...} }.
  // A star with no saved time (from before this change) never expires.
  function lockedGameExpiry(settings, classId, gameId) {
    const map = settings && settings.classLockedGameOverrideUntil && settings.classLockedGameOverrideUntil[classId];
    const value = map && typeof map === "object" ? Number(map[gameId]) : 0;
    return value > 0 ? value : 0;
  }

  function activeLockedGameList(settings, classId, date) {
    const nowMs = (date instanceof Date ? date : new Date()).getTime();
    const raw = settings && settings.classLockedGameOverride ? settings.classLockedGameOverride[classId] : "";
    return lockedGameList(raw).filter(function (id) {
      const until = lockedGameExpiry(settings, classId, id);
      return !until || until > nowMs;
    });
  }

  // When a new star should switch itself off: at the end of the lock that is
  // happening now, or of the next lock later today; otherwise at midnight.
  function lockedGameExpiryFor(settings, classId, date) {
    const d = date instanceof Date ? date : new Date();
    const now = getNewYorkNow(d);
    const startOfMinute = d.getTime() - (d.getTime() % 60000);
    const at = function (minutesAhead) { return startOfMinute + minutesAhead * 60000; };
    const midnight = at(1440 - now.minutes);
    const normalized = normalizeSettings(settings);
    const access = normalized.classAccess[classId];
    if (normalized.siteEnabled === false || !access || access.mode === "locked") return midnight;
    const ranges = Array.isArray(access.lockWindows[now.day]) ? access.lockWindows[now.day] : [];
    let best = 0;
    ranges.forEach(function (range) {
      const start = timeToMinutes(range.start), end = timeToMinutes(range.end);
      if (start === end) return; // all-day lock: midnight
      let ahead = null;
      if (minuteIsInRange(now.minutes, range)) ahead = (end - now.minutes + 1440) % 1440;
      else if (start > now.minutes && start < end) ahead = end - now.minutes;
      if (ahead !== null && ahead > 0 && (!best || ahead < best)) best = ahead;
    });
    return best ? at(best) : midnight;
  }

  function classHasLockedGameOverride(settings, classId, gameId, date) {
    if (!["et", "wt"].includes(classId) || !gameId) return false;
    return activeLockedGameList(settings, classId, date).indexOf(String(gameId)) !== -1;
  }

  // Rewrites one class's stars: drops expired ones, then adds/removes gameId.
  function writeLockedGames(settings, classId, ids, addId) {
    const date = new Date();
    settings.classLockedGameOverride = settings.classLockedGameOverride || { et: "", wt: "" };
    settings.classLockedGameOverrideUntil = settings.classLockedGameOverrideUntil || {};
    const oldUntil = settings.classLockedGameOverrideUntil[classId] || {};
    const until = {};
    ids.forEach(function (id) { if (oldUntil[id]) until[id] = oldUntil[id]; });
    if (addId) until[addId] = lockedGameExpiryFor(settings, classId, date);
    settings.classLockedGameOverride[classId] = ids.join(",");
    settings.classLockedGameOverrideUntil[classId] = until;
  }

  function setClassLockedGame(classId, gameId, keepOpen) {
    if (!["et", "wt"].includes(classId)) return Promise.reject(new Error("Unknown class."));
    gameId = String(gameId || "").trim();
    if (!gameId) return Promise.reject(new Error("Activity is required."));
    return readOnce().then(function (settings) {
      const list = activeLockedGameList(settings, classId).filter(function (id) { return id !== gameId; });
      if (keepOpen) list.push(gameId);
      writeLockedGames(settings, classId, list, keepOpen ? gameId : "");
      return save(settings);
    });
  }

  function updateClassLockedGameOverride(classId, gameId) {
    if (!["et", "wt"].includes(classId)) return Promise.reject(new Error("Unknown class."));
    const value = String(gameId || "").trim();
    return readOnce().then(function (settings) {
      writeLockedGames(settings, classId, lockedGameList(value), value);
      return save(settings);
    });
  }

  function updateClassMode(classId, mode) {
    if (!["et", "wt"].includes(classId)) return Promise.reject(new Error("Unknown class."));
    if (!["auto", "open", "locked"].includes(mode)) return Promise.reject(new Error("Unknown access mode."));
    return readOnce().then(function (settings) {
      settings.classAccess[classId].mode = mode;
      return save(settings);
    });
  }

  function updateClassLockWindows(classId, lockWindows) {
    if (!["et", "wt"].includes(classId)) return Promise.reject(new Error("Unknown class."));
    return readOnce().then(function (settings) {
      const fallback = settings.classAccess[classId].lockWindows;
      const normalized = {};
      DAY_KEYS.forEach(function (day) {
        normalized[day] = normalizeDayLockWindows(lockWindows && lockWindows[day], fallback[day]);
      });
      settings.classAccess[classId].lockWindows = normalized;
      return save(settings);
    });
  }

  function timeToMinutes(value) {
    const parts = String(value || "").split(":");
    if (parts.length !== 2) return 0;
    const h = Math.max(0, Math.min(23, Number(parts[0]) || 0));
    const m = Math.max(0, Math.min(59, Number(parts[1]) || 0));
    return h * 60 + m;
  }

  function getNewYorkNow(date) {
    const d = date instanceof Date ? date : new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
    const parts = {};
    formatter.formatToParts(d).forEach(function (part) {
      if (part.type !== "literal") parts[part.type] = part.value;
    });
    const dayMap = { Sun: "sun", Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat" };
    return {
      day: dayMap[parts.weekday] || "sun",
      minutes: (Number(parts.hour) || 0) * 60 + (Number(parts.minute) || 0)
    };
  }

  function minuteIsInRange(minutes, range) {
    const start = timeToMinutes(range.start);
    const end = timeToMinutes(range.end);
    if (start === end) return true; // explicit all-day lock
    if (start < end) return minutes >= start && minutes < end;
    return minutes >= start || minutes < end;
  }

  function isInLockedPeriod(lockWindows, date) {
    const now = getNewYorkNow(date);
    const ranges = lockWindows && Array.isArray(lockWindows[now.day]) ? lockWindows[now.day] : [];
    return ranges.some(function (range) { return minuteIsInRange(now.minutes, range); });
  }

  function isClassOpen(settings, classId, date) {
    const normalized = normalizeSettings(settings);
    if (normalized.siteEnabled === false) return false;
    if (!["et", "wt"].includes(classId)) return false;

    const access = normalized.classAccess[classId];
    if (access.mode === "open") return true;
    if (access.mode === "locked") return false;
    return !isInLockedPeriod(access.lockWindows, date);
  }

  function describeClassAccess(settings, classId, date) {
    const normalized = normalizeSettings(settings);
    if (normalized.siteEnabled === false) return { open: false, reason: "Emergency master lock" };
    if (!["et", "wt"].includes(classId)) return { open: false, reason: "Class not assigned" };

    const access = normalized.classAccess[classId];
    if (access.mode === "open") return { open: true, reason: "Manual override: OPEN" };
    if (access.mode === "locked") return { open: false, reason: "Manual override: LOCKED" };
    const locked = isInLockedPeriod(access.lockWindows, date);
    return { open: !locked, reason: locked ? "Automatic schedule: LOCKED period" : "Automatic schedule: open" };
  }

  function signInWithGoogle() {
    const services = ensureFirebase();
    if (!services || !services.auth) return Promise.reject(new Error("Firebase Authentication is not configured."));
    const provider = new window.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    return services.auth.signInWithPopup(provider).catch(function (error) {
      const code = error && error.code ? error.code : "";
      if (code === "auth/popup-blocked" || code === "auth/cancelled-popup-request" || code === "auth/operation-not-supported-in-this-environment") {
        return services.auth.signInWithRedirect(provider).then(function () { return null; });
      }
      throw error;
    }).then(function (result) {
      // Redirect sign-in leaves this page and returns later, so there is no
      // immediate result object in that branch. onAuthStateChanged will finish it.
      if (!result) return null;
      return readUserAccess(result.user).then(function(access){
        currentAccess = access;
        if(document.readyState === "loading") document.addEventListener("DOMContentLoaded",()=>showToolVersions(access),{once:true});
        else showToolVersions(access);
        if (!access.authorized) {
          return services.auth.signOut().then(function () {
            const error = new Error("This Google account is not authorized for Fun Torah Tools.");
            error.code = "b3/unauthorized-user";
            throw error;
          });
        }
        return result.user;
      });
    });
  }

  function signOut() {
    const services = ensureFirebase();
    if (!services || !services.auth) return Promise.resolve();
    return services.auth.signOut();
  }


  // Teachers no longer get a Teacher version / Student version switch.
  // A signed-in teacher who opens a tool's student page is sent to that
  // tool's teacher page instead. To see a student page, the teacher uses
  // "Sign in as a student"; in that mode getActingStudent() is set and
  // access is not authorized, so this never redirects.
  function showToolVersions(access) {
    const oldBar = document.getElementById('b3ToolVersions');
    if (oldBar) oldBar.remove();
    if (!access || !access.authorized || getActingStudent()) return;
    const versions = {
      yiddish:['yiddish/teacher.html','yiddish/index.html'],
      record_pesukim:['record_pesukim/teacher.html','record_pesukim/student.html'],
      chazara:['chazara/teacher.html','chazara/index.html'],
      shorashim:['shorashim/teacher.html','shorashim/index.html'],
      'rashi-letters':['rashi-letters/teacher.html','rashi-letters/student.html'],
      gematria:['gematria/teacher.html','gematria/index.html'],
      halacha:['halacha/teacher.html','halacha/index.html'],
      'weekly-quiz':['weekly-quiz/teacher.html','weekly-quiz/index.html'],
      'game-show':['game-show/teacher.html','game-show/player.html'],
      'student-rewards':['student-rewards/teacher.html','student-rewards/student.html']
    };
    let base, current;
    try { base = new URL(SITE_BASE); current = new URL(location.href); } catch (e) { return; }
    if (current.origin !== base.origin || current.pathname.indexOf(base.pathname) !== 0) return;
    let path = current.pathname.slice(base.pathname.length);
    const folder = path.split('/')[0], pair = versions[folder];
    if (!pair) return;
    if (path === folder || path === folder + '/') path = folder + '/index.html';
    if (path !== pair[1]) return; // only student pages redirect
    // Halacha's teacher page opens a student's work on index.html?teacherView=ID;
    // that is a teacher tool, so leave it alone.
    if (current.searchParams.has('teacherView') || current.searchParams.has('teacher')) return;
    const target = new URL(pair[0], SITE_BASE);
    const requested = current.searchParams.get('class');
    if (requested && /^[A-Za-z0-9_-]{1,100}$/.test(requested)) target.searchParams.set('class', requested);
    location.replace(target.href);
  }

  function onAuthStateChanged(callback) {
    const services = ensureFirebase();
    if (!services || !services.auth) {
      callback(null, false);
      endAuthChecking();
      return function unsubscribe() {};
    }
    return services.auth.onAuthStateChanged(function (user) {
      if (!user) {
        currentAccess = { authorized:false, role:"", classIds:[] };
        setSignedInHint(false);
        callback(null, false, currentAccess);
        endAuthChecking();
        return;
      }
      // A teacher who chose "Sign in as a student" sees every page exactly as
      // that student does until they press Exit. This only ever removes
      // teacher access in this tab; it never grants anything.
      const acting = getActingStudent();
      if (acting) {
        currentAccess = { authorized:false, role:"", classIds:[], actingAsStudent:acting };
        callback(user, false, currentAccess);
        endAuthChecking();
        return;
      }
      readUserAccess(user).then(function(access){
        currentAccess = access;
        if(document.readyState === "loading") document.addEventListener("DOMContentLoaded",()=>showToolVersions(access),{once:true});
        else showToolVersions(access);
        setSignedInHint(access.authorized);
        callback(user, access.authorized, access);
        endAuthChecking();
        if (access.authorized && access.role === "admin") {
          services.db.ref(SETTINGS_KEY).once("value").then(function (snapshot) {
            return mirrorWorkspaceSettings(services, normalizeSettings(snapshot.val())).then(function () {
              return migrateWorkspaceData(services, user);
            });
          }).catch(function (error) {
            console.warn("Could not seed B3 workspace " + WORKSPACE_ID + ":", error);
          });
        }
      });
    });
  }

  // ---------------------------------------------------------------------
  // Teacher "Sign in as a student"
  // The teacher's Google sign-in stays in place. We fetch the student's
  // passcode through the existing teacher-only funTorahManageStudents "list"
  // action (which already checks the teacher owns that class), save the same
  // values a normal student sign-in saves, and mark this tab as acting.
  // ---------------------------------------------------------------------
  const ACTING_KEY = "b3ActingAsStudent";
  const ACTING_ID = /^[A-Za-z0-9_-]{1,100}$/;
  const STUDENT_STORAGE_KEYS = ["b3Games_studentId", "b3Games_studentName", "b3Games_studentClass", "b3Games_classPin",
    "posukPractice_studentId", "posukPractice_studentName", "weeklyQuiz_classId"];
  const MANAGE_STUDENTS_URL = "https://us-central1-b3-games.cloudfunctions.net/funTorahManageStudents";
  const SITE_BASE = (function () {
    try {
      const own = document.currentScript && document.currentScript.src;
      const tag = own || Array.prototype.map.call(document.getElementsByTagName("script"), function (s) { return s.src; })
        .find(function (src) { return /\/site-settings\.js(\?|$)/.test(src || ""); });
      return new URL(".", tag || location.href).href;
    } catch (e) { return ""; }
  })();

  function getActingStudent() {
    try {
      const raw = JSON.parse(sessionStorage.getItem(ACTING_KEY) || "null");
      if (!raw || !ACTING_ID.test(String(raw.id || "")) || !ACTING_ID.test(String(raw.classId || ""))) return null;
      return { id:String(raw.id), name:String(raw.name || raw.id), classId:String(raw.classId), className:String(raw.className || raw.classId), startedAt:raw.startedAt || null };
    } catch (e) { return null; }
  }

  function clearStudentStorage() {
    try { STUDENT_STORAGE_KEYS.forEach(function (k) { sessionStorage.removeItem(k); }); } catch (e) {}
    // Per-tab caches (Yiddish session, Halacha view, etc.) belong to the old identity.
    try { sessionStorage.clear(); } catch (e) {}
  }

  async function listStudentsForActing() {
    const services = ensureFirebase();
    const user = services && services.auth && services.auth.currentUser;
    if (!user) throw new Error("Sign in with your teacher Google account first.");
    const access = await readUserAccess(user);
    if (!access.authorized) throw new Error("This Google account is not a Fun Torah Tools teacher.");
    let classIds = access.classIds || [];
    if (access.role === "admin") {
      const all = (await services.db.ref(WORKSPACE_ROOT_KEY + "/classes").once("value")).val() || {};
      classIds = Object.keys(all);
    }
    const rows = await Promise.all(classIds.filter(function (id) { return ACTING_ID.test(id); }).map(function (id) {
      return services.db.ref(WORKSPACE_ROOT_KEY + "/classes/" + id).once("value").then(function (snap) {
        const cls = snap.val();
        if (!cls || cls.active === false) return null;
        const students = Object.keys(cls.members || {}).filter(function (sid) {
          const m = cls.members[sid];
          return ACTING_ID.test(sid) && m && m.active !== false;
        }).map(function (sid) {
          return { id:sid, name:String(cls.members[sid].name || sid) };
        }).sort(function (a, b) { return a.name.localeCompare(b.name); });
        return { classId:id, className:String(cls.name || id.toUpperCase()), students:students };
      });
    }));
    return rows.filter(function (r) { return r && r.students.length; })
      .sort(function (a, b) { return a.className.localeCompare(b.className); });
  }

  async function startActingAsStudent(classId, studentId) {
    classId = String(classId || ""); studentId = String(studentId || "");
    if (!ACTING_ID.test(classId) || !ACTING_ID.test(studentId)) throw new Error("Choose a student.");
    const services = ensureFirebase();
    const user = services && services.auth && services.auth.currentUser;
    if (!user) throw new Error("Sign in with your teacher Google account first.");
    const access = await readUserAccess(user);
    if (!access.authorized) throw new Error("This Google account is not a Fun Torah Tools teacher.");
    if (access.role !== "admin" && (access.classIds || []).indexOf(classId) < 0) throw new Error("This class is not assigned to your teacher account.");
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
    clearStudentStorage();
    sessionStorage.setItem("b3Games_studentId", studentId);
    sessionStorage.setItem("b3Games_studentName", name);
    sessionStorage.setItem("b3Games_studentClass", classId);
    sessionStorage.setItem("b3Games_classPin", pin);
    sessionStorage.setItem("posukPractice_studentId", studentId);
    sessionStorage.setItem("posukPractice_studentName", name);
    sessionStorage.setItem("weeklyQuiz_classId", classId);
    sessionStorage.setItem("b3Games_workspaceId", WORKSPACE_ID);
    sessionStorage.removeItem("b3TeacherBypass");
    sessionStorage.setItem(ACTING_KEY, JSON.stringify({ id:studentId, name:name, classId:classId, className:String(cls.name || classId.toUpperCase()), startedAt:Date.now() }));
    location.href = SITE_BASE + "index.html?v=20261007-tab-login";
  }

  function stopActingAsStudent() {
    clearStudentStorage();
    try { sessionStorage.removeItem(ACTING_KEY); } catch (e) {}
    location.href = SITE_BASE + "teacher-home.html";
  }

  function actingEsc(s) { const d = document.createElement("div"); d.textContent = String(s == null ? "" : s); return d.innerHTML; }

  function showActingBanner() {
    const acting = getActingStudent();
    if (!acting || window.top !== window || document.getElementById("b3ActingBanner")) return;
    const bar = document.createElement("div");
    bar.id = "b3ActingBanner";
    bar.setAttribute("role", "status");
    bar.style.cssText = "position:fixed;left:16px;right:16px;bottom:14px;margin:0 auto;width:fit-content;z-index:2147483647;display:flex;align-items:center;gap:12px;" +
      "padding:10px 12px 10px 16px;border-radius:999px;background:#7c2d12;color:#fff;font:600 14px/1.3 Arial,sans-serif;" +
      "box-shadow:0 8px 24px rgba(0,0,0,.28)";
    bar.innerHTML = '<span>\uD83D\uDC40 Viewing as <strong>' + actingEsc(acting.name) + '</strong> \u00B7 ' + actingEsc(acting.className) + '</span>' +
      '<button type="button" style="border:0;border-radius:999px;padding:7px 14px;background:#fff;color:#7c2d12;font:800 13px Arial,sans-serif;cursor:pointer;white-space:nowrap">Exit student view</button>';
    bar.querySelector("button").onclick = stopActingAsStudent;
    document.body.appendChild(bar);
  }

  function openActAsStudentPicker() {
    const old = document.getElementById("b3ActAsPicker");
    if (old) old.remove();
    const wrap = document.createElement("div");
    wrap.id = "b3ActAsPicker";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.style.cssText = "position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.55);font-family:Arial,sans-serif";
    const field = "width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:10px;font:15px Arial,sans-serif;margin-top:6px;background:#fff;color:#1f2937";
    wrap.innerHTML = '<div style="background:#fff;color:#1f2937;border-radius:18px;padding:22px;width:100%;max-width:420px;box-shadow:0 20px 50px rgba(0,0,0,.3)">' +
      '<h2 style="margin:0 0 6px;font-size:21px">Sign in as a student</h2>' +
      '<p style="margin:0 0 16px;color:#64748b;font-size:14px;line-height:1.4">See Fun Torah Tools exactly as this student does. Anything you do counts as their work. This tab keeps its own student login; other tabs stay as they are. Press <strong>Exit student view</strong> to come back.</p>' +
      '<label style="display:block;font-weight:700;font-size:14px">Class<select id="b3ActAsClass" style="' + field + '"><option>Loading\u2026</option></select></label>' +
      '<label style="display:block;font-weight:700;font-size:14px;margin-top:12px">Student<select id="b3ActAsStudent" style="' + field + '"></select></label>' +
      '<p id="b3ActAsMsg" style="min-height:20px;margin:12px 0 0;color:#b91c1c;font-size:14px"></p>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px">' +
      '<button type="button" id="b3ActAsCancel" style="border:1px solid #cbd5e1;background:#fff;color:#1f2937;border-radius:10px;padding:10px 14px;font:700 14px Arial,sans-serif;cursor:pointer">Cancel</button>' +
      '<button type="button" id="b3ActAsGo" disabled style="border:0;background:#15803d;color:#fff;border-radius:10px;padding:10px 14px;font:800 14px Arial,sans-serif;cursor:pointer">Open as student</button>' +
      '</div></div>';
    document.body.appendChild(wrap);
    const q = function (id) { return document.getElementById(id); };
    const close = function () { wrap.remove(); };
    q("b3ActAsCancel").onclick = close;
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
    let classes = [];
    const fillStudents = function () {
      const cls = classes.find(function (c) { return c.classId === q("b3ActAsClass").value; });
      q("b3ActAsStudent").innerHTML = (cls ? cls.students : []).map(function (s) {
        return '<option value="' + actingEsc(s.id) + '">' + actingEsc(s.name) + '</option>';
      }).join("");
      q("b3ActAsGo").disabled = !cls || !cls.students.length;
    };
    q("b3ActAsClass").onchange = fillStudents;
    q("b3ActAsGo").onclick = function () {
      q("b3ActAsGo").disabled = true; q("b3ActAsMsg").style.color = "#475569"; q("b3ActAsMsg").textContent = "Opening\u2026";
      startActingAsStudent(q("b3ActAsClass").value, q("b3ActAsStudent").value).catch(function (e) {
        q("b3ActAsMsg").style.color = "#b91c1c"; q("b3ActAsMsg").textContent = e.message || "Could not open this student.";
        q("b3ActAsGo").disabled = false;
      });
    };
    listStudentsForActing().then(function (rows) {
      classes = rows;
      if (!rows.length) { q("b3ActAsClass").innerHTML = '<option value="">No students in your classes</option>'; fillStudents(); return; }
      q("b3ActAsClass").innerHTML = rows.map(function (c) { return '<option value="' + actingEsc(c.classId) + '">' + actingEsc(c.className) + '</option>'; }).join("");
      fillStudents();
    }).catch(function (e) {
      q("b3ActAsClass").innerHTML = '<option value="">\u2014</option>';
      q("b3ActAsMsg").textContent = e.message || "Could not load your classes.";
    });
  }

  // ---------------------------------------------------------------------
  // "Back to Fun Torah Tools" button on every teacher page.
  // Skipped inside frames, on student pages, and on pages that already
  // show their own visible link back to the home page.
  // ---------------------------------------------------------------------
  function isTeacherPage() {
    let base, current;
    try { base = new URL(SITE_BASE); current = new URL(location.href); } catch (e) { return false; }
    if (current.origin !== base.origin || current.pathname.indexOf(base.pathname) !== 0) return false;
    const path = current.pathname.slice(base.pathname.length);
    if (/(^|\/)teacher\.html$/.test(path)) return true;
    if (path === "class-pointer-prototype/dashboard.html") return true;
    if (/^halacha\/(index\.html)?$/.test(path) && current.searchParams.has("teacher")) return true;
    return false;
  }

  function pageHasHomeLink() {
    let home;
    try { home = new URL(SITE_BASE); } catch (e) { return false; }
    return Array.prototype.some.call(document.querySelectorAll("a[href]"), function (a) {
      let u;
      try { u = new URL(a.getAttribute("href"), location.href); } catch (e) { return false; }
      if (u.origin !== home.origin) return false;
      if (u.pathname !== home.pathname && u.pathname !== home.pathname + "index.html") return false;
      return a.getClientRects().length > 0; // visible on the page
    });
  }

  function showBackToHome() {
    if (window.top !== window || getActingStudent() || !isTeacherPage()) return;
    if (document.getElementById("b3BackHome") || pageHasHomeLink()) return;
    const link = document.createElement("a");
    link.id = "b3BackHome";
    link.href = SITE_BASE + "index.html";
    link.textContent = "\u2190 Fun Torah Tools";
    link.style.cssText = "position:fixed;left:14px;bottom:14px;z-index:2147483000;padding:8px 14px;border-radius:999px;" +
      "background:#1f2937;color:#fff;font:700 13px/1.2 Arial,sans-serif;text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.25)";
    document.body.appendChild(link);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showBackToHome, { once: true });
  else showBackToHome();

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
    getCurrentAccess: function(){ return {authorized:currentAccess.authorized,role:currentAccess.role,classIds:currentAccess.classIds.slice()}; },
    workspaceId: WORKSPACE_ID,
    timeZone: TIME_ZONE,
    dayKeys: DAY_KEYS.slice(),
    getMode: function () { ensureFirebase(); return activeMode; },
    getActingStudent: getActingStudent,
    listStudentsForActing: listStudentsForActing,
    startActingAsStudent: startActingAsStudent,
    stopActingAsStudent: stopActingAsStudent,
    openActAsStudentPicker: openActAsStudentPicker
  };
  // Pages that never ask about sign-in still need their sign-in screens shown.
  if (authChecking) {
    const watch = function () { try { onAuthStateChanged(function () {}); } catch (e) { endAuthChecking(); } };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch, { once: true });
    else setTimeout(watch, 0);
  }
  if (getActingStudent()) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showActingBanner);
    else showActingBanner();
  }
})();
