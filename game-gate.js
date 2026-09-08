/*
 * B3 student access gate — ET/WT aware
 *
 * Existing student pages already include this file. This version makes the
 * page use the SAME b3Games/siteSettings record as the B3 homepage, including:
 *   - Emergency master access (siteEnabled)
 *   - Individual activity switches
 *   - ET / WT Automatic, Unlock Now, Lock Now
 *   - Rabbi Cohen's New York automatic lock schedule
 *
 * It re-checks Firebase while the page remains open, so a teacher override
 * takes effect without requiring a new tab or a new login.
 */
(function () {
  "use strict";

  var DATABASE_URL = "https://b3-games-default-rtdb.firebaseio.com";
  var SETTINGS_PATH = "b3Games/siteSettings";
  var TIME_ZONE = "America/New_York";
  var POLL_INTERVAL_MS = 5000;

  var scriptEl = document.currentScript;
  var gameId = scriptEl && (scriptEl.getAttribute("data-game-id") || scriptEl.getAttribute("data-b3-tool-id"));
  if (!gameId) {
    console.warn("B3 game gate: missing data-game-id; skipping access check.");
    return;
  }

  var rootBase = new URL("./", scriptEl.src);
  var backHref = (scriptEl && scriptEl.getAttribute("data-back-href")) || new URL("index.html", rootBase).href;

  var ET_ROSTER = [
    "chaim_chaikin", "mayer_chaim_chaikin", "yossi_gourarie", "sholom_huebner", "sholom_dovber_huebner",
    "moshe_lapine", "kehos_notik", "yisroel_oirechman", "moshe_raichman", "moshe_tuvia_raichman",
    "avrohom_rosenfeld", "levi_rozmarin", "arik_traxler"
  ];
  var WT_ROSTER = [
    "ari_greenberg", "zev_rosenfeld", "levi_schtroks", "yisroel_aryeh_simmonds", "leibel_vogel", "leib_wolf"
  ];

  var DEFAULT_LOCKS = {
    et: {
      mon: [{start:"08:45",end:"12:00"},{start:"12:45",end:"15:15"}],
      tue: [{start:"08:45",end:"12:00"},{start:"12:45",end:"15:15"}],
      wed: [{start:"08:45",end:"12:00"},{start:"12:45",end:"15:15"}],
      thu: [{start:"08:45",end:"12:00"},{start:"12:45",end:"15:15"}],
      fri: [], sat: [], sun: []
    },
    wt: {
      mon: [{start:"12:20",end:"15:35"},{start:"16:15",end:"18:45"}],
      tue: [{start:"12:20",end:"15:35"},{start:"16:15",end:"18:45"}],
      wed: [{start:"12:20",end:"15:35"},{start:"16:15",end:"18:45"}],
      thu: [{start:"12:20",end:"15:35"},{start:"16:15",end:"18:45"}],
      fri: [], sat: [], sun: []
    }
  };

  var hideStyle = document.createElement("style");
  hideStyle.id = "b3-gate-hide-style";
  hideStyle.textContent = "html{visibility:hidden !important;}";
  (document.head || document.documentElement).appendChild(hideStyle);

  var overlay = null;
  var lastSettings = null;
  var studentClassId = "";
  var classResolved = false;
  var requestInFlight = false;

  function reveal() {
    var el = document.getElementById("b3-gate-hide-style");
    if (el && el.parentNode) el.parentNode.removeChild(el);
    document.documentElement.style.visibility = "visible";
  }

  function removeOverlay() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
  }

  function showOpen() {
    reveal();
    removeOverlay();
  }

  function showClosed(title, message) {
    reveal();
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "b3-gate-overlay";
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:#f5f7fa;" +
        "display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;" +
        "text-align:center;padding:24px;color:#1f2937;";
      overlay.innerHTML =
        '<div style="max-width:560px;background:white;border-radius:22px;padding:38px 32px;box-shadow:0 18px 45px rgba(0,0,0,.16)">' +
          '<div style="font-size:58px;margin-bottom:14px">🔒</div>' +
          '<h1 id="b3GateTitle" style="margin:0 0 12px;font-size:32px"></h1>' +
          '<p id="b3GateMessage" style="margin:0 0 24px;font-size:18px;line-height:1.5;color:#4b5563"></p>' +
          '<a href="' + String(backHref).replace(/&/g,"&amp;").replace(/"/g,"&quot;") + '" style="display:inline-block;padding:12px 20px;border-radius:12px;background:#1f2937;color:white;text-decoration:none;font-weight:700">Back to B3 Games</a>' +
        '</div>';
      (document.body || document.documentElement).appendChild(overlay);
    }
    var t = overlay.querySelector("#b3GateTitle");
    var m = overlay.querySelector("#b3GateMessage");
    if (t) t.textContent = title || "B3 Games is locked";
    if (m) m.textContent = message || "Your class cannot use this activity right now.";
  }

  function storedTeacherBypass() {
    return localStorage.getItem("b3TeacherBypass") === "1";
  }

  function getStoredStudentId() {
    return localStorage.getItem("b3Games_studentId") || localStorage.getItem("posukPractice_studentId") || "";
  }

  function getStoredClass() {
    var c = localStorage.getItem("b3Games_studentClass") || localStorage.getItem("weeklyQuiz_classId") || "";
    return c === "et" || c === "wt" ? c : "";
  }

  function rosterClass(studentId) {
    if (ET_ROSTER.indexOf(studentId) !== -1) return "et";
    if (WT_ROSTER.indexOf(studentId) !== -1) return "wt";
    return "";
  }

  function fetchJson(url) {
    var sep = url.indexOf("?") >= 0 ? "&" : "?";
    return fetch(url + sep + "_=" + Date.now(), { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  function resolveStudentClass() {
    if (classResolved) return Promise.resolve(studentClassId);

    studentClassId = getStoredClass();
    if (studentClassId) {
      classResolved = true;
      return Promise.resolve(studentClassId);
    }

    var studentId = getStoredStudentId();
    if (!studentId) {
      classResolved = true;
      return Promise.resolve("");
    }

    var fallback = rosterClass(studentId);
    var url = DATABASE_URL + "/posukPractice/allowedStudents/" + encodeURIComponent(studentId) + ".json";
    return fetchJson(url).then(function (data) {
      var c = data && (data.classId === "et" || data.classId === "wt") ? data.classId : fallback;
      studentClassId = c || "";
      if (studentClassId) {
        localStorage.setItem("b3Games_studentClass", studentClassId);
        localStorage.setItem("weeklyQuiz_classId", studentClassId);
      }
      classResolved = true;
      return studentClassId;
    }).catch(function () {
      studentClassId = fallback;
      if (studentClassId) {
        localStorage.setItem("b3Games_studentClass", studentClassId);
        localStorage.setItem("weeklyQuiz_classId", studentClassId);
      }
      classResolved = true;
      return studentClassId;
    });
  }

  function timeToMinutes(value) {
    var p = String(value || "").split(":");
    return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0);
  }

  function nyNow() {
    var f = new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
    var parts = {};
    f.formatToParts(new Date()).forEach(function (p) { if (p.type !== "literal") parts[p.type] = p.value; });
    var map = {Sun:"sun",Mon:"mon",Tue:"tue",Wed:"wed",Thu:"thu",Fri:"fri",Sat:"sat"};
    return { day: map[parts.weekday] || "sun", minutes: (Number(parts.hour)||0)*60 + (Number(parts.minute)||0) };
  }

  function inRange(minutes, r) {
    if (!r || !r.start || !r.end) return false;
    var s = timeToMinutes(r.start), e = timeToMinutes(r.end);
    if (s === e) return true;
    return s < e ? (minutes >= s && minutes < e) : (minutes >= s || minutes < e);
  }

  function classIsOpen(settings, classId) {
    var access = settings && settings.classAccess && settings.classAccess[classId] ? settings.classAccess[classId] : null;
    var mode = access && (access.mode === "open" || access.mode === "locked" || access.mode === "auto") ? access.mode : "auto";

    if (mode === "open") return { open:true, reason:"Manual override: OPEN" };
    if (mode === "locked") return { open:false, reason:"Manual override: LOCKED" };

    var locks = access && access.lockWindows ? access.lockWindows : DEFAULT_LOCKS[classId];
    var now = nyNow();
    var ranges = locks && Array.isArray(locks[now.day]) ? locks[now.day] : [];
    var locked = ranges.some(function (r) { return inRange(now.minutes, r); });
    return { open:!locked, reason:locked ? "Automatic schedule: LOCKED" : "Automatic schedule: open" };
  }

  function decide(settings) {
    lastSettings = settings || lastSettings || {};

    if (storedTeacherBypass()) {
      showOpen();
      return;
    }

    if (lastSettings.siteEnabled === false) {
      showClosed("B3 Games is closed", "The emergency master access switch is off. Rabbi Cohen must turn it back on.");
      return;
    }

    if (lastSettings.games && lastSettings.games[gameId] === false) {
      showClosed("This activity is turned off", "This individual activity is disabled in Teacher Tools. Class Unlock Now does not override an activity that is switched off.");
      return;
    }

    if (!studentClassId) {
      showClosed("Please sign in first", "Go back to B3 Games and sign in with your name and Class PIN so the site knows whether you are in ET or WT.");
      return;
    }

    var info = classIsOpen(lastSettings, studentClassId);
    if (info.open) {
      showOpen();
    } else {
      showClosed((studentClassId === "et" ? "ET" : "WT") + " is locked right now", "Rabbi Cohen can press Unlock Now for your class. This page checks again every few seconds.");
    }
  }

  function checkNow() {
    if (requestInFlight) return;
    requestInFlight = true;

    resolveStudentClass().then(function () {
      return fetchJson(DATABASE_URL + "/" + SETTINGS_PATH + ".json");
    }).then(function (settings) {
      decide(settings || {});
    }).catch(function (err) {
      console.warn("B3 game gate could not refresh settings:", err);
      // If we have already successfully read settings, keep the last known
      // decision instead of suddenly changing access on a brief network error.
      if (lastSettings) decide(lastSettings);
      else {
        // First-load network failure: do not falsely tell the student the
        // teacher locked the site. Let the page open and retry shortly.
        showOpen();
      }
    }).finally(function () {
      requestInFlight = false;
    });
  }

  checkNow();
  setInterval(checkNow, POLL_INTERVAL_MS);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") checkNow();
  });
  window.addEventListener("focus", checkNow);
})();
