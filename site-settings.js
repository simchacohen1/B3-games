(function () {
  const SETTINGS_KEY = "b3Games/siteSettings";
  const LOCAL_FALLBACK_KEY = "b3SiteSettingsFallback";
  const defaultSettings = {
    siteEnabled: true,
    games: {
      "tzitzis-game": true,
      "tzitzis-quest-arcade": true,
      "kahoot-word-quiz": true
    }
  };

  function cloneDefaultSettings() {
    return JSON.parse(JSON.stringify(defaultSettings));
  }

  function normalizeSettings(settings) {
    const normalized = cloneDefaultSettings();

    if (settings && typeof settings.siteEnabled === "boolean") {
      normalized.siteEnabled = settings.siteEnabled;
    }

    if (settings && settings.games && typeof settings.games === "object") {
      Object.keys(normalized.games).forEach((gameId) => {
        if (typeof settings.games[gameId] === "boolean") {
          normalized.games[gameId] = settings.games[gameId];
        }
      });
    }

    return normalized;
  }

  function getConfiguredFirebaseOptions() {
    const config = window.B3_FIREBASE_CONFIG || {};
    const requiredKeys = [
      "apiKey",
      "authDomain",
      "databaseURL",
      "projectId",
      "storageBucket",
      "messagingSenderId",
      "appId"
    ];

    const isConfigured = requiredKeys.every((key) => {
      const value = config[key];
      return typeof value === "string" && value.trim() !== "" && value !== "REPLACE_ME";
    });

    return isConfigured ? config : null;
  }

  let firebaseDb = null;
  let activeMode = "local-preview";

  function ensureFirebaseDb() {
    if (firebaseDb) {
      return firebaseDb;
    }

    const config = getConfiguredFirebaseOptions();
    if (!config || !window.firebase || !window.firebase.database) {
      return null;
    }

    if (!window.firebase.apps.length) {
      window.firebase.initializeApp(config);
    }

    firebaseDb = window.firebase.database();
    activeMode = "firebase";
    return firebaseDb;
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

  function readOnce() {
    const db = ensureFirebaseDb();
    if (!db) {
      return Promise.resolve(readLocalFallback());
    }

    return db.ref(SETTINGS_KEY).once("value").then((snapshot) => {
      const settings = normalizeSettings(snapshot.val());
      if (!snapshot.exists()) {
        return db.ref(SETTINGS_KEY).set(settings).then(() => settings);
      }
      return settings;
    });
  }

  function subscribe(callback) {
    const db = ensureFirebaseDb();
    if (!db) {
      callback(readLocalFallback());
      return function unsubscribe() {};
    }

    const ref = db.ref(SETTINGS_KEY);
    const handler = function (snapshot) {
      const settings = normalizeSettings(snapshot.val());
      if (!snapshot.exists()) {
        ref.set(settings);
      }
      callback(settings);
    };

    ref.on("value", handler);
    return function unsubscribe() {
      ref.off("value", handler);
    };
  }

  function save(settings) {
    const normalized = normalizeSettings(settings);
    const db = ensureFirebaseDb();

    if (!db) {
      writeLocalFallback(normalized);
      return Promise.resolve(normalized);
    }

    return db.ref(SETTINGS_KEY).set(normalized).then(() => normalized);
  }

  function updateSiteEnabled(enabled) {
    return readOnce().then((settings) => {
      settings.siteEnabled = enabled;
      return save(settings);
    });
  }

  function updateGameEnabled(gameId, enabled) {
    return readOnce().then((settings) => {
      if (Object.prototype.hasOwnProperty.call(settings.games, gameId)) {
        settings.games[gameId] = enabled;
      }
      return save(settings);
    });
  }

  window.B3SiteSettings = {
    defaultSettings: cloneDefaultSettings(),
    normalizeSettings,
    readOnce,
    subscribe,
    save,
    updateSiteEnabled,
    updateGameEnabled,
    getMode: function () {
      ensureFirebaseDb();
      return activeMode;
    }
  };
})();
