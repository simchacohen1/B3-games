/* ============================================================
   Kriah Adventure — adventure.js
   Student-facing interactive adventure map and activities.
   All teacher flows live in app.js — this file never touches them.
   Coins and stars are session-only display counters; nothing is
   written to Firebase from this file.
   ============================================================ */

'use strict';

/* ---- Hebrew data ---- */

const LETTERS = [
  { char: 'א', name: 'Aleph',  desc: 'Silent letter — a container for sound' },
  { char: 'ב', name: 'Beis',   desc: 'B or V sound' },
  { char: 'ג', name: 'Gimmel', desc: 'G sound (hard)' },
  { char: 'ד', name: 'Dalet',  desc: 'D sound' },
  { char: 'ה', name: 'Hey',    desc: 'H sound (or silent at word end)' },
  { char: 'ו', name: 'Vov',    desc: 'V or long-O/U vowel' },
  { char: 'ז', name: 'Zayin',  desc: 'Z sound' },
  { char: 'ח', name: 'Ches',   desc: 'Ch (guttural) sound' },
  { char: 'ט', name: 'Tes',    desc: 'T sound' },
  { char: 'י', name: 'Yud',    desc: 'Y or long-EE sound' },
  { char: 'כ', name: 'Kaf',    desc: 'K or Ch sound; final form ך' },
  { char: 'ל', name: 'Lamed',  desc: 'L sound' },
  { char: 'מ', name: 'Mem',    desc: 'M sound; final form ם' },
  { char: 'נ', name: 'Nun',    desc: 'N sound; final form ן' },
  { char: 'ס', name: 'Samech', desc: 'S sound' },
  { char: 'ע', name: 'Ayin',   desc: 'Silent (guttural) letter' },
  { char: 'פ', name: 'Pey',    desc: 'P or F sound; final form ף' },
  { char: 'צ', name: 'Tzadi',  desc: 'Tz sound; final form ץ' },
  { char: 'ק', name: 'Kuf',    desc: 'K sound (back of throat)' },
  { char: 'ר', name: 'Reish',  desc: 'R sound' },
  { char: 'ש', name: 'Shin',   desc: 'Sh or S sound' },
  { char: 'ת', name: 'Tav',    desc: 'T sound' },
];

const NEKUDOS = [
  { symbol: 'ַ', name: 'Kamatz',   sound: 'AH' },
  { symbol: 'ָ', name: 'Patach',   sound: 'AH' },
  { symbol: 'ֵ', name: 'Tzeirei',  sound: 'EI' },
  { symbol: 'ִ', name: 'Chirik',   sound: 'EE' },
  { symbol: 'ֹ', name: 'Cholam',   sound: 'OH' },
  { symbol: 'ּ', name: 'Dagesh',   sound: '(strengthens the letter)' },
  { symbol: 'ׁ', name: 'Shin Dot', sound: 'SH' },
];

const BLENDS = [
  { display: 'בַ', desc: 'Aleph-Beis combo',    sound: 'BA' },
  { display: 'מַ', desc: 'Mem with Kamatz',     sound: 'MA' },
  { display: 'שַ', desc: 'Shin with Kamatz',    sound: 'SHA' },
  { display: 'לַ', desc: 'Lamed with Kamatz',   sound: 'LA' },
  { display: 'רַ', desc: 'Reish with Kamatz',   sound: 'RA' },
  { display: 'כִ', desc: 'Kaf with Chirik',     sound: 'KI' },
  { display: 'דֵ', desc: 'Dalet with Tzeirei',  sound: 'DEI' },
  { display: 'תֹ', desc: 'Tav with Cholam',     sound: 'TO' },
];

const WORLDS = [
  {
    name: 'Aleph-Beis Forest',
    emoji: '🌲',
    letterIndices: [0, 1, 2, 3, 4],
    color: '#d1fae5',
    requiredReviewed: 0,
  },
  {
    name: 'Gimmel-Dalet Mountains',
    emoji: '⛰️',
    letterIndices: [5, 6, 7, 8, 9],
    color: '#dbeafe',
    requiredReviewed: 2,
  },
  {
    name: 'Lamed-Mem Sea',
    emoji: '🌊',
    letterIndices: [10, 11, 12, 13, 14],
    color: '#ede9fe',
    requiredReviewed: 4,
  },
  {
    name: 'Nun-Pey Valley',
    emoji: '🌸',
    letterIndices: [15, 16, 17, 18, 19],
    color: '#fce7f3',
    requiredReviewed: 6,
  },
  {
    name: 'Shin-Tav Kingdom',
    emoji: '👑',
    letterIndices: [20, 21],
    color: '#fef3c7',
    requiredReviewed: 10,
  },
];

