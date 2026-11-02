window.B3_STAGING_FIREBASE_CONFIG = Object.freeze({"apiKey":"AIzaSyDP_yX-qqj1RRG7urdmXVePh7OuxRTCvEg","authDomain":"fun-torah-tools-staging.firebaseapp.com","databaseURL":"https://fun-torah-tools-staging-default-rtdb.firebaseio.com","projectId":"fun-torah-tools-staging","storageBucket":"fun-torah-tools-staging.firebasestorage.app","messagingSenderId":"644865469135","appId":"1:644865469135:web:1beaf0a455acbb40d6e5ba"});

/*
 * Staging-only configuration loader.
 * The deployment workflow writes staging/firebase-config.generated.js from
 * explicit, nonproduction configuration. This file must fail before app code
 * runs when that generated configuration is missing or targets production.
 */
(function (root) {
  'use strict';

  const REQUIRED_PROJECT = 'fun-torah-tools-staging';
  const STAGING_OWNER_EMAIL = 'owner@funtorahtools-staging.test';
  const BLOCKED_VALUES = [
    'b3-games',
    'b3-games.firebaseapp.com',
    'b3-games.firebasestorage.app',
    'b3-games-default-rtdb.firebaseio.com',
    'us-central1-b3-games.cloudfunctions.net',
    'posuk-scorer.onrender.com',
    'nigrisync.onrender.com',
    'docs.google.com/spreadsheets/d/'
  ];

  function fail(message) {
    root.__B3_STAGING_BLOCKED__ = true;
    if (root.document && root.document.documentElement) {
      root.document.documentElement.dataset.stagingBlocked = 'true';
    }
    throw new Error('[FTT staging] ' + message);
  }

  function getConfig() {
    const config = root.B3_STAGING_FIREBASE_CONFIG;
    if (!config || typeof config !== 'object') {
      fail('Staging Firebase configuration was not generated.');
    }
    const expectedDb = 'https://' + REQUIRED_PROJECT + '-default-rtdb.firebaseio.com';
    if (config.projectId !== REQUIRED_PROJECT ||
        config.authDomain !== REQUIRED_PROJECT + '.firebaseapp.com' ||
        config.databaseURL !== expectedDb ||
        typeof config.storageBucket !== 'string' ||
        !config.storageBucket.startsWith(REQUIRED_PROJECT + '.')) {
      fail('Firebase configuration does not point exclusively to the approved staging project.');
    }
    for (const key of ['apiKey', 'messagingSenderId', 'appId']) {
      if (typeof config[key] !== 'string' || !config[key].trim()) {
        fail('Staging Firebase configuration is incomplete (' + key + ').');
      }
    }
    const serialized = JSON.stringify(config).toLowerCase();
    if (BLOCKED_VALUES.some(value => serialized.includes(value))) {
      fail('Production Firebase or third-party configuration was found in the staging config.');
    }
    return Object.freeze({ ...config });
  }

  function requestText(input, init) {
    let value = '';
    try {
      value = typeof input === 'string' ? input : input && input.url ? input.url : String(input || '');
    } catch (_) {}
    if (init && init.body != null) {
      try { value += ' ' + (typeof init.body === 'string' ? init.body : String(init.body)); } catch (_) {}
    }
    return value.toLowerCase();
  }

  function isBlockedRequest(input, init) {
    const value = requestText(input, init);
    return BLOCKED_VALUES.some(blocked => value.includes(blocked));
  }

  function installNetworkGuards(target) {
    if (!target || target.__B3_STAGING_NETWORK_GUARDS__) return;
    const block = (input, init) => {
      if (isBlockedRequest(input, init)) {
        fail('Blocked a request to a production Firebase or third-party service.');
      }
    };

    if (typeof target.fetch === 'function') {
      const originalFetch = target.fetch.bind(target);
      target.fetch = function (input, init) {
        block(input, init);
        return originalFetch(input, init);
      };
    }
    if (target.XMLHttpRequest) {
      const xhrOpen = target.XMLHttpRequest.prototype.open;
      target.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        block(url);
        return xhrOpen.call(this, method, url, ...rest);
      };
      const xhrSend = target.XMLHttpRequest.prototype.send;
      target.XMLHttpRequest.prototype.send = function (body) {
        block('', { body });
        return xhrSend.call(this, body);
      };
    }
    for (const constructor of ['WebSocket', 'EventSource']) {
      const Native = target[constructor];
      if (typeof Native === 'function') {
        const Guarded = function (url, ...args) {
          block(url);
          return Reflect.construct(Native, [url, ...args], new.target || Native);
        };
        Guarded.prototype = Native.prototype;
        Object.setPrototypeOf(Guarded, Native);
        target[constructor] = Guarded;
      }
    }
    if (target.navigator && typeof target.navigator.sendBeacon === 'function') {
      const sendBeacon = target.navigator.sendBeacon.bind(target.navigator);
      target.navigator.sendBeacon = function (url, data) {
        block(url, { body: data });
        return sendBeacon(url, data);
      };
    }
    if (target.HTMLFormElement) {
      for (const method of ['submit', 'requestSubmit']) {
        const original = target.HTMLFormElement.prototype[method];
        if (typeof original === 'function') {
          target.HTMLFormElement.prototype[method] = function (...args) {
            block(this.action);
            return original.apply(this, args);
          };
        }
      }
    }
    if (typeof target.addEventListener === 'function') {
      target.addEventListener('submit', event => {
        const form = event.target;
        if (form && form.action) block(form.action);
      }, true);
    }
    Object.defineProperty(target, '__B3_STAGING_NETWORK_GUARDS__', { value: true });
  }

  function installFirebaseGuard(target, config) {
    function protect(sdk) {
      if (!sdk || typeof sdk.initializeApp !== 'function' || sdk.__B3_STAGING_INITIALIZE_GUARD__) return;
      const original = sdk.initializeApp.bind(sdk);
      sdk.initializeApp = function (provided, name) {
        // PREVIEW ONLY: pages with a hard-coded live config get the staging one.
        try { (window.__INIT_LOG__ = window.__INIT_LOG__ || []).push([provided && provided.projectId, name || 'default', String(new Error().stack).split('\n').slice(2,4).join('|')]); } catch (_) {}
        if (provided && provided.projectId === 'b3-games') provided = Object.assign({}, config);
        const actual = provided || (sdk.apps && sdk.apps.length ? sdk.app().options : null);
        if (!actual || actual.projectId !== config.projectId ||
            actual.databaseURL !== config.databaseURL ||
            actual.storageBucket !== config.storageBucket ||
            actual.authDomain !== config.authDomain ||
            actual.apiKey !== config.apiKey) {
          fail('Firebase refused to initialize with anything except the configured staging project.');
        }
        return original(provided, name);
      };
      Object.defineProperty(sdk, '__B3_STAGING_INITIALIZE_GUARD__', { value: true });
    }

    if (target.firebase) {
      protect(target.firebase);
      return;
    }
    // Compat Firebase is loaded with `defer` on the app pages, after this
    // fail-closed bootstrap runs. Intercept its global assignment so the
    // initializeApp guard is active before any deferred app script executes.
    let sdk;
    try {
      Object.defineProperty(target, 'firebase', {
        configurable: true,
        enumerable: true,
        get() { return sdk; },
        set(value) { sdk = value; protect(sdk); }
      });
    } catch (_) {
      fail('Could not install the Firebase initialization guard before app code.');
    }
  }

  const api = { REQUIRED_PROJECT, BLOCKED_VALUES, getConfig, isBlockedRequest, installNetworkGuards, installFirebaseGuard };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.window === root) {
    const config = getConfig();
    root.B3_FIREBASE_CONFIG = config;
    root.B3_STAGING_MODE = true;
    root.B3_STAGING_OWNER_EMAIL = STAGING_OWNER_EMAIL;
    root.B3_STAGING_FEATURES = Object.freeze({ storage: false, posukScoring: false, nigriSync: false });
    root.document.documentElement.dataset.b3Staging = 'true';
    const featureStyle = root.document.createElement('style');
    featureStyle.textContent = 'html[data-b3-staging="true"] .record-bar,html[data-b3-staging="true"] #shorashimRecordBtn,html[data-b3-staging="true"] #shorashimPauseBtn{display:none!important}.b3-staging-notice{margin:0 auto 10px;padding:8px 12px;background:#eff6ff;color:#1e3a8a;border:1px solid #bfdbfe;border-radius:10px;font:700 12px/1.4 Arial,sans-serif;text-align:center;max-width:1050px}';
    root.document.head.appendChild(featureStyle);
    installNetworkGuards(root);
    installFirebaseGuard(root, config);
    const labelSignIn = function () {
      const button = root.document && root.document.getElementById('signInButton');
      if (button) button.textContent = 'Sign in (Google or staging test account)';
      if (root.document && root.document.body && !root.document.querySelector('.b3-staging-notice')) {
        const notice = root.document.createElement('div');
        notice.className = 'b3-staging-notice';
        notice.textContent = 'Staging test site · audio uploads, Posuk scoring, and Nigri syncing are disabled.';
        root.document.body.prepend(notice);
      }
    };
    if (root.document) {
      if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', labelSignIn, { once: true });
      else labelSignIn();
    }
    root.B3_STAGING_READY = true;
  }
})(typeof window !== 'undefined' ? window : globalThis);


