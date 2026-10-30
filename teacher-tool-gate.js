/* Teacher Tools gate (issue #439).
 *
 * Load this as the FIRST script in <head> of every Teacher Tools page:
 *   <script src="../teacher-tool-gate.js?v=..." data-scope="teacher|b3|admin"></script>
 *
 * Until a verified, currently authorized teacher/admin is confirmed, the whole page
 * is hidden and only a sign-in / access-denied card is shown. It fails closed: if
 * Firebase or the access check cannot run, the page stays locked.
 *
 * Important limit: this file is static, public HTML on GitHub Pages. It keeps the
 * tool screens from opening for strangers and students, but it cannot make the page
 * source secret. Real protection of student data and actions is in the Firebase
 * database rules and Cloud Functions, which check the signed-in identity server-side.
 *
 * data-only-if="teacher=1": gate the page only when that address parameter is present
 *   (for pages that also serve as a student screen).
 * data-scope:
 *   teacher (default) any active teacher of any class, or an admin
 *   b3                admin, or a teacher of the B3 classes (et / wt)
 *   admin             owner/admin only
 * A ?class=<id> in the address must be one of the teacher's own classes (admins: any).
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script || window.__b3TeacherGate) return;
  window.__b3TeacherGate = true;
  var scope = (script.getAttribute("data-scope") || "teacher").toLowerCase();
  // data-only-if="teacher=1": a page that is also a student screen is gated only in its teacher mode.
  var onlyIf = script.getAttribute("data-only-if");
  if (onlyIf) {
    var kv = onlyIf.split("=");
    if (new URLSearchParams(location.search).get(kv[0]) !== (kv[1] || "")) return;
  }
  var BASE = new URL(".", script.src).href;
  var doc = document.documentElement;
  var CLASS_ID = /^[A-Za-z0-9_-]{1,100}$/;
  var allowedOnce = false, deniedSinceLoad = false, gateEl = null, stage = "checking";
  // Tool code that writes to the database on startup should wait for this promise.
  // It resolves only after a verified, authorized teacher is confirmed, and never for anyone else.
  var markReady; window.B3TeacherGateReady = new Promise(function (resolve) { markReady = resolve; });

  var style = document.createElement("style");
  style.id = "b3-teacher-gate-style";
  style.textContent =
    "html.b3-tg-locked body>*:not(#b3-teacher-gate){display:none!important}" +
    "html.b3-tg-locked{background:#f1f5f9!important}" +
    "#b3-teacher-gate{font-family:Arial,sans-serif;max-width:460px;margin:12vh auto;padding:28px 24px;background:#fff;border:1px solid #dbe3ee;border-radius:16px;box-shadow:0 6px 22px rgba(15,23,42,.1);text-align:center;color:#1f2937}" +
    "#b3-teacher-gate h2{margin:0 0 10px;font-size:22px}#b3-teacher-gate p{margin:8px 0;line-height:1.45}" +
    "#b3-teacher-gate button,#b3-teacher-gate a{display:inline-block;margin:8px 5px 0;padding:10px 16px;border:0;border-radius:10px;font:inherit;font-weight:700;cursor:pointer;text-decoration:none;background:#2563eb;color:#fff}" +
    "#b3-teacher-gate a.plain,#b3-teacher-gate button.plain{background:#e2e8f0;color:#1f2937}";
  (document.head || doc).appendChild(style);
  doc.classList.add("b3-tg-locked");
  doc.setAttribute("data-b3-gate", "checking");

  function ensureCard() {
    if (gateEl && gateEl.isConnected) return gateEl;
    if (!document.body) return null;
    gateEl = document.createElement("div");
    gateEl.id = "b3-teacher-gate";
    gateEl.setAttribute("role", "region");
    gateEl.setAttribute("aria-label", "Teacher access check");
    document.body.insertBefore(gateEl, document.body.firstChild);
    return gateEl;
  }
  var lastShown = null;
  function show(title, message, buttons) {
    lastShown = { t: title, m: message, b: buttons };
    var card = ensureCard();
    if (!card) { document.addEventListener("DOMContentLoaded", function () { show(title, message, buttons); }, { once: true }); return; }
    card.textContent = "";
    var h = document.createElement("h2"); h.textContent = title; card.appendChild(h);
    var p = document.createElement("p"); p.textContent = message; p.setAttribute("role", "status"); card.appendChild(p);
    (buttons || []).forEach(function (b) {
      var el = document.createElement(b.href ? "a" : "button");
      if (b.href) el.href = b.href; else el.type = "button";
      el.textContent = b.label; if (b.plain) el.className = "plain";
      if (b.onClick) el.addEventListener("click", function () { b.onClick(el); });
      card.appendChild(el);
    });
  }
  function homeButton() { return { label: "Back to Fun Torah Tools", href: BASE + "index.html", plain: true }; }
  function signInButton() {
    return { label: "Sign in with Google", onClick: function (el) {
      el.disabled = true;
      var api = window.B3SiteSettings;
      if (!api || !api.signInWithGoogle) { el.disabled = false; return; }
      Promise.resolve(api.signInWithGoogle()).catch(function (error) {
        el.disabled = false;
        show("Teacher sign in", (error && error.message) || "Could not sign in. Please try again.", [signInButton(), homeButton()]);
      });
    } };
  }
  function lock() { doc.classList.add("b3-tg-locked"); doc.setAttribute("data-b3-gate", stage); }
  function unlock() { doc.classList.remove("b3-tg-locked"); doc.setAttribute("data-b3-gate", "allowed"); if (gateEl && gateEl.parentNode) gateEl.parentNode.removeChild(gateEl); gateEl = null; }

  function classParam() {
    var v = new URLSearchParams(location.search).get("class");
    return v == null || v === "" ? "" : v;
  }
  function decide(user, authorized, access) {
    access = access || {};
    if (access.actingAsStudent) return { ok: false, why: "student-view" };
    if (!user) return { ok: false, why: "signed-out" };
    if (!authorized || access.authorized !== true) return { ok: false, why: "not-teacher" };
    var admin = access.role === "admin", ids = Array.isArray(access.classIds) ? access.classIds : [];
    if (scope === "admin" && !admin) return { ok: false, why: "admin-only" };
    if (scope === "b3" && !admin && ids.indexOf("et") < 0 && ids.indexOf("wt") < 0) return { ok: false, why: "b3-only" };
    var cls = classParam();
    if (cls) {
      if (!CLASS_ID.test(cls)) return { ok: false, why: "bad-class" };
      if (!admin && ids.indexOf(cls) < 0) return { ok: false, why: "other-class" };
    }
    return { ok: true };
  }
  // Revocation while the page stays open: site-settings only reads access when sign-in changes,
  // so watch this teacher's own records and re-decide the moment they change.
  var watchedUid = null;
  function watchAccess(user) {
    try {
      var api = window.B3SiteSettings, fb = window.firebase;
      if (!user || !user.uid || watchedUid === user.uid || !fb || !fb.database || !api) return;
      if (String(user.email || "").toLowerCase() === "simcha5770@gmail.com") return; // owner is fixed by email
      var db = fb.database(), ws = "b3Games/workspaces/" + (api.workspaceId || "b3-2026");
      var adminRef = db.ref("b3Games/admins/" + user.uid), teacherRef = db.ref(ws + "/teachers/" + user.uid);
      watchedUid = user.uid;
      var first = { a: true, t: true };
      function recheck() {
        Promise.all([adminRef.once("value"), teacherRef.once("value")]).then(function (s) {
          var admin = s[0].val(), teacher = s[1].val();
          if (admin && admin.active !== false) return onDecision(user, true, { authorized: true, role: "admin", classIds: ["*"] });
          var ids = teacher && teacher.active !== false && teacher.classIds ? Object.keys(teacher.classIds).filter(function (k) { return k !== "*" && teacher.classIds[k] === true; }) : [];
          onDecision(user, ids.length > 0, ids.length ? { authorized: true, role: "teacher", classIds: ids } : { authorized: false, role: "", classIds: [] });
        }).catch(function () { onDecision(user, false, { authorized: false, role: "", classIds: [] }); });
      }
      adminRef.on("value", function () { if (first.a) { first.a = false; return; } recheck(); });
      teacherRef.on("value", function () { if (first.t) { first.t = false; return; } recheck(); });
    } catch (e) { /* the sign-in-time check above still stands */ }
  }
  function onDecision(user, authorized, access) {
    var d = decide(user, authorized, access);
    if (d.ok) {
      stage = "allowed"; watchAccess(user);
      allowedOnce = true; unlock(); markReady(); return;
    }
    deniedSinceLoad = true; stage = d.why; lock();
    var back = [homeButton()];
    if (d.why === "signed-out") show("Teacher sign in", "This page is for authorized teachers. Sign in with your teacher Google account.", [signInButton(), homeButton()]);
    else if (d.why === "student-view") show("Student view is on", "You are viewing the site as a student. Press “Exit student view” on the Teacher Center to return to your teacher account.", back);
    else if (d.why === "other-class") show("Class not assigned", "This class is not assigned to your teacher account.", back);
    else if (d.why === "admin-only" || d.why === "b3-only") show("Not available", "This page is not available to your account.", [{ label: "Sign in with a different account", onClick: function () { var a = window.B3SiteSettings; if (a && a.signOut) Promise.resolve(a.signOut()).then(function () { location.reload(); }); } }, homeButton()]);
    else show("Teachers only", "This Google account is not an authorized Fun Torah Tools teacher. Sign in with your teacher account.", [signInButton(), homeButton()]);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var t = document.createElement("script"); t.src = src; t.onload = resolve;
      t.onerror = function () { reject(new Error("Could not load " + src)); };
      document.head.appendChild(t);
    });
  }
  function ensureLib(test, file) {
    if (test()) return Promise.resolve();
    return loadScript("https://www.gstatic.com/firebasejs/12.15.0/" + file).catch(function () { return loadScript(BASE + "vendor/firebase/12.15.0/" + file); });
  }
  function ensureSiteSettings() {
    if (window.B3SiteSettings && window.B3SiteSettings.onAuthStateChanged) return Promise.resolve();
    return ensureLib(function () { return !!(window.firebase && window.firebase.initializeApp); }, "firebase-app-compat.js")
      .then(function () { return ensureLib(function () { return !!(window.firebase && window.firebase.auth); }, "firebase-auth-compat.js"); })
      .then(function () { return ensureLib(function () { return !!(window.firebase && window.firebase.database); }, "firebase-database-compat.js"); })
      .then(function () { return window.B3_FIREBASE_CONFIG ? null : loadScript(BASE + "firebase-config.js"); })
      .then(function () { return loadScript(BASE + "site-settings.js"); });
  }
  // Some tools rebuild the whole body while they start; keep the card in place until access is confirmed.
  function watchBody() {
    if (!document.body || typeof MutationObserver !== "function") return;
    new MutationObserver(function () {
      if (stage !== "allowed" && !(gateEl && gateEl.isConnected) && lastShown) show(lastShown.t, lastShown.m, lastShown.b);
    }).observe(document.body, { childList: true });
  }
  function start() {
    watchBody();
    show("Checking your teacher account…", "One moment.", []);
    var failTimer = setTimeout(function () {
      if (stage === "checking") show("Could not check your access", "Please reload the page. Teacher tools stay closed until access is confirmed.", [{ label: "Reload", onClick: function () { location.reload(); } }, homeButton()]);
    }, 20000);
    ensureSiteSettings().then(function () {
      var api = window.B3SiteSettings;
      if (!api || !api.onAuthStateChanged) throw new Error("Access check unavailable");
      api.onAuthStateChanged(function (user, authorized, access) { clearTimeout(failTimer); onDecision(user, authorized, access); });
    }).catch(function () {
      show("Could not check your access", "Please reload the page. Teacher tools stay closed until access is confirmed.", [{ label: "Reload", onClick: function () { location.reload(); } }, homeButton()]);
    });
  }
  // A page restored from the back/forward cache must be re-checked, not shown from memory.
  window.addEventListener("pageshow", function (event) { if (event.persisted) location.reload(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
