/*
 * Weekly Shorashim — the seven games, in plain HTML/JS.
 * Rebuilt to look and play like the games in
 * https://github.com/rabbimkosofsky-droid/school-games
 *
 * Every game is started with
 *   WeeklyShorashimGames.start(gameId, hostElement, { cards, onFinish, onExit })
 * and returns a stop() function. cards = [{ id, hebrew, english }].
 * When a round ends the game calls onFinish({ score, correct, missed }) where
 * correct / missed are { wordId: howManyTimes }. onFinish returns a promise of
 * { saved, best, note } that the finish screen shows.
 *
 * Chumash Racer difference from the original: the original built its lanes from
 * only the first 3 meanings in the whole list, so most words never had their
 * right answer on the road. Here every question brings its own 3 choices, one
 * per lane, and exactly one of them is right.
 */
(function (root) {
  'use strict';

  var L = root.WeeklyShorashimLogic;

  /* ---------- small helpers ---------- */

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function add(parent) {
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]);
    return parent;
  }
  function button(cls, text, onClick) {
    var b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function tracker() {
    var t = { correct: {}, missed: {} };
    t.mark = function (id, ok) {
      var bag = ok ? t.correct : t.missed;
      bag[id] = (bag[id] || 0) + 1;
    };
    return t;
  }

  function formatClock(seconds) {
    return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
  }

  // The line on every finish screen that says whether the score reached the teacher.
  function saveLine(parent, promise, darkTheme) {
    var line = el('p', 'ws-save-line' + (darkTheme ? ' ws-save-dark' : ''), '⏳ Saving score…');
    parent.appendChild(line);
    Promise.resolve(promise).then(function (info) {
      info = info || {};
      line.textContent = info.note || (info.saved ? '✅ Score saved for your teacher!' : 'Practice only — score not saved.');
      if (info.saved && info.best != null) line.textContent += '  Your best: ' + info.best;
    }, function () { line.textContent = '⚠️ Could not save this score.'; });
    return line;
  }

  function resultStat(value, label, color) {
    var stat = el('div', 'ws-result-stat');
    var num = el('span', 'ws-result-num', String(value));
    if (color) num.style.color = color;
    return add(stat, num, el('span', 'ws-result-label', label));
  }

  function encouragement(pct) {
    if (pct >= 91) return { text: "You're a pro! 🏆", color: '#0ea96e', emoji: '🏆' };
    if (pct >= 71) return { text: 'Great job! Keep it up! ⭐', color: '#1a3ed4', emoji: '⭐' };
    if (pct >= 41) return { text: "Good effort! You're getting there 👍", color: '#e07b00', emoji: '👍' };
    return { text: 'Keep trying! Practice makes perfect 💪', color: '#ef4444', emoji: '💪' };
  }

  // The "choose 6 / 9 / 12" style first screen shared by three games.
  function setupScreen(host, o) {
    clear(host);
    var rootEl = el('div', 'ws-light ' + (o.rootClass || ''));
    var box = el('div', 'ws-box');
    add(box, button('ws-back', '← Back', o.onExit), el('div', 'ws-emoji', o.emoji), el('h1', 'ws-title', o.title),
      el('p', 'ws-sub', o.sub), el('p', 'ws-setup-label', o.label));
    var row = el('div', 'ws-option-row');
    o.options.forEach(function (opt) {
      var b = button('ws-option-btn', null, function () { o.onPick(opt.value); });
      add(b, el('span', 'ws-option-num', opt.big), el('span', 'ws-option-small', opt.small));
      row.appendChild(b);
    });
    add(box, row);
    if (o.tip) box.appendChild(el('p', 'ws-key-hint', o.tip));
    host.appendChild(add(rootEl, box));
  }

  function finishButtons(againLabel, onAgain, onExit) {
    var row = el('div', 'ws-finish-buttons');
    return add(row, button('ws-btn-primary', againLabel, onAgain), button('ws-btn-outline', 'Back to Words', onExit));
  }

  // A, B, C, D answer buttons used by Multiple Choice and Practice Quiz.
  function choiceGrid(question, onAnswer) {
    var grid = el('div', 'ws-choices'), answered = false, buttons = [];
    question.choices.forEach(function (choice, i) {
      var b = button('ws-choice', null, function () {
        if (answered) return;
        answered = true;
        buttons.forEach(function (other) {
          other.disabled = true;
          if (other.dataset.choice === question.answer) other.classList.add('ws-choice-correct');
          else if (other === b) other.classList.add('ws-choice-wrong');
          else other.classList.add('ws-choice-dim');
        });
        onAnswer(choice === question.answer);
      });
      b.dataset.choice = choice;
      add(b, el('span', 'ws-choice-letter', 'ABCD'.charAt(i)), el('span', 'ws-choice-text', choice));
      buttons.push(b);
      grid.appendChild(b);
    });
    return grid;
  }

  /* =====================================================================
   * Chumash Racer
   * ===================================================================== */
  function racer(host, o) {
    var LANE_Y = [75, 225, 375], CAR_LEFT = 80, CAR_RIGHT = 170;
    var state, raf = 0, track, timers = [];

    function later(fn, ms) { var id = setTimeout(fn, ms); timers.push(id); return id; }

    function build() {
      clear(host);
      track = tracker();
      var rootEl = el('div', 'ws-racer');
      var top = el('div', 'ws-racer-top');
      var titles = add(el('div'), el('div', 'ws-racer-title', '🚗 Chumash Racer'),
        el('div', 'ws-racer-sub', 'Drive into the right meaning · Dodge the wrong ones'));
      var right = add(el('div', 'ws-racer-top-right'), el('div', 'ws-racer-hint', '↑↓ Arrow keys, or tap a lane'),
        button('ws-racer-exit', '← Exit', function () { stop(); o.onExit(); }));
      add(top, titles, right);

      var road = el('div', 'ws-road');
      [150, 300].forEach(function (y) { var line = el('div', 'ws-road-line'); line.style.top = y + 'px'; road.appendChild(line); });
      var hud = el('div', 'ws-road-hud');
      var scoreBox = el('div', 'ws-road-badge'), scoreNum = el('span', null, '0');
      add(scoreBox, document.createTextNode('💰 '), scoreNum);
      var turbo = el('div', 'ws-road-turbo', 'TURBO x2');
      var livesBox = el('div', 'ws-road-badge'), livesNum = el('span', null, '3');
      add(livesBox, document.createTextNode('❤️ '), livesNum);
      add(hud, scoreBox, turbo, livesBox);
      var prompt = el('div', 'ws-road-prompt');
      var car = el('div', 'ws-car');
      car.appendChild(el('div', 'ws-car-window'));
      ['tl', 'tr', 'bl', 'br'].forEach(function (pos) { car.appendChild(el('div', 'ws-car-wheel ws-wheel-' + pos)); });
      add(road, hud, prompt, car);

      var pad = add(el('div', 'ws-racer-pad'),
        button('ws-racer-pad-btn', '▲ Up', function () { move(-1); }),
        button('ws-racer-pad-btn', '▼ Down', function () { move(1); }));
      add(rootEl, top, road, pad);
      host.appendChild(rootEl);

      state = {
        active: true, score: 0, lives: 3, lane: 1, speed: 344, turboUntil: 0, wave: null, power: null,
        deck: [], last: 0, started: performance.now(), road: road, car: car, scoreNum: scoreNum,
        livesNum: livesNum, turbo: turbo, prompt: prompt, rootEl: rootEl
      };
      placeCar();
      road.addEventListener('pointerdown', function (e) {
        if (!state.active) return;
        var y = e.clientY - road.getBoundingClientRect().top;
        state.lane = y < 150 ? 0 : y < 300 ? 1 : 2;
        placeCar();
      });
      document.addEventListener('keydown', onKey);
      later(spawnWave, 700);
      raf = requestAnimationFrame(frame);
    }

    function onKey(e) {
      if (!state || !state.active) return;
      if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    }
    function move(delta) {
      if (!state.active) return;
      state.lane = Math.max(0, Math.min(2, state.lane + delta));
      placeCar();
    }
    function placeCar() { state.car.style.top = (LANE_Y[state.lane] - 25) + 'px'; }

    function nextCard() {
      if (!state.deck.length) state.deck = L.shuffle(o.cards);
      return state.deck.pop();
    }

    // One question: the Hebrew word, and its own three choices — one sign in each lane.
    function spawnWave() {
      if (!state.active) return;
      var card = nextCard(), q = L.buildQuestion(card, o.cards, 3);
      var width = state.road.clientWidth;
      var wave = { card: card, x: width + 20, signs: [], done: false };
      q.choices.forEach(function (choice, lane) {
        var sign = el('div', 'ws-sign');
        add(sign, el('div', 'ws-sign-he', card.hebrew), el('div', 'ws-sign-en', choice));
        sign.style.top = (LANE_Y[lane] - 50) + 'px';
        sign.style.left = wave.x + 'px';
        state.road.appendChild(sign);
        wave.signs.push({ node: sign, correct: choice === card.english, lane: lane });
      });
      state.prompt.textContent = card.hebrew;
      state.wave = wave;
    }

    function spawnPower() {
      var lane = Math.floor(Math.random() * 3), node = el('div', 'ws-power', '⚡');
      node.style.top = (LANE_Y[lane] - 30) + 'px';
      state.road.appendChild(node);
      state.power = { node: node, lane: lane, x: state.road.clientWidth + 20 };
    }

    function reveal(x, y, text, color, small) {
      var node = el('div', 'ws-reveal' + (small ? ' ws-reveal-small' : ''), text);
      node.style.color = color; node.style.left = x + 'px'; node.style.top = y + 'px';
      state.road.appendChild(node);
      later(function () { node.remove(); }, 800);
    }

    function isTurbo(now) { return now < state.turboUntil; }

    function afterWave() {
      if (!state.active) return;
      if (Math.random() < 0.18 && !state.power) spawnPower();
      later(spawnWave, state.power ? 1400 : 500);
    }

    function hitWave(wave, now) {
      wave.done = true;
      var sign = wave.signs.filter(function (s) { return s.lane === state.lane; })[0];
      var y = LANE_Y[state.lane] - 60;
      if (sign.correct) {
        var pts = isTurbo(now) ? 20 : 10;
        state.score += pts;
        state.scoreNum.textContent = state.score;
        track.mark(wave.card.id, true);
        reveal(CAR_RIGHT, y, '💰 +' + pts, '#f1c40f');
      } else {
        state.lives--;
        state.livesNum.textContent = Math.max(0, state.lives);
        track.mark(wave.card.id, false);
        reveal(CAR_RIGHT, y, '🪨 -1  ' + wave.card.english, '#ff4757', true);
        state.road.classList.add('ws-road-crash');
        later(function () { state.road.classList.remove('ws-road-crash'); }, 300);
      }
      sign.node.remove();
      wave.signs.forEach(function (s) { if (s !== sign) s.node.classList.add(s.correct ? 'ws-sign-was-right' : 'ws-sign-fade'); });
      if (state.lives <= 0) { end(); return; }
      afterWave();
    }

    function frame(now) {
      if (!state.active) return;
      var dt = Math.min(0.05, (now - (state.last || now)) / 1000);
      state.last = now;
      // Same pace as the original: a little faster every 8 seconds.
      state.speed = 344 + Math.floor((now - state.started) / 8000) * 9.4;
      state.turbo.style.visibility = isTurbo(now) ? 'visible' : 'hidden';
      state.car.classList.toggle('ws-car-turbo', isTurbo(now));

      var wave = state.wave;
      if (wave) {
        wave.x -= state.speed * dt;
        wave.signs.forEach(function (s) { if (s.node.isConnected) s.node.style.left = wave.x + 'px'; });
        if (!wave.done && wave.x <= CAR_RIGHT) hitWave(wave, now);
        if (wave.x < -260) { wave.signs.forEach(function (s) { s.node.remove(); }); if (state.wave === wave) state.wave = null; }
      }
      var power = state.power;
      if (power) {
        power.x -= state.speed * dt;
        power.node.style.left = power.x + 'px';
        if (power.x <= CAR_RIGHT && power.x + 60 >= CAR_LEFT && power.lane === state.lane) {
          state.turboUntil = now + 7000;
          reveal(CAR_RIGHT, LANE_Y[power.lane] - 60, 'TURBO!!', '#00d2ff');
          power.node.remove(); state.power = null;
        } else if (power.x < -80) { power.node.remove(); state.power = null; }
      }
      raf = requestAnimationFrame(frame);
    }

    function end() {
      state.active = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      var overlay = el('div', 'ws-racer-overlay'), card = el('div', 'ws-racer-card');
      add(card, el('div', 'ws-racer-over-emoji', '💥'), el('h2', 'ws-racer-over-title', 'TOTAL CRASH!'),
        el('p', 'ws-racer-over-score', state.score + ' points'));
      saveLine(card, o.onFinish({ score: state.score, correct: track.correct, missed: track.missed }), true);
      add(card, add(el('div', 'ws-racer-over-buttons'),
        button('ws-racer-again', 'Play Again', function () { stop(); build(); }),
        button('ws-racer-exit2', 'Exit', function () { stop(); o.onExit(); })));
      state.rootEl.appendChild(add(overlay, card));
    }

    function stop() {
      if (state) state.active = false;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout); timers = [];
      document.removeEventListener('keydown', onKey);
    }

    build();
    return stop;
  }

  /* =====================================================================
   * Lava Traveler
   * ===================================================================== */
  var HATS = ['🎓', '👒', '🪖', '👑', '🎩', '🌟'];
  var HAT_LABELS = ['Explorer', 'Traveler', 'Ranger', 'Chief', 'Master', 'Legend'];

  function roundRect(cx, x, y, w, h, r) {
    cx.beginPath();
    if (cx.roundRect) { cx.roundRect(x, y, w, h, r); return; }
    cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r);
    cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath();
  }

  function drawTraveler(cx, x, y, walkT, hatIdx, alpha) {
    cx.save();
    cx.globalAlpha = alpha;
    cx.translate(x, y);
    cx.save(); cx.globalAlpha = alpha * 0.2; cx.fillStyle = '#000';
    cx.beginPath(); cx.ellipse(0, 26, 14, 4, 0, 0, Math.PI * 2); cx.fill(); cx.restore();
    var sw = Math.sin(walkT * 5) * 0.25;
    cx.fillStyle = '#1a1a2e';
    cx.save(); cx.translate(-4, 8); cx.rotate(-sw); roundRect(cx, -3, 0, 7, 20, 3); cx.fill(); cx.restore();
    cx.save(); cx.translate(4, 8); cx.rotate(sw); roundRect(cx, -3, 0, 7, 20, 3); cx.fill(); cx.restore();
    roundRect(cx, -10, -10, 20, 22, 5); cx.fill();
    cx.fillStyle = '#2952f5'; cx.fillRect(-10, 0, 20, 5);
    cx.fillStyle = '#1a1a2e';
    cx.save(); cx.translate(-10, -4); cx.rotate(sw * 0.6); roundRect(cx, -4, 0, 7, 15, 3); cx.fill(); cx.restore();
    cx.save(); cx.translate(10, -4); cx.rotate(-sw * 0.6); roundRect(cx, -3, 0, 7, 15, 3); cx.fill(); cx.restore();
    cx.fillStyle = '#f5c842';
    cx.beginPath(); cx.arc(0, -20, 12, 0, Math.PI * 2); cx.fill();
    cx.strokeStyle = '#c8960a'; cx.lineWidth = 1.5; cx.stroke();
    cx.fillStyle = '#333';
    cx.beginPath(); cx.arc(4, -22, 2, 0, Math.PI * 2); cx.fill();
    cx.beginPath(); cx.arc(-4, -22, 1.5, 0, Math.PI * 2); cx.fill();
    cx.strokeStyle = '#333'; cx.lineWidth = 1.5;
    cx.beginPath(); cx.arc(0, -17, 5, 0.1, Math.PI - 0.1); cx.stroke();
    cx.font = '18px serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText(HATS[hatIdx], 0, -40);
    cx.restore();
  }

  function drawLog(cx, log, animT) {
    if (log.sinking && log.sinkY > 800) return;
    var drawY = log.sinking ? log.sinkY : log.y;
    var bob = log.sinking ? 0 : Math.sin(animT * 1.3 + log.wobble) * 2.5;
    var x = log.x, w = log.w, h = log.h;
    if (!log.sinking) {
      cx.save(); cx.globalAlpha = 0.15; cx.fillStyle = '#ff4500';
      cx.beginPath(); cx.ellipse(x, drawY + h / 2 + 10 + bob, w * 0.44, 7, 0, 0, Math.PI * 2); cx.fill(); cx.restore();
    }
    var bodyY = drawY - h / 2 + bob, fill;
    if (log.flash > 0) fill = log.flashOk ? '#1a6b2a' : '#7a0000';
    else if (log.sinking) fill = '#3a1800';
    else {
      fill = cx.createLinearGradient(x - w / 2, bodyY, x - w / 2, bodyY + h);
      fill.addColorStop(0, '#9b6535'); fill.addColorStop(0.5, '#6b3f1a'); fill.addColorStop(1, '#4a2a0a');
    }
    cx.fillStyle = fill;
    roundRect(cx, x - w / 2, bodyY, w, h, 10); cx.fill();
    cx.strokeStyle = 'rgba(0,0,0,0.22)'; cx.lineWidth = 1.5;
    for (var i = 1; i < 4; i++) {
      cx.beginPath(); cx.moveTo(x - w / 2 + (w / 4) * i, bodyY + 5); cx.lineTo(x - w / 2 + (w / 4) * i, bodyY + h - 5); cx.stroke();
    }
    if (!log.sinking || log.sinkY < log.y + 30) {
      cx.fillStyle = log.sinking ? 'rgba(255,248,225,0.4)' : '#FFF8E1';
      cx.font = 'bold 12px Nunito,sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
      var words = String(log.answer).split(' '), lines = [], cur = '';
      words.forEach(function (word) {
        var test = cur ? cur + ' ' + word : word;
        if (cx.measureText(test).width > w - 16 && cur) { lines.push(cur); cur = word; } else cur = test;
      });
      if (cur) lines.push(cur);
      lines = lines.slice(0, 2);
      lines.forEach(function (line, n) { cx.fillText(line, x, drawY + bob + (n - (lines.length - 1) / 2) * 15); });
    }
  }

  function lava(host, o) {
    var LOG_H = 46, CHAR_H = 46;
    var G = null, raf = 0, track, timers = [], cv, cx, ui = {};

    function later(fn, ms) { var id = setTimeout(fn, ms); timers.push(id); return id; }
    function W() { return cv.width; }
    function H() { return cv.height; }
    function logY() { return H() * 0.60; }
    function logW() { return Math.min(150, W() * 0.22); }
    function logGap() { return Math.min(200, W() * 0.28); }
    function resize() {
      if (!cv) return;
      cv.width = cv.offsetWidth || window.innerWidth;
      cv.height = cv.offsetHeight || 300;
    }

    function build() {
      clear(host);
      var rootEl = el('div', 'ws-lava');
      var top = el('div', 'ws-lava-top');
      add(top, add(el('div'), el('div', 'ws-lava-title', '🌋 Lava Traveler'),
        el('div', 'ws-lava-sub', 'Translate the word · Jump to the correct log!')),
        button('ws-lava-exit', '← Exit', function () { stop(); o.onExit(); }));
      var wrap = el('div', 'ws-lava-wrap');
      cv = el('canvas', 'ws-lava-canvas');
      ui.panel = el('div', 'ws-lava-panel');
      ui.question = el('div', 'ws-lava-q');
      ui.buttons = el('div', 'ws-lava-btns');
      ui.feedback = el('div', 'ws-lava-fb');
      add(ui.panel, el('div', 'ws-lava-qlabel', 'What does this mean?'), ui.question, ui.buttons, ui.feedback);
      ui.overlay = el('div', 'ws-lava-ov');
      add(wrap, cv, ui.panel, ui.overlay);
      host.appendChild(add(rootEl, top, wrap));
      cx = cv.getContext('2d');
      window.addEventListener('resize', resize);
      showStart();
    }

    function overlayCard() {
      clear(ui.overlay);
      ui.overlay.style.display = 'flex';
      var card = el('div', 'ws-lava-card');
      ui.overlay.appendChild(card);
      return card;
    }

    function showStart() {
      ui.panel.style.display = 'none';
      var card = overlayCard(), hats = el('p', 'ws-lava-desc ws-lava-gold', 'Hat upgrades every 50m: ' + HATS.join(' '));
      add(card, el('div', 'ws-lava-emoji', '🌋'), el('h2', 'ws-lava-card-title', 'Lava Traveler'),
        el('p', 'ws-lava-desc', 'Cross the lava river by jumping to the log with the correct translation!'),
        el('p', 'ws-lava-desc', 'Wrong answer → you sink. 3 lives.'), hats,
        button('ws-lava-start', '🚀 Start!', startGame));
    }

    function makeLog(x, answer, isCorrect) {
      return { x: x, y: logY(), w: logW(), h: LOG_H, answer: answer, isCorrect: isCorrect, wobble: Math.random() * Math.PI * 2,
        flash: 0, flashOk: false, sinking: false, sinkY: logY(), slideIn: false };
    }

    function nextCard() {
      if (!G.deck.length) G.deck = L.shuffle(o.cards);
      return G.deck.pop();
    }

    function loadQuestion(slideIn) {
      var card = nextCard(), q = L.buildQuestion(card, o.cards, 3);
      G.card = card;
      var first = W() * 0.38, gap = logGap();
      G.logs = q.choices.map(function (choice, i) {
        var log = makeLog(first + gap * i, choice, choice === q.answer);
        if (slideIn) { log.slideIn = true; log.x = W() + 80 + i * 80; }
        return log;
      });
      ui.question.textContent = card.hebrew;
      clear(ui.buttons);
      q.choices.forEach(function (choice) {
        ui.buttons.appendChild(button('ws-lava-opt', choice, function () { answer(choice); }));
      });
      setFeedback(null);
    }

    function setFeedback(kind) {
      ui.panel.dataset.feedback = kind || '';
      ui.feedback.style.display = kind ? 'block' : 'none';
      ui.feedback.className = 'ws-lava-fb ' + (kind === 'correct' ? 'ws-lava-fb-ok' : 'ws-lava-fb-bad');
      if (kind === 'correct') ui.feedback.textContent = '✅ Correct! +10 pts';
      if (kind === 'wrong') ui.feedback.textContent = '❌ Wrong! ' + Math.max(0, G.lives) + (G.lives === 1 ? ' life' : ' lives') + ' left';
    }

    function startGame() {
      timers.forEach(clearTimeout); timers = [];
      cancelAnimationFrame(raf);
      ui.overlay.style.display = 'none';
      ui.panel.style.display = 'block';
      track = tracker();
      resize();
      G = {
        animT: 0, logs: [], deck: [], card: null,
        charX: W() * 0.10, charY: logY() - LOG_H / 2 - CHAR_H, charWalk: 0, charState: 'idle',
        jumpT: 0, jumpDur: 22, jumpSX: 0, jumpSY: 0, jumpTX: 0, jumpTY: 0, jumpTarget: -1,
        sinkT: 0, standingOn: null, showPlatform: true, scrollX: 0,
        bubbles: [], rocks: [], answered: false, lives: 3, score: 0, distance: 0, hatIdx: 0
      };
      for (var b = 0; b < 24; b++) G.bubbles.push({ x: Math.random() * 800, y: Math.random() * 400 + 200, r: 4 + Math.random() * 14,
        spd: 0.3 + Math.random() * 0.7, alpha: 0.4 + Math.random() * 0.5, wob: Math.random() * 6 });
      for (var r = 0; r < 12; r++) G.rocks.push({ x: Math.random() * 800, y: logY() + 30 + Math.random() * 80, r: 8 + Math.random() * 22 });
      loadQuestion(false);
      raf = requestAnimationFrame(loop);
    }

    function answer(choice) {
      if (!G || G.answered || G.charState !== 'idle') return;
      if (G.logs.some(function (l) { return l.slideIn; })) return;
      var chosen = G.logs.filter(function (l) { return l.answer === choice; })[0];
      if (!chosen) return;
      G.answered = true;
      var game = G;
      chosen.flash = 20;
      if (chosen.isCorrect) {
        chosen.flashOk = true;
        G.score += 10; G.distance += 8;
        track.mark(G.card.id, true);
        setFeedback('correct');
        G.charState = 'jumping'; G.jumpT = 0;
        G.jumpSX = G.charX; G.jumpSY = G.charY;
        G.jumpTX = chosen.x; G.jumpTY = chosen.y - chosen.h / 2 - CHAR_H;
        G.jumpTarget = G.logs.indexOf(chosen);
      } else {
        chosen.flashOk = false;
        G.lives--;
        track.mark(G.card.id, false);
        setFeedback('wrong');
        G.charState = 'sinking'; G.sinkT = 0;
        if (G.lives <= 0) {
          later(function () { if (G === game) gameOver(); }, 900);
        } else {
          later(function () {
            if (G !== game) return;
            G.charState = 'idle'; G.sinkT = 0;
            var right = G.logs.filter(function (l) { return l.isCorrect; })[0];
            if (right) { G.charX = right.x; G.charY = right.y - right.h / 2 - CHAR_H; G.standingOn = right; G.showPlatform = false; }
            G.logs.forEach(function (l) { l.flash = 0; });
            setFeedback(null);
            // The right log was just shown, so move on to a new word.
            later(function () { if (G === game) { G.answered = false; G.standingOn = null; loadQuestion(true); } }, 900);
          }, 1000);
        }
      }
    }

    function gameOver() {
      var final = { score: G.score, dist: Math.floor(G.distance) };
      cancelAnimationFrame(raf);
      ui.panel.style.display = 'none';
      var card = overlayCard();
      add(card, el('div', 'ws-lava-emoji', '😵'), el('h2', 'ws-lava-card-title', 'You Sank!'),
        el('p', 'ws-lava-desc ws-lava-final', final.score + ' pts · ' + final.dist + 'm'));
      saveLine(card, o.onFinish({ score: final.score, correct: track.correct, missed: track.missed }), true);
      add(card, add(el('div', 'ws-lava-over-buttons'), button('ws-lava-start', 'Try Again', startGame),
        button('ws-lava-exit2', 'Exit', function () { stop(); o.onExit(); })));
    }

    function update() {
      G.animT += 0.035; G.scrollX += 0.4;
      G.logs.forEach(function (l, i) {
        if (l.slideIn) {
          var target = W() * 0.38 + i * logGap(), dx = target - l.x;
          l.x += dx * 0.12;
          if (Math.abs(dx) < 2) { l.x = target; l.slideIn = false; }
        }
        if (l.sinking) { l.sinkY += 5 + (l.sinkY - logY()) * 0.05; if (l.flash > 0) l.flash--; }
      });
      if (G.charState === 'idle' && G.standingOn) {
        var sl = G.standingOn, bob = sl.sinking ? 0 : Math.sin(G.animT * 1.3 + sl.wobble) * 2.5;
        G.charX = sl.x; G.charY = sl.y - sl.h / 2 + bob - CHAR_H;
        G.charWalk += 0.04; G.distance += 0.015;
      }
      if (G.charState === 'jumping') {
        G.jumpT++;
        var t = Math.min(G.jumpT / G.jumpDur, 1), ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        G.charX = G.jumpSX + (G.jumpTX - G.jumpSX) * ease;
        G.charY = G.jumpSY + (G.jumpTY - G.jumpSY) * ease - Math.sin(t * Math.PI) * 80;
        G.charWalk += 0.2;
        if (t >= 1) {
          G.charX = G.jumpTX; G.charY = G.jumpTY; G.charState = 'idle'; G.charWalk = 0; G.showPlatform = false;
          G.standingOn = G.logs[G.jumpTarget];
          G.logs.forEach(function (l, i) { if (i !== G.jumpTarget) { l.sinking = true; l.sinkY = l.y; } });
          var game = G;
          later(function () { if (G !== game) return; G.answered = false; G.standingOn = null; loadQuestion(true); }, 700);
        }
      }
      if (G.charState === 'sinking') { G.sinkT++; G.charY += G.sinkT * 1.8; }
      G.hatIdx = Math.min(Math.floor(G.distance / 50), HATS.length - 1);
    }

    function drawBackground() {
      var lY = logY(), w = W(), h = H();
      var sky = cx.createLinearGradient(0, 0, 0, lY * 0.8);
      sky.addColorStop(0, '#060010'); sky.addColorStop(1, '#180008');
      cx.fillStyle = sky; cx.fillRect(0, 0, w, lY * 0.8);
      cx.fillStyle = 'rgba(255,60,0,0.08)'; cx.fillRect(0, lY * 0.65, w, lY * 0.2);
      cx.fillStyle = '#080010';
      for (var i = 0; i < 10; i++) {
        var sx = ((i * 110 + G.scrollX * 0.08) % (w + 100)), sh = 20 + Math.sin(i * 1.9) * 16;
        cx.beginPath(); cx.moveTo(sx - 18, 0); cx.lineTo(sx + 18, 0); cx.lineTo(sx, sh); cx.closePath(); cx.fill();
      }
      var lv = cx.createLinearGradient(0, lY * 0.82, 0, h);
      lv.addColorStop(0, '#550e00'); lv.addColorStop(0.35, '#881600'); lv.addColorStop(0.75, '#bb2e00'); lv.addColorStop(1, '#ff5200');
      cx.fillStyle = lv; cx.fillRect(0, lY * 0.82, w, h - lY * 0.82);
      for (var wi = 0; wi < 4; wi++) {
        cx.strokeStyle = 'rgba(255,' + (90 + wi * 28) + ',0,' + (0.05 + wi * 0.02) + ')';
        cx.lineWidth = 2; cx.beginPath();
        for (var x = 0; x <= w; x += 5) {
          var y = lY * 0.84 + Math.sin(x * 0.018 + G.animT * 0.9 + wi * 1.4) * 7;
          if (x === 0) cx.moveTo(x, y); else cx.lineTo(x, y);
        }
        cx.stroke();
      }
      G.rocks.forEach(function (r) {
        r.x = ((r.x - 0.4) + w + 60) % (w + 60);
        cx.fillStyle = '#250700'; cx.beginPath(); cx.ellipse(r.x, r.y, r.r * 1.6, r.r * 0.62, 0, 0, Math.PI * 2); cx.fill();
        cx.fillStyle = '#381000'; cx.beginPath(); cx.ellipse(r.x - r.r * 0.3, r.y - r.r * 0.22, r.r * 0.9, r.r * 0.48, 0, 0, Math.PI * 2); cx.fill();
      });
      G.bubbles.forEach(function (b) {
        b.y -= b.spd; b.wob += 0.04; b.x += Math.sin(b.wob) * 0.28;
        if (b.y + b.r < lY * 0.82) { b.y = h + b.r; b.x = Math.random() * w; }
        var gr = cx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        gr.addColorStop(0, 'rgba(255,190,40,' + b.alpha + ')'); gr.addColorStop(0.5, 'rgba(255,80,0,' + (b.alpha * 0.5) + ')');
        gr.addColorStop(1, 'rgba(200,20,0,0)');
        cx.fillStyle = gr; cx.beginPath(); cx.arc(b.x, b.y, b.r, 0, Math.PI * 2); cx.fill();
      });
      if (G.showPlatform) {
        cx.fillStyle = '#2a1500'; roundRect(cx, 0, lY - 10, w * 0.18, h - (lY - 10), 4); cx.fill();
        cx.fillStyle = '#4a2800'; cx.fillRect(0, lY - 12, w * 0.18, 6);
        cx.fillStyle = '#5a3500'; cx.fillRect(0, lY - 14, w * 0.18, 4);
      }
    }

    function drawHud() {
      var w = W();
      cx.fillStyle = 'rgba(0,0,0,0.70)'; cx.fillRect(0, 0, w, 50);
      cx.fillStyle = 'rgba(255,70,0,0.22)'; cx.fillRect(0, 49, w, 1);
      cx.font = 'bold 14px Nunito,sans-serif'; cx.textBaseline = 'middle';
      cx.textAlign = 'left'; cx.fillStyle = '#fff';
      cx.fillText('❤️'.repeat(Math.max(0, G.lives)), 14, 17);
      cx.fillStyle = '#f5c842'; cx.fillText('⭐ ' + G.score, 14, 37);
      cx.textAlign = 'right'; cx.fillStyle = '#ff9944'; cx.fillText('📏 ' + Math.floor(G.distance) + 'm', w - 14, 17);
      cx.fillStyle = '#aaa'; cx.fillText(HATS[G.hatIdx] + ' ' + HAT_LABELS[G.hatIdx], w - 14, 37);
    }

    function loop() {
      if (!G) return;
      update();
      cx.clearRect(0, 0, W(), H());
      drawBackground();
      G.logs.forEach(function (log) { drawLog(cx, log, G.animT); if (log.flash > 0 && !log.sinking) log.flash--; });
      drawTraveler(cx, G.charX, G.charY, G.charWalk, G.hatIdx, G.charState === 'sinking' ? Math.max(0, 1 - G.sinkT / 22) : 1);
      drawHud();
      raf = requestAnimationFrame(loop);
    }

    function stop() {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout); timers = [];
      window.removeEventListener('resize', resize);
      G = null;
    }

    build();
    return stop;
  }

  /* =====================================================================
   * Matching
   * ===================================================================== */
  function matching(host, o) {
    var timer = 0;

    function formatTenths(tenths) {
      var total = tenths / 10;
      return Math.floor(total / 60) + ':' + String(Math.floor(total % 60)).padStart(2, '0') + '.' + (tenths % 10);
    }

    function setup() {
      clearInterval(timer);
      var sizes = [6, 9, 12].filter(function (n) { return n <= o.cards.length; });
      if (!sizes.length) sizes = [o.cards.length];
      setupScreen(host, {
        rootClass: 'ws-plain', emoji: '🃏', title: 'Matching', sub: 'Find all the matching pairs as fast as you can!',
        label: 'Choose number of pairs:', onExit: function () { stop(); o.onExit(); }, onPick: play,
        options: sizes.map(function (n) { return { value: n, big: String(n), small: 'pairs' }; })
      });
    }

    function play(pairCount) {
      clear(host);
      var track = tracker(), elapsed = 0, matched = 0, selected = null, locked = false;
      var tiles = [];
      L.shuffle(o.cards).slice(0, pairCount).forEach(function (card) {
        tiles.push({ pair: card.id, text: card.hebrew, lang: 'he', english: card.english });
        tiles.push({ pair: card.id, text: card.english, lang: 'en', english: card.english });
      });
      tiles = L.shuffle(tiles);

      var rootEl = el('div', 'ws-light ws-plain');
      var header = el('div', 'ws-header ws-header-wide');
      var time = el('span', 'ws-timer', '⏱ 0:00.0'), progress = el('span', 'ws-progress', '0/' + pairCount + ' matched');
      add(header, button('ws-back', '← Back', function () { stop(); o.onExit(); }),
        add(el('div', 'ws-header-center'), time, progress), el('div', 'ws-header-spacer'));
      var grid = el('div', 'ws-match-grid ws-match-cols-' + (pairCount === 6 ? 4 : 6));

      tiles.forEach(function (tile) {
        var b = button('ws-match-card' + (tile.lang === 'he' ? ' ws-he' : ''), tile.text, function () {
          if (locked || tile.gone) return;
          if (selected === tile) { selected = null; b.classList.remove('ws-match-selected'); return; }
          if (!selected) { selected = tile; b.classList.add('ws-match-selected'); return; }
          var other = selected;
          // Two words that share a meaning count as a pair, as in the original.
          if (other.pair === tile.pair || other.english === tile.english) {
            [other, tile].forEach(function (t) { t.gone = true; t.node.className = 'ws-match-gone'; t.node.textContent = ''; t.node.disabled = true; });
            track.mark(tile.pair, true);
            if (other.pair !== tile.pair) track.mark(other.pair, true);
            selected = null;
            matched++;
            progress.textContent = matched + '/' + pairCount + ' matched';
            if (matched >= pairCount) finish();
          } else {
            locked = true;
            track.mark(other.pair, false);
            if (other.pair !== tile.pair) track.mark(tile.pair, false);
            [other, tile].forEach(function (t) { t.node.classList.add('ws-match-wrong'); });
            setTimeout(function () {
              [other, tile].forEach(function (t) { t.node.classList.remove('ws-match-wrong', 'ws-match-selected'); });
              selected = null; locked = false;
            }, 600);
          }
        });
        tile.node = b;
        grid.appendChild(b);
      });
      host.appendChild(add(rootEl, header, grid));
      timer = setInterval(function () { elapsed++; time.textContent = '⏱ ' + formatTenths(elapsed); }, 100);

      function finish() {
        clearInterval(timer);
        var score = Math.max(1000 - Math.floor(elapsed / 10) * 5, 100);
        clear(host);
        var done = el('div', 'ws-light ws-plain'), box = el('div', 'ws-box ws-box-wide');
        add(box, el('div', 'ws-emoji', '🎉'), el('h1', 'ws-title', 'Nice work!'),
          el('p', 'ws-sub', 'You matched all ' + pairCount + ' pairs!'),
          add(el('div', 'ws-result-row'), resultStat(formatTenths(elapsed), 'Time'), resultStat(score, 'Score')));
        saveLine(box, o.onFinish({ score: score, correct: track.correct, missed: track.missed }));
        add(box, finishButtons('Play Again', setup, function () { stop(); o.onExit(); }));
        host.appendChild(add(done, box));
      }
    }

    function stop() { clearInterval(timer); }
    setup();
    return stop;
  }

  /* =====================================================================
   * Multiple Choice
   * ===================================================================== */
  function multipleChoice(host, o) {
    var timer = 0, pending = 0;

    function setup() {
      clearInterval(timer); clearTimeout(pending);
      setupScreen(host, {
        emoji: '🧠', title: 'Multiple Choice', sub: 'Answer questions and build your streak for bonus points!',
        label: 'Choose number of questions:', onExit: function () { stop(); o.onExit(); }, onPick: play,
        options: [10, 15, 20].map(function (n) { return { value: n, big: String(n), small: 'questions' }; })
      });
    }

    function play(count) {
      var track = tracker(), elapsed = 0, current = 0, streak = 0, bestStreak = 0, score = 0, right = 0;
      var questions = L.pickCards(o.cards, count).map(function (card) { return L.buildQuestion(card, o.cards, 4); });
      clear(host);
      var rootEl = el('div', 'ws-light');
      var time = el('span', 'ws-timer', '⏱ 0:00'), progress = el('span', 'ws-progress');
      var streakBadge = el('div', 'ws-streak', '🔥 0');
      var header = add(el('div', 'ws-header'), button('ws-back', '← Back', function () { stop(); o.onExit(); }),
        add(el('div', 'ws-header-center'), time, progress), streakBadge);
      var bar = el('div', 'ws-bar'), barWrap = add(el('div', 'ws-bar-wrap'), bar);
      var scoreNum = el('span', 'ws-score-num', '0 pts'), streakMsg = el('span', 'ws-streak-msg');
      var scoreLine = add(el('div', 'ws-score-line'), scoreNum, streakMsg);
      var card = el('div', 'ws-question-card ws-he');
      var questionWrap = add(el('div', 'ws-question-wrap'), el('p', 'ws-question-hint', 'What does this mean?'), card);
      var choices = el('div');
      host.appendChild(add(rootEl, header, barWrap, scoreLine, questionWrap, choices));
      timer = setInterval(function () { elapsed++; time.textContent = '⏱ ' + formatClock(elapsed); }, 1000);

      function show() {
        var q = questions[current];
        progress.textContent = (current + 1) + ' / ' + count;
        bar.style.width = (current / count * 100) + '%';
        card.textContent = q.hebrew;
        var grid = choiceGrid(q, function (ok) {
          streak = ok ? streak + 1 : 0;
          bestStreak = Math.max(bestStreak, streak);
          if (ok) { right++; score += 100 + (streak - 1) * 25; }
          track.mark(q.id, ok);
          scoreNum.textContent = score + ' pts';
          streakBadge.textContent = '🔥 ' + streak;
          streakMsg.textContent = streak >= 2 ? '🔥 ' + streak + ' streak — +' + ((streak - 1) * 25) + ' bonus!' : '';
          pending = setTimeout(function () { current++; if (current >= count) finish(); else show(); }, 900);
        });
        choices.replaceWith(grid);
        choices = grid;
      }

      function finish() {
        clearInterval(timer);
        clear(host);
        var done = el('div', 'ws-light'), box = el('div', 'ws-box ws-box-wide');
        add(box, el('div', 'ws-emoji', right >= count * 0.8 ? '🏆' : right >= count * 0.5 ? '👍' : '💪'),
          el('h1', 'ws-title', 'Round complete!'),
          add(el('div', 'ws-result-grid'), resultStat(score, 'Score'), resultStat(right + '/' + count, 'Correct'),
            resultStat(formatClock(elapsed), 'Time'), resultStat(bestStreak, 'Best streak')));
        saveLine(box, o.onFinish({ score: score, correct: track.correct, missed: track.missed }));
        add(box, finishButtons('Play Again', setup, function () { stop(); o.onExit(); }));
        host.appendChild(add(done, box));
      }
      show();
    }

    function stop() { clearInterval(timer); clearTimeout(pending); }
    setup();
    return stop;
  }

  /* =====================================================================
   * True or False
   * ===================================================================== */
  function trueFalse(host, o) {
    var timer = 0, pending = 0, keyHandler = null;

    function setup() {
      stop();
      setupScreen(host, {
        emoji: '⚡', title: 'True or False',
        sub: 'A Hebrew word flashes on screen — is the translation correct? Answer as many as you can before time runs out!',
        label: 'Choose time limit:', tip: '💡 Tip: use ← → arrow keys or T / F to answer',
        onExit: function () { stop(); o.onExit(); }, onPick: play,
        options: [{ value: 30, big: '30s', small: 'quick' }, { value: 60, big: '60s', small: 'standard' }, { value: 90, big: '90s', small: 'marathon' }]
      });
    }

    function play(limit) {
      var track = tracker(), timeLeft = limit, score = 0, right = 0, wrong = 0, busy = false, finished = false;
      var deck = [], question = null, shownAt = 0;
      clear(host);
      var rootEl = el('div', 'ws-light');
      var timeNum = el('span', 'ws-tf-time', limit + 's'), tally = el('span', 'ws-progress', '0 correct · 0 wrong');
      var scoreBadge = el('div', 'ws-tf-score', '0 pts');
      var header = add(el('div', 'ws-header'), button('ws-back', '← Back', function () { stop(); o.onExit(); }),
        add(el('div', 'ws-header-center'), timeNum, tally), scoreBadge);
      var bar = el('div', 'ws-tf-bar'), barWrap = add(el('div', 'ws-bar-wrap ws-tf-bar-wrap'), bar);
      var prompt = el('div', 'ws-tf-prompt ws-he'), shown = el('div', 'ws-tf-shown'), badge = el('div', 'ws-tf-feedback');
      var card = add(el('div', 'ws-tf-card'), el('p', 'ws-question-hint', 'Does this Hebrew word mean:'), prompt,
        el('div', 'ws-tf-arrow', '↓'), shown, badge);
      var trueBtn = button('ws-tf-btn ws-tf-true', null, function () { answer(true); });
      add(trueBtn, document.createTextNode('✓ True'), el('span', 'ws-tf-key', '← or T'));
      var falseBtn = button('ws-tf-btn ws-tf-false', null, function () { answer(false); });
      add(falseBtn, document.createTextNode('✗ False'), el('span', 'ws-tf-key', '→ or F'));
      host.appendChild(add(rootEl, header, barWrap, card, add(el('div', 'ws-tf-buttons'), trueBtn, falseBtn)));

      function paintTimer() {
        var pct = timeLeft / limit, color = pct > 0.5 ? '#0ea96e' : pct > 0.25 ? '#e07b00' : '#ef4444';
        timeNum.textContent = timeLeft + 's'; timeNum.style.color = color;
        bar.style.width = (pct * 100) + '%'; bar.style.background = color;
      }
      function next() {
        if (!deck.length) deck = L.shuffle(o.cards);
        var word = deck.pop(), isTrue = Math.random() > 0.5, text = word.english;
        if (!isTrue) {
          var others = L.uniqueMeanings(o.cards).filter(function (m) { return m !== word.english; });
          text = others.length ? L.shuffle(others)[0] : '—';
        }
        question = { card: word, answer: isTrue };
        prompt.textContent = word.hebrew; shown.textContent = text;
        badge.textContent = ''; card.dataset.feedback = '';
        shownAt = Date.now(); busy = false;
      }
      function answer(userSaysTrue) {
        if (busy || finished || !question) return;
        busy = true;
        var ok = userSaysTrue === question.answer;
        track.mark(question.card.id, ok);
        if (ok) { right++; score += 100 + Math.max(0, Math.floor((3 - (Date.now() - shownAt) / 1000) * 20)); }
        else wrong++;
        scoreBadge.textContent = score + ' pts';
        tally.textContent = right + ' correct · ' + wrong + ' wrong';
        card.dataset.feedback = ok ? 'correct' : 'wrong';
        badge.textContent = ok ? '✓ Correct!' : '✗ Wrong!';
        badge.style.color = ok ? '#065f46' : '#991b1b';
        pending = setTimeout(next, 700);
      }
      function finish() {
        finished = true;
        stop();
        var total = right + wrong, accuracy = total ? Math.round(right / total * 100) : 0;
        clear(host);
        var done = el('div', 'ws-light'), box = el('div', 'ws-box ws-box-wide');
        add(box, el('div', 'ws-emoji', accuracy >= 80 ? '🏆' : accuracy >= 50 ? '👍' : '💪'), el('h1', 'ws-title', "Time's up!"),
          add(el('div', 'ws-result-grid'), resultStat(score, 'Score'), resultStat(total, 'Answered'),
            resultStat(right, 'Correct'), resultStat(accuracy + '%', 'Accuracy')));
        saveLine(box, o.onFinish({ score: score, correct: track.correct, missed: track.missed }));
        add(box, finishButtons('Play Again', setup, function () { stop(); o.onExit(); }));
        host.appendChild(add(done, box));
      }

      keyHandler = function (e) {
        if (e.key === 'ArrowLeft' || e.key === 't' || e.key === 'T') answer(true);
        if (e.key === 'ArrowRight' || e.key === 'f' || e.key === 'F') answer(false);
      };
      window.addEventListener('keydown', keyHandler);
      timer = setInterval(function () { timeLeft--; paintTimer(); if (timeLeft <= 0) finish(); }, 1000);
      paintTimer();
      next();
    }

    function stop() {
      clearInterval(timer); clearTimeout(pending);
      if (keyHandler) window.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    }
    setup();
    return stop;
  }

  /* =====================================================================
   * Flashcards
   * ===================================================================== */
  function flashcards(host, o) {
    function play() {
      var track = tracker(), deck = L.shuffle(o.cards), total = deck.length, current = 0, gotIt = 0, learning = 0, flipped = false;
      clear(host);
      var rootEl = el('div', 'ws-light');
      var progress = el('span', 'ws-flash-progress');
      var got = el('span', 'ws-flash-got', '✓ 0'), still = el('span', 'ws-flash-still', '↺ 0');
      var header = add(el('div', 'ws-header'), button('ws-back', '← Back', o.onExit),
        add(el('div', 'ws-header-center'), progress), add(el('div', 'ws-flash-stats'), got, still));
      var bar = el('div', 'ws-bar'), barWrap = add(el('div', 'ws-bar-wrap'), bar);
      var card = el('div', 'ws-flashcard'), cardWrap = add(el('div', 'ws-flash-wrap'), card);
      var buttons = add(el('div', 'ws-flash-buttons'),
        button('ws-flash-btn ws-flash-learning', '↺ Still learning', function () { learning++; advance(false); }),
        button('ws-flash-btn ws-flash-gotit', '✓ Got it!', function () { gotIt++; advance(true); }));
      host.appendChild(add(rootEl, header, barWrap, cardWrap, buttons));
      card.addEventListener('click', function () { if (!flipped) { flipped = true; paint(); } });
      card.tabIndex = 0;
      card.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && !flipped) { e.preventDefault(); flipped = true; paint(); } });

      function paint() {
        var word = deck[current];
        progress.textContent = (current + 1) + ' / ' + total;
        bar.style.width = (current / total * 100) + '%';
        got.textContent = '✓ ' + gotIt; still.textContent = '↺ ' + learning;
        clear(card);
        card.classList.toggle('ws-flashcard-flipped', flipped);
        if (!flipped) add(card, el('p', 'ws-flash-hint', 'Hebrew'), el('div', 'ws-flash-he ws-he', word.hebrew), el('p', 'ws-flash-tap', 'Tap to reveal →'));
        else add(card, el('p', 'ws-flash-hint', 'English'), el('div', 'ws-flash-en', word.english), el('div', 'ws-flash-he-small ws-he', word.hebrew));
        buttons.style.visibility = flipped ? 'visible' : 'hidden';
      }
      function advance(knewIt) {
        track.mark(deck[current].id, knewIt);
        current++; flipped = false;
        if (current >= total) finish(); else paint();
      }
      function finish() {
        var pct = total ? Math.round(gotIt / total * 100) : 0, msg = encouragement(pct);
        clear(host);
        var done = el('div', 'ws-light'), box = el('div', 'ws-box');
        var note = el('div', 'ws-message', msg.text);
        note.style.color = msg.color; note.style.borderColor = msg.color;
        add(box, el('div', 'ws-emoji', '🃏'), el('h1', 'ws-title', 'All done!'), el('p', 'ws-sub', 'You went through all ' + total + ' cards'),
          add(el('div', 'ws-result-grid'), resultStat(gotIt, 'Got it', '#0ea96e'), resultStat(learning, 'Still learning', '#ef4444')), note);
        saveLine(box, o.onFinish({ score: gotIt, correct: track.correct, missed: track.missed }));
        add(box, finishButtons('Study Again', play, o.onExit));
        host.appendChild(add(done, box));
      }
      paint();
    }
    play();
    return function () {};
  }

  /* =====================================================================
   * Practice Quiz
   * ===================================================================== */
  function quiz(host, o) {
    var pending = 0;
    function play() {
      clearTimeout(pending);
      var track = tracker(), current = 0, right = 0;
      var questions = L.shuffle(o.cards).slice(0, 15).map(function (card) { return L.buildQuestion(card, o.cards, 4); });
      var total = questions.length;
      clear(host);
      var rootEl = el('div', 'ws-light');
      var progress = el('span', 'ws-flash-progress'), correctText = el('span', 'ws-quiz-correct', '✓ 0 correct');
      var header = add(el('div', 'ws-header'), button('ws-back', '← Back', function () { stop(); o.onExit(); }),
        add(el('div', 'ws-header-center'), progress, correctText), el('div', 'ws-header-spacer'));
      var bar = el('div', 'ws-bar'), barWrap = add(el('div', 'ws-bar-wrap'), bar);
      var card = el('div', 'ws-question-card ws-he');
      var questionWrap = add(el('div', 'ws-question-wrap'), el('p', 'ws-question-hint', 'What does this mean?'), card);
      var choices = el('div');
      host.appendChild(add(rootEl, header, barWrap, questionWrap, choices));

      function show() {
        var q = questions[current];
        progress.textContent = (current + 1) + ' / ' + total;
        bar.style.width = (current / total * 100) + '%';
        card.textContent = q.hebrew;
        var grid = choiceGrid(q, function (ok) {
          if (ok) right++;
          track.mark(q.id, ok);
          correctText.textContent = '✓ ' + right + ' correct';
          pending = setTimeout(function () { current++; if (current >= total) finish(); else show(); }, 900);
        });
        choices.replaceWith(grid);
        choices = grid;
      }
      function finish() {
        var pct = total ? Math.round(right / total * 100) : 0, msg = encouragement(pct);
        clear(host);
        var done = el('div', 'ws-light'), box = el('div', 'ws-box');
        var note = el('div', 'ws-message', msg.text);
        note.style.color = msg.color; note.style.borderColor = msg.color;
        add(box, el('div', 'ws-emoji', msg.emoji), el('h1', 'ws-title', 'Quiz Complete!'),
          add(el('div', 'ws-result-grid'), resultStat(right + '/' + total, 'Correct'), resultStat(pct + '%', 'Score')), note);
        saveLine(box, o.onFinish({ score: pct, correct: track.correct, missed: track.missed }));
        add(box, finishButtons('Try Again', play, function () { stop(); o.onExit(); }));
        host.appendChild(add(done, box));
      }
      show();
    }
    function stop() { clearTimeout(pending); }
    play();
    return stop;
  }

  var GAMES = {
    'racer': racer, 'lava': lava, 'matching': matching, 'multiple-choice': multipleChoice,
    'true-false': trueFalse, 'flashcards': flashcards, 'quiz': quiz
  };

  root.WeeklyShorashimGames = {
    start: function (gameId, host, options) {
      if (!GAMES[gameId]) throw new Error('Unknown Weekly Shorashim game: ' + gameId);
      return GAMES[gameId](host, options);
    }
  };
})(window);
