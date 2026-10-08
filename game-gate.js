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
  // Phase 1: identify the whole B3 classroom without changing the live
  // settings path yet. Existing ET/WT values remain the within-class tracks.
  var WORKSPACE_ID = "b3-2026";
  try {
    WORKSPACE_ID = sessionStorage.getItem("b3Games_workspaceId") || WORKSPACE_ID;
    sessionStorage.setItem("b3Games_workspaceId", WORKSPACE_ID);
  } catch (error) {}
  window.B3_WORKSPACE_ID = WORKSPACE_ID;
  var TIME_ZONE = "America/New_York";
  var POLL_INTERVAL_MS = 5000;
  var FETCH_TIMEOUT_MS = 4500;
  var FIRST_LOAD_FAILSAFE_MS = 5500;

  var scriptEl = document.currentScript;
  var gameId = scriptEl && (scriptEl.getAttribute("data-game-id") || scriptEl.getAttribute("data-b3-tool-id"));
  if (!gameId) {
    console.warn("B3 game gate: missing data-game-id; skipping access check.");
    return;
  }

  var rootBase = new URL("./", scriptEl.src);
  var backHref = (scriptEl && scriptEl.getAttribute("data-back-href")) || new URL("index.html", rootBase).href;

  // Student rosters are intentionally not embedded in application code.

  // Master Schedule 5787 / 2026-2027.
  // B3 Games is open by default and is automatically locked during class time.
  // ET opens 2 minutes after each 10-minute recess starts; WT opens immediately.
  var DEFAULT_LOCKS = {
    et: {
      mon: [{start:"08:45",end:"10:17"},{start:"10:25",end:"11:07"},{start:"11:15",end:"12:00"},{start:"12:45",end:"13:32"},{start:"13:40",end:"14:27"},{start:"14:35",end:"15:15"}],
      tue: [{start:"08:45",end:"10:17"},{start:"10:25",end:"11:07"},{start:"11:15",end:"12:00"},{start:"12:45",end:"13:32"},{start:"13:40",end:"14:27"},{start:"14:35",end:"15:15"}],
      wed: [{start:"08:45",end:"10:17"},{start:"10:25",end:"11:07"},{start:"11:15",end:"12:00"},{start:"12:45",end:"13:32"},{start:"13:40",end:"14:27"},{start:"14:35",end:"15:15"}],
      thu: [{start:"08:45",end:"10:17"},{start:"10:25",end:"11:07"},{start:"11:15",end:"12:00"},{start:"12:45",end:"13:32"},{start:"13:40",end:"14:27"},{start:"14:35",end:"15:15"}],
      fri: [{start:"08:45",end:"10:17"},{start:"10:25",end:"11:07"},{start:"11:15",end:"12:00"}], sat: [], sun: []
    },
    wt: {
      mon: [{start:"12:20",end:"13:50"},{start:"14:00",end:"14:45"},{start:"14:55",end:"15:35"},{start:"16:15",end:"17:00"},{start:"17:10",end:"17:55"},{start:"18:05",end:"18:45"}],
      tue: [{start:"12:20",end:"13:50"},{start:"14:00",end:"14:45"},{start:"14:55",end:"15:35"},{start:"16:15",end:"17:00"},{start:"17:10",end:"17:55"},{start:"18:05",end:"18:45"}],
      wed: [{start:"12:20",end:"13:50"},{start:"14:00",end:"14:45"},{start:"14:55",end:"15:35"},{start:"16:15",end:"17:00"},{start:"17:10",end:"17:55"},{start:"18:05",end:"18:45"}],
      thu: [{start:"12:20",end:"13:50"},{start:"14:00",end:"14:45"},{start:"14:55",end:"15:35"},{start:"16:15",end:"17:00"},{start:"17:10",end:"17:55"},{start:"18:05",end:"18:45"}],
      fri: [{start:"11:00",end:"12:30"},{start:"12:40",end:"13:25"},{start:"13:35",end:"14:15"}], sat: [], sun: []
    }
  };

  // Previous untouched defaults, used only for automatic migration. If the
  // teacher customized the old schedule, those custom times remain respected.
  var PREVIOUS_DEFAULT_LOCKS = {
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

  function lockSchedulesEqual(a, b) {
    var days = ["sun","mon","tue","wed","thu","fri","sat"];
    return days.every(function (day) {
      var aa = a && Array.isArray(a[day]) ? a[day] : [];
      var bb = b && Array.isArray(b[day]) ? b[day] : [];
      if (aa.length !== bb.length) return false;
      return aa.every(function (r, i) {
        return r && bb[i] && r.start === bb[i].start && r.end === bb[i].end;
      });
    });
  }


  var hideStyle = document.createElement("style");
  hideStyle.id = "b3-gate-hide-style";
  hideStyle.textContent = "html{visibility:hidden !important;}";
  (document.head || document.documentElement).appendChild(hideStyle);

  var overlay = null;
  var lastSettings = null;
  var studentClassId = "";
  var classResolved = false;
  var studentActive = false;
  var assignedClass = null;
  var verifiedTeacherAccess = null;
  var teacherClassRecord = null;
  var requestInFlight = false;
  var firstDecisionMade = false;
  var firstLoadFailsafe = setTimeout(function () {
    if (firstDecisionMade) return;
    console.warn("B3 game gate: first access check is taking too long.");
    showClosed(
      "Still checking access…",
      "The access check is taking longer than expected. This page will keep trying automatically."
    );
  }, FIRST_LOAD_FAILSAFE_MS);

  function reveal() {
    var el = document.getElementById("b3-gate-hide-style");
    if (el && el.parentNode) el.parentNode.removeChild(el);
    document.documentElement.style.visibility = "visible";
  }

  function removeOverlay() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
  }

  function markFirstDecision() {
    firstDecisionMade = true;
    if (firstLoadFailsafe) {
      clearTimeout(firstLoadFailsafe);
      firstLoadFailsafe = null;
    }
  }

  function showOpen() {
    markFirstDecision();
    reveal();
    removeOverlay();
  }

  function showClosed(title, message) {
    document.querySelectorAll("audio,video").forEach(function(media){try{media.pause();}catch(error){}});
    markFirstDecision();
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
          '<a href="' + String(backHref).replace(/&/g,"&amp;").replace(/"/g,"&quot;") + '" style="display:inline-block;padding:12px 20px;border-radius:12px;background:#1f2937;color:white;text-decoration:none;font-weight:700">Back to Fun Torah Tools</a>' +
        '</div>';
      (document.body || document.documentElement).appendChild(overlay);
    }
    var t = overlay.querySelector("#b3GateTitle");
    var m = overlay.querySelector("#b3GateMessage");
    if (t) t.textContent = title || "Fun Torah Tools is locked";
    if (m) m.textContent = message || "Your class cannot use this activity right now.";
  }

  function storedTeacherBypass() {
    return Boolean(verifiedTeacherAccess && verifiedTeacherAccess.authorized &&
      verifiedTeacherAccess.role === "admin");
  }

  function loadOneScript(url) {
    return new Promise(function(resolve,reject){
      var script=document.createElement("script");script.src=url;
      script.onload=resolve;script.onerror=function(e){script.remove();reject(e);};document.head.appendChild(script);
    });
  }
  // If gstatic.com is blocked (some school networks), fall back to the copy hosted on this site.
  function loadAuthScript(url) {
    var m=/gstatic\.com\/firebasejs\/12\.15\.0\/(firebase-[a-z]+-compat\.js)$/.exec(url);
    return loadOneScript(url).catch(function(e){
      if(!m) throw e;
      return loadOneScript(new URL("vendor/firebase/12.15.0/"+m[1],rootBase).href);
    });
  }
  async function watchTeacherAccess() {
    try {
      // Let the page's own Firebase scripts finish before supplying missing ones.
      if(document.readyState === "loading") await new Promise(function(resolve){document.addEventListener("DOMContentLoaded",resolve,{once:true});});
      // Add missing Firebase pieces in the SAME version the page already uses.
      // Mixing versions (for example 12.x auth on a 10.x page) silently stops
      // the page's database from connecting, so nothing loads or saves.
      if(!window.firebase) await loadAuthScript("https://www.gstatic.com/firebasejs/12.15.0/firebase-app-compat.js");
      var sdk=String(window.firebase.SDK_VERSION||"12.15.0"),major=parseInt(sdk,10)||12,suffix=major>=9?"-compat.js":".js";
      var base="https://www.gstatic.com/firebasejs/"+sdk+"/firebase-";
      if(!window.firebase.auth) await loadAuthScript(base+"auth"+suffix);
      if(!window.firebase.database) await loadAuthScript(base+"database"+suffix);
      if(!window.B3_FIREBASE_CONFIG) await loadAuthScript(new URL("firebase-config.js",rootBase).href);
      if(!window.B3SiteSettings) await loadAuthScript(new URL("site-settings.js?v=20261007-act-as-student",rootBase).href);
      window.B3SiteSettings.onAuthStateChanged(function(user,authorized,access){
        verifiedTeacherAccess=authorized?access:null;checkNow();
      });
    } catch(error){console.warn("Teacher access could not be verified",error);}
  }

  function getStoredStudentId() {
    return sessionStorage.getItem("b3Games_studentId") || sessionStorage.getItem("posukPractice_studentId") || "";
  }

  function getStoredClass() {
    var c = sessionStorage.getItem("b3Games_studentClass") || sessionStorage.getItem("weeklyQuiz_classId") || "";
    return String(c || "").trim();
  }

  function fetchJson(url) {
    var sep = url.indexOf("?") >= 0 ? "&" : "?";
    var target = url + sep + "_=" + Date.now();

    // Never allow a Firebase request to hang forever. A hung request used to
    // leave the entire page hidden because the gate was waiting for a decision.
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error("Access check timed out"));
      }, FETCH_TIMEOUT_MS);

      fetch(target, { cache: "no-store" }).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      }).then(function (data) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(data);
      }).catch(function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async function resolveStudentClass() {
    var studentId=getStoredStudentId(), storedClass=getStoredClass();
    studentActive=false;assignedClass=null;studentClassId="";
    if(!studentId)return "";
    var rows=await Promise.all([
      fetchJson(DATABASE_URL+"/b3Games/students/"+encodeURIComponent(studentId)+"/profile.json"),
      fetchJson(DATABASE_URL+"/b3Games/students/"+encodeURIComponent(studentId)+"/memberships.json")
    ]);
    var profile=rows[0],memberships=rows[1]||{};
    if(profile && profile.active===false)return "";
    var valid=Object.values(memberships).filter(function(m){return m&&m.active!==false&&m.workspaceId===WORKSPACE_ID&&m.classId;});
    var match=valid.find(function(m){return m.classId===storedClass;})||(valid.length===1?valid[0]:null);
    if(match)studentClassId=String(match.classId);
    else if(!Object.keys(memberships).length){
      var legacy=await fetchJson(DATABASE_URL+"/posukPractice/allowedStudents/"+encodeURIComponent(studentId)+".json");
      if(legacy&&legacy.active!==false&&["et","wt"].includes(legacy.classId))studentClassId=legacy.classId;
    }
    if(!studentClassId)return "";
    assignedClass=await fetchJson(DATABASE_URL+"/b3Games/workspaces/"+encodeURIComponent(WORKSPACE_ID)+"/classes/"+encodeURIComponent(studentClassId)+".json");
    var member=assignedClass&&assignedClass.members&&assignedClass.members[studentId];
    if(!assignedClass||assignedClass.active===false||!member||member.active===false){studentClassId="";return "";}
    studentActive=true;
    return studentClassId;
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
    if (lockSchedulesEqual(locks, PREVIOUS_DEFAULT_LOCKS[classId])) {
      locks = DEFAULT_LOCKS[classId];
    }
    var now = nyNow();
    var ranges = locks && Array.isArray(locks[now.day]) ? locks[now.day] : [];
    var locked = ranges.some(function (r) { return inRange(now.minutes, r); });
    return { open:!locked, reason:locked ? "Automatic schedule: LOCKED" : "Automatic schedule: open" };
  }

  function studentHasGameOverride(settings) {
    var studentId = getStoredStudentId();
    if (!studentId || !settings || !settings.studentGameOverrides) return false;
    var studentMap = settings.studentGameOverrides[studentId];
    return Boolean(studentMap && studentMap[gameId] === true);
  }

  function classHasLockedGameOverride(settings, classId) {
    if (!settings || !classId || !settings.classLockedGameOverride) return false;
    return String(settings.classLockedGameOverride[classId] || "").split(",").map(function (v) { return v.trim(); }).indexOf(String(gameId || "")) !== -1;
  }

  // Match the B3 homepage's ET/WT activity switches.
  // A class-specific switch is authoritative when it exists. Older/global
  // settings.games values remain supported as a fallback for compatibility.
  function gameIsEnabledForClass(settings, classId) {
    if (!settings) return true;

    // The global activity switch is the master switch. If an activity is
    // globally inactive, no class override may reopen it.
    if (settings.games && Object.prototype.hasOwnProperty.call(settings.games, gameId) && settings.games[gameId] === false) {
      return false;
    }

    var classMap = settings.classGames && classId ? settings.classGames[classId] : null;
    if (classMap && Object.prototype.hasOwnProperty.call(classMap, gameId)) {
      return classMap[gameId] !== false;
    }

    return true;
  }

  // Shorashim also has its own internal master-site watcher. When this shared
  // gate grants a student-specific exception, keep that internal master check
  // open too. Its separate Shorashim-only lock still remains authoritative.
  function syncEmbeddedGameOverride(active) {
    if (gameId !== "shorashim" || !active) return;
    setTimeout(function () {
      try {
        if (typeof recomputeSiteOpen === "function") {
          masterSettingOpen = true;
          masterWatcherReady = true;
          recomputeSiteOpen();
        }
      } catch (err) {
        // The Shorashim app may not have finished loading yet; the next 5-second
        // gate refresh will try again.
      }
    }, 0);
  }

  function decide(settings) {
    lastSettings = settings || lastSettings || {};

    if (storedTeacherBypass()) {
      showOpen();
      return;
    }

    if(verifiedTeacherAccess&&verifiedTeacherAccess.authorized){
      var selected=new URLSearchParams(location.search).get("class")||getStoredClass();
      if(!(verifiedTeacherAccess.classIds||[]).includes(selected)){
        showClosed("Choose an assigned class", "Open this tool from your Teacher Center.");return;
      }
      // Tool grants are checked against the selected class, never another teacher's class.
      var teacherGrantId=gameId==="class-gallery"?"gallery":gameId;
      if(!teacherClassRecord||teacherClassRecord.active===false||(teacherClassRecord.toolGrants?.[teacherGrantId]!==true&&!(gameId==="class-gallery"&&(teacherClassRecord.toolGrants?.tag===true||teacherClassRecord.toolGrants?.["class-gallery"]===true)))){showClosed("Teacher class access", "This tool is not enabled for your assigned class.");return;}
      showOpen();return;
    }
    if(!studentActive){showClosed("Please sign in again", "Your student access or class membership could not be verified.");return;}
    if(studentClassId!=="et"&&studentClassId!=="wt"){
      var grantId=gameId==="class-gallery"?"gallery":gameId;
      if(!assignedClass||(assignedClass.toolGrants?.[grantId]!==true&&!(gameId==="class-gallery"&&(assignedClass.toolGrants?.tag===true||assignedClass.toolGrants?.["class-gallery"]===true)))){showClosed("This activity is turned off", "Your teacher has not enabled this tool for your class.");return;}
      if(assignedClass.siteEnabled===false||assignedClass.access?.mode==="locked"){showClosed("Your class is locked", "Your teacher can reopen your class.");return;}
      showOpen();return;
    }

    // An activity switched off for this student's ET/WT class always stays
    // disabled, even if the class itself is unlocked and even if this student
    // has a special exception for the activity.
    if (studentClassId && !gameIsEnabledForClass(lastSettings, studentClassId)) {
      showClosed(
        "This activity is turned off",
        "This activity is disabled for your class in Teacher Tools. Your teacher can turn it back on from Fun Torah Tools."
      );
      return;
    }

    // Keep supporting the old/global switch too when the student's class has
    // not yet been resolved.
    if (!studentClassId && lastSettings.games && lastSettings.games[gameId] === false) {
      showClosed(
        "This activity is turned off",
        "This individual activity is disabled in Teacher Tools."
      );
      return;
    }

    // A class-wide exception lets exactly one selected activity stay open for
    // every student in that ET/WT class while the site/class lock is active.
    // The activity-enabled check above still wins.
    if (classHasLockedGameOverride(lastSettings, studentClassId)) {
      syncEmbeddedGameOverride(true);
      showOpen();
      return;
    }

    // Per-student/per-game exceptions bypass the emergency master lock and the
    // ET/WT class lock, but only for this one activity.
    if (studentHasGameOverride(lastSettings)) {
      syncEmbeddedGameOverride(true);
      showOpen();
      return;
    }

    if (lastSettings.siteEnabled === false && (studentClassId === "et" || studentClassId === "wt")) {
      showClosed("B3 Games is closed", "B3 Games is locked right now. Your teacher can give you access to a specific activity.");
      return;
    }

    if (!studentClassId) {
      showClosed("Please sign in first", "Go back to Fun Torah Tools and sign in again so the site can verify your class.");
      return;
    }

    if (studentClassId !== "et" && studentClassId !== "wt") {
      showOpen();
      return;
    }
    var info = classIsOpen(lastSettings, studentClassId);
    if (info.open) {
      showOpen();
    } else {
      showClosed((studentClassId === "et" ? "ET" : "WT") + " is locked right now", "Your teacher can press Unlock Now for your class. This page checks again every few seconds.");
    }
  }

  function checkNow() {
    if (requestInFlight) return;
    requestInFlight = true;

    Promise.resolve().then(async function () {
      if(storedTeacherBypass())return;
      if(verifiedTeacherAccess?.authorized){
        var selected=new URLSearchParams(location.search).get("class")||getStoredClass();
        teacherClassRecord=(verifiedTeacherAccess.classIds||[]).includes(selected)?await fetchJson(DATABASE_URL+"/b3Games/workspaces/"+encodeURIComponent(WORKSPACE_ID)+"/classes/"+encodeURIComponent(selected)+".json"):null;
        return;
      }
      await resolveStudentClass();
    }).then(function () {
      return fetchJson(DATABASE_URL + "/" + SETTINGS_PATH + ".json");
    }).then(function (settings) {
      decide(settings || {});
    }).catch(function (err) {
      console.warn("B3 game gate could not refresh settings:", err);
      // If we have already successfully read settings, keep the last known
      // decision instead of suddenly changing access on a brief network error.
      if (lastSettings && studentActive) decide(lastSettings);
      else {
        // Do not leave the page blank and do not bypass the teacher's access
        // controls. Show a useful message and retry automatically.
        showClosed(
          "Having trouble checking access",
          "We could not reach the Fun Torah Tools access settings yet. This page will try again automatically in a few seconds."
        );
      }
    }).finally(function () {
      requestInFlight = false;
    });
  }

  ["click","pointerdown","keydown","submit"].forEach(function(type){
    document.addEventListener(type,function(event){
      if(!overlay||overlay.contains(event.target))return;
      event.preventDefault();event.stopImmediatePropagation();
    },true);
  });
  watchTeacherAccess();
  checkNow();
  setInterval(checkNow, POLL_INTERVAL_MS);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") checkNow();
  });
  window.addEventListener("focus", checkNow);
})();