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