/* ---- Session-only coin/star counters (never sent to Firebase) ---- */
let _coins = 0;
let _stars  = 0;

function addCoins(n) {
  _coins += n;
  if (typeof document !== 'undefined') {
    const el = document.getElementById('coinCount');
    if (el) el.textContent = _coins;
  }
}
function addStars(n) {
  _stars += n;
  if (typeof document !== 'undefined') {
    const el = document.getElementById('starCount');
    if (el) el.textContent = _stars;
  }
}

/** How many worlds are unlocked based on reviewed assessment count. */
function letterUnlockIndex(reviewedCount) {
  return Math.max(1, Math.min(5, 1 + Math.floor(reviewedCount / 2)));
}

/** Coin reward for a correct / possible pair. Returns 0 if no correct answers. */
function coinReward(correct, possible, coinsPerCorrect) {
  if (!correct) return 0;
  return correct * coinsPerCorrect;
}

/* ---- UI state ---- */
let _currentTab = 'map';
let _reviewedCount = 0;
let _records = [];

/* ---- Bootstrap (browser only) ---- */
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.adv-tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.advTab));
    });

    document.getElementById('stationBack').addEventListener('click', () => {
      document.getElementById('stationPanel').hidden = true;
      document.getElementById('mapTab').hidden = false;
    });

    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('modalBackdrop').addEventListener('click', closeModal);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
    });

    document.getElementById('signInBtn').addEventListener('click', onSignIn);

    document.getElementById('signOutBtn').addEventListener('click', () => {
      if (typeof KriahClient !== 'undefined') KriahClient.signOut();
      location.reload();
    });

    if (typeof KriahClient !== 'undefined') {
      KriahClient.init(onIdentity);
    } else {
      console.warn('[Adventure] KriahClient not loaded yet');
    }
  });
}

/* ---- Sign-in ---- */
function onSignIn() {
  const sel = document.getElementById('fixtureSelect');
  const actor = sel.value;
  if (!actor) { alert('Please select a student fixture first.'); return; }
  if (typeof KriahClient !== 'undefined') {
    KriahClient.fixtureSignIn(actor).catch(err => {
      console.error('[Adventure] Sign-in failed', err);
      alert('Sign-in failed: ' + err.message);
    });
  }
}

/* ---- Identity callback ---- */
function onIdentity(identity) {
  const gate = document.getElementById('signInGate');
  const teacherNotice = document.getElementById('teacherNotice');
  const app = document.getElementById('adventureApp');
  const userInfo = document.getElementById('userInfo');
  const signInControls = document.getElementById('signInControls');

  if (!identity) {
    gate.hidden = false;
    app.hidden = true;
    teacherNotice.hidden = true;
    userInfo.hidden = true;
    signInControls.hidden = false;
    return;
  }

  gate.hidden = true;
  signInControls.hidden = true;
  userInfo.hidden = false;
  document.getElementById('userDisplayName').textContent = identity.displayName || identity.email || 'Student';

  if (identity.role === 'teacher') {
    teacherNotice.hidden = false;
    app.hidden = true;
    return;
  }

  teacherNotice.hidden = true;
  app.hidden = false;
  document.getElementById('welcomeName').textContent = (identity.displayName || 'Adventurer').split(' ')[0];

  loadRecords(identity);
}

/* ---- Load assignment records ---- */
function loadRecords(identity) {
  if (typeof KriahClient === 'undefined') return;

  KriahClient.call({ action: 'classes' })
    .then(result => {
      if (!result || !result.classes || !result.classes.length) {
        buildMap(0);
        buildPracticeGrid();
        buildProgress([]);
        return;
      }
      const cls = result.classes[0];
      return KriahClient.call({ action: 'list', classId: cls.id, studentId: identity.uid });
    })
    .then(result => {
      const records = (result && result.records) ? result.records : [];
      _records = records;
      _reviewedCount = records.filter(r => r.status === 'reviewed').length;

      const unread = records.filter(r => r.status === 'assigned').length;
      if (unread > 0) {
        document.getElementById('assignmentAlertText').textContent =
          `You have ${unread} new assignment${unread > 1 ? 's' : ''} from your teacher!`;
        document.getElementById('assignmentAlert').hidden = false;
      }

      buildMap(_reviewedCount);
      buildPracticeGrid();
      buildProgress(records);
    })
    .catch(err => {
      console.warn('[Adventure] loadRecords error:', err);
      buildMap(0);
      buildPracticeGrid();
      buildProgress([]);
    });
}

