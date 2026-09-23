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
 * B3 Admin password gate.
 *
 * Pressing Admin first asks for the admin password.
 * Only after the correct password is entered does the normal Admin panel open,
 * where Google sign-in still verifies the authorized teacher account.
 *
 * The password itself is not stored in plain text here.
 */
(function () {
  "use strict";

  const ADMIN_PASSWORD_HASH = "57532c1bb37dcc8f1f9c86501590f50bcae0825fdd22a6a88605a046be7d43e3";
  const SESSION_KEY = "b3AdminPasswordUnlocked";

  function isUnlocked() {
    try {
      return sessionStorage.getItem(SESSION_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function unlock() {
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch (e) {}
  }

  function lock() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }

  function authorizedTeacherAlreadySignedIn() {
    try {
      const user =
        window.firebase &&
        window.firebase.auth &&
        window.firebase.auth().currentUser;

      return Boolean(
        user &&
        user.email &&
        user.email.toLowerCase() === "simcha5770@gmail.com"
      );
    } catch (e) {
      return false;
    }
  }

  async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(String(value || ""));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map(function (b) { return b.toString(16).padStart(2, "0"); })
      .join("");
  }

  function installAdminPasswordGate() {
    const adminButton = document.getElementById("adminAccessButton");
    if (!adminButton || adminButton.dataset.passwordGateInstalled === "1") return;

    adminButton.dataset.passwordGateInstalled = "1";

    /*
     * Capture phase is intentional: it runs before the existing Admin click
     * handler in index.html. Until the password is accepted, the existing
     * handler never runs, so students cannot reach the Google sign-in button.
     */
    adminButton.addEventListener("click", async function (event) {
      if (isUnlocked() || authorizedTeacherAlreadySignedIn()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }

      const entered = window.prompt("Enter admin password:");
      if (entered === null) return;

      try {
        const enteredHash = await sha256Hex(entered);

        if (enteredHash !== ADMIN_PASSWORD_HASH) {
          window.alert("Incorrect admin password.");
          return;
        }

        unlock();

        /*
         * Run a fresh click. This time the gate sees the unlocked session and
         * allows the site's normal Admin click handler to open the panel.
         */
        adminButton.click();
      } catch (error) {
        console.error("Could not verify admin password:", error);
        window.alert("Could not verify the admin password. Please try again.");
      }
    }, true);

    const signOutButton = document.getElementById("signOutButton");
    if (signOutButton) {
      signOutButton.addEventListener("click", function () {
        lock();
      }, true);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installAdminPasswordGate);
  } else {
    installAdminPasswordGate();
  }
})();
