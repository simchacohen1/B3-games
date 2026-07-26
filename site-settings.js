(function () {
  const SETTINGS_KEY = "b3Games/siteSettings";
  const LOCAL_FALLBACK_KEY = "b3SiteSettingsFallback";
  const AUTHORIZED_ADMIN_EMAIL = "simcha5770@gmail.com";

  const defaultSettings = {
    siteEnabled: true,
    games: {
      "tzitzis-game": true,
      "tzitzis-quest-arcade": true,
      "kahoot-word-quiz": true,
      "kodesh-construct": true,
      "chumash-quiz": true
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
      return (
        typeof value === "string" &&
        value.trim() !== "" &&
        value !== "REPLACE_ME"
      );
    });

    return isConfigured ? config : null;
  }

  let firebaseDb = null;
  let firebaseAuth = null;
  let activeMode = "local-preview";

  function ensureFirebase() {
    const config = getConfiguredFirebaseOptions();

    if (
      !config ||
      !window.firebase ||
      !window.firebase.database ||
      !window.firebase.auth
    ) {
      return null;
    }

    if (!window.firebase.apps.length) {
      window.firebase.initializeApp(config);
    }

    if (!firebaseDb) {
      firebaseDb = window.firebase.database();
    }

    if (!firebaseAuth) {
      firebaseAuth = window.firebase.auth();
    }

    activeMode = "firebase";

    return {
      db: firebaseDb,
      auth: firebaseAuth
    };
  }

  function readLocalFallback() {
    try {
      return normalizeSettings(
        JSON.parse(localStorage.getItem(LOCAL_FALLBACK_KEY) || "{}")
      );
    } catch (error) {
      return cloneDefaultSettings();
    }
  }

  function writeLocalFallback(settings) {
    localStorage.setItem(
      LOCAL_FALLBACK_KEY,
      JSON.stringify(normalizeSettings(settings))
    );
  }

  function isAuthorizedUser(user) {
    return Boolean(
      user &&
      user.email &&
      user.email.toLowerCase() === AUTHORIZED_ADMIN_EMAIL.toLowerCase()
    );
  }

  function requireAuthorizedUser() {
    const services = ensureFirebase();

    if (!services) {
      return Promise.resolve();
    }

    const user = services.auth.currentUser;

    if (!isAuthorizedUser(user)) {
      return Promise.reject(
        new Error("You are not signed in with the authorized administrator account.")
      );
    }

    return user.getIdToken(true).then(() => undefined);
  }

  function readOnce() {
    const services = ensureFirebase();

    if (!services) {
      return Promise.resolve(readLocalFallback());
    }

    return services.db
      .ref(SETTINGS_KEY)
      .once("value")
      .then((snapshot) => normalizeSettings(snapshot.val()));
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
      console.error("Could not read Firebase settings:", error);
      callback(readLocalFallback());
    };

    ref.on("value", handler, errorHandler);

    return function unsubscribe() {
      ref.off("value", handler);
    };
  }

  function save(settings) {
    const normalized = normalizeSettings(settings);
    const services = ensureFirebase();

    if (!services) {
      writeLocalFallback(normalized);
      return Promise.resolve(normalized);
    }

    return requireAuthorizedUser()
      .then(() => services.db.ref(SETTINGS_KEY).set(normalized))
      .then(() => normalized);
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

  function signInWithGoogle() {
    const services = ensureFirebase();

    if (!services) {
      return Promise.reject(new Error("Firebase is not configured."));
    }

    const provider = new window.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({
      prompt: "select_account"
    });

    return services.auth.signInWithPopup(provider).then((result) => {
      if (!isAuthorizedUser(result.user)) {
        return services.auth.signOut().then(() => {
          throw new Error("This Google account is not authorized.");
        });
      }

      return result.user;
    });
  }

  function signOut() {
    const services = ensureFirebase();

    if (!services) {
      return Promise.resolve();
    }

    return services.auth.signOut();
  }

  function onAuthStateChanged(callback) {
    const services = ensureFirebase();

    if (!services) {
      callback(null, false);
      return function unsubscribe() {};
    }

    return services.auth.onAuthStateChanged((user) => {
      callback(user, isAuthorizedUser(user));
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
    signInWithGoogle,
    signOut,
    onAuthStateChanged,
    isAuthorizedUser,
    getMode: function () {
      ensureFirebase();
      return activeMode;
    }
  };
})();
