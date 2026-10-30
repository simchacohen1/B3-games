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

  var databaseNamespace = "";
  function databaseUrl() {
    var stagingHost = location.hostname === "fun-torah-tools-staging.web.app" ||
      location.hostname === "fun-torah-tools-staging.firebaseapp.com";
    var stagingProject = window.B3_STAGING_FIREBASE_CONFIG?.projectId;
    if (stagingProject === "fun-torah-tools-staging" || stagingHost) {
      return String(window.B3_STAGING_FIREBASE_CONFIG?.databaseURL ||
        window.B3_FIREBASE_CONFIG?.databaseURL ||
        "https://fun-torah-tools-staging-default-rtdb.firebaseio.com").replace(/\/+$/, "");
    }
    var configured = String(window.B3_FIREBASE_CONFIG?.databaseURL ||
      "https://b3-games-default-rtdb.firebaseio.com");
    try {
      var parsed = new URL(configured);
      // Firebase's RTDB emulator accepts its namespace as a query parameter.
      // Keep the base URL path-only because callers append REST paths to it;
      // fetchJson adds the namespace alongside auth/cache-busting parameters.
      databaseNamespace = parsed.searchParams.get("ns") || "";
      parsed.search = "";
      return parsed.href.replace(/\/+$/, "");
    } catch (_) {
      databaseNamespace = "";
      return configured.replace(/\/+$/, "");
    }
  }
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
  var POLL_INTERVAL_MS = 30000;
  // Bound slow Firebase reads while preserving the fail-closed decision.
  var FETCH_TIMEOUT_MS = 15000;
  var FIRST_LOAD_FAILSAFE_MS = 5500;
  var authReadyResolve;
  var authReadyPromise = new Promise(function (resolve) { authReadyResolve = resolve; });
  // Other student clients share this initialization instead of loading a second SDK.
  window.B3GameGateAuthReady = authReadyPromise;
  function markAuthReady() {
    if (!authReadyResolve) return;
    authReadyResolve();
    authReadyResolve = null;
  }

  var scriptEl = document.currentScript;
  var gameId = scriptEl && (scriptEl.getAttribute("data-game-id") || scriptEl.getAttribute("data-b3-tool-id"));
  if (!gameId) {
    console.warn("B3 game gate: missing data-game-id; skipping access check.");
    return;
  }

  var rootBase = new URL("./", scriptEl.src);
  // One free, opt-in audio switch shared by student activities.
  // Audio Mode never makes a paid synthesis request.
  if (!document.querySelector('script[data-ftt-audio-mode]')) {
    var audioScript = document.createElement("script");
    audioScript.src = new URL("audio-mode.js?v=20261012-game-show-choices", rootBase).href;
    audioScript.defer = true;
    audioScript.setAttribute("data-ftt-audio-mode", "1");
    (document.head || document.documentElement).appendChild(audioScript);
  }

  // Guest Mode (see guest-mode.js): one shared flag, loaded here so every page
  // that has this gate also gets the no-saving protection and the banner.
  function isGuestPreview() {
    try { return sessionStorage.getItem("b3Games_guest") === "1"; } catch (e) { return false; }
  }
  if (isGuestPreview() && !window.B3Guest) {
    var guestScript = document.createElement("script");
    guestScript.src = new URL("guest-mode.js?v=20261011-guest", rootBase).href;
    (document.head || document.documentElement).appendChild(guestScript);
  }
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
  // Any teacher tool can open before Firebase restores the saved Google session.
  // Keep the page on the neutral loading state rather than flashing a false
  // student sign-in error while teacher authorization is still pending.
  var teacherCheckPending = !isGuestPreview();
  var requestInFlight = false;
  var refreshRequested = false;
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
    // The independently authenticated Pointer lesson remains usable above a
    // locked activity. Closing that activity must not freeze the teacher video.
    document.querySelectorAll("audio,video").forEach(function(media){
      if(media.closest('#fttTeacherLessonOverlay'))return;
      try{media.pause();}catch(error){}
    });
    markFirstDecision();
    reveal();
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "b3-gate-overlay";
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:2147483635;background:#f5f7fa;" +
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

  // Direct Gallery links select from verified teacher assignments, never B3 defaults.
  function galleryAssignedIds() {
    return verifiedTeacherAccess && verifiedTeacherAccess.authorized &&
      verifiedTeacherAccess.role === "teacher"
      ? (verifiedTeacherAccess.classIds || []).filter(function(id){return /^[A-Za-z0-9_-]{1,100}$/.test(id);})
      : [];
  }
  function resolveGalleryTeacherClass() {
    if(gameId!=="class-gallery" || !verifiedTeacherAccess ||
       !verifiedTeacherAccess.authorized || verifiedTeacherAccess.role!=="teacher") return false;
    var ids=galleryAssignedIds(), chosen=new URLSearchParams(location.search).get("class")||"";
    if(ids.includes(chosen))return false;
    if(ids.length===1){
      var target=new URL(location.href);
      target.searchParams.set("class",ids[0]);
      location.replace(target.href);
      return true;
    }
    return false;
  }
  function showGalleryClassChoices() {
    var ids=galleryAssignedIds();
    showClosed("Choose your class",ids.length?"Select one of your assigned classes to open Class Gallery.":"No classes are assigned to this teacher.");
    var panel=overlay&&overlay.querySelector("#b3GateMessage");
    if(!panel)return;
    var wrap=document.createElement("div");
    wrap.style.cssText="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:15px";
    ids.forEach(function(id){
      var btn=document.createElement("button");
      btn.type="button";
      btn.textContent=id==="et"?"ET":id==="wt"?"WT":id.replace(/[-_]/g," ");
      btn.style.cssText="border:0;border-radius:10px;padding:12px 18px;background:#2563eb;color:white;font:bold 16px Arial;cursor:pointer";
      btn.addEventListener("click",function(){
        var target=new URL(location.href);
        target.searchParams.set("class",id);
        location.assign(target.href);
      });
      wrap.appendChild(btn);
    });
    panel.appendChild(wrap);
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
  function waitForFirebaseAuthState(auth) {
    if (auth && typeof auth.authStateReady === "function") return auth.authStateReady();
    if (!auth || typeof auth.onAuthStateChanged !== "function") return Promise.resolve();
    // Firebase v8 does not expose authStateReady(). Its first observer callback
    // is the signal that persisted auth has been restored (including null for a
    // signed-out browser). Do not let private REST reads race that restoration.
    return new Promise(function(resolve, reject) {
      var unsubscribe = null, finished = false;
      function finish(error) {
        if (finished) return;
        finished = true;
        if (unsubscribe) unsubscribe();
        if (error) reject(error); else resolve();
      }
      try {
        unsubscribe = auth.onAuthStateChanged(function() { finish(); }, finish);
        // Some SDK/test implementations invoke the initial callback inline.
        if (finished && unsubscribe) unsubscribe();
      } catch (error) { finish(error); }
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
      if(!window.firebase.apps.length) window.firebase.initializeApp(window.B3_FIREBASE_CONFIG);
      if(!window.B3SiteSettings) await loadAuthScript(new URL("site-settings.js?v=20261008-owner-demo",rootBase).href);
      await waitForFirebaseAuthState(window.firebase.auth());
      markAuthReady();
      window.B3SiteSettings.onAuthStateChanged(function(user,authorized,access){
        markAuthReady();
        teacherCheckPending=false;
        verifiedTeacherAccess=authorized?access:null;
        if(resolveGalleryTeacherClass())return;
        checkNow();
      });
    } catch(error){
      markAuthReady();
      teacherCheckPending=false;
      console.warn("Teacher access could not be verified",error);
      checkNow();
    }
  }

  function getStoredStudentId() {
    return sessionStorage.getItem("b3Games_studentId") || sessionStorage.getItem("posukPractice_studentId") || "";
  }

  function getStoredClass() {
    var c = sessionStorage.getItem("b3Games_studentClass") || sessionStorage.getItem("weeklyQuiz_classId") || "";
    return String(c || "").trim();
  }

  async function fetchJson(url) {
    var params = new URLSearchParams();
    params.set("_", String(Date.now()));
    if (databaseNamespace) params.set("ns", databaseNamespace);
    // Firebase's REST API accepts Firebase ID tokens using the `auth` query
    // parameter. Use the current signed-in user's token so private rules can
    // authorize this gate's narrow reads. Public settings continue to work
    // before authentication is available.
    try {
      // Do not race this against a short timer: the protected profile and
      // membership reads below must never fall back to anonymous requests
      // just because Firebase's scripts or persisted auth state initialize
      // more slowly than the page. watchTeacherAccess resolves this promise
      // after initialization (or its catch path if initialization fails).
      await authReadyPromise;
      var auth = window.firebase && window.firebase.auth && window.firebase.auth();
      if (auth && typeof auth.authStateReady === "function") await auth.authStateReady();
      var user = auth && auth.currentUser;
      if (user && typeof user.getIdToken === "function") params.set("auth", await user.getIdToken());
    } catch (_) {
      // Firebase may not have initialized yet; public gate settings can still
      // load, and a later auth-state callback will retry protected reads.
    }
    var target = url + (url.indexOf("?") >= 0 ? "&" : "?") + params.toString();

    // Never allow a Firebase request to hang forever. A hung request used to
    // leave the entire page hidden because the gate was waiting for a decision.
    return new Promise(function (resolve, reject) {
      var settled = false;
      var controller = new AbortController();
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        controller.abort();
        reject(new Error("Access check timed out"));
      }, FETCH_TIMEOUT_MS);

      fetch(target, { cache: "no-store", signal: controller.signal }).then(function (res) {
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

  let followLoader=null;
  let followActivityOpen=false;
  async function startFollowTeacherListener(classId,studentId) {
    if (!classId || !studentId || isGuestPreview() || verifiedTeacherAccess?.authorized) return;
    if (!followLoader) {
      followLoader = loadOneScript(new URL("follow-teacher/core.js?v=20261020-follow-pointer1",rootBase).href)
        .then(()=>loadOneScript(new URL("follow-teacher/student.js?v=20261020-follow-pointer1",rootBase).href))
        .catch(error=>{followLoader=null;throw error;});
    }
    return followLoader.then(()=>{
      if (studentActive && studentClassId===classId &&
          getStoredStudentId()===studentId) {
        return window.FTTFollowStudent?.start({workspaceId:WORKSPACE_ID,classId,studentId});
      }
    }).catch(error=>console.warn("Follow Teacher not available",error));
  }

  async function resolveStudentClass() {
    var studentId=getStoredStudentId(), storedClass=getStoredClass();
    studentActive=false;assignedClass=null;studentClassId="";
    if(!studentId)return "";
    var rows=await Promise.all([
      fetchJson(databaseUrl()+"/b3Games/students/"+encodeURIComponent(studentId)+"/profile.json"),
      fetchJson(databaseUrl()+"/b3Games/students/"+encodeURIComponent(studentId)+"/memberships.json")
    ]);
    var profile=rows[0],memberships=rows[1]||{};
    if(profile && profile.active===false)return "";
    var valid=Object.values(memberships).filter(function(m){return m&&m.active!==false&&m.workspaceId===WORKSPACE_ID&&m.classId;});
    var match=valid.find(function(m){return m.classId===storedClass;})||(valid.length===1?valid[0]:null);
    if(match)studentClassId=String(match.classId);
    else if(!Object.keys(memberships).length){
      var legacy=await fetchJson(databaseUrl()+"/posukPractice/allowedStudents/"+encodeURIComponent(studentId)+".json");
      if(legacy&&legacy.active!==false&&["et","wt"].includes(legacy.classId))studentClassId=legacy.classId;
    }
    if(!studentClassId)return "";
    var classPath=databaseUrl()+"/b3Games/workspaces/"+encodeURIComponent(WORKSPACE_ID)+"/classes/"+encodeURIComponent(studentClassId);
    // The display name is not used to authorize tool access. Avoid a
    // redundant, occasionally slow Firebase read on every gate refresh.
    // Keep every permission-critical field and the student membership check.
    var classFields=await Promise.all([
      fetchJson(classPath+"/active.json"),
      fetchJson(classPath+"/siteEnabled.json"),
      fetchJson(classPath+"/access.json"),
      fetchJson(classPath+"/toolGrants.json"),
      fetchJson(classPath+"/members/"+encodeURIComponent(studentId)+".json")
    ]);
    var member=classFields[4];
    assignedClass={active:classFields[0],siteEnabled:classFields[1],access:classFields[2],toolGrants:classFields[3],members:{}};
    assignedClass.members[studentId]=member;
    if(assignedClass.active===false||!member||member.active===false){studentClassId="";return "";}
    studentActive=true;
    // Follow Teacher is an optional, class-scoped navigation listener.
    // It starts only after the shared gate has resolved an active student.
    void startFollowTeacherListener(studentClassId, studentId);
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
    var listed = String(settings.classLockedGameOverride[classId] || "").split(",").map(function (v) { return v.trim(); }).indexOf(String(gameId || "")) !== -1;
    if (!listed) return false;
    // Stars switch themselves off after their saved time (see site-settings.js).
    var until = settings.classLockedGameOverrideUntil && settings.classLockedGameOverrideUntil[classId];
    var ms = until && typeof until === "object" ? Number(until[gameId]) : 0;
    return !(ms > 0 && ms <= Date.now());
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
        if(gameId==="class-gallery"){showGalleryClassChoices();return;}
        showClosed("Choose an assigned class", "Open this tool from your Teacher Center.");return;
      }
      // Tool grants are checked against the selected class, never another teacher's class.
      var teacherGrantId=gameId==="class-gallery"?"gallery":gameId;
      // The B3 legacy ET/WT classroom activity switch is also the accepted
      // Multiplayer Arcade teacher grant. Mirror teacher-home.html, which
      // offers this activity without requiring a separate toolGrants record.
      var legacyArcadeTeacherGrant=gameId==="multiplayer-center"&&(selected==="et"||selected==="wt")&&
        gameIsEnabledForClass(lastSettings,selected);
      if(!teacherClassRecord||teacherClassRecord.active===false||
          !(window.B3StudentTools.granted(teacherClassRecord,teacherGrantId)||legacyArcadeTeacherGrant)){
        showClosed("Teacher class access", "This tool is not enabled for your assigned class.");return;
      }
      showOpen();return;
    }
    if(!studentActive){
      // A missing student session is normal for teachers. Wait for the Firebase
      // teacher check before displaying a misleading "sign in again" message.
      // The existing fail-safe shows a neutral checking message if this is slow.
      if(teacherCheckPending)return;
      showClosed("Please sign in again", "Your student access or class membership could not be verified.");
      return;
    }
    if(!window.B3StudentTools || !window.B3StudentTools.allowed(assignedClass,getStoredStudentId(),gameId)){
      showClosed("This activity is turned off for you", "Your teacher can change your tool access.");return;
    }
    if(studentClassId!=="et"&&studentClassId!=="wt"){
      if(lastSettings.siteEnabled===false){
        showClosed("Fun Torah Tools is closed", "The administrator has activated the emergency lock.");return;
      }
      var grantId=gameId==="class-gallery"?"gallery":gameId;
      if(!assignedClass||!window.B3StudentTools.granted(assignedClass,grantId)){showClosed("This activity is turned off", "Your teacher has not enabled this tool for your class.");return;}
      if(!followActivityOpen&&(assignedClass.siteEnabled===false||assignedClass.access?.mode==="locked")){showClosed("Your class is locked", "Your teacher can reopen your class.");return;}
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

    // Follow grants only the authenticated, permitted destination, never other tools.
    if (followActivityOpen) { showOpen(); return; }

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
      showClosed("Fun Torah Tools is closed", "Fun Torah Tools is locked right now. Your teacher can give you access to a specific activity.");
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
    // Guest Mode: a preview, no student to check. guest-mode.js blocks all saving.
    if (isGuestPreview()) { showOpen(); return; }
    if (requestInFlight) { refreshRequested = true; return; }
    requestInFlight = true;
    followActivityOpen = false;

    Promise.resolve().then(async function () {
      if(!window.B3StudentTools)await loadOneScript(new URL('backend/functions/student-tool-policy.js',rootBase).href);
      if(storedTeacherBypass())return;
      if(verifiedTeacherAccess?.authorized){
        var selected=new URLSearchParams(location.search).get("class")||getStoredClass();
        var teacherClassPath=databaseUrl()+"/b3Games/workspaces/"+encodeURIComponent(WORKSPACE_ID)+"/classes/"+encodeURIComponent(selected);
        teacherClassRecord=(verifiedTeacherAccess.classIds||[]).includes(selected)?{
          active:await fetchJson(teacherClassPath+"/active.json"),
          siteEnabled:await fetchJson(teacherClassPath+"/siteEnabled.json"),
          access:await fetchJson(teacherClassPath+"/access.json"),
          toolGrants:await fetchJson(teacherClassPath+"/toolGrants.json")
        }:null;
        return;
      }
      await resolveStudentClass();
      // Optional navigation must not block verification of tool permissions.
      if (studentActive) void startFollowTeacherListener(studentClassId, getStoredStudentId());
      followActivityOpen = !!(studentActive && await window.FTTFollowStudent?.allowsLockedActivity(gameId));
    }).then(function () {
      return fetchJson(databaseUrl() + "/" + SETTINGS_PATH + ".json");
    }).then(function (settings) {
      // When teacher auth finishes during a student-first check, ignore that
      // stale decision; the queued pass will load the teacher's class record.
      if(refreshRequested && gameId==="class-gallery")return;
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
      // The sign-in callback may arrive while the first student check is in
      // flight. Recheck immediately instead of waiting for the 30s poll.
      if(refreshRequested){refreshRequested=false;checkNow();}
    });
  }

  ["click","pointerdown","keydown","submit"].forEach(function(type){
    document.addEventListener(type,function(event){
      if(!overlay||overlay.contains(event.target))return;
      if(window.B3PointerAssignedUI?.allowsEvent(event.target))return;
      event.preventDefault();event.stopImmediatePropagation();
    },true);
  });
  if (!isGuestPreview()) watchTeacherAccess();
  checkNow();
  setInterval(checkNow, POLL_INTERVAL_MS);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") checkNow();
  });
  window.addEventListener("focus", checkNow);
  window.addEventListener("ftt:follow-policy-changed", checkNow);

  // ---- "← Fun Torah Tools" home button -------------------------------------------
  // Every student page loads this gate, so it is the one place that can make
  // sure students always have a way back to the Fun Torah Tools home page. Pages that
  // already show their own visible home link keep it, and this pill stays hidden.
  function setupHomeButton() {
    if (window.top !== window || document.getElementById("b3HomeButton")) return;
    var homePath = new URL("index.html", rootBase).pathname;
    var btn = document.createElement("a");
    btn.id = "b3HomeButton";
    btn.href = new URL("index.html", rootBase).href;
    btn.textContent = "← Fun Torah Tools";
    btn.setAttribute("aria-label", "Back to Fun Torah Tools home");
    btn.style.cssText = [
      "position:fixed", "left:10px", "bottom:10px", "z-index:2147483000",
      "padding:7px 13px", "border-radius:999px", "background:rgba(31,41,55,.88)",
      "color:#fff", "font:700 13px/1.2 system-ui,-apple-system,Segoe UI,sans-serif",
      "text-decoration:none", "box-shadow:0 2px 8px rgba(0,0,0,.25)",
      "-webkit-tap-highlight-color:transparent"
    ].join(";");
    document.body.appendChild(btn);

    function pageHasOwnHomeLink() {
      var links = document.querySelectorAll("a[href],[data-b3-home]");
      for (var i = 0; i < links.length; i++) {
        var el = links[i];
        if (el === btn || !el.offsetParent) continue;
        if (el.hasAttribute("data-b3-home")) return true;
        try {
          if (new URL(el.getAttribute("href"), location.href).pathname === homePath &&
              /B3 Games|Fun Torah Tools|Home/i.test(el.textContent)) return true;
        } catch (e) {}
      }
      return false;
    }
    function refresh() { btn.style.display = pageHasOwnHomeLink() ? "none" : ""; }
    refresh();
    setInterval(refresh, 1500);
  }
  if (document.body) setupHomeButton();
  else document.addEventListener("DOMContentLoaded", setupHomeButton);
})();
