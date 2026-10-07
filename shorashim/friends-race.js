/* Shorashim — "Play with Friends": a live class race using the shared B3 Race module (../b3-race.js).
 * Everyone in the race gets the same 10 shorashim from the class word list (not just the words one boy
 * has learned), so friends can play together. Rooms are kept per class. */
(function () {
  "use strict";
  var race = null;
  function css() {
    if (document.getElementById("shFriendsCss")) return;
    var s = document.createElement("style"); s.id = "shFriendsCss";
    s.textContent = ".b3r-big.he{font-size:64px;direction:rtl}.b3r-choices button{font-size:20px!important}";
    document.head.appendChild(s);
  }
  function pool() {
    var seen = {}, out = [];
    ["shorashim", "prefix", "suffix"].forEach(function (track) {
      (typeof visibleCatalog === "function" ? visibleCatalog(track) : []).forEach(function (item) {
        var en = String(item.english || "").trim(), he = String(item.front || item.hebrew || "").trim();
        if (!en || !he || seen[en.toLowerCase()]) return;
        seen[en.toLowerCase()] = 1; out.push({ he: he, en: en, track: track });
      });
    });
    return out;
  }
  function mix(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function makeQuestions() {
    var p = pool(), main = p.filter(function (x) { return x.track === "shorashim"; });
    var picks = mix(main.length >= 10 ? main : p).slice(0, 10);
    return picks.map(function (x) {
      var others = mix(p.filter(function (y) { return y.en !== x.en; })).slice(0, 3).map(function (y) { return y.en; });
      return { prompt: x.track === "shorashim" ? "What does this shoresh mean?" : "What does this mean?", big: x.he, bigClass: "he", bigDir: "rtl",
        choices: mix([x.en].concat(others)), answer: x.en, explain: x.he + " = " + x.en };
    });
  }
  async function roomsPath() {
    var id = (typeof cloudStudentId !== "undefined" && cloudStudentId) || "";
    if (!id || !window.FunTorahStudentClass) return "";
    var info = await window.FunTorahStudentClass.resolve(cloudDb, id);
    return info.classId ? "b3Games/workspaces/" + info.workspaceId + "/classes/" + info.classId + "/resources/shorashim/rooms" : "";
  }
  async function open() {
    if (typeof cleanupGameRuntime === "function") cleanupGameRuntime();
    var stage = document.getElementById("gameStage"); if (!stage) return;
    stage.classList.remove("hidden");
    stage.innerHTML = '<div class="game-head"><div><h3>👥 Play with Friends</h3><span class="muted">Race your classmates on 10 shorashim. Most right answers wins!</span></div></div><div id="shFriendsBox"><p class="muted">Loading…</p></div>';
    if (typeof focusGameStage === "function") focusGameStage();
    var box = document.getElementById("shFriendsBox");
    if (pool().length < 4) { box.innerHTML = '<p class="muted">Your class needs at least 4 words in the list before you can race.</p>'; return; }
    var path = "";
    try { path = await roomsPath(); } catch (e) { console.warn("Shorashim race: could not find class", e); }
    if (race) race.leave();
    race = window.B3Race.create({
      container: box, db: cloudDb, roomsPath: path,
      studentId: (typeof cloudStudentId !== "undefined" && cloudStudentId) || "", studentName: (typeof cloudStudentName !== "undefined" && cloudStudentName) || "Player",
      makeQuestions: makeQuestions,
      onFinish: function () { try { if (typeof finishGame === "function") finishGame(); } catch (e) {} },
      onExit: function () { stage.classList.add("hidden"); stage.innerHTML = ""; }
    });
    race.start();
  }
  function install() {
    var grid = document.querySelector("#gamesUnlockedPanel .game-menu-grid");
    if (!grid || !window.B3Race) return;
    css();
    if (!grid.querySelector(".game-choice-friends")) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "feature-card game-choice-friends";
      b.innerHTML = '<span class="feature-icon">👥</span><strong>Play with Friends</strong><span>Race your classmates live on the class shorashim.</span>';
      b.onclick = open; grid.appendChild(b);
    }
    // Leave the race if the boy starts a different game or leaves the page.
    grid.querySelectorAll(".game-choice").forEach(function (g) { g.addEventListener("click", function () { if (race) race.leave(); }); });
    window.addEventListener("pagehide", function () { if (race) race.leave(); });
    document.addEventListener("click", function (e) { if (race && e.target.closest && e.target.closest(".backBtn,[data-screen],.nav-btn")) race.leave(); }, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
})();
