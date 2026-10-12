/* Read-only safety layer for the owner's teacher preview iframe.
   Only the verified owner preview shell may supply preview context. */
(function () {
  "use strict";
  let context;
  try {
    context = window.parent !== window && window.parent.__B3_PREVIEW_CONTEXT;
  } catch (_) {}
  if (!context || context.verified !== true || !/^[A-Za-z0-9_-]{1,100}$/.test(context.classId || "")) {
    document.documentElement.replaceChildren(document.createTextNode("Teacher preview is not available."));
    throw new Error("Missing verified teacher preview context");
  }
  const denied = () => Promise.reject(new Error("Read-only teacher preview: changes are disabled."));
  const readonly = {authorized: true, role: "teacher", classIds: [context.classId], preview: true};
  window.B3_READ_ONLY_TEACHER_PREVIEW = true;

  // Guard remote function calls, even when a tool bypasses Firebase.
  const nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = function (input, init) {
      const method = String(init?.method || input?.method || "GET").toUpperCase();
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) return denied();
      return nativeFetch.apply(this, arguments);
    };
  }
  const xhr = XMLHttpRequest.prototype;
  const xhrOpen = xhr.open, xhrSend = xhr.send;
  xhr.open = function (method) {
    this.__b3PreviewMethod = String(method || "GET").toUpperCase();
    return xhrOpen.apply(this, arguments);
  };
  xhr.send = function () {
    if (!["GET", "HEAD", "OPTIONS"].includes(this.__b3PreviewMethod || "GET")) {
      throw new Error("Read-only teacher preview: network changes are disabled.");
    }
    return xhrSend.apply(this, arguments);
  };
  if (navigator.sendBeacon) navigator.sendBeacon = function () { return false; };
  HTMLFormElement.prototype.submit = function () { throw new Error("Read-only teacher preview."); };
  if (HTMLFormElement.prototype.requestSubmit) HTMLFormElement.prototype.requestSubmit = function () { throw new Error("Read-only teacher preview."); };
  document.addEventListener("submit", event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);

  // Patch the compat SDK's database/storage reference prototypes, preserving all reads.
  function protectMethods(ref, methods) {
    if (!ref) return;
    const proto = Object.getPrototypeOf(ref);
    if (!proto) return;
    methods.forEach(name => {
      const fn = proto[name];
      if (typeof fn !== "function" || fn.__b3PreviewProtected) return;
      const blocked = function () { return denied(); };
      blocked.__b3PreviewProtected = true;
      try { proto[name] = blocked; } catch (_) {}
    });
  }
  function protectFirebase() {
    const fb = window.firebase;
    if (!fb) return;
    if (typeof fb.initializeApp === "function" && !fb.initializeApp.__b3PreviewProtected) {
      const original = fb.initializeApp;
      const wrapped = function () {
        const result = original.apply(this, arguments);
        protectFirebase();
        return result;
      };
      wrapped.__b3PreviewProtected = true;
      try { fb.initializeApp = wrapped; } catch (_) {}
    }
    if (typeof fb.database === "function") {
      try {
        const db = fb.database();
        protectMethods(db.ref(), ["set", "update", "remove", "transaction"]);
        // push(value) is a write too. Disable it even when it returns a new reference.
        protectMethods(db.ref(), ["push"]);
        const onDisconnect = db.ref().onDisconnect?.();
        protectMethods(onDisconnect, ["set", "update", "remove", "cancel", "setWithPriority"]);
        protectMethods(db.ref(), ["setWithPriority", "setPriority"]);
      } catch (_) {}
    }
    if (typeof fb.storage === "function") {
      try { protectMethods(fb.storage().ref(), ["put", "putString", "delete", "updateMetadata"]); } catch (_) {}
    }
    if (typeof fb.firestore === "function") {
      try {
        const store = fb.firestore();
        protectMethods(store.doc("__preview__/blocked"), ["set", "update", "delete"]);
        protectMethods(store.batch(), ["commit"]);
      } catch (_) {}
    }
  }
  function protectSettings() {
    const api = window.B3SiteSettings;
    if (!api || api.__b3ReadonlyWrapped) return;
    const originalAuth = api.onAuthStateChanged;
    const originalAccess = api.getCurrentAccess;
    if (typeof originalAuth === "function") {
      api.onAuthStateChanged = function (callback) {
        return originalAuth.call(api, (user, authorized, access) => {
          const owner = Boolean(user && authorized && access?.role === "admin");
          callback(user, owner, owner ? {...readonly} : {authorized:false, role:"", classIds:[]});
        });
      };
    }
    if (typeof originalAccess === "function") {
      api.getCurrentAccess = function () {
        const access = originalAccess.call(api);
        return access?.authorized && access.role === "admin"
          ? {...readonly}
          : {authorized:false,role:"",classIds:[]};
      };
    }
    Object.keys(api).filter(name => /^(save|update|set|startActing|stopActing|signOut)/.test(name)).forEach(name => {
      if (typeof api[name] === "function") api[name] = denied;
    });
    api.__b3ReadonlyWrapped = true;
  }
  window.B3PreviewProtect = function () {
    protectFirebase();
    protectSettings();
  };
  window.B3PreviewProtect();
  // Some tools initialize Firebase inside their own scripts, after SDK imports.
  document.addEventListener("DOMContentLoaded", () => {
    window.B3PreviewProtect();
    const banner = document.createElement("div");
    banner.textContent = "👀 Viewing as " + context.teacherName + " · " + context.className +
      " · READ ONLY — saving, approvals and changes are blocked";
    banner.style.cssText = "position:sticky;top:0;z-index:2147483647;padding:11px 16px;background:#fff3bf;color:#543900;border-bottom:2px solid #c89127;text-align:center;font:700 14px Arial,sans-serif";
    document.body.prepend(banner);
  });

  // Keep links inside the guarded preview instead of navigating to unguarded pages.
  document.addEventListener("click", event => {
    const anchor = event.target.closest?.("a[href]");
    if (anchor) {
      let target;
      try { target = new URL(anchor.href, location.href); } catch (_) { return; }
      if ((anchor.getAttribute("href") || "").startsWith("#")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.parent.postMessage({type:"b3-teacher-preview-link", href:target.href}, window.parent.location.origin);
      return;
    }
    const control = event.target.closest?.("button,[role=button],input[type=submit]");
    if (!control) return;
    const label = String([control.textContent,control.title,control.id,control.name,control.value].join(" "));
    if (/save|delete|remove|approve|reject|publish|submit|upload|award|lock|unlock|grant|revoke|apply changes|reset|clear all|add student|add item|edit|update|purchase|sign out/i.test(label)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
})();