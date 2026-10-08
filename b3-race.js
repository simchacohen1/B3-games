/*
 * B3 Race — shared live multiplayer ("Play with friends") for B3 Games.
 * Based on the Rashi Letters match race: one boy opens a game, classmates who
 * tap "Play with friends" are offered to join, the host starts, everyone gets
 * the same questions, and a live scoreboard shows who is ahead.
 *
 * Usage (from any game page that already has Firebase + a signed-in student):
 *   const race = B3Race.create({
 *     container: element,            // where the race draws itself
 *     db, roomsPath,                 // Firebase database + path for this game's rooms (class-scoped)
 *     studentId, studentName,
 *     makeQuestions: () => [{prompt, big, bigClass, choices:[...], answer, choiceClass, explain}],  // may also return a Promise
 *     roomInfo: () => ({label:'Level 2'}),   // optional extra info shown on invitations
 *     onCorrect: () => {}, onFinish: ({won, score, total}) => {}, onExit: () => {}
 *   });
 *   race.start();   // opens the friends screen
 *   race.leave();   // call when the student navigates away
 *   B3Race.classRoomsPath(db, studentId, "my-game")  // Promise of the class-scoped rooms path ("" if no class)
 */
(function (root) {
  "use strict";
  var OPEN_MS = 20 * 60 * 1000, STALE_MS = 3 * 3600 * 1000, MAX_PLAYERS = 8;
  var CSS = ".b3r{font-family:inherit;text-align:center}" +
    ".b3r-panel{background:#f8f9ff;border:2px solid #e0e5f3;border-radius:20px;padding:18px;margin-bottom:14px}" +
    ".b3r h3{margin:0 0 8px;font-size:21px;color:#1f2d5a}.b3r p{margin:6px 0}" +
    ".b3r-btn{border:0;border-radius:12px;padding:11px 20px;font:inherit;font-weight:900;background:#173b62;color:#fff;cursor:pointer;box-shadow:0 3px 0 #0f2a47}" +
    ".b3r-btn:disabled{opacity:.5;cursor:default}.b3r-small{border:0;background:none;color:#475569;font:inherit;font-weight:800;cursor:pointer;margin-top:12px;padding:8px}" +
    ".b3r-offer{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#f3fbf8;border:2px solid #bfe9d8;border-bottom-width:5px;border-radius:16px;padding:12px 14px;margin:8px 0;text-align:left}" +
    ".b3r-offer b{font-size:18px;color:#1f2d5a;display:block}.b3r-offer small{color:#536180;font-weight:700}" +
    ".b3r-players{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:12px 0}" +
    ".b3r-chip{background:#fff;border:2px solid #dbe2f1;border-radius:999px;padding:7px 13px;font-weight:800;color:#1f2d5a}.b3r-chip.me{border-color:#6553d6;background:#ede9ff}" +
    ".b3r-count{font-size:110px;font-weight:900;color:#6553d6;line-height:1.2;animation:b3rpop .5s ease}" +
    "@keyframes b3rpop{0%{transform:scale(.7);opacity:0}100%{transform:scale(1);opacity:1}}" +
    ".b3r-board{background:#f8f9ff;border:2px solid #e0e5f3;border-radius:16px;padding:8px 12px;margin-bottom:12px;text-align:left}" +
    ".b3r-row{display:grid;grid-template-columns:30px minmax(60px,140px) 1fr 52px;align-items:center;gap:8px;padding:4px 0;font-weight:800;font-size:15px}" +
    ".b3r-row.me{color:#3f3099}.b3r-row.left{opacity:.4}.b3r-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".b3r-bar{height:10px;background:#e6e9f4;border-radius:99px;overflow:hidden}.b3r-bar i{display:block;height:100%;background:linear-gradient(90deg,#8b7cf0,#5b47d6);transition:width .3s}" +
    ".b3r-status{font-weight:800;color:#64748b;margin:4px 0}.b3r-prompt{font-size:18px;font-weight:800;color:#475569;margin:6px 0}" +
    ".b3r-big{font-size:64px;font-weight:900;color:#173b62;line-height:1.2;margin:4px 0}" +
    ".b3r-choices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;max-width:460px;margin:10px auto 0}" +
    ".b3r-choices button{border:3px solid #d9e4ee;background:#fff;border-radius:14px;padding:13px 6px;font:inherit;font-size:26px;font-weight:900;color:#173b62;cursor:pointer}" +
    ".b3r-choices button.ok{background:#e5f7ec;border-color:#1f9d55;color:#1f9d55}.b3r-choices button.no{background:#fdecea;border-color:#c0392b;color:#c0392b}" +
    ".b3r-fb{min-height:28px;font-weight:900;font-size:18px;margin-top:10px}.b3r-fb.ok{color:#1f9d55}.b3r-fb.no{color:#b45309}" +
    ".b3r-icon{font-size:60px}";

  function injectCss() {
    if (document.getElementById("b3r-css")) return;
    var s = document.createElement("style"); s.id = "b3r-css"; s.textContent = CSS; document.head.appendChild(s);
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function now() { return Date.now(); }
  function list(x) { return Array.isArray(x) ? x : (x && typeof x === "object" ? Object.keys(x).sort(function (a, b) { return a - b; }).map(function (k) { return x[k]; }) : []); }

  function create(opts) {
    injectCss();
    var db = opts.db, path = opts.roomsPath, me = String(opts.studentId || ""), myName = String(opts.studentName || "Player");
    var box = opts.container, room = null, watch = null, view = 0, creating = false;
    var firebase = root.firebase;

    function draw() { var w = el("div", "b3r"); box.replaceChildren(w); return w; }
    function active(r) { return Object.entries((r && r.players) || {}).filter(function (x) { return x[1] && !x[1].left; }); }
    function allDone(r) { var a = active(r); return a.length > 0 && a.every(function (x) { return x[1].finishedAt; }); }
    function openGames(all) {
      var t = now();
      return Object.entries(all || {}).filter(function (x) {
        var code = x[0], r = x[1];
        return r && r.state === "lobby" && r.createdAt && t - r.createdAt < OPEN_MS && r.players && r.players[r.host] &&
          !r.players[r.host].left && !(room && room.code === code) && active(r).length < MAX_PLAYERS;
      });
    }
    function cleanup(all) {
      var t = now();
      Object.entries(all || {}).forEach(function (x) { var r = x[1]; if (!r || !r.createdAt || t - r.createdAt > STALE_MS) db.ref(path + "/" + x[0]).remove().catch(function () {}); });
    }
    function startWatch() {
      if (watch) return;
      var ref = db.ref(path), cb = ref.on("value", function (s) { onAll(s.val() || {}); }, function (e) { console.warn("B3Race watch failed", e); });
      watch = { ref: ref, cb: cb };
    }
    function stopWatch() { if (watch) { watch.ref.off("value", watch.cb); watch = null; } }
    function onAll(all) {
      if (room) { onRoom(all[room.code] || null, all); return; }
      if (box.querySelector("[data-b3r-offers]")) renderOffers(all);
    }

    async function start(msg) {
      leave(); view++;
      var w = draw();
      if (!me) { w.append(el("p", "b3r-prompt", "Please sign in on B3 Games to play with friends."), backBtn()); return; }
      if (!db || !path) { w.append(el("p", "b3r-prompt", "Ask your teacher to add you to a class to play with friends."), backBtn()); return; }
      w.append(el("p", "b3r-prompt", "Looking for friends…"));
      var v = view;
      try {
        var all = (await db.ref(path).once("value")).val() || {};
        if (v !== view) return;
        cleanup(all);
        if (!openGames(all).length) { await createRoom(); return; }
        startWatch(); renderOffers(all, msg);
      } catch (e) { console.error(e); var w2 = draw(); w2.append(el("p", "b3r-prompt", "Could not reach the game server. Try again in a minute."), backBtn()); }
    }
    function backBtn(label) { var b = el("button", "b3r-small", label || "← Back"); b.type = "button"; b.onclick = function () { view++; leave(); if (opts.onExit) opts.onExit(); }; return b; }

    function offerList(all) {
      var offers = el("div"); offers.setAttribute("data-b3r-offers", "1");
      openGames(all).sort(function (a, b) { return a[1].createdAt - b[1].createdAt; }).forEach(function (x) {
        var code = x[0], r = x[1], names = active(r).map(function (p) { return p[1].name; });
        var card = el("div", "b3r-offer"), txt = el("div");
        txt.append(el("b", null, (r.hostName || names[0] || "A friend") + " wants to play!"),
          el("small", null, (r.label ? r.label + " · " : "") + names.length + " waiting: " + names.join(", ")));
        var j = el("button", "b3r-btn", "Join"); j.type = "button";
        j.onclick = function () { j.disabled = true; join(code).then(function (err) { if (err) start(err); }).catch(function () { start("Could not join. Try again."); }); };
        card.append(txt, j); offers.appendChild(card);
      });
      return offers;
    }
    function renderOffers(all, msg) {
      var found = offerList(all);
      if (!found.children.length) { createRoom().catch(function () {}); return; }
      var w = draw();
      var own = el("button", "b3r-small", "Start my own game instead"); own.type = "button";
      own.onclick = function () { own.disabled = true; createRoom().catch(function () {}); };
      w.append(el("h3", null, "Friends are waiting for you!"), found, el("p", "b3r-fb no", msg || ""), backBtn(), own);
    }

    function showProblem(msg) { var w = draw(); w.append(el("p", "b3r-prompt", msg || "Could not set up the race. Try again."), backBtn()); }
    async function createRoom() { if (creating) return; creating = true; try { await createInner(); } finally { creating = false; } }
    async function createInner() {
      leave();
      var code = null;
      for (var i = 0; i < 8 && !code; i++) {
        var c = String(1000 + Math.floor(Math.random() * 9000));
        var r = (await db.ref(path + "/" + c).once("value")).val();
        if (!r || (r.createdAt && now() - r.createdAt > STALE_MS)) code = c;
      }
      if (!code) throw new Error("no free code");
      var wait = draw(); wait.append(el("p", "b3r-prompt", "Getting the questions ready…"));
      var ref = db.ref(path + "/" + code), players = {};
      players[me] = { name: myName, score: 0, q: 0 };
      var info = (opts.roomInfo && opts.roomInfo()) || {};
      var qs, v = view;
      try { qs = await opts.makeQuestions(); } catch (e) { qs = null; showProblem(e && e.message); return; }
      if (!qs || !list(qs).length) { showProblem("There are no questions to race on yet."); return; }
      if (v !== view) return;
      await ref.set({ host: me, hostName: myName, label: info.label || "", state: "lobby",
        createdAt: firebase.database.ServerValue.TIMESTAMP, questions: qs, players: players });
      ref.onDisconnect().remove();
      enter(code, true);
    }
    async function join(code) {
      var ref = db.ref(path + "/" + code), r = (await ref.once("value")).val();
      if (!r) return "That game closed. Try another one.";
      if (r.state !== "lobby") return "That game already started.";
      if (active(r).length >= MAX_PLAYERS && !(r.players || {})[me]) return "That game is full.";
      leave();
      var mine = ref.child("players/" + me);
      await mine.set({ name: myName, score: 0, q: 0 });
      mine.onDisconnect().update({ left: true });
      enter(code, false);
      return null;
    }
    function enter(code, isHost) {
      view++;
      room = { code: code, ref: db.ref(path + "/" + code), isHost: isHost, data: null, started: false, qi: 0, score: 0, finished: false, shown: null };
      startWatch();
      db.ref(path).once("value").then(function (s) { var all = s.val() || {}; if (room && room.code === code) onRoom(all[code] || null, all); });
    }
    function leave() {
      stopWatch();
      var r = room; if (!r) return; room = null;
      try {
        var st = r.data && r.data.state;
        if (r.isHost && (st === "lobby" || r.shown === "results")) { r.ref.onDisconnect().cancel(); r.ref.remove().catch(function () {}); }
        else if (!r.finished && r.data) { var m = r.ref.child("players/" + me); m.onDisconnect().cancel(); m.update({ left: true }).catch(function () {}); }
      } catch (e) { console.error(e); }
    }

    function onRoom(data, all) {
      var r = room; if (!r) return;
      if (!data) { if (r.shown !== "results") { room = null; start(r.isHost ? "" : "That game was closed."); } return; }
      r.data = data;
      if (data.state === "lobby") { renderLobby(data, all); return; }
      if (r.shown === "results") return;
      if (data.state === "ended" || (r.finished && allDone(data))) { renderResults(data); return; }
      if (data.state === "playing" && !r.started) {
        if (!data.players || !data.players[me] || data.players[me].left) { room = null; start("That game already started."); return; }
        r.started = true; r.ref.onDisconnect().cancel();
        r.ref.child("players/" + me).onDisconnect().update({ left: true });
        countdown(); return;
      }
      if (r.shown === "waiting") { renderWaiting(); return; }
      var old = box.querySelector("[data-b3r-board]"); if (old) old.replaceWith(board(data, false));
    }

    function renderLobby(data, all) {
      var r = room; r.shown = "lobby";
      var w = draw(), panel = el("div", "b3r-panel"), ps = active(data), n = ps.length;
      panel.append(el("h3", null, n < 2 ? "Waiting for friends to join…" : "Your race is ready!"));
      if (data.label) panel.append(el("p", "b3r-status", data.label));
      if (n < 2) panel.append(el("p", null, "When a classmate taps 👥 Play with friends, he’ll be asked to join you."));
      var chips = el("div", "b3r-players");
      ps.forEach(function (x) { chips.appendChild(el("span", "b3r-chip" + (x[0] === me ? " me" : ""), (x[0] === data.host ? "👑 " : "") + (x[0] === me ? "You" : x[1].name))); });
      panel.append(el("div", "b3r-status", n + " player" + (n === 1 ? "" : "s") + " here"), chips);
      if (r.isHost) {
        var go = el("button", "b3r-btn", n < 2 ? "Waiting…" : "▶ Start the race!"); go.type = "button"; go.disabled = n < 2;
        go.onclick = function () { go.disabled = true; r.ref.onDisconnect().cancel(); r.ref.update({ state: "playing", startedAt: firebase.database.ServerValue.TIMESTAMP }); };
        panel.append(go);
      } else panel.append(el("p", "b3r-prompt", "Waiting for " + (data.hostName || "the host") + " to start…"));
      w.append(panel);
      if (r.isHost && n < 2 && all) { var offers = offerList(all); if (offers.children.length) w.append(el("p", "b3r-prompt", "Or join a friend who is waiting:"), offers); }
      w.append(backBtn("← Leave"));
    }

    function countdown() {
      var r = room; r.shown = "countdown"; var v = view, steps = ["3", "2", "1", "Go!"], i = 0;
      (function tick() {
        if (room !== r || v !== view) return;
        if (i >= steps.length) { question(); return; }
        var w = draw(); w.append(el("p", "b3r-prompt", "Get ready…"), el("div", "b3r-count", steps[i])); i++; setTimeout(tick, 750);
      })();
    }

    function ranked(data) {
      return Object.entries(data.players || {}).sort(function (a, b) {
        return ((b[1].score || 0) - (a[1].score || 0)) || ((a[1].finishedAt || Infinity) - (b[1].finishedAt || Infinity));
      });
    }
    function board(data, results) {
      var total = list(data.questions).length || 1, b = el("div", "b3r-board"); b.setAttribute("data-b3r-board", "1");
      ranked(data).forEach(function (x, i) {
        var id = x[0], p = x[1], row = el("div", "b3r-row" + (id === me ? " me" : "") + (p.left ? " left" : ""));
        var medal = results ? (["🥇", "🥈", "🥉"][i] || (i + 1) + ".") : (p.finishedAt ? "🏁" : (i + 1) + ".");
        var bar = el("div", "b3r-bar"), fill = document.createElement("i"); fill.style.width = Math.min(100, (p.q || 0) / total * 100) + "%"; bar.appendChild(fill);
        row.append(el("span", null, medal), el("span", "b3r-name", (id === me ? "You" : p.name) + (p.left ? " (left)" : "")), bar, el("span", null, "⭐ " + (p.score || 0)));
        b.appendChild(row);
      });
      return b;
    }

    function question() {
      var r = room; if (!r) return; r.shown = "question";
      var qs = list(r.data.questions), q = qs[r.qi], v = view, w = draw();
      var big = el("div", "b3r-big " + (q.bigClass || "")); big.textContent = q.big; if (q.bigDir) big.dir = q.bigDir;
      var row = el("div", "b3r-choices"), fb = el("div", "b3r-fb");
      list(q.choices).forEach(function (ch) {
        var b = el("button", q.choiceClass || "", ch); b.type = "button";
        b.onclick = function () {
          row.querySelectorAll("button").forEach(function (x) { x.disabled = true; });
          var ok = String(ch) === String(q.answer);
          if (ok) { b.classList.add("ok"); r.score++; fb.className = "b3r-fb ok"; fb.textContent = "Got it! ⭐"; if (opts.onCorrect) opts.onCorrect(q); }
          else { b.classList.add("no"); row.querySelectorAll("button").forEach(function (x) { if (x.textContent === String(q.answer)) x.classList.add("ok"); });
            fb.className = "b3r-fb no"; fb.textContent = q.explain || "The green one is right."; if (opts.onWrong) opts.onWrong(q); }
          r.qi++;
          var upd = { score: r.score, q: r.qi };
          if (r.qi >= qs.length) { upd.finishedAt = firebase.database.ServerValue.TIMESTAMP; r.finished = true; r.ref.child("players/" + me).onDisconnect().cancel(); }
          r.ref.child("players/" + me).update(upd).catch(function () {});
          setTimeout(function () { if (room !== r || v !== view) return; if (r.qi >= qs.length) renderWaiting(); else question(); }, ok ? 650 : 1400);
        };
        row.appendChild(b);
      });
      w.append(board(r.data, false), el("div", "b3r-status", "Question " + (r.qi + 1) + " of " + qs.length), el("p", "b3r-prompt", q.prompt || ""), big, row, fb);
    }

    function renderWaiting() {
      var r = room; if (!r) return;
      if (allDone(r.data) || r.data.state === "ended") { renderResults(r.data); return; }
      r.shown = "waiting";
      var w = draw();
      w.append(el("div", "b3r-icon", "🏁"), el("p", "b3r-prompt", "You finished with ⭐ " + r.score + "! Waiting for your friends…"), board(r.data, false));
      if (r.isHost) { var end = el("button", "b3r-small", "End the game now"); end.type = "button"; end.onclick = function () { r.ref.update({ state: "ended" }); }; w.append(end); }
    }

    function renderResults(data) {
      var r = room; if (!r || r.shown === "results") return; r.shown = "results";
      r.ref.child("players/" + me).onDisconnect().cancel();
      if (r.isHost) r.ref.onDisconnect().remove();
      var order = ranked(data), won = order.length && order[0][0] === me, w = draw();
      var again = el("button", "b3r-btn", "Play again"); again.type = "button"; again.onclick = function () { start(); };
      w.append(el("div", "b3r-icon", won ? "🏆" : "🎉"), el("h3", null, won ? "You won the race!" : (order[0] ? order[0][1].name + " wins!" : "Game over")), board(data, true), again, backBtn("← Back to menu"));
      var mine = (data.players && data.players[me] && data.players[me].score) || 0;
      if (opts.onFinish) opts.onFinish({ won: !!won, score: mine, total: list(data.questions).length });
    }

    return { start: start, leave: leave };
  }

  /* Finds this student's class and returns the rooms path for a game, or "" if he has no class. */
  function classRoomsPath(db, studentId, gameKey) {
    if (!db || !studentId || !root.FunTorahStudentClass) return Promise.resolve("");
    return root.FunTorahStudentClass.resolve(db, studentId).then(function (info) {
      return info && info.classId ? "b3Games/workspaces/" + info.workspaceId + "/classes/" + info.classId + "/resources/" + gameKey + "/rooms" : "";
    }).catch(function (e) { console.warn("B3Race: could not find class", e); return ""; });
  }

  root.B3Race = { create: create, classRoomsPath: classRoomsPath };
})(window);