/*
 * Multi-teacher / multi-class foundation.
 *
 * Vocabulary:
 * - workspace: a school/teacher space that owns configuration
 * - teacher: an authenticated adult account
 * - class: a teaching group inside a workspace
 * - student: one person who may belong to multiple classes
 * - membership: the link between a student and a class
 * - shared resource: an explicitly shared area (for example a gallery) that
 *   multiple classes may opt into without sharing their unrelated settings.
 *
 * During migration, ET/WT keep their existing short IDs so all current B3
 * behavior continues to work while data is moved into the new model.
 */
window.B3_APP_CONTEXT = Object.freeze({
  // This identifies the current legacy workspace only. Teachers, classes,
  // students and PINs are loaded from Firebase rather than embedded here.
  workspaceId: "b3-2026",
  workspaceName: "B3 2026-27"
});

/*
 * Canonical Firebase paths for the scalable model. Apps should build new
 * multi-class features from these helpers instead of inventing global paths.
 *
 * A student can belong to any number of classes because membership is stored
 * separately from the student profile. Class settings therefore never overlap.
 * Shared resources are separate objects with explicit class membership.
 */
window.B3_DATA_MODEL = Object.freeze({
  version: 2,
  root: "b3Games",
  workspace: function (workspaceId) {
    return "b3Games/workspaces/" + String(workspaceId || "");
  },
  teacher: function (teacherId) {
    return "b3Games/teachers/" + String(teacherId || "");
  },
  student: function (studentId) {
    return "b3Games/students/" + String(studentId || "");
  },
  class: function (workspaceId, classId) {
    return "b3Games/workspaces/" + String(workspaceId || "") + "/classes/" + String(classId || "");
  },
  classMembership: function (workspaceId, classId, studentId) {
    return "b3Games/workspaces/" + String(workspaceId || "") + "/classes/" +
      String(classId || "") + "/members/" + String(studentId || "");
  },
  studentMemberships: function (studentId) {
    return "b3Games/students/" + String(studentId || "") + "/memberships";
  },
  sharedResource: function (workspaceId, resourceId) {
    return "b3Games/workspaces/" + String(workspaceId || "") + "/sharedResources/" + String(resourceId || "");
  }
});


