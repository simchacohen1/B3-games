(function () {
  "use strict";
  var GAMES = [
    { key: "shorashim", name: "Shorashim Race", icon: "🔤", description: "Race classmates on the class shorashim.", url: "../shorashim/index.html", mode: "start" },
    { key: "yiddish", name: "Yiddish Race", icon: "🗣️", description: "Match Yiddish words with your classmates.", url: "../yiddish/index.html", mode: "start" },
    { key: "gematria", name: "Gematria Race", icon: "🔢", description: "Race friends in the existing Gematria game.", url: "../gematria/index.html", mode: "start" },
    { key: "weekly-quiz", name: "Weekly Quiz Race", icon: "📘", description: "Choose a quiz, then invite classmates to race.", url: "../weekly-quiz/practice.html", mode: "configure" },
    { key: "rashi-letters", name: "Rashi Letters Match", icon: "✍️", description: "Match Rashi letters in the live class game.", url: "../rashi-letters/student.html", mode: "start" }
  ];
  var sessionId = "", sessionName = "", db = null, roomsRef = null, roomsListener = null, scopeKey = "";
  var statusBox = document.getElementById("accountStatus");
  var cards = document.getElementById("games"), invitations = document.getElementById("invitations");
  var invitationSection = document.getElementById("invitationSection");

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function gameFor(key) { return GAMES.find(function (game) { return game.key === key; }); }
  function route(game, mode, code) {
    var url = new URL(game.url, location.href);
    url.searchParams.set("b3Multiplayer", mode);
    if (code) url.searchParams.set("b3MultiplayerRoom", code);
    location.assign(url.href);
  }
  function drawGames(ready) {
    cards.replaceChildren();
    GAMES.forEach(function (game) {
      var card = make("article", "game"), button = make("button", "btn", "Start Game");
      card.append(make("h3", "", game.icon + " " + game.name), make("p", "", game.description), button);
      button.type = "button"; button.disabled = !ready;
      button.addEventListener("click", function () { route(game, game.mode); });
      cards.appendChild(card);
    });
  }
  function declinedRooms() {
    try { return new Set(JSON.parse(sessionStorage.getItem("fttMultiplayerDeclined:" + scopeKey) || "[]")); }
    catch (e) { return new Set(); }
  }
  function decline(id) {
    var ids = declinedRooms(); ids.add(id);
    try { sessionStorage.setItem("fttMultiplayerDeclined:" + scopeKey, JSON.stringify(Array.from(ids))); } catch (e) {}
  }
  function renderRooms(all) {
    var ignored = declinedRooms(), visible = Object.entries(all || {}).filter(function (entry) {
      var id = entry[0], room = entry[1];
      return room && room.host !== sessionId && room.state === "lobby" && room.roomCode && gameFor(room.gameKey) && !ignored.has(id) &&
        room.createdAt && Date.now() - Number(room.createdAt) < 20 * 60 * 1000;
    });
    invitations.replaceChildren();
    invitationSection.hidden = !visible.length;
    visible.sort(function (a, b) { return Number(a[1].createdAt) - Number(b[1].createdAt); }).forEach(function (entry) {
      var id = entry[0], room = entry[1], game = gameFor(room.gameKey), card = make("article", "invite");
      card.append(make("h3", "", (room.hostName || "A classmate") + " wants to play"),
        make("p", "", game.icon + " " + game.name),
        make("small", "", Math.max(1, Number(room.playerCount) || 1) + " player" + (Number(room.playerCount) === 1 ? "" : "s") + " waiting"));
      var actions = make("div", "invite-actions"), join = make("button", "btn", "Join Game"), later = make("button", "quiet", "Not Now");
      join.type = later.type = "button";
      join.addEventListener("click", function () { join.disabled = true; route(game, "join", String(room.roomCode)); });
      later.addEventListener("click", function () { decline(id); renderRooms(all); });
      actions.append(join, later); card.appendChild(actions); invitations.appendChild(card);
    });
  }
  function start() {
    drawGames(false);
    try {
      sessionId = String(sessionStorage.getItem("b3Games_studentId") || sessionStorage.getItem("posukPractice_studentId") || "").trim();
      sessionName = String(sessionStorage.getItem("b3Games_studentName") || sessionStorage.getItem("posukPractice_studentName") || "Student");
    } catch (e) {}
    if (!sessionId || !window.firebase || !window.B3_FIREBASE_CONFIG) {
      statusBox.className = "notice error";
      statusBox.replaceChildren(document.createTextNode("Sign in on Fun Torah Tools first. "));
      var link = make("a", "", "Go to sign in"); link.href = "../index.html"; statusBox.appendChild(link); return;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(window.B3_FIREBASE_CONFIG);
      db = firebase.database();
    } catch (e) {
      statusBox.className = "notice error"; statusBox.textContent = "Could not connect to multiplayer right now. Try again in a moment."; return;
    }
    firebase.auth().onAuthStateChanged(async function (user) {
      if (!user) {
        statusBox.className = "notice error"; statusBox.textContent = "Your saved sign-in has expired. Please sign in on Fun Torah Tools again."; return;
      }
      try {
        var path = await window.B3Race.classCenterRoomsPath(db, sessionId);
        if (!path) throw new Error("class scope unavailable");
        scopeKey = path;
        roomsRef = db.ref(path);
        statusBox.className = "notice good";
        statusBox.textContent = "Signed in as " + sessionName + ". Showing games for your class.";
        drawGames(true);
        if (roomsListener) roomsRef.off("value", roomsListener);
        roomsListener = roomsRef.on("value", function (snapshot) { renderRooms(snapshot.val() || {}); }, function () {
          statusBox.className = "notice error"; statusBox.textContent = "Could not load your class's waiting games. Refresh to try again.";
        });
      } catch (e) {
        console.warn("Multiplayer Center: class access check failed", e);
        statusBox.className = "notice error";
        statusBox.textContent = "A class sign-in is required to use the Multiplayer Center. Please sign in again or ask your teacher to check your class access.";
      }
    });
  }
  window.addEventListener("pagehide", function () { if (roomsRef && roomsListener) roomsRef.off("value", roomsListener); });
  start();
})();
