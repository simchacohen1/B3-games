/*
 * Weekly Shorashim — student page.
 *
 * STAGING ONLY: this page refuses to run anywhere except the staging site
 * (or a developer's own computer).
 *
 * What it reads and writes, all under the student's class record
 * (B3_DATA_MODEL.class(workspaceId, classId)):
 *   /weeklyShorashimGrade                       "B2".."B6" (missing = B3)
 *   /weeklyShorashim/currentWeek                { week, setAt, held }
 *   /weeklyShorashim/progress/<studentId>/<week>/<game>
 *        { bestScore, timesPlayed, lastPlayed, wordsCorrect, wordsMissed }
 * A student can only read and write his own progress (enforced by the rules).
 */
(function () {
  'use strict';

  var Data = window.WeeklyShorashimData, L = window.WeeklyShorashimLogic, Games = window.WeeklyShorashimGames;
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var localHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var onStaging = !!(window.B3_STAGING_FIREBASE_CONFIG && window.B3_STAGING_FIREBASE_CONFIG.projectId === 'fun-torah-tools-staging');

  var state = {
    grade: L.DEFAULT_GRADE, currentWeek: 1, selectedWeek: 1, mode: 'single',
    studentId: '', classId: '', base: '', db: null, progress: {}, canSave: false, stopGame: null
  };

  function notice(html, warn) {
    var box = $('wsNotice');
    box.innerHTML = html;
    box.classList.toggle('ws-warn', !!warn);
    box.classList.remove('hidden');
  }
  function hideNotice() { $('wsNotice').classList.add('hidden'); }
  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  /* ---------- drawing the page ---------- */

  function cards() {
    return state.mode === 'single'
      ? L.weekCards(Data.WEEKS, state.selectedWeek, state.grade)
      : L.cumulativeCards(Data.WEEKS, state.selectedWeek, state.grade);
  }

  function drawWeeks() {
    var wrap = $('wsWeeks');
    wrap.innerHTML = '';
    Data.WEEKS.forEach(function (week) {
      var n = week.week, locked = n > state.currentWeek;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ws-week' + (n === state.currentWeek ? ' current' : '') + (n === state.selectedWeek ? ' selected' : '') + (locked ? ' locked' : '');
      b.appendChild(document.createTextNode(String(n)));
      if (locked) {
        var lock = document.createElement('span'); lock.textContent = '🔒'; b.appendChild(lock);
        b.disabled = true;
        b.title = 'Week ' + n + ' — not open yet';
      } else {
        b.title = n === state.currentWeek ? 'Current week' : 'Week ' + n;
        b.addEventListener('click', function () { state.selectedWeek = n; draw(); });
      }
      b.setAttribute('aria-label', 'Week ' + n + (locked ? ' (locked)' : n === state.currentWeek ? ' (current week)' : ''));
      wrap.appendChild(b);
    });
  }

  function draw() {
    var list = cards(), grade = state.grade, chipClass = 'ws-chip ws-g-' + grade;
    $('wsGradeBadge').className = 'ws-badge ' + chipClass; $('wsGradeBadge').textContent = grade;
    $('wsGradeChip').className = chipClass; $('wsGradeChip').textContent = grade;
    $('wsDesc').textContent = 'Weekly vocabulary practice — ' + grade + ' words';
    $('wsGradeTitle').textContent = 'Your Grade — Week ' + state.selectedWeek;
    $('wsModeSingle').classList.toggle('on', state.mode === 'single');
    $('wsModeCumulative').classList.toggle('on', state.mode === 'cumulative');
    drawWeeks();

    $('wsCount').className = 'ws-count ws-g-' + grade;
    $('wsCount').textContent = list.length + ' words';
    $('wsRange').textContent = state.mode === 'cumulative' ? 'Weeks 1–' + state.selectedWeek : 'Week ' + state.selectedWeek + ' only';
    $('wsWords').innerHTML = list.map(function (c) {
      return '<div class="ws-word"><span class="ws-word-he">' + esc(c.hebrew) + '</span><span class="ws-word-en">' + esc(c.english) + '</span></div>';
    }).join('');

    var links = L.quizletLinks(Data.WEEKS, state.selectedWeek, grade), html = '';
    if (links.single) html += '<a href="' + esc(links.single) + '" target="_blank" rel="noopener noreferrer">📘 Quizlet — This Week</a>';
    if (links.cumulative) html += '<a class="cum" href="' + esc(links.cumulative) + '" target="_blank" rel="noopener noreferrer">📚 Quizlet — All Weeks So Far</a>';
    $('wsQuizlet').innerHTML = html;

    var gamesBox = $('wsGames');
    gamesBox.innerHTML = '';
    var enough = list.length >= 4;
    $('wsGamesLabel').classList.toggle('hidden', !enough);
    if (enough) {
      var weekProgress = state.progress[state.selectedWeek] || {};
      L.GAMES.forEach(function (game) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'ws-game'; b.dataset.game = game.id;
        var saved = weekProgress[game.id];
        b.innerHTML = '<span class="e">' + game.emoji + '</span><span class="l">' + esc(game.label) + '</span><span class="b">' +
          (saved ? 'Best ' + esc(saved.bestScore) : '') + '</span>';
        b.addEventListener('click', function () { openGame(game.id, list); });
        gamesBox.appendChild(b);
      });
    }
    $('wsSaveNote').textContent = !enough ? 'This list needs at least 4 words for games.'
      : state.canSave ? '✓ Your scores are saved for your teacher.' : 'Practice mode — scores are not saved.';
  }

  /* ---------- games ---------- */

  function openGame(gameId, list) {
    var host = $('wsGame'), week = state.selectedWeek;
    $('wsPage').classList.add('hidden');
    host.classList.remove('hidden');
    window.scrollTo(0, 0);
    state.stopGame = Games.start(gameId, host, {
      cards: list,
      onExit: closeGame,
      onFinish: function (result) { return saveResult(week, gameId, result); }
    });
  }

  function closeGame() {
    if (state.stopGame) { try { state.stopGame(); } catch (e) {} }
    state.stopGame = null;
    $('wsGame').innerHTML = '';
    $('wsGame').classList.add('hidden');
    $('wsPage').classList.remove('hidden');
    draw();
  }

  function saveResult(week, gameId, result) {
    if (!state.canSave) return Promise.resolve({ saved: false });
    var ref = state.db.ref(state.base + '/weeklyShorashim/progress/' + state.studentId + '/' + week + '/' + gameId);
    return ref.transaction(function (existing) {
      return L.mergeProgress(existing, result, Date.now());
    }).then(function (outcome) {
      var saved = outcome.snapshot.val() || {};
      if (!state.progress[week]) state.progress[week] = {};
      state.progress[week][gameId] = saved;
      return { saved: outcome.committed, best: saved.bestScore };
    }).catch(function (error) {
      console.warn('Weekly Shorashim: score was not saved', error);
      return { saved: false, note: '⚠️ Could not save this score. Check the internet connection.' };
    });
  }

  /* ---------- start up ---------- */

  function show() {
    hideNotice();
    $('wsCard').classList.remove('hidden');
    draw();
  }

  function waitForAuth(auth) {
    if (typeof auth.authStateReady === 'function') return auth.authStateReady();
    return new Promise(function (resolve) { var off = auth.onAuthStateChanged(function () { off(); resolve(); }); });
  }

  function withTimeout(promise, ms, what) {
    return Promise.race([promise, new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error(what + ' is taking too long.')); }, ms);
    })]);
  }

  async function connect() {
    if (!window.firebase || !window.B3_FIREBASE_CONFIG) throw new Error('The connection to the server did not load.');
    if (!firebase.apps.length) firebase.initializeApp(window.B3_FIREBASE_CONFIG);
    var auth = firebase.auth(), db = firebase.database();
    await withTimeout(waitForAuth(auth), 12000, 'Sign-in');
    var user = auth.currentUser;
    var claims = user ? (await user.getIdTokenResult()).claims : {};
    var studentId = String(claims.b3StudentId || '');
    if (!user || !studentId) {
      notice(user
        ? 'You are signed in as a teacher. Students play here; teachers use the <a href="teacher.html">Weekly Shorashim teacher page</a>.'
        : 'Please <a href="../index.html">sign in on Fun Torah Tools</a> as a student first, then come back to this page.', true);
      return;
    }
    var name = '';
    try { name = sessionStorage.getItem('b3Games_studentName') || ''; } catch (e) {}
    $('wsWho').textContent = name;

    var info = await withTimeout(window.FunTorahStudentClass.resolve(db, studentId), 12000, 'Finding your class');
    var model = window.B3_DATA_MODEL;
    // The class chosen by the shared resolver first; the class on the sign-in itself as a fallback.
    var candidates = [info.classId, String(claims.b3ClassId || '')].filter(function (id, i, all) { return id && all.indexOf(id) === i; });
    if (!candidates.length) { notice('You are not in a class yet. Ask your teacher to add you to a class.', true); return; }

    var lastError = null;
    for (var i = 0; i < candidates.length; i++) {
      var base = model.class(info.workspaceId, candidates[i]);
      try {
        var snaps = await Promise.all([
          db.ref(base + '/weeklyShorashimGrade').once('value'),
          db.ref(base + '/weeklyShorashim/currentWeek').once('value'),
          db.ref(base + '/weeklyShorashim/progress/' + studentId).once('value')
        ]);
        state.db = db; state.base = base; state.classId = candidates[i]; state.studentId = studentId;
        state.grade = L.resolveGrade(snaps[0].val());
        state.currentWeek = L.currentWeek(snaps[1].val(), Date.now());
        state.selectedWeek = state.currentWeek;
        state.progress = snaps[2].val() || {};
        state.canSave = true;
        show();
        return;
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error('Your class could not be opened.');
  }

  function start() {
    $('wsModeSingle').addEventListener('click', function () { state.mode = 'single'; draw(); });
    $('wsModeCumulative').addEventListener('click', function () { state.mode = 'cumulative'; draw(); });

    if (!onStaging && !localHost) {
      notice('Weekly Shorashim is being tested and is only available on the staging site.', true);
      return;
    }
    // A developer's own computer only: look at the page and games without signing in. Nothing is saved.
    if (localHost && params.get('preview') === '1') {
      state.grade = L.resolveGrade(params.get('grade'));
      state.currentWeek = L.clampWeek(params.get('week') || 1);
      state.selectedWeek = state.currentWeek;
      $('wsWho').textContent = 'Preview';
      show();
      return;
    }
    connect().catch(function (error) {
      console.warn('Weekly Shorashim could not start', error);
      notice('Weekly Shorashim could not load: ' + esc(error && error.message || error) + ' Please refresh the page.', true);
    });
  }

  start();
})();
