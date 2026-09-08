(function () {
  "use strict";

  const SETTINGS_KEY = "b3Games/siteSettings";
  const LOCAL_FALLBACK_KEY = "b3SiteSettingsFallback";
  const AUTHORIZED_ADMIN_EMAIL = "simcha5770@gmail.com";
  const TIME_ZONE = "America/New_York";

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

  function defaultLockWindows(classId) {
    const result = blankLockWindows();
    ["mon", "tue", "wed", "thu"].forEach(function (day) {
      if (classId === "et") {
        result[day] = [
          { start: "08:45", end: "12:00" },
          { start: "12:45", end: "15:15" }
        ];
      } else {
        result[day] = [
          { start: "12:20", end: "15:35" },
          { start: "16:15", end: "18:45" }
        ];
      }
    });
    return result;
  }

  const defaultSettings = {
    siteEnabled: true,
    games: GAME_DEFAULTS,
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

  function normalizeClassAccess(value, fallback) {
    const source = value && typeof value === "object" ? value : {};
    const mode = ["auto", "open", "locked"].includes(source.mode) ? source.mode : fallback.mode;
    let lockWindows;

    if (source.lockWindows && typeof source.lockWindows === "object") {
      lockWindows = {};
      DAY_KEYS.forEach(function (day) {
        lockWindows[day] = normalizeDayLockWindows(source.lockWindows[day], fallback.lockWindows[day]);
      });
    } else if (source.schedule && typeof source.schedule === "object") {
      lockWindows = legacyOpenScheduleToLockWindows(source.schedule, fallback.lockWindows);
    } else {
      lockWindows = deepClone(fallback.lockWindows);
    }

    return { mode: mode, lockWindows: lockWindows };
  }

  function normalizeSettings(settings) {
    const source = settings && typeof settings === "object" ? deepClone(settings) : {};
    const normalized = deepClone(source);
    const sourceGames = source.games && typeof source.games === "object" ? source.games : {};
    const sourceClassAccess = source.classAccess && typeof source.classAccess === "object" ? source.classAccess : {};

    normalized.siteEnabled = typeof source.siteEnabled === "boolean" ? source.siteEnabled : true;

    normalized.games = Object.assign({}, GAME_DEFAULTS);
    Object.keys(sourceGames).forEach(function (gameId) {
      if (typeof sourceGames[gameId] === "boolean") normalized.games[gameId] = sourceGames[gameId];
    });

    const fallbackAccess = cloneDefaultSettings().classAccess;
    normalized.classAccess = {
      et: normalizeClassAccess(sourceClassAccess.et, fallbackAccess.et),
      wt: normalizeClassAccess(sourceClassAccess.wt, fallbackAccess.wt)
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

  function isAuthorizedUser(user) {
    return Boolean(user && user.email && user.email.toLowerCase() === AUTHORIZED_ADMIN_EMAIL.toLowerCase());
  }

  function requireAuthorizedUser() {
    const services = ensureFirebase();
    if (!services || !services.auth) return Promise.resolve();
    const user = services.auth.currentUser;
    if (!isAuthorizedUser(user)) return Promise.reject(new Error("You are not signed in with the authorized administrator account."));
    return user.getIdToken(true).then(function () { return undefined; });
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

  function save(settings) {
    const normalized = normalizeSettings(settings);
    const services = ensureFirebase();

    if (!services) {
      writeLocalFallback(normalized);
      return Promise.resolve(normalized);
    }

    return requireAuthorizedUser()
      .then(function () { return services.db.ref(SETTINGS_KEY).set(normalized); })
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
      if (!isAuthorizedUser(result.user)) {
        return services.auth.signOut().then(function () {
          const error = new Error("This Google account is not authorized. Please use simcha5770@gmail.com.");
          error.code = "b3/unauthorized-admin";
          throw error;
        });
      }
      return result.user;
    });
  }

  function signOut() {
    const services = ensureFirebase();
    if (!services || !services.auth) return Promise.resolve();
    return services.auth.signOut();
  }

  function onAuthStateChanged(callback) {
    const services = ensureFirebase();
    if (!services || !services.auth) {
      callback(null, false);
      return function unsubscribe() {};
    }
    return services.auth.onAuthStateChanged(function (user) {
      callback(user, isAuthorizedUser(user));
    });
  }

  window.B3SiteSettings = {
    defaultSettings: cloneDefaultSettings(),
    normalizeSettings: normalizeSettings,
    readOnce: readOnce,
    subscribe: subscribe,
    save: save,
    updateSiteEnabled: updateSiteEnabled,
    updateGameEnabled: updateGameEnabled,
    updateClassMode: updateClassMode,
    updateClassLockWindows: updateClassLockWindows,
    isClassOpen: isClassOpen,
    describeClassAccess: describeClassAccess,
    signInWithGoogle: signInWithGoogle,
    signOut: signOut,
    onAuthStateChanged: onAuthStateChanged,
    isAuthorizedUser: isAuthorizedUser,
    timeZone: TIME_ZONE,
    dayKeys: DAY_KEYS.slice(),
    getMode: function () { ensureFirebase(); return activeMode; }
  };
})();