/* ---- Build adventure map ---- */
function buildMap(reviewedCount) {
  const unlockedCount = letterUnlockIndex(reviewedCount);
  const grid = document.getElementById('worldGrid');
  grid.innerHTML = '';

  WORLDS.forEach((world, idx) => {
    const unlocked = idx < unlockedCount;
    const complete  = unlocked && _records.filter(r =>
      r.status === 'reviewed' && worldContainsRecord(world, r)
    ).length > 0;

    const card = document.createElement('div');
    card.className = 'adv-world-card ' + (unlocked ? (complete ? 'complete' : 'unlocked') : 'locked');
    card.setAttribute('role', 'listitem');
    card.setAttribute('aria-label', world.name + (unlocked ? '' : ' — locked'));
    card.innerHTML =
      (!unlocked ? '<span class="adv-lock-icon">🔒</span>' : '') +
      '<div class="adv-world-emoji">' + world.emoji + '</div>' +
      '<div class="adv-world-name">' + world.name + '</div>' +
      '<div class="adv-world-letters">' + world.letterIndices.map(i => LETTERS[i].char).join(' ') + '</div>' +
      '<div class="adv-world-status">' + (unlocked ? (complete ? '✅ Explored' : '🗺️ Explore!') : '🔒 Locked') + '</div>';
    if (unlocked) {
      card.addEventListener('click', () => openStation(idx));
    }
    grid.appendChild(card);
  });
}

function worldContainsRecord(world, record) {
  if (!record.passage) return false;
  return world.letterIndices.some(i => record.passage.includes(LETTERS[i].char));
}

/* ---- Station detail ---- */
function openStation(worldIndex) {
  const world = WORLDS[worldIndex];
  const letters = world.letterIndices.map(i => LETTERS[i]);
  const related = _records.filter(r => worldContainsRecord(world, r));

  document.getElementById('mapTab').hidden = true;
  const panel = document.getElementById('stationPanel');
  panel.hidden = false;

  const content = document.getElementById('stationContent');
  content.innerHTML =
    '<div class="adv-station-header">' +
      '<div class="adv-station-emoji">' + world.emoji + '</div>' +
      '<div class="adv-station-title">' + world.name + '</div>' +
    '</div>' +
    '<div class="adv-station-letters-row">' + letters.map(l => l.char).join('  ') + '</div>' +
    '<div class="adv-activity-buttons">' +
      '<button class="adv-activity-btn" data-activity="spot">🔍 Spot the Letter</button>' +
      '<button class="adv-activity-btn" data-activity="match">🔗 Letter Match</button>' +
      '<button class="adv-activity-btn" data-activity="blend">🗣️ Sound Blends</button>' +
      '<button class="adv-activity-btn" data-activity="quiz">❓ Letter Quiz</button>' +
    '</div>' +
    '<div class="adv-related-assignments">' +
      '<h3>📋 Related Assignments (' + related.length + ')</h3>' +
      (related.length === 0
        ? '<p style="color:#9ca3af">No assignments yet for this world.</p>'
        : related.map(r =>
            '<div class="adv-assignment-item">' +
              '<div>' +
                '<div class="adv-progress-title">' + (r.title || 'Exercise') + '</div>' +
                '<div class="adv-assignment-status">' + r.status + '</div>' +
              '</div>' +
              (r.score != null ? '<span class="adv-progress-score">' + r.score + '%</span>' : '') +
            '</div>'
          ).join('')) +
    '</div>';

  content.querySelectorAll('.adv-activity-btn').forEach(btn => {
    btn.addEventListener('click', () => openActivity(btn.dataset.activity, world));
  });
}

