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
    { key: "uno-style", name: "Uno-style Cards", icon: "UNO", description: "Match colors and numbers with simple action cards.", url: "game.html?game=uno-style", mode: "start" }
  ];
  var sessionId = "", sessionName = "", db = null, roomsRef = null, roomsListener = null, scopeKey = "";
  var statusBox = document.getElementById("accountStatus");
  var invitations = document.getElementById("invitations");
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
    { key: "cards", label: "Cards & Matching", icon: "UNO" },
    { key: "challenges", label: "Quick Challenges", icon: "⚡" }
  ];
  var GAME_CATEGORIES = {
    shorashim: "torah", yiddish: "torah", gematria: "torah", "weekly-quiz": "torah", "rashi-letters": "torah",
    "connect-four": "strategy", "tic-tac-toe": "strategy", checkers: "strategy", reversi: "strategy", ludo: "strategy",
    "memory-match": "cards", set: "cards", dominoes: "cards", "go-fish": "cards", "uno-style": "cards",
    bingo: "challenges", "math-race": "challenges"
  };
  // Small vector scenes make the game mechanics recognizable, even in compact tiles.
  var GAME_ART = {
    shorashim: '<circle cx="49" cy="28" r="17" fill="#66c84c"/><circle cx="35" cy="35" r="12" fill="#82d960"/><circle cx="63" cy="36" r="12" fill="#4eae42"/><path d="M49 34v34M49 48 35 39m14 9 14-11M49 68 30 83m19-15-8 19m8-19 11 19m-11-19 22 13m-22-13-2 20" fill="none" stroke="#78512f" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 69h61" stroke="#a86d35" stroke-width="4" stroke-linecap="round"/>',
    yiddish: '<path d="M14 20a12 12 0 0 1 12-12h35a12 12 0 0 1 12 12v20a12 12 0 0 1-12 12H39L25 66v-14a12 12 0 0 1-11-12z" fill="#7542bb"/><path d="M38 45h33a11 11 0 0 1 11 11v13a11 11 0 0 1-11 11H57L45 90V80a11 11 0 0 1-7-11z" fill="#f18ac6"/><circle cx="35" cy="30" r="3" fill="#fff"/><circle cx="47" cy="30" r="3" fill="#fff"/><circle cx="59" cy="30" r="3" fill="#fff"/>',
    gematria: '<rect x="12" y="16" width="72" height="64" rx="12" fill="#fff6d2"/><text x="48" y="60" text-anchor="middle" font-size="34" font-weight="900" fill="#9a3412" font-family="system-ui,sans-serif">123</text><path d="M22 71h52" stroke="#f0a22e" stroke-width="5" stroke-linecap="round"/>',
    "weekly-quiz": '<path d="M27 10h37l12 12v64H27z" fill="#fff" stroke="#8b5cf6" stroke-width="5" stroke-linejoin="round"/><path d="M64 11v15h14" fill="#ddd0ff" stroke="#8b5cf6" stroke-width="4"/><path d="m37 43 5 5 9-11m-14 25 5 5 9-11m6-15h11m-11 26h11" fill="none" stroke="#38a169" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>',
    "rashi-letters": '<path d="M22 16h42l13 13v56H22z" fill="#fff9e7" stroke="#d68b32" stroke-width="4"/><text x="50" y="61" text-anchor="middle" font-size="32" font-weight="800" fill="#8b3b45" font-family="serif">רש״י</text><path d="m70 18-8 48 13-3 4-38z" fill="#3976c8" stroke="#234c8a" stroke-width="3"/>',
    "connect-four": '<rect x="10" y="8" width="76" height="80" rx="10" fill="#2357be"/><g fill="#ffe047" stroke="#173b8b" stroke-width="2"><circle cx="24" cy="25" r="7"/><circle cx="48" cy="25" r="7"/><circle cx="72" cy="25" r="7"/><circle cx="36" cy="46" r="7"/><circle cx="60" cy="46" r="7"/><circle cx="24" cy="67" r="7"/><circle cx="48" cy="67" r="7"/></g><g fill="#ef4055" stroke="#173b8b" stroke-width="2"><circle cx="36" cy="67" r="7"/><circle cx="60" cy="67" r="7"/></g>',
    "tic-tac-toe": '<rect x="13" y="13" width="70" height="70" rx="12" fill="#fff"/><path d="M36 17v62M60 17v62M17 36h62M17 60h62" stroke="#16859a" stroke-width="5" stroke-linecap="round"/><path d="m20 21 13 13m0-13L20 34m47 32 12 12m0-12L67 78" stroke="#f05252" stroke-width="5" stroke-linecap="round"/><circle cx="48" cy="48" r="8" fill="none" stroke="#5e4bd8" stroke-width="5"/>',
    "memory-match": '<rect x="17" y="13" width="38" height="52" rx="7" fill="#fff" stroke="#7742cf" stroke-width="4" transform="rotate(-12 36 39)"/><rect x="43" y="29" width="38" height="52" rx="7" fill="#fff" stroke="#e84f96" stroke-width="4" transform="rotate(10 62 55)"/><text x="37" y="49" text-anchor="middle" font-size="23" font-weight="900" fill="#7742cf" font-family="system-ui,sans-serif">★</text><text x="62" y="65" text-anchor="middle" font-size="23" font-weight="900" fill="#e84f96" font-family="system-ui,sans-serif">★</text>',
    checkers: '<defs><pattern id="checkers-board" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="#fff0d7"/><rect width="16" height="16" fill="#875232"/><rect x="16" y="16" width="16" height="16" fill="#875232"/></pattern></defs><rect x="12" y="12" width="72" height="72" rx="5" fill="url(#checkers-board)" stroke="#51321f" stroke-width="4"/><g stroke="#fff" stroke-width="2"><circle cx="28" cy="28" r="9" fill="#e34151"/><circle cx="60" cy="28" r="9" fill="#26364b"/><circle cx="44" cy="44" r="9" fill="#e34151"/><circle cx="28" cy="60" r="9" fill="#26364b"/><circle cx="60" cy="60" r="9" fill="#e34151"/></g>',
    reversi: '<rect x="10" y="10" width="76" height="76" rx="10" fill="#178451" stroke="#075b39" stroke-width="4"/><path d="M35 12v72M60 12v72M12 35h72M12 60h72" stroke="#b7edc8" stroke-width="2"/><g stroke="#11352c" stroke-width="2"><circle cx="47" cy="47" r="10" fill="#202a34"/><circle cx="60" cy="47" r="10" fill="#fff"/><circle cx="47" cy="60" r="10" fill="#fff"/><circle cx="60" cy="60" r="10" fill="#202a34"/></g>',
    bingo: '<rect x="10" y="11" width="76" height="76" rx="9" fill="#fff" stroke="#d73873" stroke-width="4"/><text x="48" y="27" text-anchor="middle" font-size="15" font-weight="900" fill="#be185d" font-family="system-ui,sans-serif">BINGO</text><path d="M25 34v42M39 34v42M54 34v42M69 34v42M17 43h62M17 57h62M17 71h62" stroke="#f2adc9" stroke-width="2"/><circle cx="47" cy="57" r="7" fill="#f6bb2e"/>',
    "math-race": '<path d="M15 69h65" stroke="#b76513" stroke-width="5" stroke-linecap="round"/><path d="m68 65 10 4-10 5" fill="none" stroke="#b76513" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><rect x="14" y="15" width="53" height="44" rx="10" fill="#fff2bb"/><text x="40" y="46" text-anchor="middle" font-size="23" font-weight="900" fill="#b45309" font-family="system-ui,sans-serif">3+4</text><path d="M31 63h18l8 8v8H23v-8z" fill="#e84b3d" stroke="#8b2e25" stroke-width="3"/><circle cx="32" cy="80" r="5" fill="#29364b"/><circle cx="50" cy="80" r="5" fill="#29364b"/>',
    set: '<rect x="12" y="19" width="30" height="57" rx="7" fill="#fff" stroke="#b8445b" stroke-width="3"/><rect x="34" y="11" width="30" height="57" rx="7" fill="#fff" stroke="#4875c9" stroke-width="3"/><rect x="56" y="20" width="28" height="56" rx="7" fill="#fff" stroke="#319a65" stroke-width="3"/><g fill="none" stroke-width="5"><circle cx="27" cy="47" r="8" stroke="#bd3c66"/><path d="M43 42h13l-7 13z" stroke="#4d72ce"/><path d="M64 45q7-9 14 0t-7 11q-7-2-7-11" stroke="#32a16c"/></g>',
    ludo: '<rect x="11" y="11" width="74" height="74" rx="13" fill="#f5f7fb" stroke="#334155" stroke-width="4"/><path d="M16 16h25v25H16z" fill="#e94853"/><path d="M55 16h25v25H55z" fill="#f3c93a"/><path d="M16 55h25v25H16z" fill="#3f75d5"/><path d="M55 55h25v25H55z" fill="#39a866"/><path d="M41 16h14v25H41zM41 55h14v25H41zM16 41h25v14H16zM55 41h25v14H55z" fill="#fff" stroke="#ccd3df" stroke-width="2"/><path d="m41 41 7 7 7-7v14l-7-7-7 7z" fill="#9ca3af"/>',
    dominoes: '<rect x="23" y="9" width="50" height="78" rx="10" fill="#fffdf6" stroke="#315a78" stroke-width="5" transform="rotate(12 48 48)"/><path d="M27 48h42" stroke="#315a78" stroke-width="4"/><g fill="#24364a"><circle cx="39" cy="30" r="4"/><circle cx="59" cy="30" r="4"/><circle cx="49" cy="58" r="4"/><circle cx="39" cy="73" r="4"/><circle cx="59" cy="73" r="4"/></g>',
    "go-fish": '<path d="M10 26h54a9 9 0 0 1 9 9v34a9 9 0 0 1-9 9H37L20 90V78h-1a9 9 0 0 1-9-9z" fill="#fff" stroke="#2198b7" stroke-width="4"/><path d="M22 52c13-17 27-17 40 0-13 17-27 17-40 0zm40 0 13-10v20z" fill="#38b8d1" stroke="#137b9a" stroke-width="3"/><circle cx="34" cy="49" r="3" fill="#17384a"/><path d="M12 20h42" stroke="#a4e5f0" stroke-width="4" stroke-linecap="round"/>',
    "uno-style": '<rect x="20" y="13" width="49" height="72" rx="11" fill="#2772c9" stroke="#fff" stroke-width="4" transform="rotate(13 44 49)"/><rect x="15" y="10" width="49" height="72" rx="11" fill="#ef3c47" stroke="#fff" stroke-width="4" transform="rotate(-10 39 46)"/><ellipse cx="39" cy="47" rx="17" ry="26" fill="#fff" transform="rotate(-10 39 47)"/><text x="39" y="56" text-anchor="middle" font-size="26" font-weight="1000" font-style="italic" fill="#e6323e" font-family="system-ui,sans-serif">7</text><rect x="15" y="10" width="49" height="72" rx="11" fill="none" stroke="#f5cd28" stroke-width="4" transform="rotate(-10 39 46)"/>'
  };
  function gameIllustration(game) {
    var markup = GAME_ART[game.key];
    if (!markup) return make("span", "game-art-symbol", game.icon);
    var parsed = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">' + markup + '</svg>', "image/svg+xml");
    var svg = document.importNode(parsed.documentElement, true);
    svg.setAttribute("class", "game-illustration");
    svg.setAttribute("aria-hidden", "true");
    return svg;
  }
  // Keep all games visible as compact app tiles. A category can expand in place.
  var expandedCategory = "";
  var readyToPlay = false;
  var categoriesEl = document.getElementById("gameCategories");
  var gameResultsSummary = document.getElementById("gameResultsSummary");
  function drawGameCard(game, compact) {
    var category = GAME_CATEGORIES[game.key];
    var card = make("article", "game game-" + category + " game-" + game.key + (compact ? " game-mini" : ""));
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
      var isExpanded = expandedCategory === category.key || expandedCategory === "all";
      var group = make("section", "category-group category-" + category.key + (isExpanded ? " is-expanded" : ""));
      var toggle = make("button", "category-heading");
      var gameGrid = make("div", "category-game-grid" + (isExpanded ? " is-expanded" : ""));
      var groupId = "category-games-" + category.key;
      toggle.type = "button";
      toggle.id = "category-toggle-" + category.key;
      toggle.setAttribute("aria-controls", groupId);
      toggle.setAttribute("aria-expanded", String(isExpanded));
      toggle.append(make("span", "category-mark", category.icon),
        make("span", "category-title", category.label),
        make("span", "category-count", games.length + " games"),
        make("span", "category-expand-label", isExpanded ? "Make smaller  −" : "Make bigger  +"));
      toggle.addEventListener("click", function () {
        expandedCategory = expandedCategory === category.key ? "" : category.key;
        drawCategoryHome();
        var focusTarget = document.getElementById(toggle.id);
        if (focusTarget) focusTarget.focus();
      });
      gameGrid.id = groupId;
      gameGrid.setAttribute("role", "group");
      gameGrid.setAttribute("aria-labelledby", toggle.id);
      games.forEach(function (game) { gameGrid.appendChild(drawGameCard(game, !isExpanded)); });
      group.append(toggle, gameGrid);
      categoriesEl.appendChild(group);
    });
    var allGames = make("button", "all-games-link", expandedCategory === "all" ? "🎮 Make all games smaller" : "🎮 Make all 17 games bigger");
    allGames.type = "button";
    allGames.setAttribute("aria-pressed", String(expandedCategory === "all"));
    allGames.addEventListener("click", function () {
      expandedCategory = expandedCategory === "all" ? "" : "all";
      drawCategoryHome();
      document.querySelector(".all-games-link").focus();
    });
    categoriesEl.appendChild(allGames);
    gameResultsSummary.textContent = expandedCategory === "all"
      ? "All 17 games are expanded. Click a category to expand only that group, or make all games smaller."
      : expandedCategory
        ? "" + CATEGORIES.find(function (category) { return category.key === expandedCategory; }).label + " is expanded. All 17 games remain visible."
        : "All 17 games are visible as compact tiles. Choose a game to play or make a category bigger.";
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
    drawCategoryHome();
    try {
      sessionId = String(sessionStorage.getItem("b3Games_studentId") || sessionStorage.getItem("posukPractice_studentId") || "").trim();
      sessionName = String(sessionStorage.getItem("b3Games_studentName") || sessionStorage.getItem("posukPractice_studentName") || "Student");
    } catch (e) {}
    if (!sessionId || !window.firebase || !window.B3_FIREBASE_CONFIG) {
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
        drawCategoryHome();
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
