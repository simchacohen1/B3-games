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

  function allDaySchedule() {
    const schedule = {};
    DAY_KEYS.forEach(function (day) {
      schedule[day] = { enabled: true, start: "00:00", end: "23:59" };
    });
    return schedule;
  }

  const defaultSettings = {
    siteEnabled: true,
    games: GAME_DEFAULTS,
    classAccess: {
      et: { mode: "auto", schedule: allDaySchedule() },
      wt: { mode: "auto", schedule: allDaySchedule() }
    }
  };

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function cloneDefaultSettings() {
    return deepClone(defaultSettings);
  }

  function normalizeDay(value, fallback) {
    const source = value && typeof value === "object" ? value : {};
    return {
      enabled: typeof source.enabled === "boolean" ? source.enabled : fallback.enabled,
      start: /^\d{2}:\d{2}$/.test(source.start || "") ? source.start : fallback.start,
      end: /^\d{2}:\d{2}$/.test(source.end || "") ? source.end : fallback.end
    };
  }

  function normalizeClassAccess(value, fallback) {
    const source = value && typeof value === "object" ? value : {};
    const mode = ["auto", "open", "locked"].includes(source.mode) ? source.mode : fallback.mode;
    const schedule = {};
    DAY_KEYS.forEach(function (day) {
      schedule[day] = normalizeDay(source.schedule && source.schedule[day], fallback.schedule[day]);
    });
    return { mode: mode, schedule: schedule };
  }

  function normalizeSettings(settings) {
    const source = settings && typeof settings === "object" ? deepClone(settings) : {};
    const normalized = deepClone(source);
    const sourceGames = source.games && typeof source.games === "object" ? source.games : {};
    const sourceClassAccess = source.classAccess && typeof source.classAccess === "object" ? source.classAccess : {};

    normalized.siteEnabled = typeof source.siteEnabled === "boolean" ? source.siteEnabled : true;

    normalized.games = Object.assign({}, GAME_DEFAULTS);
    Object.keys(sourceGames).forEach(function (gameId) {
      if (typeof sourceGames[gameId] === "boolean") {
        normalized.games[gameId] = sourceGames[gameId];
      }
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

    if (!window.firebase.apps.length) {
      window.firebase.initializeApp(config);
    }

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
    if (!isAuthorizedUser(user)) {
      return Promise.reject(new Error("You are not signed in with the authorized administrator account."));
    }

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
    const handler = function (snapshot) {
      callback(normalizeSettings(snapshot.val()));
    };
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

  function updateClassSchedule(classId, schedule) {
    if (!["et", "wt"].includes(classId)) return Promise.reject(new Error("Unknown class."));

    return readOnce().then(function (settings) {
      settings.classAccess[classId].schedule = normalizeClassAccess(
        { mode: settings.classAccess[classId].mode, schedule: schedule },
        settings.classAccess[classId]
      ).schedule;
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

  function isWithinSchedule(schedule, date) {
    const now = getNewYorkNow(date);
    const rule = schedule && schedule[now.day];
    if (!rule || rule.enabled === false) return false;

    const start = timeToMinutes(rule.start);
    const end = timeToMinutes(rule.end);

    if (start === end) return true;
    if (start < end) return now.minutes >= start && now.minutes <= end;
    return now.minutes >= start || now.minutes <= end;
  }

  function isClassOpen(settings, classId, date) {
    const normalized = normalizeSettings(settings);
    if (normalized.siteEnabled === false) return false;
    if (!["et", "wt"].includes(classId)) return false;

    const access = normalized.classAccess[classId];
    if (access.mode === "open") return true;
    if (access.mode === "locked") return false;
    return isWithinSchedule(access.schedule, date);
  }

  function describeClassAccess(settings, classId, date) {
    const normalized = normalizeSettings(settings);
    if (normalized.siteEnabled === false) return { open: false, reason: "Emergency master lock" };
    if (!["et", "wt"].includes(classId)) return { open: false, reason: "Class not assigned" };

    const access = normalized.classAccess[classId];
    if (access.mode === "open") return { open: true, reason: "Manual override: OPEN" };
    if (access.mode === "locked") return { open: false, reason: "Manual override: LOCKED" };
    return {
      open: isWithinSchedule(access.schedule, date),
      reason: "Automatic schedule"
    };
  }

  function signInWithGoogle() {
    const services = ensureFirebase();
    if (!services || !services.auth) return Promise.reject(new Error("Firebase Authentication is not configured."));

    const provider = new window.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    return services.auth.signInWithPopup(provider).then(function (result) {
      if (!isAuthorizedUser(result.user)) {
        return services.auth.signOut().then(function () {
          throw new Error("This Google account is not authorized.");
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
    updateClassSchedule: updateClassSchedule,
    isClassOpen: isClassOpen,
    describeClassAccess: describeClassAccess,
    signInWithGoogle: signInWithGoogle,
    signOut: signOut,
    onAuthStateChanged: onAuthStateChanged,
    isAuthorizedUser: isAuthorizedUser,
    timeZone: TIME_ZONE,
    dayKeys: DAY_KEYS.slice(),
    getMode: function () {
      ensureFirebase();
      return activeMode;
    }
  };
})();