/* ---- Practice grid ---- */
function buildPracticeGrid() {
  const grid = document.getElementById('practiceGrid');
  const activities = [
    { type: 'spot',  emoji: '🔍', name: 'Spot the Letter', desc: 'Find the right letter in a grid' },
    { type: 'match', emoji: '🔗', name: 'Letter Match',    desc: 'Match letters to their names' },
    { type: 'blend', emoji: '🗣️', name: 'Sound Blends',  desc: 'Identify syllable sounds' },
    { type: 'quiz',  emoji: '❓',       name: 'Letter Quiz',     desc: 'Name that Hebrew letter!' },
    { type: 'spot',  emoji: '🌊', name: 'Sea Challenge',   desc: 'Spot letters in the sea world' },
    { type: 'blend', emoji: '⛰️', name: 'Mountain Blends', desc: 'Blend letters from the mountains' },
    { type: 'quiz',  emoji: '🌸', name: 'Valley Quiz',     desc: 'Quiz yourself on valley letters' },
    { type: 'match', emoji: '👑', name: 'Kingdom Match',   desc: 'Match the final letters' },
  ];
  grid.innerHTML = activities.map((a, i) =>
    '<div class="adv-practice-card" data-idx="' + i + '" tabindex="0" role="button" aria-label="' + a.name + '">' +
      '<div class="adv-practice-emoji">' + a.emoji + '</div>' +
      '<div class="adv-practice-name">' + a.name + '</div>' +
      '<div class="adv-practice-desc">' + a.desc + '</div>' +
    '</div>'
  ).join('');
  grid.querySelectorAll('.adv-practice-card').forEach((card, i) => {
    const act = activities[i];
    const world = WORLDS[i % WORLDS.length];
    card.addEventListener('click', () => openActivity(act.type, world));
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openActivity(act.type, world); });
  });
}

/* ---- Progress tab ---- */
function buildProgress(records) {
  const list = document.getElementById('progressList');
  if (!records.length) {
    list.innerHTML = '<div class="adv-progress-empty">No assignments yet — ask your teacher!</div>';
    return;
  }
  list.innerHTML = records.map(r => {
    const isReviewed = r.status === 'reviewed';
    const stars = isReviewed ? (r.score >= 80 ? '⭐⭐⭐' : r.score >= 60 ? '⭐⭐' : '⭐') : '';
    return '<div class="adv-progress-item">' +
      '<div>' +
        '<div class="adv-progress-title">' + (r.title || 'Exercise') + '</div>' +
        '<div class="adv-progress-meta">' + (r.assignedAt ? new Date(r.assignedAt).toLocaleDateString() : '') + ' · ' + r.status + '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:.5rem">' +
        (r.score != null ? '<span class="adv-progress-score">' + r.score + '%</span>' : '') +
        (stars ? '<span class="adv-progress-stars">' + stars + '</span>' : '') +
      '</div>' +
    '</div>';
  }).join('');

  const reviewed = records.filter(r => r.status === 'reviewed');
  if (reviewed.length) addStars(reviewed.length);
}

/* ---- Activity router ---- */
function openActivity(type, world) {
  const titles = {
    spot:  '🔍 Spot the Letter',
    match: '🔗 Letter Match',
    blend: '🗣️ Sound Blends',
    quiz:  '❓ Letter Quiz',
  };
  const builders = { spot: buildSpotActivity, match: buildMatchActivity, blend: buildBlendActivity, quiz: buildQuizActivity };
  openModal(titles[type] || 'Activity', () => builders[type](world));
}

/* ---- Spot the Letter ---- */
function buildSpotActivity(world) {
  const letters = world.letterIndices.map(i => LETTERS[i]);
  const target = letters[Math.floor(Math.random() * letters.length)];
  const distractors = LETTERS.filter(l => !world.letterIndices.some(i => LETTERS[i].char === l.char))
    .sort(() => Math.random() - .5).slice(0, 7);
  const pool = [target, target, target, ...distractors].sort(() => Math.random() - .5).slice(0, 10);

  const container = document.createElement('div');
  const prompt = document.createElement('div');
  prompt.className = 'adv-activity-prompt';
  prompt.innerHTML = 'Tap every <span style="font-family:Georgia;font-size:1.3em;direction:rtl">' + target.char + '</span> (' + target.name + ') you see!';
  container.appendChild(prompt);

  const grid = document.createElement('div');
  grid.className = 'adv-spot-grid';
  let found = 0, total = pool.filter(l => l.char === target.char).length;

  pool.forEach(letter => {
    const btn = document.createElement('button');
    btn.className = 'adv-spot-btn';
    btn.textContent = letter.char;
    btn.setAttribute('lang', 'he');
    btn.addEventListener('click', () => {
      if (btn.classList.contains('correct') || btn.classList.contains('wrong')) return;
      if (letter.char === target.char) {
        btn.classList.add('correct');
        found++;
        addCoins(2);
        if (found === total) {
          setTimeout(() => rewardBanner('🎉', 'Excellent!', 'You found all ' + total + ' ' + target.name + 's!', coinReward(found, total, 5)), 400);
        }
      } else {
        btn.classList.add('wrong');
      }
    });
    grid.appendChild(btn);
  });

  container.appendChild(grid);
  return container;
}