// Load the shared student-only Add to Gallery button in every activity that
// already loads Firebase configuration. Button waits for a live verified API.
(function () {
  if (typeof document === 'undefined' || window.__fttGalleryShareLoading) return;
  window.__fttGalleryShareLoading = true;
  const current = document.currentScript;
  if (!current || !current.src) return;
  const loader = document.createElement('script');
  loader.src = new URL('gallery-share.js?v=20261022-pointer2', current.src).href;
  loader.async = true;
  (document.head || document.documentElement).appendChild(loader);
})();

/*
 * STAGING-ONLY email + password sign-in for fictional test teachers.
 * This block exists only in the staging preview build. It does nothing unless
 * the staging guard above has run (B3_STAGING_MODE) and the Firebase project
 * is fun-torah-tools-staging. Production never contains it.
 */
(function () {
  'use strict';
  if (!window.B3_STAGING_MODE) return;
  if (!window.B3_FIREBASE_CONFIG || window.B3_FIREBASE_CONFIG.projectId !== 'fun-torah-tools-staging') return;
  if (!/(^|\.)fun-torah-tools-staging(--[a-z0-9-]+)?\.web\.app$/.test(location.hostname)) return;
  function findBtn() { return document.getElementById('signInButton') || document.getElementById('login'); }
  function build() {
    var btn = findBtn();
    if (!btn || document.getElementById('stagingEmailSignIn')) return !!document.getElementById('stagingEmailSignIn');
    var box = document.createElement('form');
    box.id = 'stagingEmailSignIn';
    box.style.cssText = 'margin:10px 0;padding:12px;border:2px dashed #2563eb;border-radius:12px;background:#eff6ff;max-width:380px';
    box.innerHTML = '<div style="font:700 13px Arial;color:#1e3a8a;margin-bottom:8px">Staging test teacher sign-in (test site only)</div>' +
      '<input id="stagingEmail" type="email" autocomplete="username" placeholder="Test email" style="display:block;width:100%;box-sizing:border-box;padding:9px;margin-bottom:8px;border:1px solid #93c5fd;border-radius:8px">' +
      '<input id="stagingPassword" type="password" autocomplete="current-password" placeholder="Test password" style="display:block;width:100%;box-sizing:border-box;padding:9px;margin-bottom:8px;border:1px solid #93c5fd;border-radius:8px">' +
      '<button type="submit" style="padding:9px 14px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer">Sign in with email</button>' +
      '<div id="stagingEmailStatus" style="margin-top:8px;font:13px Arial;color:#b91c1c" aria-live="polite"></div>';
    btn.parentNode.insertBefore(box, btn.nextSibling);
    box.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var status = document.getElementById('stagingEmailStatus');
      status.style.color = '#1e3a8a'; status.textContent = 'Signing in…';
      window.firebase.auth().signInWithEmailAndPassword(
        document.getElementById('stagingEmail').value.trim(),
        document.getElementById('stagingPassword').value
      ).then(function () { status.textContent = 'Signed in.'; document.getElementById('stagingPassword').value = ''; })
       .catch(function (e) { status.style.color = '#b91c1c'; status.textContent = 'Could not sign in: ' + (e && e.code ? e.code : 'error'); });
    });
    return true;
  }
  function sync() {
    var btn = findBtn();
    var box = document.getElementById('stagingEmailSignIn');
    if (!box) { if (btn && window.firebase && window.firebase.auth) build(); return; }
    box.style.display = (btn && !btn.classList.contains('hidden') && btn.offsetParent !== null) ? '' : 'none';
  }
  setInterval(sync, 600);
})();

