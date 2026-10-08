/* Yiddish — "Play with Friends": a live class race using the shared B3 Race module (../b3-race.js).
 * Everyone in the race gets the same 10 Yiddish words, picked from the steps the class has open,
 * and picks the English meaning. Rooms are kept per class. */
(function () {
  "use strict";
  var race = null, db = null;
  var $ = function (id) { return document.getElementById(id); };
  var OTHER = ["practice", "flashcards", "storyquiz", "sentencegame", "soundgame"];

  function css() {
    if ($("yiFriendsCss")) return;
    var s = document.createElement("style"); s.id = "yiFriendsCss";
    s.textContent = "#friendsgame{margin:18px 0}#friendsgame .b3r-big.yi{font-size:58px;direction:rtl}" +
      "#friendsgame .b3r-choices button{font-size:20px}#friendsgame h2{margin:0 0 4px}#friendsgame .fr-sub{margin:0 0 14px;color:#536180;font-weight:700}" +
      ".activity-friends .activity-icon{background:#e9e4ff}";
    document.head.appendChild(s);
  }
  function mix(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  // All words in the steps this class has open (the same for everyone in the class).
  function pool() {
    var out = [], seen = {};
    try {
      if (!config || !config.sections) return out;
      config.sections.forEach(function (s, g) {
        for (var p = 0; p < partCount(g); p++) {
          if (!stepOpen(g, p)) continue;
          newWords(g, p).forEach(function (id) {
            var w = word(id); if (!w || !w.yi || !w.en) return;
            var k = String(w.en).trim().toLowerCase(); if (seen[k]) return; seen[k] = 1;
            out.push({ yi: w.yi, en: String(w.en).trim() });
          });
        }
      });
    } catch (e) { console.warn("Yiddish race: could not read words", e); }
    return out;
  }
  function makeQuestions() {
    var p = pool();
    if (p.length < 4) throw new Error("Your class needs at least 4 open Yiddish words before you can race.");
    return mix(p).slice(0, 10).map(function (x) {
      var others = mix(p.filter(function (y) { return y.en !== x.en; })).slice(0, 3).map(function (y) { return y.en; });
      return { prompt: "What does this Yiddish word mean?", big: x.yi, bigClass: "yi", bigDir: "rtl",
        choices: mix([x.en].concat(others)), answer: x.en, explain: x.yi + " = " + x.en };
    });
  }
  function getDb() {
    if (db) return db;
    if (!window.firebase || !window.B3_FIREBASE_CONFIG) return null;
    if (!firebase.apps.length) firebase.initializeApp(window.B3_FIREBASE_CONFIG);
    db = firebase.database(); return db;
  }
  function close() {
    if (race) race.leave();
    window.yiddishFriendsOpen = false;
    var box = $("friendsgame"); if (box) { box.hidden = true; box.innerHTML = ""; }
  }
  function backToWords() {
    close();
    $("words").hidden = false; $("toolbar").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function open() {
    if (typeof busy !== "undefined" && busy) return;
    try { if (typeof clearAdvance === "function") clearAdvance(); round = null; flash = null; storyQuiz = null; sentenceGame = null; soundGame = null; } catch (e) {}
    OTHER.forEach(function (id) { var x = $(id); if (x) x.hidden = true; });
    window.yiddishFriendsOpen = true;
    $("words").hidden = true; $("toolbar").hidden = true;
    var sec = $("friendsgame"); sec.hidden = false;
    sec.innerHTML = '<h2>👥 Play with Friends</h2><p class="fr-sub">Race your classmates on 10 Yiddish words. Most right answers wins!</p><div id="yiFriendsBox"><p>Loading…</p></div>';
    requestAnimationFrame(function () { sec.scrollIntoView({ behavior: "smooth", block: "start" }); });
    var box = $("yiFriendsBox"), d = getDb(), id = "", name = "";
    try { id = String(sessionStorage.getItem("b3Games_studentId") || "").trim(); name = sessionStorage.getItem("b3Games_studentName") || ""; } catch (e) {}
    if (student && student.name) name = student.name;
    if (window.YiddishAPI.preview) { box.textContent = 'Class races require student accounts. Use solo activities for demonstrations.'; return; }
    var path = await window.B3Race.classRoomsPath(d, id, "yiddish");
    if (race) race.leave();
    race = window.B3Race.create({
      container: box, db: d, roomsPath: path, studentId: id, studentName: name || "Player",
      makeQuestions: makeQuestions,
      onExit: backToWords
    });
    race.start();
  }
  function install() {
    css();
    var grid = document.querySelector("#toolbar .activity-grid"), lesson = $("lesson");
    if (!grid || !lesson || $("friendsStart")) return;
    var sec = document.createElement("section"); sec.id = "friendsgame"; sec.hidden = true;
    lesson.insertBefore(sec, $("toolbar"));
    var b = document.createElement("button"); b.id = "friendsStart"; b.className = "activity-card activity-friends"; b.type = "button";
    b.innerHTML = '<span class="activity-icon">👥</span><span class="activity-text"><strong>Play with Friends</strong><small>Race your classmates live!</small></span><span class="activity-arrow">→</span>';
    b.onclick = open;
    var all = $("all"); grid.insertBefore(b, all || null);
    // Any other activity or step button closes the race.
    ["start", "flashStart", "sentenceStart", "soundStart", "storyQuizStart", "all"].forEach(function (x) {
      var el = $(x); if (el) el.addEventListener("click", close, true);
    });
    $("segments").addEventListener("click", close, true);
    window.addEventListener("pagehide", close);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
})();