/* ---- Letter Match ---- */
function buildMatchActivity(world) {
  const letters = world.letterIndices.map(i => LETTERS[i]).slice(0, 4);
  const shuffledNames = [...letters].sort(() => Math.random() - .5);

  const container = document.createElement('div');
  const prompt = document.createElement('div');
  prompt.className = 'adv-activity-prompt';
  prompt.textContent = 'Match each letter to its name. (Practice — any pair works!)';
  container.appendChild(prompt);

  const grid = document.createElement('div');
  grid.className = 'adv-match-grid';
  const leftCol = document.createElement('div');
  leftCol.className = 'adv-match-col';
  const rightCol = document.createElement('div');
  rightCol.className = 'adv-match-col';

  let matchedCount = 0;
  let _selLeft = null, _selRight = null;

  function handleMatch(side, btn) {
    if (btn.classList.contains('matched')) return;
    if (side === 'left') {
      if (_selLeft) _selLeft.classList.remove('selected');
      _selLeft = btn;
      btn.classList.add('selected');
    } else {
      if (_selRight) _selRight.classList.remove('selected');
      _selRight = btn;
      btn.classList.add('selected');
    }
    if (_selLeft && _selRight) {
      _selLeft.classList.remove('selected');
      _selRight.classList.remove('selected');
      _selLeft.classList.add('matched');
      _selRight.classList.add('matched');
      addCoins(3);
      matchedCount++;
      _selLeft = null; _selRight = null;
      if (matchedCount === letters.length) {
        setTimeout(() => rewardBanner('🌟', 'Matched!', 'Great job pairing all the letters!', coinReward(matchedCount, letters.length, 8)), 400);
      }
    }
  }

  letters.forEach(letter => {
    const btn = document.createElement('button');
    btn.className = 'adv-match-btn hebrew';
    btn.textContent = letter.char;
    btn.setAttribute('lang', 'he');
    btn.addEventListener('click', () => handleMatch('left', btn));
    leftCol.appendChild(btn);
  });
  shuffledNames.forEach(letter => {
    const btn = document.createElement('button');
    btn.className = 'adv-match-btn';
    btn.textContent = letter.name;
    btn.addEventListener('click', () => handleMatch('right', btn));
    rightCol.appendChild(btn);
  });

  grid.appendChild(leftCol);
  grid.appendChild(rightCol);
  container.appendChild(grid);
  return container;
}

/* ---- Sound Blends ---- */
function buildBlendActivity(world) {
  const container = document.createElement('div');
  const questions = [...BLENDS].sort(() => Math.random() - .5).slice(0, 5);
  let qIdx = 0, correct = 0;

  function renderQuestion() {
    const q = questions[qIdx];
    const others = BLENDS.filter(b => b.sound !== q.sound).sort(() => Math.random() - .5).slice(0, 3);
    const opts = [q, ...others].sort(() => Math.random() - .5);
    container.innerHTML =
      '<div class="adv-activity-prompt">Question ' + (qIdx + 1) + ' of ' + questions.length + ': What sound does this make?</div>' +
      '<div class="adv-mcq-question blend-text" lang="he">' + q.display + '</div>' +
      '<div class="adv-mcq">' +
        opts.map(o => '<button class="adv-mcq-btn" data-sound="' + o.sound + '">' + o.sound + '</button>').join('') +
      '</div>';
    container.querySelectorAll('.adv-mcq-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const isCorrect = btn.dataset.sound === q.sound;
        container.querySelectorAll('.adv-mcq-btn').forEach(b => {
          if (b.dataset.sound === q.sound) b.classList.add('correct');
          else if (b === btn && !isCorrect) b.classList.add('wrong');
        });
        if (isCorrect) { correct++; addCoins(4); }
        setTimeout(() => {
          qIdx++;
          if (qIdx < questions.length) renderQuestion();
          else rewardBanner('🗣️', correct + '/' + questions.length + ' correct!', 'Great blend practice!', coinReward(correct, questions.length, 10));
        }, 800);
      });
    });
  }
  renderQuestion();
  return container;
}

