/*
 * game-gate.js
 *
 * Include this near the top of <head> on a game's student-facing entry
 * page (not on teacher pages) with a data-game-id attribute matching the
 * id used in index.html / site-settings.js, e.g.:
 *
 *   <script src="../game-gate.js" data-game-id="rashi-letters"></script>
 *
 * It checks the shared B3 Games settings (the same Firebase record the
 * admin panel on index.html writes to) and, if the site or this specific
 * game has been toggled off, blocks the page with a "closed" message
 * instead of letting the game load. Read access to this Firebase path is
 * public (see firebase-rules.json), so this works with a plain fetch and
 * no SDK, sign-in, or extra script tags.
 *
 * This mirrors the same client-side trust model already used on
 * index.html (there is no server enforcing this — a technically
 * determined student could still get around it), but it closes the gap
 * where a game page ignored the toggle entirely when opened directly
 * (bookmark, browser history, an already-open tab, etc.).
 *
 * It also keeps checking while the page stays open (a short poll, plus
 * an immediate re-check whenever the tab regains focus), so a game that
 * gets toggled off while a student is already on the page shuts down on
 * its own instead of staying playable until they reload.
 */
(function () {
  "use strict";

  var DATABASE_URL = "https://b3-games-default-rtdb.firebaseio.com";
  var SETTINGS_PATH = "b3Games/siteSettings";
  var LOCAL_FALLBACK_KEY = "b3SiteSettingsFallback";

  var scriptEl = document.currentScript;
  var gameId = scriptEl && scriptEl.getAttribute("data-game-id");
  var backHref = (scriptEl && scriptEl.getAttribute("data-back-href")) || "../index.html";

  if (!gameId) {
    console.warn("game-gate.js: missing data-game-id attribute; skipping gate check.");
    return;
  }

  // Hide the page immediately so nothing flashes on screen while we check.
  var hideStyle = document.createElement("style");
  hideStyle.id = "b3-gate-hide-style";
  hideStyle.textContent = "html{visibility:hidden !important;}";
  (document.head || document.documentElement).appendChild(hideStyle);

  function reveal() {
    var el = document.getElementById("b3-gate-hide-style");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  var closedOverlayEl = null;

  function showClosed() {
    document.documentElement.style.visibility = "visible";
    reveal();

    if (closedOverlayEl) return; // already showing, nothing to do

    var overlay = document.createElement("div");
    overlay.setAttribute("id", "b3-gate-overlay");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;background:#f5f7fa;" +
      "display:flex;flex-direction:column;align-items:center;justify-content:center;" +
      "font-family:Arial, sans-serif;text-align:center;padding:24px;";
    overlay.innerHTML =
      '<div style="font-size:48px;margin-bottom:12px;">🔒</div>' +
      '<h1 style="color:#333;margin:0 0 8px;font-size:28px;">This game is currently closed</h1>' +
      '<p style="color:#4b5563;margin:0 0 24px;max-width:360px;">Ask your teacher to open it, then try again.</p>' +
      '<a href="' + backHref + '" style="background:#1f2937;color:white;padding:10px 20px;' +
      'border-radius:999px;text-decoration:none;font-weight:bold;">Back to Games</a>';

    document.title = "Closed — " + document.title;
    closedOverlayEl = overlay;
    (document.body || document.documentElement).appendChild(overlay);
  }

  function hideClosedOverlay() {
    if (closedOverlayEl && closedOverlayEl.parentNode) {
      closedOverlayEl.parentNode.removeChild(closedOverlayEl);
    }
    closedOverlayEl = null;
  }

  function isEnabled(settings) {
    if (!settings) return true; // no record yet / unreachable: fail open
    if (settings.siteEnabled === false) return false;
    if (settings.games && settings.games[gameId] === false) return false;
    return true;
  }

  function readLocalFallback() {
    try {
      var raw = localStorage.getItem(LOCAL_FALLBACK_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function decide(settings) {
    if (isEnabled(settings)) {
      reveal();
      hideClosedOverlay();
    } else {
      showClosed();
    }
  }

  var hasDecidedOnce = false;

  function applyDecision() {
    fetch(DATABASE_URL + "/" + SETTINGS_PATH + ".json", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("gate fetch failed: " + res.status);
        return res.json();
      })
      .then(function (settings) {
        hasDecidedOnce = true;
        decide(settings);
      })
      .catch(function (err) {
        console.warn("game-gate.js: could not reach settings.", err);
        // Only fall back to the locally-cached value on the very first
        // check (nothing to go on yet). On a later poll, a transient
        // network blip should not suddenly lock out a student who was
        // already confirmed open — just skip this cycle and try again
        // on the next poll.
        if (!hasDecidedOnce) {
          hasDecidedOnce = true;
          decide(readLocalFallback());
        }
      });
  }

  var POLL_INTERVAL_MS = 15000;

  applyDecision();
  setInterval(applyDecision, POLL_INTERVAL_MS);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      applyDecision();
    }
  });
})();
