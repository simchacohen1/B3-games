/*
 * Weekly Shorashim — shared rules with no page or Firebase code in them, so
 * the same functions run in the browser and in the Node tests.
 *
 *  - which words a grade sees (grades are cumulative: B3 sees grade <= 3)
 *  - "All Weeks So Far" (repeats removed by Hebrew)
 *  - Quizlet links (with the original grade shift B4->B3, B5->B4, B6->B5)
 *  - the class's current week (moves up every Sunday, US Eastern, max 30)
 *  - question choices, and how one finished game is added to saved progress
 */
(function (root) {
  'use strict';

  var GRADES = ['B2', 'B3', 'B4', 'B5', 'B6'];
  var DEFAULT_GRADE = 'B3';
  var MAX_WEEK = 30;
  var TIME_ZONE = 'America/New_York';
  var GAMES = [
    { id: 'racer', label: 'Chumash Racer', emoji: '🚗' },
    { id: 'lava', label: 'Lava Traveler', emoji: '🌋' },
    { id: 'matching', label: 'Matching', emoji: '🃏' },
    { id: 'multiple-choice', label: 'Multiple Choice', emoji: '🧠' },
    { id: 'true-false', label: 'True or False', emoji: '⚡' },
    { id: 'flashcards', label: 'Flashcards', emoji: '📖' },
    { id: 'quiz', label: 'Practice Quiz', emoji: '📝' }
  ];
  var WORD_ID = /^w([1-9]|[12][0-9]|30)_[0-9]{1,2}$/;

  function validGrade(grade) { return GRADES.indexOf(grade) >= 0; }
  // A class with no saved grade (including et and wt) is B3.
  function resolveGrade(stored) { return validGrade(stored) ? stored : DEFAULT_GRADE; }
  function gradeNum(grade) { return Number(String(grade || '').replace(/^B/, '')) || 0; }

  function clampWeek(value) {
    var n = Math.floor(Number(value));
    if (!isFinite(n) || n < 1) return 1;
    return n > MAX_WEEK ? MAX_WEEK : n;
  }

  function findWeek(weeks, weekNum) {
    for (var i = 0; i < weeks.length; i++) if (weeks[i].week === weekNum) return weeks[i];
    return null;
  }

  function toCard(word) { return { id: word.id, hebrew: word.hebrew, english: word.english }; }

  function weekCards(weeks, weekNum, grade) {
    var week = findWeek(weeks, weekNum), max = gradeNum(grade);
    if (!week) return [];
    return week.words.filter(function (w) { return w.grade <= max; }).map(toCard);
  }

  function cumulativeCards(weeks, throughWeek, grade) {
    var max = gradeNum(grade), seen = {}, cards = [];
    weeks.forEach(function (week) {
      if (week.week > throughWeek) return;
      week.words.forEach(function (w) {
        if (w.grade > max || seen[w.hebrew]) return;
        seen[w.hebrew] = true;
        cards.push(toCard(w));
      });
    });
    return cards;
  }

  // The Quizlet sets were made for one grade lower than the class now using them.
  function quizletGrade(grade) {
    var shift = { B4: 'B3', B5: 'B4', B6: 'B5' };
    return shift[grade] || grade;
  }

  function quizletLinks(weeks, weekNum, grade) {
    var week = findWeek(weeks, weekNum);
    var links = week && week.quizlet && week.quizlet[quizletGrade(grade)];
    return { single: (links && links.single) || null, cumulative: (links && links.cumulative) || null };
  }

  function wordIndex(weeks) {
    var index = {};
    weeks.forEach(function (week) {
      week.words.forEach(function (w) { index[w.id] = { id: w.id, hebrew: w.hebrew, english: w.english, grade: w.grade, week: week.week }; });
    });
    return index;
  }

  /* ---------- current week ---------- */

  var dayFormat = null;
  // Whole days since 1970-01-01 for the calendar date it is in US Eastern time.
  function easternDayNumber(ms) {
    if (!dayFormat) dayFormat = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric' });
    var parts = {};
    dayFormat.formatToParts(new Date(ms)).forEach(function (p) { parts[p.type] = Number(p.value); });
    return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);
  }
  // 1970-01-01 was a Thursday, so adding 4 makes every Sunday start a new block of 7.
  function sundayWeekIndex(dayNumber) { return Math.floor((dayNumber + 4) / 7); }
  // How many times the calendar turned to Sunday (Eastern midnight) after `fromMs`, up to `toMs`.
  function sundaysBetween(fromMs, toMs) {
    var n = sundayWeekIndex(easternDayNumber(toMs)) - sundayWeekIndex(easternDayNumber(fromMs));
    return n > 0 ? n : 0;
  }

  // setting = { week, setAt, held } saved on the class. No setting = week 1.
  function currentWeek(setting, nowMs) {
    var base = clampWeek(setting && setting.week);
    if (!setting || setting.held === true) return base;
    var setAt = Number(setting.setAt);
    if (!isFinite(setAt) || setAt <= 0) return base;
    return clampWeek(base + sundaysBetween(setAt, nowMs));
  }

  function weekSetting(week, held, nowMs) {
    return { week: clampWeek(week), setAt: Math.floor(nowMs), held: held === true };
  }

  /* ---------- questions ---------- */

  function shuffle(list, rng) {
    var a = list.slice(), random = rng || Math.random;
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1)), t = a[i];
      a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function uniqueMeanings(cards) {
    var seen = {}, out = [];
    cards.forEach(function (c) { if (!seen[c.english]) { seen[c.english] = true; out.push(c.english); } });
    return out;
  }

  // The right meaning plus (count - 1) different wrong meanings from the same word list.
  function buildChoices(card, cards, count, rng) {
    var wrong = shuffle(uniqueMeanings(cards).filter(function (m) { return m !== card.english; }), rng).slice(0, count - 1);
    while (wrong.length < count - 1) wrong.push('—');
    return shuffle([card.english].concat(wrong), rng);
  }

  function buildQuestion(card, cards, count, rng) {
    return { id: card.id, hebrew: card.hebrew, answer: card.english, choices: buildChoices(card, cards, count, rng) };
  }

  // `count` cards in random order; the list repeats (reshuffled) if it is shorter than `count`.
  function pickCards(cards, count, rng) {
    var out = [];
    while (cards.length && out.length < count) out = out.concat(shuffle(cards, rng));
    return out.slice(0, count);
  }

  /* ---------- progress ---------- */

  function cleanCounts(map) {
    var out = {};
    Object.keys(map || {}).forEach(function (id) {
      var n = Math.floor(Number(map[id]));
      if (WORD_ID.test(id) && isFinite(n) && n > 0) out[id] = n;
    });
    return out;
  }
  function addCounts(a, b) {
    var out = cleanCounts(a), extra = cleanCounts(b);
    Object.keys(extra).forEach(function (id) { out[id] = Math.min(100000, (out[id] || 0) + extra[id]); });
    return out;
  }

  // existing = what is saved for this student / week / game; result = one finished game.
  function mergeProgress(existing, result, nowMs) {
    var old = existing || {};
    var score = Math.max(0, Math.min(1000000, Math.floor(Number(result && result.score) || 0)));
    var next = {
      bestScore: Math.max(Math.floor(Number(old.bestScore) || 0), score),
      timesPlayed: Math.min(1000000, (Math.floor(Number(old.timesPlayed)) || 0) + 1),
      lastPlayed: Math.floor(nowMs)
    };
    var correct = addCounts(old.wordsCorrect, result && result.correct);
    var missed = addCounts(old.wordsMissed, result && result.missed);
    if (Object.keys(correct).length) next.wordsCorrect = correct;
    if (Object.keys(missed).length) next.wordsMissed = missed;
    return next;
  }

  // weekProgress = { gameId: record } for one student and one week (or the whole class's, added up).
  function missedTotals(weekProgressList) {
    var totals = {};
    weekProgressList.forEach(function (games) {
      Object.keys(games || {}).forEach(function (gameId) {
        var missed = cleanCounts(games[gameId] && games[gameId].wordsMissed);
        Object.keys(missed).forEach(function (id) { totals[id] = (totals[id] || 0) + missed[id]; });
      });
    });
    return Object.keys(totals).map(function (id) { return { id: id, count: totals[id] }; })
      .sort(function (a, b) { return b.count - a.count || (a.id < b.id ? -1 : 1); });
  }

  var api = {
    GRADES: GRADES, DEFAULT_GRADE: DEFAULT_GRADE, MAX_WEEK: MAX_WEEK, GAMES: GAMES, WORD_ID: WORD_ID,
    validGrade: validGrade, resolveGrade: resolveGrade, gradeNum: gradeNum, clampWeek: clampWeek,
    weekCards: weekCards, cumulativeCards: cumulativeCards, quizletGrade: quizletGrade, quizletLinks: quizletLinks,
    wordIndex: wordIndex, easternDayNumber: easternDayNumber, sundaysBetween: sundaysBetween,
    currentWeek: currentWeek, weekSetting: weekSetting, shuffle: shuffle, uniqueMeanings: uniqueMeanings,
    buildChoices: buildChoices, buildQuestion: buildQuestion, pickCards: pickCards,
    mergeProgress: mergeProgress, missedTotals: missedTotals
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WeeklyShorashimLogic = api;
})(typeof window === 'undefined' ? globalThis : window);
