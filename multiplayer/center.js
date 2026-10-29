(function () {
  "use strict";
  var GAMES = [
    { key: "shorashim", name: "Shorashim Race", icon: "🔤", description: "Race classmates on the class shorashim.", url: "../shorashim/index.html", mode: "start" },
    { key: "yiddish", name: "Yiddish Race", icon: "🗣️", description: "Match Yiddish words with your classmates.", url: "../yiddish/index.html", mode: "start" },
    { key: "gematria", name: "Gematria Race", icon: "🔢", description: "Race friends in the existing Gematria game.", url: "../gematria/index.html", mode: "start" },
    { key: "weekly-quiz", name: "Weekly Quiz Race", icon: "📘", description: "Choose a quiz, then invite classmates to race.", url: "../weekly-quiz/practice.html", mode: "configure" },
    { key: "rashi-letters", name: "Rashi Letters Match", icon: "✍️", description: "Match Rashi letters in the live class game.", url: "../rashi-letters/student.html", mode: "start" },
    { key: "connect-four", name: "Connect 4", icon: "🟡", description: "Drop colored discs and connect four in a row.", url: "game.html?game=connect-four", mode: "start" },
    { key: "tic-tac-toe", name: "Tic Tac Toe", icon: "⭕", description: "Take turns and make three in a row.", url: "game.html?game=tic-tac-toe", mode: "start" },
    { key: "memory-match", name: "Memory Match", icon: "🧠", description: "Flip cards and find matching pairs with your class.", url: "game.html?game=memory-match", mode: "start" },
    { key: "checkers", name: "Checkers", icon: "♟️", description: "Jump opposing checkers and crown your kings.", url: "game.html?game=checkers", mode: "start" },
    { key: "reversi", name: "Reversi", icon: "⚫", description: "Flip discs and finish with the most of your color.", url: "game.html?game=reversi", mode: "start" },
    { key: "bingo", name: "Bingo", icon: "🎱", description: "Mark called numbers and complete a line.", url: "game.html?game=bingo", mode: "start" },
    { key: "math-race", name: "Math Race", icon: "➕", description: "Solve the same friendly math problems for points.", url: "game.html?game=math-race", mode: "start" },
    { key: "set", name: "Set", icon: "🟣", description: "Spot groups of three cards with matching patterns.", url: "game.html?game=set", mode: "start" },
    { key: "ludo", name: "Ludo", icon: "🎲", description: "Roll the die and race four tokens home.", url: "game.html?game=ludo", mode: "start" },
    { key: "dominoes", name: "Dominoes", icon: "🁣", description: "Match tiles and empty your hand to win.", url: "game.html?game=dominoes", mode: "start" },
    { key: "go-fish", name: "Go Fish", icon: "🐟", description: "Ask classmates for cards and collect complete sets.", url: "game.html?game=go-fish", mode: "start" },
    { key: "uno-style", name: "Uno-style Cards", icon: "🃏", description: "Match colors and numbers with simple action cards.", url: "game.html?game=uno-style", mode: "start" }
  ];
  var sessionId = "", sessionName = "", db = null, roomsRef = null, roomsListener = null, scopeKey = "";
  var statusBox = document.getElementById("accountStatus");
  var cards = document.getElementById("games"), invitations = document.getElementById("invitations");
  var invitationSection = document.getElementById("invitationSection");
  var invitationSummary = document.getElementById("invitationSummary");

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
  // Presentation-only category grouping: existing multiplayer routing and permissions remain unchanged.
  var CATEGORIES = [
    { key: "all", label: "All Games", icon: "🎮" },
    { key: "torah", label: "Torah & Jewish", icon: "📖" },
    { key: "strategy", label: "Board & Strategy", icon: "♟️" },
    { key: "cards", label: "Cards & Matching", icon: "🃏" },
    { key: "challenges", label: "Quick Challenges", icon: "⚡" }
  ];
  var GAME_CATEGORIES = {
    shorashim: "torah", yiddish: "torah", gematria: "torah", "weekly-quiz": "torah", "rashi-letters": "torah",
    "connect-four": "strategy", "tic-tac-toe": "strategy", checkers: "strategy", reversi: "strategy", ludo: "strategy",
    "memory-match": "cards", set: "cards", dominoes: "cards", "go-fish": "cards", "uno-style": "cards",
    bingo: "challenges", "math-race": "challenges"
  };
  var selectedCategory = "all";
  var readyToPlay = false;
  var categoriesEl = document.getElementById("gameCategories");
  var categoryButtons = Object.create(null);
  var gameResultsSummary = document.getElementById("gameResultsSummary");
  function updateCategoryButtons() {
    CATEGORIES.forEach(function (category) {
      var tab = categoryButtons[category.key];
      if (!tab) {
        var count = category.key === "all" ? GAMES.length : GAMES.filter(function (game) { return GAME_CATEGORIES[game.key] === category.key; }).length;
        tab = make("button", "category-tab", category.icon + " " + category.label + " · " + count);
        tab.type = "button";
        tab.setAttribute("aria-controls", "games");
        tab.setAttribute("aria-label", category.label + ", " + count + " games");
        tab.addEventListener("click", function () {
          selectedCategory = category.key;
          drawGames();
        });
        categoryButtons[category.key] = tab;
        categoriesEl.appendChild(tab);
      }
      var selected = selectedCategory === category.key;
      tab.classList.toggle("is-selected", selected);
      tab.setAttribute("aria-pressed", String(selected));
    });
  }
  function drawGames() {
    cards.replaceChildren();
    updateCategoryButtons();
    var visibleGames = GAMES.filter(function (game) { return selectedCategory === "all" || GAME_CATEGORIES[game.key] === selectedCategory; });
    gameResultsSummary.textContent = selectedCategory === "all"
      ? "Showing all " + visibleGames.length + " games."
      : "Showing " + visibleGames.length + " games in " + CATEGORIES.find(function (category) { return category.key === selectedCategory; }).label + ".";
    visibleGames.forEach(function (game) {
      var category = GAME_CATEGORIES[game.key];
      var card = make("article", "game game-" + category + " game-" + game.key);
      var button = make("button", "game-launch");
      var picture = make("span", "game-art");
      picture.setAttribute("aria-hidden", "true");
      picture.appendChild(make("span", "game-art-symbol", game.icon));
      var details = make("span", "game-details");
      details.append(make("span", "game-name", game.name), make("span", "game-description", game.description));
      var footer = make("span", "game-launch-footer");
      footer.append(make("span", "game-type", CATEGORIES.find(function (c) { return c.key === category; }).label), make("span", "game-play-label", "Play  ›"));
      button.append(picture, details, footer);
      button.type = "button";
      button.disabled = !readyToPlay;
      button.setAttribute("aria-label", "Start Game: " + game.name);
      button.addEventListener("click", function () { route(game, game.mode); });
      card.appendChild(button);
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
  function savedRejoin() {
    try {
      var saved = JSON.parse(sessionStorage.getItem("fttMultiplayerRejoin:" + sessionId) || "null");
      return saved && /^\d{6}$/.test(saved.roomCode || "") && gameFor(String(saved.gameKey || ""))
        ? { roomCode: saved.roomCode, gameKey: saved.gameKey } : null;
    } catch (e) { return null; }
  }
  function renderRooms(all) {
    var ignored = declinedRooms(), visible = Object.entries(all || {}).filter(function (entry) {
      var id = entry[0], room = entry[1];
      return room && room.host !== sessionId && room.state === "lobby" && room.roomCode && gameFor(room.gameKey) && !ignored.has(id) &&
        room.createdAt && Date.now() - Number(room.createdAt) < 20 * 60 * 1000;
    });
    var saved = savedRejoin();
    invitations.replaceChildren();
    invitationSection.hidden = !visible.length && !saved;
    invitationSummary.textContent = visible.length
      ? visible.length + (visible.length === 1 ? " classmate game is" : " classmate games are") + " ready to join."
      : "Pick up where you left off.";
    if (saved) {
      var savedGame = gameFor(saved.gameKey), resume = make("article", "invite");
      resume.append(make("h3", "", "Resume your game"),
        make("p", "", savedGame.icon + " " + savedGame.name),
        make("small", "", "You left this game. Rejoin to continue."));
      var resumeActions = make("div", "invite-actions");
      var rejoin = make("button", "btn", "Rejoin game");
      rejoin.type = "button";
      rejoin.addEventListener("click", function () { route(savedGame, "join", saved.roomCode); });
      var dismiss = make("button", "quiet", "Dismiss");
      dismiss.type = "button";
      dismiss.addEventListener("click", function () {
        try { sessionStorage.removeItem("fttMultiplayerRejoin:" + sessionId); } catch (e) {}
        renderRooms(all);
      });
      resumeActions.append(rejoin, dismiss); resume.appendChild(resumeActions); invitations.appendChild(resume);
    }
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
    drawGames();
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
        var classInfo = await window.FunTorahStudentClass.resolve(db, sessionId);
        var memberRecord = (await db.ref("b3Games/workspaces/" + classInfo.workspaceId + "/classes/" + classInfo.classId + "/members/" + sessionId).once("value")).val() || {};
        var centerEnabled = memberRecord.active !== false && memberRecord.toolAccess?.["multiplayer-center"] !== false;
        if (["et", "wt"].includes(classInfo.classId)) {
          var settings = (await db.ref("b3Games/siteSettings").once("value")).val() || {};
          centerEnabled = centerEnabled && settings.games?.["multiplayer-center"] !== false && settings.classGames?.[classInfo.classId]?.["multiplayer-center"] !== false;
        } else {
          var classGrant = (await db.ref("b3Games/workspaces/" + classInfo.workspaceId + "/classes/" + classInfo.classId + "/toolGrants/multiplayer-center").once("value")).val() === true;
          centerEnabled = centerEnabled && classGrant;
        }
        if (!centerEnabled) {
          statusBox.className = "notice error";
          statusBox.textContent = "Your teacher has not enabled Multiplayer Center for your class yet.";
          return;
        }
        if (typeof firebase.functions === "function") {
          try { await firebase.app().functions("us-central1").httpsCallable("multiplayerGameAction")({ action: "cleanup", workspaceId: classInfo.workspaceId }); }
          catch (cleanupError) { console.warn("Multiplayer Center: stale-room cleanup will retry later", cleanupError); }
        }
        scopeKey = path;
        roomsRef = db.ref(path);
        statusBox.className = "notice good";
        statusBox.textContent = "Signed in as " + sessionName + ". Showing games for your class.";
        readyToPlay = true;
        drawGames();
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