/* ---- Letter Quiz ---- */
function buildQuizActivity(world) {
  const letters = world.letterIndices.map(i => LETTERS[i]);
  const questions = [...letters].sort(() => Math.random() - .5).slice(0, Math.min(5, letters.length));
  let qIdx = 0, correct = 0;
  const container = document.createElement('div');

  function renderQuestion() {
    const q = questions[qIdx];
    const others = LETTERS.filter(l => l.char !== q.char).sort(() => Math.random() - .5).slice(0, 3);
    const opts = [q, ...others].sort(() => Math.random() - .5);
    container.innerHTML =
      '<div class="adv-activity-prompt">Question ' + (qIdx + 1) + ' of ' + questions.length + ': What is the name of this letter?</div>' +
      '<div class="adv-mcq-question" lang="he">' + q.char + '</div>' +
      '<div class="adv-mcq">' +
        opts.map(o => '<button class="adv-mcq-btn" data-name="' + o.name + '">' + o.name + '</button>').join('') +
      '</div>';
    container.querySelectorAll('.adv-mcq-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const isCorrect = btn.dataset.name === q.name;
        container.querySelectorAll('.adv-mcq-btn').forEach(b => {
          if (b.dataset.name === q.name) b.classList.add('correct');
          else if (b === btn && !isCorrect) b.classList.add('wrong');
        });
        if (isCorrect) { correct++; addCoins(5); }
        setTimeout(() => {
          qIdx++;
          if (qIdx < questions.length) renderQuestion();
          else rewardBanner('❓', correct + '/' + questions.length + ' correct!', 'Quiz complete!', coinReward(correct, questions.length, 12));
        }, 800);
      });
    });
  }
  renderQuestion();
  return container;
}

/* ---- Reward banner ---- */
function rewardBanner(emoji, heading, sub, coinsEarned) {
  addCoins(coinsEarned);
  const container = document.createElement('div');
  container.className = 'adv-reward';
  container.innerHTML =
    '<div class="adv-reward-emoji">' + emoji + '</div>' +
    '<div class="adv-reward-heading">' + heading + '</div>' +
    '<div class="adv-reward-sub">' + sub + '</div>' +
    (coinsEarned > 0 ? '<div class="adv-reward-coins">+' + coinsEarned + ' coins! 🪙</div>' : '') +
    '<button class="adv-btn adv-btn-primary" style="margin-top:1rem" id="rewardDone">Done!</button>';
  const body = document.getElementById('modalBody');
  body.innerHTML = '';
  body.appendChild(container);
  document.getElementById('rewardDone').addEventListener('click', closeModal);
}

/* ---- Tab switching ---- */
function switchTab(tab) {
  _currentTab = tab;
  document.querySelectorAll('.adv-tab').forEach(b => b.classList.toggle('active', b.dataset.advTab === tab));
  ['mapTab','practiceTab','progressTab'].forEach(id => { document.getElementById(id).hidden = true; });
  document.getElementById('stationPanel').hidden = true;
  if (tab === 'map') document.getElementById('mapTab').hidden = false;
  else if (tab === 'practice') document.getElementById('practiceTab').hidden = false;
  else if (tab === 'progress') document.getElementById('progressTab').hidden = false;
}

/* ---- Modal ---- */
function openModal(title, buildContent) {
  document.getElementById('modalTitle').textContent = title;
  const body = document.getElementById('modalBody');
  body.innerHTML = '';
  const content = buildContent();
  if (content) body.appendChild(content);
  document.getElementById('activityModal').hidden = false;
  document.getElementById('modalClose').focus();
}

function closeModal() {
  document.getElementById('activityModal').hidden = true;
}

/* ---- Exports for unit tests ---- */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LETTERS, NEKUDOS, BLENDS, WORLDS, letterUnlockIndex, coinReward };
}
