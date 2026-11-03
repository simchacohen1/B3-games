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
  async function roomsPath(id) {
    return window.B3Race.classRoomsPath(cloudDb, id || "", "shorashim");
  }
  async function open() {
    if (typeof cleanupGameRuntime === "function") cleanupGameRuntime();
    if (typeof goScreen === "function") goScreen("gamesScreen");
    var stage = document.getElementById("gameStage"); if (!stage) return;
    stage.classList.remove("hidden");
    stage.innerHTML = '<div class="game-head"><div><h3>👥 Play with Friends</h3><span class="muted">Race your classmates on 10 shorashim. Most right answers wins!</span></div></div><div id="shFriendsBox"><p class="muted">Loading…</p></div>';
    if (typeof focusGameStage === "function") focusGameStage();
    var box = document.getElementById("shFriendsBox");
    // Direct launches from Multiplayer Center can beat app.js account
    // restoration. Do not create a room until the shared student session is
    // available and the app has finished its initial home-screen render, or
    // that render will hide the newly opened race.
    var readyUntil = Date.now() + 15000;
    while (!((typeof cloudStudentId !== "undefined" && cloudStudentId || typeof teacherPreview !== "undefined" && teacherPreview) && typeof appStarted !== "undefined" && appStarted) && Date.now() < readyUntil) {
      await new Promise(function (resolve) { setTimeout(resolve, 100); });
    }
    if (!((typeof cloudStudentId !== "undefined" && cloudStudentId || typeof teacherPreview !== "undefined" && teacherPreview) && typeof appStarted !== "undefined" && appStarted)) {
      box.textContent = "Please sign in with a student or assigned teacher account to play with friends.";
      return;
    }
    if (pool().length < 4) { box.innerHTML = '<p class="muted">Your class needs at least 4 words in the list before you can race.</p>'; return; }
    var path = "", centerPath = "", actor;
    try { actor = await window.B3MultiplayerIdentity.resolve(cloudDb, firebase.auth().currentUser, new URLSearchParams(location.search).get("class") || "", (typeof cloudStudentId !== "undefined" && cloudStudentId) || ""); }
    catch (e) { box.textContent = e.message || "Sign in with an assigned class account to play."; return; }
    try { path = await roomsPath(actor.participantId); } catch (e) { console.warn("Shorashim race: could not find class", e); }
    try { centerPath = await window.B3Race.classCenterRoomsPath(cloudDb, actor.participantId); } catch (e) { console.warn("Shorashim center: could not find class", e); }
    if (race) race.leave();
    race = window.B3Race.create({
      container: box, db: cloudDb, roomsPath: path, centerPath: centerPath,
      gameKey: "shorashim", gameName: "Shorashim Race", gameUrl: "../shorashim/index.html", centerUrl: "../multiplayer/index.html",
      onRoomCreated: window.B3Race.saveHostRoomCode,
      studentId: actor.participantId, studentName: actor.participantName, role: actor.role,
      makeQuestions: makeQuestions,
      onFinish: function () { try { if (typeof finishGame === "function") finishGame(); } catch (e) {} },
      onExit: function () { stage.classList.add("hidden"); stage.innerHTML = ""; }
    });
    if (!window.B3Race.launchFromUrl(race)) race.start();
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
    document.addEventListener("click", function (e) { if (race && e.target.closest && e.target.closest(".backBtn,[data-screen],.nav-btn")) race.leave(); }, true);
    var params = new URLSearchParams(location.search);
    if (params.get("b3Multiplayer") === "start" || params.get("b3Multiplayer") === "host" || params.get("b3MultiplayerRoom")) open();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
})();
