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
        '<h1 id="b3BlockTitle" style="margin:0 0 12px;font-size:34px">Fun Torah Tools is locked</h1>' +
        '<p id="b3BlockMessage" style="margin:0 0 24px;font-size:18px;line-height:1.5;color:#4b5563"></p>' +
        '<a id="b3BackToTools" href="' + toolsHomeUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '" ' +
           'style="display:inline-block;padding:12px 20px;border-radius:12px;background:#1f2937;color:white;text-decoration:none;font-weight:700">Back to Fun Torah Tools</a>' +
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
    if (messageNode) messageNode.textContent = message || "Your class cannot use Fun Torah Tools right now.";
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
      const profileSnap = await window.firebase.database().ref("b3Games/students/" + studentId + "/profile").once("value");
      const legacySnap = await window.firebase.database().ref("posukPractice/allowedStudents/" + studentId).once("value");
      const profile = profileSnap.val() || {};
      const data = legacySnap.val() || {};
      if (!profileSnap.exists() && !legacySnap.exists()) {
        studentClassId = "";
        studentDisplayName = "";
        return;
      }
      studentDisplayName = profile.name ? String(profile.name) : (data.name ? String(data.name) : "");
      let classId = "";
      const workspaceId = (window.B3SiteSettings && window.B3SiteSettings.workspaceId) ||
        localStorage.getItem("b3Games_workspaceId") || "b3-2026";
      try {
        const membershipSnap = await window.firebase.database().ref("b3Games/students/" + studentId + "/memberships").once("value");
        const memberships = membershipSnap.val() || {};
        Object.keys(memberships).some(function (key) {
          const m = memberships[key] || {};
          if (m.active !== false && m.workspaceId === workspaceId && String(m.classId || "").trim()) {
            classId = String(m.classId).trim();
            return true;
          }
          return false;
        });
      } catch (error) {}

      // Temporary compatibility while migration completes. This is data from
      // Firebase, not a roster embedded in the application.
      if (!classId) {
        classId = data && typeof data === "object" ? String(data.classId || "").trim() : "";
      }
      if (!classId) {
        const storedId = localStorage.getItem("b3Games_studentId") || "";
        const storedClass = String(localStorage.getItem("b3Games_studentClass") || "").trim();
        if (storedId === studentId && storedClass) classId = storedClass;
      }

      if (!classId) {
        studentClassId = "";
        return;
      }

      studentClassId = classId;
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
      if (studentClassId === "et" || studentClassId === "wt") showBlocked("B3 Games is closed for everyone right now.");
      else showBlocked("Fun Torah Tools is closed for your class right now.");
      return;
    }

    if (currentSettings.games && currentSettings.games[toolId] === false) {
      showBlocked("This activity is turned off right now.");
      return;
    }

    if (!studentClassId) {
      showBlocked("Please go back to Fun Torah Tools and sign in again so your class can be verified.");
      return;
    }

    if (studentClassId !== "et" && studentClassId !== "wt") {
      showAllowed();
      return;
    }
    const info = window.B3SiteSettings.describeClassAccess(currentSettings, studentClassId, new Date());
    if (info.open) {
      showAllowed();
    } else {
      const className = studentClassId === "et" ? "ET" : "WT";
      showBlocked(className + " is locked right now. Please ask your teacher if you think it should be open.");
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
        await loadScript(new URL("firebase-config.js?v=20261001-multiclass", rootBase).href);
      }
      if (!window.B3SiteSettings) {
        await loadScript(new URL("site-settings.js?v=20261001-multiclass", rootBase).href);
      }
      if (!window.B3SiteSettings || typeof window.B3SiteSettings.subscribe !== "function") {
        throw new Error("B3 site settings did not load.");
      }

      // Carry the whole-class workspace identity even when a student opens a
      // tool directly. This is separate from the existing ET/WT classId.
      try {
        if (window.B3SiteSettings.workspaceId) {
          localStorage.setItem("b3Games_workspaceId", window.B3SiteSettings.workspaceId);
        }
      } catch (error) {}

      await beginTeacherBypassWatch();
      await resolveStudentClass();

      window.B3SiteSettings.subscribe(function (settings) {
        currentSettings = settings;
        evaluateAccess();
      });

      window.setInterval(evaluateAccess, 15000);

      window.setTimeout(function () {
        if (!firstDecisionMade) {
          showBlocked("Access could not be verified. Please return to Fun Torah Tools and try again.");
        }
      }, 8000);
    } catch (error) {
      console.error("B3 access guard failed:", error);
      showBlocked("Access could not be verified. Please return to Fun Torah Tools and try again.");
    }
  }

  start();
})();
