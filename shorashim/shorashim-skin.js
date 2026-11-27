/* Shorashim "Learning Lab" skin — look-and-feel helper.
 * Added 2026-10-13. Does NOT change how the app works: it only
 *   - puts the magnifier logo + two-line title in the header
 *   - shows a trophy / progress pill (reads the "x / y learned" count the app already makes)
 *   - renames a few buttons to friendlier words
 *   - adds a "Reset Design" button next to the Art Lab tabs (it just presses the app's own Reset button)
 * To undo: remove the shorashim-skin lines from index.html.
 */
(function () {
  "use strict";

  var LOGO =
    '<svg class="sk-logo" viewBox="0 0 64 64" aria-hidden="true">' +
    '<path d="M44 44l14 14" stroke="#8a5a2b" stroke-width="7" stroke-linecap="round"/>' +
    '<circle cx="27" cy="27" r="20" fill="#cfeeff" stroke="#3d7fc4" stroke-width="5"/>' +
    '<path d="M16 20a14 14 0 0 1 9-8" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"/>' +
    '<path d="M27 40V26" stroke="#2f9a57" stroke-width="3.5" stroke-linecap="round"/>' +
    '<path d="M27 28c-8 0-11-5-11-10 7 0 11 3 11 10z" fill="#4cc26e"/>' +
    '<path d="M27 25c0-7 4-10 11-10 0 6-4 10-11 10z" fill="#2fa65a"/>' +
    '' +
    '</svg>';

  var TAB_LABELS = {
    text: "✏️ Text & Card",
    pictures: "🎨 Pictures & Emojis",
    draw: "🖌️ Draw"
  };

  function setText(el, txt) {
    if (el && el.textContent !== txt) el.textContent = txt;
  }

  function brandHeader() {
    var h1 = document.querySelector(".topbar h1");
    if (!h1 || h1.dataset.skReady === "1") return;
    h1.dataset.skReady = "1";
    h1.setAttribute("aria-label", "Shorashim Learning Lab");
    h1.innerHTML = LOGO + '<span class="sk-words"><span>Shorashim</span><span>Learning Lab</span></span>';
  }

  /* Top tracker: two numbers for the signed-in student.
     Learned  = words where a picture was drawn or saved (the card has been learned).
     Mastered = words with Learned + Tracing + Multiple choice + Matching done (mastery tracking).
     Read-only: nothing here writes progress. */
  var trk = { at: 0, timer: 0, learned: -1, mastered: -1 };
  function trackerCounts() {
    var M = window.ShorashimMastery;
    if (!M || typeof student !== "function" || typeof visibleCatalog !== "function") return null;
    var s = student();
    if (!s) return null;
    var seen = {}, items = [];
    function add(key, it) {
      if (!it || seen[key]) return;
      seen[key] = 1;
      items.push({ key: key, track: "shorashim", front: it.front || "", english: it.english || "" });
    }
    visibleCatalog("shorashim").forEach(function (it) { add("shorashim:" + it.id, it); });
    if (typeof chumashExtra === "function") chumashExtra().forEach(function (it) { add("shorashim:" + it.id, it); });
    Object.keys(s.cards || {}).concat(Object.keys(s.practice || {})).forEach(function (k) {
      if (k.indexOf("shorashim:") === 0 && !seen[k] && typeof getItem === "function") add(k, getItem(k));
    });
    var sum = M.summarizeStudent(s, M.groupWords(items));
    return { learned: sum.stages.learned, mastered: sum.mastered };
  }

  function progressPill() {
    var actions = document.querySelector(".topbar-actions");
    if (!actions) return;
    var pill = actions.querySelector(".sk-progress");
    if (!pill) {
      pill = document.createElement("div");
      pill.className = "sk-progress";
      pill.hidden = true;
      pill.innerHTML =
        '<span class="sk-trophy" aria-hidden="true">🏆</span>' +
        '<div class="sk-count" data-kind="learned"><b>0</b><small>LEARNED</small></div>' +
        '<div class="sk-count" data-kind="mastered"><b>0</b><small>MASTERED</small></div>';
      actions.insertBefore(pill, actions.firstChild);
    }
    // Working this out is a bit heavy, so do it at most twice a second.
    var wait = 500 - (Date.now() - trk.at);
    if (wait > 0) {
      if (!trk.timer) trk.timer = setTimeout(function () { trk.timer = 0; progressPill(); }, wait);
      return;
    }
    trk.at = Date.now();
    var c = trackerCounts();
    if (!c) { pill.hidden = true; return; }
    pill.hidden = false;
    setText(pill.querySelector('[data-kind="learned"] b'), String(c.learned));
    setText(pill.querySelector('[data-kind="mastered"] b'), String(c.mastered));
  }

  function friendlyLabels() {
    // Home buttons
    document.querySelectorAll(".backBtn").forEach(function (b) {
      if (b.textContent.trim() === "← Home") b.textContent = "🏠 Home";
    });

    // Art Lab tabs
    document.querySelectorAll(".ux-tool-tab").forEach(function (t) {
      var label = TAB_LABELS[t.dataset.tool];
      if (label) setText(t, label);
    });

    // Picture buttons
    setText(document.getElementById("artSmallerBtn"), "Small");
    setText(document.getElementById("artBiggerBtn"), "BIG");
    setText(document.getElementById("removeArtBtn"), "🗑 Delete");
    setText(document.getElementById("removeAllArtBtn"), "Remove all");

    // Save button: copy whatever the app's own Save button says, plus a rocket
    var quick = document.querySelector(".ux-quick-save");
    var real = document.getElementById("saveCardBtn");
    if (quick && real) {
      var base = String(real.textContent || "").replace(/\s*🚀\s*$/, "").trim();
      if (base) setText(quick, base + " 🚀");
    }
  }

  function resetButton() {
    var strip = document.querySelector(".ux-tool-tabs");
    var real = document.getElementById("resetCardBtn");
    if (!strip || !real) return;
    if (strip.querySelector(".sk-reset")) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sk-reset";
    btn.textContent = "Reset Design ↺";
    btn.title = "Start this card's design over";
    btn.addEventListener("click", function () { real.click(); });
    strip.appendChild(btn);
    document.body.classList.add("sk-has-reset");
  }

  function apply() {
    try {
      brandHeader();
      progressPill();
      friendlyLabels();
      resetButton();
    } catch (e) {
      console.warn("Shorashim skin:", e);
    }
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; apply(); });
  }

  function boot() {
    apply();
    new MutationObserver(schedule).observe(document.documentElement, {
      childList: true, subtree: true, characterData: true
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
