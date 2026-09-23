window.B3_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDaheO5K2qL8qe3rHIZY4nTd0wuEUG_DEs",
  authDomain: "b3-games.firebaseapp.com",
  databaseURL: "https://b3-games-default-rtdb.firebaseio.com",
  projectId: "b3-games",
  storageBucket: "b3-games.firebasestorage.app",
  messagingSenderId: "568530046190",
  appId: "1:568530046190:web:fd765fdd27e55a3c73f7ff"
};

/*
 * B3 Admin password gate
 * This gate keeps students from reaching the Google sign-in screen.
 * Google/Firebase authentication remains the real admin security.
 */
(function () {
  "use strict";

  const ADMIN_PASSWORD_HASH =
    "57532c1bb37dcc8f1f9c86501590f50bcae0825fdd22a6a88605a046be7d43e3";
  const SESSION_KEY = "b3AdminPasswordUnlocked";

  function unlocked() {
    try {
      return sessionStorage.getItem(SESSION_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function setUnlocked(value) {
    try {
      if (value) sessionStorage.setItem(SESSION_KEY, "1");
      else sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }

  async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(String(value || ""));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function authorizedTeacherSignedIn() {
    try {
      const user = window.firebase &&
                   window.firebase.auth &&
                   window.firebase.auth().currentUser;
      return !!(
        user &&
        user.email &&
        user.email.toLowerCase() === "simcha5770@gmail.com"
      );
    } catch (e) {
      return false;
    }
  }

  function installGate() {
    const panel = document.getElementById("adminPanel");
    const signInButton = document.getElementById("signInButton");
    const signOutButton = document.getElementById("signOutButton");
    const adminStatus = document.getElementById("adminStatus");

    if (!panel || !signInButton || document.getElementById("adminPasswordGate")) {
      return;
    }

    const gate = document.createElement("div");
    gate.id = "adminPasswordGate";
    gate.innerHTML = `
      <label for="adminPasswordInput"
             style="display:block;font-weight:800;margin:10px 0 6px;">
        Admin password
      </label>
      <input id="adminPasswordInput"
             type="password"
             autocomplete="current-password"
             placeholder="Enter admin password"
             style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;
                    border-radius:10px;font-size:15px;">
      <button id="adminPasswordButton"
              type="button"
              class="admin-action">
        Continue
      </button>
      <div id="adminPasswordMsg"
           style="min-height:18px;margin-top:8px;color:#b91c1c;
                  font-size:13px;"></div>
    `;

    signInButton.parentNode.insertBefore(gate, signInButton);

    const input = document.getElementById("adminPasswordInput");
    const continueButton = document.getElementById("adminPasswordButton");
    const message = document.getElementById("adminPasswordMsg");

    function applyGateState() {
      const teacherSignedIn = authorizedTeacherSignedIn();
      const allowGoogle = unlocked() || teacherSignedIn;

      if (teacherSignedIn) {
        gate.style.display = "none";
        return;
      }

      gate.style.display = allowGoogle ? "none" : "";

      if (!allowGoogle) {
        signInButton.classList.add("hidden");
        if (adminStatus) {
          adminStatus.textContent = "Enter the admin password to continue.";
        }
      } else {
        signInButton.classList.remove("hidden");
        if (adminStatus) {
          adminStatus.textContent =
            "Password accepted. Now sign in with simcha5770@gmail.com.";
        }
      }
    }

    async function submitPassword() {
      message.textContent = "";
      continueButton.disabled = true;

      try {
        const hash = await sha256Hex(input.value);

        if (hash !== ADMIN_PASSWORD_HASH) {
          message.textContent = "Incorrect password.";
          input.select();
          input.focus();
          return;
        }

        setUnlocked(true);
        input.value = "";
        applyGateState();
        setTimeout(() => signInButton.focus(), 0);
      } catch (err) {
        console.error("Admin password check failed:", err);
        message.textContent = "Could not check the password. Please try again.";
      } finally {
        continueButton.disabled = false;
      }
    }

    continueButton.addEventListener("click", submitPassword);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") submitPassword();
    });

    // Existing B3 code can re-render this button. Keep it hidden until
    // the password gate has been passed.
    const observer = new MutationObserver(function () {
      if (!unlocked() && !authorizedTeacherSignedIn()) {
        signInButton.classList.add("hidden");
        gate.style.display = "";
      }
    });

    observer.observe(signInButton, {
      attributes: true,
      attributeFilter: ["class", "style"]
    });

    if (signOutButton) {
      signOutButton.addEventListener("click", function () {
        setUnlocked(false);
        setTimeout(applyGateState, 50);
      }, true);
    }

    try {
      if (window.firebase && window.firebase.auth) {
        window.firebase.auth().onAuthStateChanged(function (user) {
          if (!user) setUnlocked(false);
          setTimeout(applyGateState, 0);
        });
      }
    } catch (e) {}

    applyGateState();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(installGate, 0);
    });
  } else {
    setTimeout(installGate, 0);
  }
})();