/*
 * STAGING-ONLY address swap: pages hard-code the production Cloud Functions
 * address. On the staging preview those calls are sent to the staging project
 * instead (same function names). Runs after the guard, so everything else that
 * points at production is still blocked.
 */
(function () {
  'use strict';
  if (!window.B3_STAGING_MODE || window.__B3_STAGING_FN_SWAP__) return;
  if (!window.B3_FIREBASE_CONFIG || window.B3_FIREBASE_CONFIG.projectId !== 'fun-torah-tools-staging') return;
  var PROD = 'https://us-central1-b3-games.cloudfunctions.net/';
  var STAGE = 'https://us-central1-fun-torah-tools-staging.cloudfunctions.net/';
  var SAME_ORIGIN = ["funTorahStudentAuth","funTorahManageStudents","funTorahTeacherClaim","studentRewardsAutoAward","weeklyQuizStudent","studentRewardsLogin","yiddishApi","homeworkPortal","classPointerShareAuth"];
  var PROD_DB = 'https://b3-games-default-rtdb.firebaseio.com';
  var STAGE_DB = 'https://fun-torah-tools-staging-default-rtdb.firebaseio.com';
  function swap(u) {
    if (typeof u === 'string' && u.indexOf(PROD_DB) === 0) return STAGE_DB + u.slice(PROD_DB.length);
    if (typeof u !== 'string' || u.indexOf(PROD) !== 0) return u;
    var rest = u.slice(PROD.length), name = rest.split(/[?#/]/)[0];
    return SAME_ORIGIN.indexOf(name) >= 0 ? location.origin + '/__fn/' + rest : STAGE + rest;
  }
  var nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    if (typeof input === 'string') input = swap(input);
    else if (input && typeof input.url === 'string' && (input.url.indexOf(PROD) === 0 || input.url.indexOf(PROD_DB) === 0)) input = new Request(swap(input.url), input);
    return nativeFetch.call(window, input, init);
  };
  var xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, url) {
    var a = Array.prototype.slice.call(arguments); a[1] = swap(String(url)); return xhrOpen.apply(this, a);
  };
  Object.defineProperty(window, '__B3_STAGING_FN_SWAP__', { value: true });
})();
