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
    { key: "reversi", name: "Othello", icon: "⚫", description: "Flip discs and finish with the most of your color.", url: "game.html?game=reversi", mode: "start" },
    { key: "bingo", name: "Bingo", icon: "🎱", description: "Mark called numbers and complete a line.", url: "game.html?game=bingo", mode: "start" },
    { key: "math-race", name: "Math Race", icon: "➕", description: "Solve the same friendly math problems for points.", url: "game.html?game=math-race", mode: "start" },
    { key: "set", name: "Set", icon: "🟣", description: "Spot groups of three cards with matching patterns.", url: "game.html?game=set", mode: "start" },
    { key: "ludo", name: "Ludo", icon: "🎲", description: "Roll the die and race four tokens home.", url: "game.html?game=ludo", mode: "start" },
    { key: "dominoes", name: "Dominoes", icon: "🁣", description: "Match tiles and empty your hand to win.", url: "game.html?game=dominoes", mode: "start" },
    { key: "go-fish", name: "Go Fish", icon: "🐟", description: "Ask classmates for cards and collect complete sets.", url: "game.html?game=go-fish", mode: "start" },
    { key: "uno-style", name: "Uno-style Cards", icon: "UNO", description: "Match colors and numbers with simple action cards.", url: "game.html?game=uno-style", mode: "start" }
  ];
  var sessionId = "", sessionName = "", db = null, roomsPollTimer = null, roomsCallable = null, roomsRequest = 0, scopeKey = "", classInfo = null, lockRef = null, lockListener = null;
  var statusBox = document.getElementById("accountStatus");
  var invitations = document.getElementById("invitations");
  var invitationSection = document.getElementById("invitationSection");
  var invitationSummary = document.getElementById("invitationSummary");
  var leaderboardSection = document.getElementById("classLeaderboard");
  function renderLeaderboard(rows, balance, rewardsConfigured) {
    var list = document.getElementById("leaderboardRows"), status = document.getElementById("leaderboardStatus");
    var balanceBox = document.getElementById("gameCoinBalance");
    list.replaceChildren();
    (rows || []).slice(0, 10).forEach(function (entry) {
      var item = make("li", "leaderboard-row");
      item.append(make("span", "leaderboard-name", entry.name || "Student"), make("span", "leaderboard-coins", String(Math.max(0, Number(entry.coins) || 0)) + " coins"));
      list.appendChild(item);
    });
    status.textContent = rows && rows.length ? "Top players in " + classInfo.className + "." : "No game coin scores yet. Play a class game to get started!";
    if (rewardsConfigured === false) {
      status.textContent += classInfo.role === "teacher"
        ? " Students do not earn coins until you set the class rewards below."
        : " Game coins are not turned on for your class yet. Ask your teacher.";
    }
    if (classInfo.role === "teacher") return;
    var peerCoins = Math.max(0, Number(balance && balance.peerCoins) || 0);
    var computerCoins = Math.max(0, Number(balance && balance.computerCoins) || 0);
    document.getElementById("gameCoinTotal").textContent = String(Math.max(0, Number(balance && balance.totalCoins) || peerCoins + computerCoins));
    document.getElementById("gameCoinBreakdown").textContent = "Peer games " + peerCoins + " · Computer games " + computerCoins;
    balanceBox.hidden = false;
  }

  // ── Game lock ──────────────────────────────────────────────────────────────
  function setupGameLock() {
    var wid = classInfo.workspaceId, cid = classInfo.classId;
    lockRef = db.ref("multiplayerCenter/workspaces/" + wid + "/classes/" + cid + "/gamesLocked");
    var isTeacher = classInfo.role === "teacher";

    if (isTeacher) {
      // Build the teacher toggle button
      var lockSection = document.createElement("div");
      lockSection.id = "gameLockSection";
      lockSection.style.cssText = "text-align:center;margin:10px 0 18px";
      var lockBtn = document.createElement("button");
      lockBtn.id = "gameLockBtn";
      lockBtn.type = "button";
      lockBtn.className = "btn";
      lockBtn.style.cssText = "font-size:15px;padding:8px 22px;border-radius:20px";
      var lockStatus = document.createElement("span");
      lockStatus.id = "gameLockStatus";
      lockStatus.style.cssText = "display:block;font-size:13px;color:#64748b;margin-top:6px";
      lockSection.append(lockBtn, lockStatus);
      var gamesSection = document.querySelector("section[aria-labelledby='gamesHeading']");
      if (gamesSection) gamesSection.insertBefore(lockSection, gamesSection.firstChild);

      function applyTeacherLockUI(locked) {
        lockBtn.textContent = locked ? "🔓 Unlock Games" : "🔒 Lock Games for Students";
        lockBtn.style.background = locked ? "#dc2626" : "#1d4ed8";
        lockBtn.style.color = "#fff";
        lockBtn.style.border = "none";
        lockStatus.textContent = locked
          ? "Games are locked. Students see a 'games locked' message."
          : "Games are open. Students can play freely.";
      }

      lockBtn.addEventListener("click", function () {
        lockBtn.disabled = true;
        lockRef.once("value").then(function (snap) {
          var nowLocked = !!snap.val();
          return lockRef.set(!nowLocked);
        }).catch(function (err) {
          lockStatus.textContent = "Could not change lock. " + (err && err.message || "");
        }).finally(function () { lockBtn.disabled = false; });
      });

      lockListener = lockRef.on("value", function (snap) {
        applyTeacherLockUI(!!snap.val());
      });
    } else {
      // Student: watch lock state and show/hide overlay
      lockListener = lockRef.on("value", function (snap) {
        var locked = !!snap.val();
        var overlay = document.getElementById("gameLockOverlay");
        var gamesSection = document.querySelector("section[aria-labelledby='gamesHeading']");
        if (locked) {
          if (!overlay && gamesSection) {
            overlay = document.createElement("div");
            overlay.id = "gameLockOverlay";
            overlay.style.cssText = "text-align:center;padding:36px 20px;background:#fef2f2;border:2px solid #fca5a5;border-radius:16px;margin:18px 0";
            overlay.innerHTML = "<div style='font-size:48px'>🔒</div><h3 style='margin:8px 0 4px;color:#991b1b'>Games are locked</h3><p style='color:#7f1d1d;margin:0'>Your teacher has locked the Multiplayer Arcade. Games will be available again when your teacher unlocks them.</p>";
            gamesSection.insertBefore(overlay, document.getElementById("gameCategories"));
          }
          if (overlay) overlay.hidden = false;
          document.querySelectorAll(".game-launch").forEach(function (btn) { btn.disabled = true; });
        } else {
          if (overlay) overlay.hidden = true;
          document.querySelectorAll(".game-launch").forEach(function (btn) { btn.disabled = !readyToPlay; });
        }
      });
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  function setupCoinPolicyEditor() {
    var section = document.getElementById("gameCoinSettings"), form = document.getElementById("gameCoinPolicyForm");
    var status = document.getElementById("gameCoinPolicyStatus"), fields = ["win", "finish", "sportsmanship", "computerMultiplier"];
    section.hidden = false;
    firebase.app().functions("us-central1").httpsCallable("multiplayerGameAction")({ action: "get-coin-policy", workspaceId: classInfo.workspaceId, classId: classInfo.classId })
      .then(function (result) {
        var policy = result.data && result.data.policy;
        if (policy) fields.forEach(function (key) { form.elements.namedItem(key).value = String(policy[key]); });
        status.textContent = policy ? "Current class rewards loaded. You can change them at any time." : "Set rewards for this class. No reward amounts are preset.";
      })
      .catch(function () { status.textContent = "Could not load reward settings. Check your teacher access and try again."; });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var policy = {};
      fields.forEach(function (key) { policy[key] = form.elements.namedItem(key).valueAsNumber; });
      if (![policy.win, policy.finish, policy.sportsmanship].every(Number.isSafeInteger) ||
          !Number.isFinite(policy.computerMultiplier) || policy.computerMultiplier < 0 || policy.computerMultiplier >= 1) {
        status.textContent = "Use whole non-negative coin amounts and a computer multiplier less than 1."; return;
      }
      var submit = form.querySelector("button[type=submit]");
      submit.disabled = true; status.textContent = "Saving class rewards…";
      firebase.app().functions("us-central1").httpsCallable("multiplayerGameAction")({
        action: "set-coin-policy", workspaceId: classInfo.workspaceId, classId: classInfo.classId, policy: policy
      }).then(function () { status.textContent = "Class game coin rewards saved."; })
        .catch(function () { status.textContent = "Could not save rewards. Please check the values and try again."; })
        .finally(function () { submit.disabled = false; });
    });
  }

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
    if (classInfo) { url.searchParams.set("workspaceId", classInfo.workspaceId); url.searchParams.set("classId", classInfo.classId); url.searchParams.set("class", classInfo.classId); }
    location.assign(url.href);
  }
  // Presentation-only category grouping: existing multiplayer routing and permissions remain unchanged.
  var CATEGORIES = [
    { key: "all", label: "All Games", icon: "🎮" },
    { key: "torah", label: "Torah & Jewish", icon: "📖" },
    { key: "strategy", label: "Board & Strategy", icon: "♟️" },
    { key: "cards", label: "Cards & Matching", icon: "UNO" },
    { key: "challenges", label: "Quick Challenges", icon: "⚡" }
  ];
  var GAME_CATEGORIES = {
    shorashim: "torah", yiddish: "torah", gematria: "torah", "weekly-quiz": "torah", "rashi-letters": "torah",
    "connect-four": "strategy", "tic-tac-toe": "strategy", checkers: "strategy", reversi: "strategy", ludo: "strategy",
    "memory-match": "cards", set: "cards", dominoes: "cards", "go-fish": "cards", "uno-style": "cards",
    bingo: "challenges", "math-race": "challenges"
  };
  var gameIllustration = window.FTT_GAME_ART.illustration;
  // Keep every game visible at its full app-tile size from the first render.
  var readyToPlay = false;
  var categoriesEl = document.getElementById("gameCategories");
  var gameResultsSummary = document.getElementById("gameResultsSummary");
  function drawGameCard(game) {
    var category = GAME_CATEGORIES[game.key];
    var card = make("article", "game game-" + category + " game-" + game.key);
    var button = make("button", "game-launch");
    var picture = make("span", "game-art");
    picture.setAttribute("aria-hidden", "true");
    picture.appendChild(gameIllustration(game));
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
    return card;
  }
  function drawCategoryHome() {
    document.getElementById("gamesHeading").textContent = "All 17 games, ready to play";
    categoriesEl.replaceChildren();
    categoriesEl.className = "category-shelf";
    CATEGORIES.filter(function (category) { return category.key !== "all"; }).forEach(function (category) {
      var games = GAMES.filter(function (game) { return GAME_CATEGORIES[game.key] === category.key; });
      var group = make("section", "category-group category-" + category.key);
      var heading = make("h3", "category-heading");
      var gameGrid = make("div", "category-game-grid");
      var groupId = "category-games-" + category.key;
      heading.id = "category-heading-" + category.key;
      heading.append(make("span", "category-mark", category.icon),
        make("span", "category-title", category.label),
        make("span", "category-count", games.length + " games"));
      gameGrid.id = groupId;
      gameGrid.setAttribute("role", "group");
      gameGrid.setAttribute("aria-labelledby", heading.id);
      games.forEach(function (game) { gameGrid.appendChild(drawGameCard(game)); });
      group.append(heading, gameGrid);
      categoriesEl.appendChild(group);
    });
    gameResultsSummary.textContent = "All 17 games are ready to browse. Choose a game to play with your classmates.";
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
      return room && room.host !== sessionId && room.roomCode && gameFor(room.gameKey) && !ignored.has(id) &&
        (room.state === "lobby" || (room.allowSpectators && ["playing", "finished"].includes(room.state))) &&
        (!room.invitedStudentId || room.invitedStudentId === sessionId || room.allowSpectators || room.playerCount >= room.maxPlayers) &&
        room.createdAt && Date.now() - Number(room.createdAt) < 20 * 60 * 1000;
    });
    var saved = savedRejoin();
    invitations.replaceChildren();
    invitationSection.hidden = !visible.length && !saved;
    invitationSummary.textContent = visible.length
      ? visible.length + (visible.length === 1 ? " class game" : " class games") + " to join, watch, or start your own match."
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
    visible.sort(function (a, b) {
      var aDirect = a[1].invitedStudentId === sessionId ? 1 : 0;
      var bDirect = b[1].invitedStudentId === sessionId ? 1 : 0;
      return bDirect - aDirect || Number(a[1].createdAt) - Number(b[1].createdAt);
    }).forEach(function (entry) {
      var id = entry[0], room = entry[1], game = gameFor(room.gameKey), card = make("article", "invite");
      var count = Math.max(1, Number(room.playerCount) || 1), max = Number(room.maxPlayers) || 0;
      var full = max > 0 && count >= max, reserved = !!room.invitedStudentId && room.invitedStudentId !== sessionId;
      var direct = room.invitedStudentId === sessionId, canJoin = room.state === "lobby" && !full && !reserved;
      var canWatch = max === 2 && room.allowSpectators === true;
      var label = direct ? "⭐ A personal invitation for you!" : (room.hostName || "A classmate") + (room.state === "lobby" ? " wants to play" : " is playing");
      card.append(make("h3", "", label), make("p", "", game.icon + " " + game.name));
      card.appendChild(make("small", "", room.state === "playing" ? "Game in progress" : room.state === "finished" ? "Match finished" : full ? count + "/" + max + " Players — Full" : count + (max ? "/" + max : "") + " players waiting"));
      if (direct) card.appendChild(make("small", "", (room.hostName || "A classmate") + " invited you to this match."));
      else if (reserved && room.state === "lobby") card.appendChild(make("small", "", "Reserved for " + (room.invitedStudentName || "an invited classmate") + "."));
      var actions = make("div", "invite-actions");
      if (canJoin) {
        var join = make("button", "btn", "Join Game"); join.type = "button";
        join.addEventListener("click", function () { join.disabled = true; route(game, "join", String(room.roomCode)); });
        actions.appendChild(join);
      }
      if (canWatch) {
        var watch = make("button", "quiet", "👀 Join as spectator"); watch.type = "button";
        watch.addEventListener("click", function () { route(game, "spectate", String(room.roomCode)); });
        actions.appendChild(watch);
      }
      if (max === 2 && !canJoin) {
        var another = make("button", "btn", "Start another " + game.name + " match"); another.type = "button";
        another.addEventListener("click", function () { route(game, "start"); });
        actions.appendChild(another);
      }
      var later = make("button", "quiet", "Not Now"); later.type = "button";
      later.addEventListener("click", function () { decline(id); renderRooms(all); });
      actions.appendChild(later); card.appendChild(actions); invitations.appendChild(card);
    });
  }
  function loadRooms() {
    if (!roomsCallable || !classInfo) return;
    var request = ++roomsRequest;
    roomsCallable({ action: "list-rooms", workspaceId: classInfo.workspaceId, classId: classInfo.classId })
      .then(function (result) {
        if (request !== roomsRequest) return;
        renderRooms(result.data && result.data.rooms || {});
      })
      .catch(function () {
        if (request !== roomsRequest) return;
        invitationSection.hidden = false;
        invitationSummary.textContent = "Waiting games are temporarily unavailable. You can still start a new class game.";
      });
  }
  function start() {
    drawCategoryHome();
    try {
      sessionId = String(sessionStorage.getItem("b3Games_studentId") || sessionStorage.getItem("posukPractice_studentId") || "").trim();
      sessionName = String(sessionStorage.getItem("b3Games_studentName") || sessionStorage.getItem("posukPractice_studentName") || "Student");
    } catch (e) {}
    if (!window.firebase || !window.B3_FIREBASE_CONFIG) {
      statusBox.className = "notice error";
      statusBox.replaceChildren(document.createTextNode("Sign in on Fun Torah Tools first. "));
      var link = make("a", "", "Go to sign in");
      link.href = "../index.html";
      link.addEventListener("click", function () {
        try { sessionStorage.setItem("b3StudentReturnTo", "multiplayer/index.html"); } catch (e) {}
      });
      statusBox.appendChild(link); return;
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
        var params = new URLSearchParams(location.search);
        var requestedClass = params.get("classId") || params.get("class") || "";
        classInfo = await window.B3MultiplayerIdentity.resolve(db, user, requestedClass, sessionId);
        sessionId = classInfo.participantId;
        sessionName = classInfo.participantName;
        if (classInfo.role === "teacher") {
          var backLink = document.querySelector("header a");
          if (backLink) { backLink.href = "../teacher-home.html?class=" + encodeURIComponent(classInfo.classId); backLink.textContent = "← Back to teacher home"; }
        }
        var path = "multiplayerCenter/workspaces/" + classInfo.workspaceId + "/classes/" + classInfo.classId + "/rooms";
        if (typeof firebase.functions === "function") {
          try { await firebase.app().functions("us-central1").httpsCallable("multiplayerGameAction")({ action: "cleanup", workspaceId: classInfo.workspaceId, classId: classInfo.classId }); }
          catch (cleanupError) { console.warn("Multiplayer Center: stale-room cleanup will retry later", cleanupError); }
        }
        scopeKey = path;
        if (typeof firebase.functions === "function") {
          roomsCallable = firebase.app().functions("us-central1").httpsCallable("multiplayerGameAction");
        }
        statusBox.className = "notice good";
        statusBox.textContent = (classInfo.role === "teacher" ? "Playing as teacher " : "Signed in as ") + sessionName + " · " + classInfo.className + ". Showing games for this class.";
        readyToPlay = true;
        drawCategoryHome();
        setupGameLock();
        if (typeof firebase.functions === "function") {
          // Students see their balance and the class board; teachers see the class board too.
          leaderboardSection.hidden = false;
          firebase.app().functions("us-central1").httpsCallable("multiplayerGameAction")({ action: "leaderboard", workspaceId: classInfo.workspaceId, classId: classInfo.classId })
            .then(function (result) { var data = result.data || {}; renderLeaderboard(data.leaderboard || [], data.balance || {}, data.rewardsConfigured); })
            .catch(function () { document.getElementById("leaderboardStatus").textContent = "Class leaderboard is unavailable right now."; });
        }
        if (classInfo.role === "teacher" && typeof firebase.functions === "function") setupCoinPolicyEditor();
        loadRooms();
        clearInterval(roomsPollTimer);
        roomsPollTimer = setInterval(loadRooms, 5000);
      } catch (e) {
        console.warn("Multiplayer Center: class access check failed", e);
        statusBox.className = "notice error";
        statusBox.textContent = "A class sign-in is required to use the Multiplayer Center. Please sign in again or ask your teacher to check your class access.";
      }
    });
  }
  window.addEventListener("pagehide", function () {
    clearInterval(roomsPollTimer); roomsPollTimer = null; roomsRequest += 1;
    if (lockRef && lockListener) { lockRef.off("value", lockListener); lockRef = null; lockListener = null; }
  });
  start();
})();
