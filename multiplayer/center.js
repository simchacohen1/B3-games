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
  var sessionId = "", sessionName = "", db = null, roomsRef = null, roomsListener = null, scopeKey = "", classInfo = null;
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
  // Small vector scenes make the game mechanics recognizable, even in compact tiles.
  var GAME_ART = {
    shorashim: '<circle cx="49" cy="28" r="17" fill="#66c84c"/><circle cx="35" cy="35" r="12" fill="#82d960"/><circle cx="63" cy="36" r="12" fill="#4eae42"/><path d="M49 34v34M49 48 35 39m14 9 14-11M49 68 30 83m19-15-8 19m8-19 11 19m-11-19 22 13m-22-13-2 20" fill="none" stroke="#78512f" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 69h61" stroke="#a86d35" stroke-width="4" stroke-linecap="round"/>',
    yiddish: '<path d="M14 20a12 12 0 0 1 12-12h35a12 12 0 0 1 12 12v20a12 12 0 0 1-12 12H39L25 66v-14a12 12 0 0 1-11-12z" fill="#7542bb"/><path d="M38 45h33a11 11 0 0 1 11 11v13a11 11 0 0 1-11 11H57L45 90V80a11 11 0 0 1-7-11z" fill="#f18ac6"/><circle cx="35" cy="30" r="3" fill="#fff"/><circle cx="47" cy="30" r="3" fill="#fff"/><circle cx="59" cy="30" r="3" fill="#fff"/>',
    gematria: '<rect x="12" y="16" width="72" height="64" rx="12" fill="#fff6d2"/><text x="48" y="60" text-anchor="middle" font-size="34" font-weight="900" fill="#9a3412" font-family="system-ui,sans-serif">123</text><path d="M22 71h52" stroke="#f0a22e" stroke-width="5" stroke-linecap="round"/>',
    "weekly-quiz": '<path d="M27 10h37l12 12v64H27z" fill="#fff" stroke="#8b5cf6" stroke-width="5" stroke-linejoin="round"/><path d="M64 11v15h14" fill="#ddd0ff" stroke="#8b5cf6" stroke-width="4"/><path d="m37 43 5 5 9-11m-14 25 5 5 9-11m6-15h11m-11 26h11" fill="none" stroke="#38a169" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>',
    "rashi-letters": '<path d="M22 16h42l13 13v56H22z" fill="#fff9e7" stroke="#d68b32" stroke-width="4"/><text x="50" y="61" text-anchor="middle" font-size="32" font-weight="800" fill="#8b3b45" font-family="serif">רש״י</text><path d="m70 18-8 48 13-3 4-38z" fill="#3976c8" stroke="#234c8a" stroke-width="3"/>',
    "connect-four": '<defs><pattern id="connect-four-holes" x="15" y="12" width="9.3" height="10.5" patternUnits="userSpaceOnUse"><circle cx="4.65" cy="5.25" r="3.7" fill="#e9f1ff"/></pattern></defs><rect x="10" y="8" width="76" height="80" rx="9" fill="#1745a4"/><rect x="15" y="12" width="65" height="64" fill="#3474e3"/><rect x="15" y="12" width="65" height="64" fill="url(#connect-four-holes)"/><g stroke="#153d91" stroke-width="1.4"><circle cx="19.65" cy="69.75" r="4.1" fill="#f04452"/><circle cx="28.95" cy="69.75" r="4.1" fill="#ffd83d"/><circle cx="38.25" cy="69.75" r="4.1" fill="#f04452"/><circle cx="47.55" cy="69.75" r="4.1" fill="#ffd83d"/><circle cx="28.95" cy="59.25" r="4.1" fill="#ffd83d"/><circle cx="38.25" cy="59.25" r="4.1" fill="#f04452"/><circle cx="47.55" cy="59.25" r="4.1" fill="#ffd83d"/><circle cx="38.25" cy="48.75" r="4.1" fill="#f04452"/></g>',
    "tic-tac-toe": '<rect x="13" y="13" width="70" height="70" rx="12" fill="#fff"/><path d="M36 17v62M60 17v62M17 36h62M17 60h62" stroke="#16859a" stroke-width="5" stroke-linecap="round"/><path d="m20 21 13 13m0-13L20 34m47 32 12 12m0-12L67 78" stroke="#f05252" stroke-width="5" stroke-linecap="round"/><circle cx="48" cy="48" r="8" fill="none" stroke="#5e4bd8" stroke-width="5"/>',
    "memory-match": '<rect x="17" y="13" width="38" height="52" rx="7" fill="#fff" stroke="#7742cf" stroke-width="4" transform="rotate(-12 36 39)"/><rect x="43" y="29" width="38" height="52" rx="7" fill="#fff" stroke="#e84f96" stroke-width="4" transform="rotate(10 62 55)"/><text x="37" y="49" text-anchor="middle" font-size="23" font-weight="900" fill="#7742cf" font-family="system-ui,sans-serif">★</text><text x="62" y="65" text-anchor="middle" font-size="23" font-weight="900" fill="#e84f96" font-family="system-ui,sans-serif">★</text>',
    checkers: '<defs><pattern id="checkers-board" width="18" height="18" patternUnits="userSpaceOnUse"><rect width="18" height="18" fill="#f8ead2"/><rect width="9" height="9" fill="#794b32"/><rect x="9" y="9" width="9" height="9" fill="#794b32"/></pattern><radialGradient id="checker-red" cx="32%" cy="25%"><stop stop-color="#ffb9aa"/><stop offset=".48" stop-color="#df493a"/><stop offset="1" stop-color="#9f252d"/></radialGradient><radialGradient id="checker-black" cx="32%" cy="25%"><stop stop-color="#8996a9"/><stop offset=".5" stop-color="#354358"/><stop offset="1" stop-color="#172235"/></radialGradient></defs><rect x="12" y="12" width="72" height="72" rx="5" fill="url(#checkers-board)" stroke="#51321f" stroke-width="3"/><g stroke="#f8ead2" stroke-width="1.5"><circle cx="16.5" cy="16.5" r="5.2" fill="url(#checker-red)"/><circle cx="34.5" cy="16.5" r="5.2" fill="url(#checker-red)"/><circle cx="52.5" cy="16.5" r="5.2" fill="url(#checker-red)"/><circle cx="70.5" cy="16.5" r="5.2" fill="url(#checker-red)"/><circle cx="25.5" cy="25.5" r="5.2" fill="url(#checker-red)"/><circle cx="43.5" cy="25.5" r="5.2" fill="url(#checker-red)"/><circle cx="61.5" cy="25.5" r="5.2" fill="url(#checker-red)"/><circle cx="79.5" cy="25.5" r="4.4" fill="url(#checker-red)"/><circle cx="16.5" cy="34.5" r="5.2" fill="url(#checker-red)"/><circle cx="34.5" cy="34.5" r="5.2" fill="url(#checker-red)"/><circle cx="52.5" cy="34.5" r="5.2" fill="url(#checker-red)"/><circle cx="70.5" cy="34.5" r="5.2" fill="url(#checker-red)"/><circle cx="25.5" cy="61.5" r="5.2" fill="url(#checker-black)"/><circle cx="43.5" cy="61.5" r="5.2" fill="url(#checker-black)"/><circle cx="61.5" cy="61.5" r="5.2" fill="url(#checker-black)"/><circle cx="79.5" cy="61.5" r="4.4" fill="url(#checker-black)"/><circle cx="16.5" cy="70.5" r="5.2" fill="url(#checker-black)"/><circle cx="34.5" cy="70.5" r="5.2" fill="url(#checker-black)"/><circle cx="52.5" cy="70.5" r="5.2" fill="url(#checker-black)"/><circle cx="70.5" cy="70.5" r="5.2" fill="url(#checker-black)"/><circle cx="25.5" cy="79.5" r="5.2" fill="url(#checker-black)"/><circle cx="43.5" cy="79.5" r="5.2" fill="url(#checker-black)"/><circle cx="61.5" cy="79.5" r="5.2" fill="url(#checker-black)"/><circle cx="79.5" cy="79.5" r="4.4" fill="url(#checker-black)"/></g>',
    reversi: '<rect x="10" y="10" width="76" height="76" rx="8" fill="#14824d" stroke="#075b39" stroke-width="4"/><path d="M19.5 12v72M29 12v72M38.5 12v72M48 12v72M57.5 12v72M67 12v72M76.5 12v72M12 19.5h72M12 29h72M12 38.5h72M12 48h72M12 57.5h72M12 67h72M12 76.5h72" stroke="#c3efcf" stroke-opacity=".72" stroke-width="1.2"/><g stroke="#123b2c" stroke-width="1"><circle cx="43.25" cy="43.25" r="4.4" fill="#202b39"/><circle cx="52.75" cy="43.25" r="4.4" fill="#fff"/><circle cx="43.25" cy="52.75" r="4.4" fill="#fff"/><circle cx="52.75" cy="52.75" r="4.4" fill="#202b39"/></g>',
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
      card.append(make("h3", "", (room.hostRole === "teacher" ? "Teacher " : "") + (room.hostName || "A classmate") + " wants to play"),
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
        roomsRef = db.ref(path);
        statusBox.className = "notice good";
        statusBox.textContent = (classInfo.role === "teacher" ? "Playing as teacher " : "Signed in as ") + sessionName + " · " + classInfo.className + ". Showing games for this class.";
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
