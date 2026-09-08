(function () {
  "use strict";

  const loaderScript = document.currentScript;
  const toolId = loaderScript && loaderScript.dataset ? loaderScript.dataset.b3ToolId : "";

  if (!toolId) {
    console.error("B3 access guard: missing data-b3-tool-id.");
    return;
  }

  const rootBase = new URL("./", loaderScript.src);
  const toolsHomeUrl = new URL("index.html", rootBase).href;
  const previousVisibility = document.documentElement.style.visibility;
  document.documentElement.style.visibility = "hidden";

  let blocked = true;
  let blocker = null;
  let currentSettings = null;
  let studentClassId = "";
  let studentDisplayName = "";
  let teacherBypass = false;
  let authResolved = false;
  let firstDecisionMade = false;

  const stopIfBlocked = function (event) {
    if (!blocked) return;
    if (blocker && event.target && blocker.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
  };

  ["click", "dblclick", "pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "keydown", "keyup", "keypress", "submit", "contextmenu"].forEach(function (eventName) {
    document.addEventListener(eventName, stopIfBlocked, true);
  });

  function pausePageActivity() {
    try {
      document.querySelectorAll("audio, video").forEach(function (media) {
        try { media.pause(); } catch (error) {}
      });
    } catch (error) {}

    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (error) {}
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (error) {}
  }

  function ensureBlocker() {
    if (blocker && blocker.isConnected) return blocker;

    blocker = document.createElement("div");
    blocker.id = "b3ToolAccessBlocker";
    blocker.setAttribute("role", "alert");
    blocker.style.cssText = [
      "position:fixed", "inset:0", "z-index:2147483647", "display:flex", "align-items:center",
      "justify-content:center", "padding:24px", "background:#f5f7fa", "font-family:Arial,sans-serif",
      "text-align:center", "color:#1f2937", "pointer-events:auto"
    ].join(";");

    blocker.innerHTML =
      '<div style="max-width:560px;background:white;border-radius:22px;padding:38px 32px;box-shadow:0 18px 45px rgba(0,0,0,.16)">' +
        '<div style="font-size:58px;margin-bottom:14px">🔒</div>' +
        '<h1 style="margin:0 0 12px;font-size:34px">B3 Games is locked</h1>' +
        '<p id="b3BlockMessage" style="margin:0 0 24px;font-size:18px;line-height:1.5;color:#4b5563"></p>' +
        '<a id="b3BackToTools" href="' + toolsHomeUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '" ' +
           'style="display:inline-block;padding:12px 20px;border-radius:12px;background:#1f2937;color:white;text-decoration:none;font-weight:700">Back to B3 Games</a>' +
      '</div>';

    (document.body || document.documentElement).appendChild(blocker);
    const backLink = blocker.querySelector("#b3BackToTools");
    if (backLink) backLink.addEventListener("click", function (event) { event.stopPropagation(); }, true);
    return blocker;
  }

  function showBlocked(message) {
    blocked = true;
    pausePageActivity();
    const panel = ensureBlocker();
    const messageNode = panel.querySelector("#b3BlockMessage");
    if (messageNode) messageNode.textContent = message || "Your class cannot use B3 Games right now.";
    document.documentElement.style.visibility = previousVisibility || "";
  }

  function showAllowed() {
    blocked = false;
    if (blocker && blocker.isConnected) blocker.remove();
    document.documentElement.style.visibility = previousVisibility || "";
  }

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      const existing = Array.from(document.scripts).find(function (script) { return script.src === url; });
      if (existing) {
        if (existing.dataset.b3Loaded === "true") { resolve(); return; }
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = url;
      script.async = false;
      script.addEventListener("load", function () { script.dataset.b3Loaded = "true"; resolve(); }, { once: true });
      script.addEventListener("error", reject, { once: true });
      (document.head || document.documentElement).appendChild(script);
    });
  }

  function getStoredStudentId() {
    return localStorage.getItem("b3Games_studentId") || localStorage.getItem("posukPractice_studentId") || "";
  }

  async function resolveStudentClass() {
    const studentId = getStoredStudentId();
    if (!studentId) {
      studentClassId = "";
      studentDisplayName = "";
      return;
    }

    try {
      const snap = await window.firebase.database().ref("posukPractice/allowedStudents/" + studentId).once("value");
      if (!snap.exists()) {
        studentClassId = "";
        studentDisplayName = "";
        return;
      }

      const data = snap.val() || {};
      const classId = data && typeof data === "object" ? data.classId : "";
      if (!['et', 'wt'].includes(classId)) {
        studentClassId = "";
        studentDisplayName = data && data.name ? String(data.name) : "";
        return;
      }

      studentClassId = classId;
      studentDisplayName = data && data.name ? String(data.name) : "";
      localStorage.setItem("b3Games_studentId", studentId);
      localStorage.setItem("b3Games_studentClass", classId);
      if (studentDisplayName) localStorage.setItem("b3Games_studentName", studentDisplayName);
    } catch (error) {
      console.warn("B3 access guard could not resolve student class:", error);
      studentClassId = "";
    }
  }

  function evaluateAccess() {
    if (!currentSettings || !authResolved) return;
    firstDecisionMade = true;

    // Rabbi Cohen's authorized Google account always bypasses student locks.
    // This includes ET/WT schedules, manual class overrides, the emergency
    // student master lock, and individual activity switches.
    if (teacherBypass) {
      showAllowed();
      return;
    }

    if (currentSettings.siteEnabled === false) {
      showBlocked("B3 Games is closed for everyone right now.");
      return;
    }

    if (currentSettings.games && currentSettings.games[toolId] === false) {
      showBlocked("This activity is turned off right now.");
      return;
    }

    if (!studentClassId) {
      showBlocked("Please go back to B3 Games and sign in so I know whether you are in ET or WT.");
      return;
    }

    const info = window.B3SiteSettings.describeClassAccess(currentSettings, studentClassId, new Date());
    if (info.open) {
      showAllowed();
    } else {
      const className = studentClassId === "et" ? "ET" : "WT";
      showBlocked(className + " is locked right now. Please ask Rabbi Cohen if you think it should be open.");
    }
  }


  function beginTeacherBypassWatch() {
    return new Promise(function (resolve) {
      let firstCallbackPending = true;
      let settled = false;

      function settleOnce() {
        if (settled) return;
        settled = true;
        resolve();
      }

      window.B3SiteSettings.onAuthStateChanged(function (user, authorized) {
        teacherBypass = Boolean(authorized);
        authResolved = true;
        if (firstCallbackPending) {
          firstCallbackPending = false;
          settleOnce();
        }
        evaluateAccess();
      });

      // Firebase normally restores auth immediately. If it is unusually slow,
      // continue as a student after a short grace period; a later auth callback
      // will still switch an authorized teacher to bypass mode instantly.
      window.setTimeout(function () {
        if (!authResolved) authResolved = true;
        settleOnce();
      }, 3500);
    });
  }

  async function start() {
    try {
      if (!window.firebase || !window.firebase.initializeApp) {
        await loadScript("https://www.gstatic.com/firebasejs/12.15.0/firebase-app-compat.js");
      }
      if (!window.firebase || !window.firebase.auth) {
        await loadScript("https://www.gstatic.com/firebasejs/12.15.0/firebase-auth-compat.js");
      }
      if (!window.firebase || !window.firebase.database) {
        await loadScript("https://www.gstatic.com/firebasejs/12.15.0/firebase-database-compat.js");
      }
      if (!window.B3_FIREBASE_CONFIG) {
        await loadScript(new URL("firebase-config.js", rootBase).href);
      }
      if (!window.B3SiteSettings) {
        await loadScript(new URL("site-settings.js", rootBase).href);
      }
      if (!window.B3SiteSettings || typeof window.B3SiteSettings.subscribe !== "function") {
        throw new Error("B3 site settings did not load.");
      }

      await beginTeacherBypassWatch();
      await resolveStudentClass();

      window.B3SiteSettings.subscribe(function (settings) {
        currentSettings = settings;
        evaluateAccess();
      });

      window.setInterval(evaluateAccess, 15000);

      window.setTimeout(function () {
        if (!firstDecisionMade) {
          showBlocked("Access could not be verified. Please return to B3 Games and try again.");
        }
      }, 8000);
    } catch (error) {
      console.error("B3 access guard failed:", error);
      showBlocked("Access could not be verified. Please return to B3 Games and try again.");
    }
  }

  start();
})();
