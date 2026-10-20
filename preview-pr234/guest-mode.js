/*
 * Guest Mode: a tour and preview of Fun Torah Tools. It is NOT a login.
 *
 * One flag (sessionStorage "b3Games_guest") is checked by every page through
 * window.B3Guest. While it is on:
 *   - every database write, server POST and beacon is blocked in the browser,
 *     so nothing a guest does can reach Firebase or the backend;
 *   - a "Guest Mode - Sign in" banner (with Exit) shows on every page;
 *   - pages marked data-guest="block" (admin, teacher, sync) are replaced by a
 *     "not available for guests" screen;
 *   - tools use B3Guest.allow(toolId, limit) to give a few sample items, then
 *     B3Guest.unlock(...) shows the friendly "Sign in to unlock" message.
 * Guests never get a student id, so they cannot appear in rosters or reports.
 */
(function () {
  "use strict";
  var FLAG = "b3Games_guest";

  // Keep the live weekly Lamdan draft current even when an older browser draft exists.
  // The weekly-quiz Lamdan page stores drafts in localStorage, so seed only the
  // current week's two class keys and leave all other saved drafts untouched.
  if (/\/weekly-quiz\/chossid-lamdan\.html$/i.test(location.pathname)) {
    try {
      var lamdanKey = "b3-chossid-lamdan-drafts-v1";
      var lamdanDrafts = JSON.parse(localStorage.getItem(lamdanKey) || "{}") || {};
      lamdanDrafts["et|2026-10-15"] = {
        name: "Parshas Noach",
        description: "Weekly A Chossid is a Lamdan mark for Parshas Noach.",
        students: {
          "Chaikin Mayer Chaim": {mark:"100", comment:"Outstanding week — excellent participation, effort, and responsibility!"},
          "Gourarie Yossi": {mark:"98", comment:"Excellent participation and effort this week!"},
          "Huebner Sholom DovBer": {mark:"95", comment:"Very nice participation and effort this week!"},
          "Lapine Moshe": {mark:"94", comment:"Very good effort and participation this week!"},
          "Notik Kehos": {mark:"99", comment:"Excellent class involvement and effort this week!"},
          "Oirechman Yisroel": {mark:"99", comment:"Excellent participation and effort this week!"},
          "Raichman Moshe Tuvia": {mark:"96", comment:"Great class involvement and effort this week!"},
          "Rosenfeld Avrohom": {mark:"98", comment:"Excellent participation and effort this week!"},
          "Rozmarin Levi": {mark:"97", comment:"Great effort and participation this week!"},
          "Traxler Arik": {mark:"95", comment:"Very nice participation and effort this week!"}
        }
      };
      lamdanDrafts["wt|2026-10-15"] = {
        name: "Parshas Noach",
        description: "Weekly A Chossid is a Lamdan mark for Parshas Noach.",
        students: {
          "Greenberg Ari": {mark:"100", comment:"Outstanding week — excellent participation, effort, and responsibility!"},
          "Rosenfeld Zev": {mark:"94", comment:"Very good class involvement and effort this week!"},
          "Schtroks Levi": {mark:"98", comment:"Excellent participation and effort this week!"},
          "Simmonds Yisroel Aryeh": {mark:"99", comment:"Excellent effort and class involvement this week!"},
          "Vogel Leibel": {mark:"96", comment:"Great participation and effort this week!"},
          "Wolf Yisroel Arye Leib": {mark:"100", comment:"Outstanding week — excellent effort and responsibility!"}
        }
      };
      localStorage.setItem(lamdanKey, JSON.stringify(lamdanDrafts));
    } catch (e) {}
  }

  var loader = document.currentScript;
  var rootBase = loader && loader.src ? new URL("./", loader.src) : new URL("./", location.href);
  var homeHref = new URL("index.html", rootBase).href;

  // Everything that identifies a real student; wiped when guest mode starts.
  var STUDENT_KEYS = ["b3Games_studentId", "b3Games_studentName", "b3Games_studentClass",
    "b3Games_classPin", "posukPractice_studentId", "posukPractice_studentName", "weeklyQuiz_classId"];

  function read() { try { return sessionStorage.getItem(FLAG) === "1"; } catch (e) { return false; } }
  var on = read();

  // Eastern wall-clock time automatically follows daylight saving time.
  function isAvailable(now) {
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", weekday: "short", hour: "2-digit",
      minute: "2-digit", hourCycle: "h23"
    }).formatToParts(now || new Date());
    var values = {};
    parts.forEach(function (p) { values[p.type] = p.value; });
    var minutes = Number(values.hour) * 60 + Number(values.minute);
    return !( ["Mon", "Tue", "Wed", "Thu"].indexOf(values.weekday) >= 0 &&
      minutes >= 525 && minutes < 1080 );
  }
  function enforceSchedule() {
    var available = isAvailable();
    var button = document.getElementById("exploreGuestBtn");
    if (button) {
      button.disabled = !available;
      button.textContent = available ? "👀 Explore as Guest" : "Guest mode closed until 6:00 PM ET";
      button.title = "Guest mode is closed Monday–Thursday, 8:45 AM–6:00 PM Eastern time.";
    }
    if (!available && (on || read())) {
      stop();
      location.replace(homeHref);
    }
    return available;
  }
  enforceSchedule();
  document.addEventListener("DOMContentLoaded", enforceSchedule);
  window.addEventListener("focus", enforceSchedule);
  document.addEventListener("visibilitychange", enforceSchedule);
  setInterval(enforceSchedule, 1000);

  function start() {
    if (!enforceSchedule()) return false;
    try {
      STUDENT_KEYS.forEach(function (k) { sessionStorage.removeItem(k); });
      sessionStorage.removeItem("b3TeacherBypass");
      sessionStorage.setItem(FLAG, "1");
    } catch (e) {}
    on = true;
    if (api.activate) api.activate();
    return true;
  }
  function stop() {
    try {
      sessionStorage.removeItem(FLAG);
      Object.keys(sessionStorage).filter(function (k) { return k.indexOf("b3GuestUse_") === 0; })
        .forEach(function (k) { sessionStorage.removeItem(k); });
    } catch (e) {}
    on = false;
    var b = document.getElementById("b3GuestBanner");
    if (b) b.remove();
  }

  var api = window.B3Guest = {
    isGuest: function () { return on; },
    isAvailable: isAvailable,
    start: start,
    stop: stop,
    exit: function () { stop(); location.href = homeHref; },
    homeHref: homeHref
  };
  // Everything below only runs once guest mode is on (at load, or when start() is called).
  var activated = false;
  function activate() {
  if (activated) return;
  activated = true;

  /* ---- 1. Nothing is saved ------------------------------------------------ */
  var blockedCount = 0;
  function noteBlocked(what) {
    blockedCount++;
    api.blockedWrites = blockedCount;
    try { console.info("[Guest Mode] blocked " + what + " (" + blockedCount + " so far)"); } catch (e) {}
  }
  api.blockedWrites = 0;

  function patchFirebase() {
    var fb = window.firebase;
    if (!fb || !fb.database || !fb.database.Reference || fb.database.Reference.__b3Guest) return !!(fb && fb.database && fb.database.Reference && fb.database.Reference.__b3Guest);
    var Ref = fb.database.Reference.prototype;
    ["set", "update", "remove", "setPriority", "setWithPriority", "transaction"].forEach(function (name) {
      if (typeof Ref[name] !== "function") return;
      var orig = Ref[name];
      Ref[name] = function () {
        if (!on) return orig.apply(this, arguments);
        noteBlocked("database " + name);
        var done = arguments[1];
        if (name === "transaction" && typeof arguments[1] === "function") { try { arguments[1](null, false, null); } catch (e) {} }
        return Promise.resolve(name === "transaction" ? { committed: false, snapshot: null } : undefined);
      };
    });
    // push() makes a key and then writes; keep the key but write nothing.
    var origPush = Ref.push;
    if (typeof origPush === "function") {
      Ref.push = function (value, cb) {
        if (!on) return origPush.apply(this, arguments);
        noteBlocked("database push");
        var child = origPush.call(this); // no value => only a local key, no network write
        var p = Promise.resolve(child);
        child.then = p.then.bind(p); child.catch = p.catch.bind(p);
        if (typeof cb === "function") { try { cb(null); } catch (e) {} }
        return child;
      };
    }
    if (fb.database.OnDisconnect) {
      ["set", "update", "remove", "setWithPriority"].forEach(function (name) {
        var D = fb.database.OnDisconnect.prototype;
        var origD = D[name];
        if (typeof origD === "function") D[name] = function () { if (!on) return origD.apply(this, arguments); noteBlocked("onDisconnect " + name); return Promise.resolve(); };
      });
    }
    fb.database.Reference.__b3Guest = true;
    return true;
  }
  // File uploads (recordings, drawings) are writes too.
  function patchStorage() {
    var fb = window.firebase;
    if (!fb || !fb.storage || !fb.storage.Reference || fb.storage.Reference.__b3Guest) return !!(fb && fb.storage && fb.storage.Reference && fb.storage.Reference.__b3Guest);
    var S = fb.storage.Reference.prototype;
    ["put", "putString", "delete", "updateMetadata"].forEach(function (name) {
      var orig = S[name];
      if (typeof orig !== "function") return;
      S[name] = function () {
        if (!on) return orig.apply(this, arguments);
        noteBlocked("storage " + name);
        return Promise.reject(new Error("Guest Mode: uploads are not saved."));
      };
    });
    fb.storage.Reference.__b3Guest = true;
    return true;
  }
  // Pages load Firebase at different moments, so keep trying until it is patched.
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    patchFirebase(); patchStorage();
    if (tries > 400) clearInterval(timer);
  }, 25);
  patchFirebase(); patchStorage();
  document.addEventListener("DOMContentLoaded", function () { patchFirebase(); patchStorage(); });
  window.addEventListener("load", function () { patchFirebase(); patchStorage(); });

  // Server calls: guests may only read. Any POST/PUT/PATCH/DELETE is refused.
  var origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
      if (on && method !== "GET" && method !== "HEAD") {
        noteBlocked("fetch " + method);
        var now = Date.now();
        if (now - (api.lastNudge || 0) > 8000) {
          api.lastNudge = now;
          api.unlock("Sign in to unlock", "Recording, scoring, answers and rewards need a signed-in student. You are previewing as a guest.");
        }
        return Promise.resolve(new Response(JSON.stringify({ error: "guest_mode", message: "Sign in to unlock this." }),
          { status: 403, headers: { "Content-Type": "application/json" } }));
      }
      return origFetch.apply(this, arguments);
    };
  }
  if (window.XMLHttpRequest) {
    var origOpen = XMLHttpRequest.prototype.open, origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method) {
      this.__b3GuestBlocked = !/^(GET|HEAD)$/i.test(String(method));
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      if (on && this.__b3GuestBlocked) { noteBlocked("xhr"); try { this.abort(); } catch (e) {} return; }
      return origSend.apply(this, arguments);
    };
  }
  if (navigator.sendBeacon) {
    var origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function () { if (!on) return origBeacon.apply(null, arguments); noteBlocked("beacon"); return true; };
  }

  /* ---- 2. Friendly "Sign in to unlock" popup ------------------------------ */
  function el(tag, css, html) {
    var n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  var FONT = "font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;";

  api.unlock = function (title, message) {
    var old = document.getElementById("b3GuestUnlock");
    if (old) old.remove();
    var wrap = el("div", "position:fixed;inset:0;z-index:2147483600;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:20px;" + FONT);
    wrap.id = "b3GuestUnlock";
    var card = el("div", "max-width:440px;width:100%;background:#fff;border-radius:20px;padding:28px 26px;text-align:center;box-shadow:0 18px 45px rgba(0,0,0,.3);color:#1f2937");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.innerHTML = '<div style="font-size:48px">🔓</div>' +
      '<h2 style="margin:8px 0 10px;font-size:24px">' + esc(title || "Sign in to unlock") + '</h2>' +
      '<p style="margin:0 0 20px;font-size:17px;line-height:1.5;color:#4b5563">' + esc(message || "This part is for signed-in students and teachers. You are previewing as a guest.") + '</p>';
    var row = el("div", "display:flex;gap:10px;justify-content:center;flex-wrap:wrap");
    var signIn = el("button", "padding:12px 20px;border:0;border-radius:12px;background:#2563eb;color:#fff;font:700 16px system-ui;cursor:pointer", "Sign in");
    signIn.type = "button";
    signIn.onclick = api.exit;
    var keep = el("button", "padding:12px 20px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;color:#1f2937;font:700 16px system-ui;cursor:pointer", "Keep exploring");
    keep.type = "button";
    keep.onclick = function () { wrap.remove(); };
    row.appendChild(signIn); row.appendChild(keep); card.appendChild(row); wrap.appendChild(card);
    wrap.addEventListener("click", function (e) { if (e.target === wrap) wrap.remove(); });
    (document.body || document.documentElement).appendChild(wrap);
    keep.focus();
  };

  /* Per-tool sample allowance. Stored only in this tab; never in the database. */
  api.used = function (toolId) {
    try { return parseInt(sessionStorage.getItem("b3GuestUse_" + toolId) || "0", 10) || 0; } catch (e) { return 0; }
  };
  // Returns true if the guest may use one more sample item, and counts it.
  api.allow = function (toolId, limit, label) {
    var n = api.used(toolId);
    if (n >= limit) {
      api.unlock("Sign in to unlock", "You tried the " + limit + " free sample " + (label || "items") + ". Sign in to keep going.");
      return false;
    }
    try { sessionStorage.setItem("b3GuestUse_" + toolId, String(n + 1)); } catch (e) {}
    return true;
  };

  // Counts distinct items (e.g. "1:3" = perek 1 posuk 3) in this tab only.
  // Returns true if every key was already tried or there is room for the new ones.
  api.allowItems = function (toolId, keys, limit, label) {
    var seen = [];
    try { seen = JSON.parse(sessionStorage.getItem("b3GuestUse_" + toolId) || "[]"); } catch (e) {}
    var fresh = keys.filter(function (k) { return seen.indexOf(k) < 0; });
    if (seen.length + fresh.length > limit) {
      api.unlock("Sign in to unlock", "You tried the " + limit + " free sample " + (label || "items") + ". Sign in to keep going.");
      return false;
    }
    try { sessionStorage.setItem("b3GuestUse_" + toolId, JSON.stringify(seen.concat(fresh))); } catch (e) {}
    return true;
  };

  /* ---- 3. Pages guests may never open ------------------------------------- */
  var script = loader;
  var blockPage = script && script.getAttribute("data-guest") === "block";
  if (blockPage) {
    document.documentElement.style.visibility = "hidden";
    var showBlocked = function () {
      var html = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#f5f7fa;' + FONT + '">' +
        '<div style="max-width:460px;background:#fff;border-radius:22px;padding:36px 30px;text-align:center;box-shadow:0 18px 45px rgba(0,0,0,.16);color:#1f2937">' +
        '<div style="font-size:54px">🔒</div><h1 style="margin:10px 0;font-size:28px">Not available in Guest Mode</h1>' +
        '<p style="font-size:17px;line-height:1.5;color:#4b5563">This page is only for signed-in teachers. Guests can explore the student tools.</p>' +
        '<button id="b3GuestBlockBack" type="button" style="margin-top:10px;padding:12px 20px;border:0;border-radius:12px;background:#1f2937;color:#fff;font:700 16px system-ui;cursor:pointer">Back to the tour</button></div></div>';
      var body = document.body || document.documentElement;
      // Stop the real page: remove everything, including its scripts' targets.
      while (body.firstChild) body.removeChild(body.firstChild);
      body.innerHTML = html;
      document.getElementById("b3GuestBlockBack").onclick = function () { location.href = homeHref; };
      document.documentElement.style.visibility = "visible";
      try { window.stop(); } catch (e) {}
    };
    if (document.body) showBlocked(); else document.addEventListener("DOMContentLoaded", showBlocked);
  }

  /* ---- 4. Guest banner ----------------------------------------------------- */
  function banner() {
    if (document.getElementById("b3GuestBanner") || window.top !== window) return;
    var bar = el("div", "position:sticky;top:0;left:0;right:0;z-index:2147483500;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;padding:8px 12px;background:#fef3c7;border-bottom:2px solid #f59e0b;color:#78350f;" + FONT + "font-size:15px;font-weight:700;text-align:center");
    bar.id = "b3GuestBanner";
    bar.innerHTML = '<span>👀 Guest Mode – nothing you do here is saved</span>';
    var signIn = el("a", "color:#1d4ed8;text-decoration:underline;cursor:pointer", "Sign in");
    signIn.href = homeHref;
    signIn.onclick = function (e) { e.preventDefault(); api.exit(); };
    var exit = el("button", "padding:5px 12px;border:1px solid #b45309;border-radius:999px;background:#fff;color:#78350f;font:700 14px system-ui;cursor:pointer", "Exit guest mode");
    exit.type = "button";
    exit.onclick = api.exit;
    bar.appendChild(signIn); bar.appendChild(exit);
    var body = document.body;
    body.insertBefore(bar, body.firstChild);
  }
  if (document.body) banner(); else document.addEventListener("DOMContentLoaded", banner);
  // Pages that rebuild the body get the banner back.
  setInterval(function () { if (document.body) banner(); }, 2000);

  /* ---- 5. Homepage tour --------------------------------------------------- */
  // Steps are {selector, title, text}; the page supplies them with B3Guest.tour().
  api.tour = function (steps) {
    steps = steps.filter(function (s) { var t = document.querySelector(s.selector); return t && !t.classList.contains("hidden"); });
    if (!steps.length) return;
    var i = 0, ring = null, box = null;
    function close() {
      if (ring) ring.remove(); if (box) box.remove();
      window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true);
      try { sessionStorage.setItem("b3GuestTourDone", "1"); } catch (e) {}
    }
    function place() {
      var target = document.querySelector(steps[i].selector);
      if (!target) return;
      var r = target.getBoundingClientRect(), pad = 8;
      ring.style.cssText = "position:fixed;z-index:2147483300;pointer-events:none;border:3px solid #2563eb;border-radius:14px;box-shadow:0 0 0 9999px rgba(15,23,42,.55);" +
        "left:" + (r.left - pad) + "px;top:" + (r.top - pad) + "px;width:" + (r.width + pad * 2) + "px;height:" + (r.height + pad * 2) + "px;transition:all .25s";
      var below = r.bottom + 14 + 190 < window.innerHeight;
      var bw = Math.min(380, window.innerWidth - 24);
      var left = Math.max(12, Math.min(r.left, window.innerWidth - bw - 12));
      box.style.cssText = "position:fixed;z-index:2147483400;background:#fff;border-radius:16px;padding:18px 20px;width:" + bw + "px;box-sizing:border-box;box-shadow:0 12px 34px rgba(0,0,0,.35);color:#1f2937;" + FONT +
        "left:" + left + "px;" + (below ? "top:" + (r.bottom + 14) + "px" : "bottom:" + Math.max(12, window.innerHeight - r.top + 14) + "px");
    }
    function show() {
      var s = steps[i];
      var target = document.querySelector(s.selector);
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      box.innerHTML = '<div style="font-size:13px;color:#6b7280;font-weight:700">Step ' + (i + 1) + ' of ' + steps.length + '</div>' +
        '<h3 style="margin:4px 0 6px;font-size:20px">' + esc(s.title) + '</h3>' +
        '<p style="margin:0 0 14px;font-size:16px;line-height:1.45;color:#374151">' + esc(s.text) + '</p>';
      var row = el("div", "display:flex;gap:8px;align-items:center");
      function btn(label, bg, fg, border, fn, disabled) {
        var b = el("button", "padding:9px 15px;border-radius:10px;border:" + border + ";background:" + bg + ";color:" + fg + ";font:700 15px system-ui;cursor:pointer" + (disabled ? ";opacity:.4;cursor:default" : ""), label);
        b.type = "button"; b.disabled = !!disabled; b.onclick = fn; return b;
      }
      row.appendChild(btn("Back", "#fff", "#1f2937", "1px solid #cbd5e1", function () { i--; show(); }, i === 0));
      row.appendChild(btn(i === steps.length - 1 ? "Finish" : "Next", "#2563eb", "#fff", "0", function () { if (i === steps.length - 1) close(); else { i++; show(); } }));
      var skip = btn("Skip", "transparent", "#6b7280", "0", close);
      skip.style.marginLeft = "auto";
      row.appendChild(skip);
      box.appendChild(row);
      setTimeout(place, 50); setTimeout(place, 400);
    }
    ring = el("div"); box = el("div");
    ring.id = "b3GuestTourRing"; box.id = "b3GuestTourBox";
    box.setAttribute("role", "dialog");
    document.body.appendChild(ring); document.body.appendChild(box);
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    show();
  };
  }
  if (on) activate();
  api.activate = activate;
})();
