/* Shorashim mastery tracking: pure helpers shared by the student app, the teacher
   dashboard and the tests. No DOM or Firebase in here.

   Every student record gets   practice[itemKey] = { <stageId>: count, last: ms }
   A separate map (not inside cards[...]) so redesigning a card can never wipe it. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ShorashimMastery = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const STAGES = [
    { id: 'learned', label: 'Learned', short: 'Learned' },
    { id: 'trace', label: 'Tracing', short: 'Tracing' },
    { id: 'mc', label: 'Multiple choice', short: 'Mult. choice' },
    { id: 'match', label: 'Matching', short: 'Matching' },
    { id: 'g_match', label: 'Game: Match', short: 'Match game' },
    { id: 'g_shoot', label: 'Game: Target Shoot', short: 'Target Shoot' },
    { id: 'g_whack', label: 'Game: Whack-a-Word', short: 'Whack' },
    { id: 'g_race', label: 'Game: Word Race', short: 'Word Race' },
    { id: 'review', label: 'Regular review', short: 'Review' }
  ];
  const STAGE_IDS = STAGES.map(s => s.id);
  // A word counts as mastered once all four of these are done at least once.
  const MASTERY_STAGES = ['learned', 'trace', 'mc', 'match'];

  /* ---------- recording ---------- */
  function recordPractice(studentObj, itemKey, stageId, now) {
    if (!studentObj || !itemKey || !STAGE_IDS.includes(stageId)) return 0;
    if (!studentObj.practice || typeof studentObj.practice !== 'object') studentObj.practice = {};
    const p = studentObj.practice[itemKey] = studentObj.practice[itemKey] || {};
    p[stageId] = (Number(p[stageId]) || 0) + 1;
    p.last = now || Date.now();
    return p[stageId];
  }

  function countFor(studentObj, itemKey, stageId) {
    if (!studentObj) return 0;
    const p = (studentObj.practice && studentObj.practice[itemKey]) || {};
    const card = (studentObj.cards && studentObj.cards[itemKey]) || null;
    const own = Number(p[stageId]) || 0;
    if (stageId === 'learned') return Math.max(own, card && card.learnedAt ? 1 : 0);
    // Regular review: the per-word counter that Review cycles (#962) keeps on the card.
    if (stageId === 'review') return Math.max(own, Number(card && card.reviewCount) || 0);
    return own;
  }

  /* ---------- Hebrew / English matching ---------- */
  // Vowel points and cantillation (not the maqaf, which is punctuation).
  const NIKUD = /[֑-ׇֽֿׁׂׅׄ]/g;
  const exactKey = s => String(s || '').normalize('NFC').replace(/[\s‎‏]+/g, '').trim();
  const consonantKey = s => String(s || '').normalize('NFC').replace(NIKUD, '').replace(/[\s‎‏]+/g, '').trim();
  function meaningsOf(english) {
    return String(english || '').toLowerCase().replace(/\([^)]*\)/g, ' ')
      .split(/[\/,;]| or /).map(x => x.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  }
  function sameMeaning(a, b) {
    const x = meaningsOf(a), y = new Set(meaningsOf(b));
    if (!x.length || !y.size) return false;
    return x.some(m => y.has(m));
  }

  /* Group catalog items into one row per word.
     items: [{ key:'shorashim:1-raah', track, front, english, list }]
     - Same Hebrew spelling (with vowels)            -> one row.
     - Same letters, different vowels, SAME meaning  -> one row.
     - Same letters, different vowels, DIFFERENT meaning -> separate rows, both flagged.
     - Same spelling but different meanings          -> one row, flagged. */
  function groupWords(items) {
    const parent = items.map((_, i) => i);
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
    const byExact = new Map(), byCons = new Map();
    items.forEach((it, i) => {
      const t = it.track || String(it.key || '').split(':')[0] || 'shorashim';
      const ek = t + '|' + exactKey(it.front), ck = t + '|' + consonantKey(it.front);
      if (byExact.has(ek)) union(i, byExact.get(ek)); else byExact.set(ek, i);
      if (!byCons.has(ck)) byCons.set(ck, []);
      byCons.get(ck).push(i);
    });
    byCons.forEach(list => {
      for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
        if (sameMeaning(items[list[a]].english, items[list[b]].english)) union(list[a], list[b]);
      }
    });
    const groups = new Map();
    items.forEach((it, i) => {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, { id: '', track: it.track || String(it.key || '').split(':')[0] || 'shorashim', front: it.front, english: it.english, keys: [], lists: [], englishAll: [], flags: [], _cons: consonantKey(it.front) });
      const g = groups.get(r);
      g.keys.push(it.key);
      if (it.list && !g.lists.includes(it.list)) g.lists.push(it.list);
      if (it.english && !g.englishAll.some(e => e.trim().toLowerCase() === String(it.english).trim().toLowerCase())) g.englishAll.push(it.english);
    });
    const rows = [...groups.values()];
    rows.forEach(g => { g.id = g.keys[0]; });
    // Flags
    rows.forEach(g => {
      if (g.englishAll.length > 1 && !g.englishAll.every(e => sameMeaning(g.englishAll[0], e))) {
        g.flags.push('Same spelling, different meanings: ' + g.englishAll.join(' | '));
      }
    });
    const consRows = new Map();
    rows.forEach(g => { const k = g.track + '|' + g._cons; if (!consRows.has(k)) consRows.set(k, []); consRows.get(k).push(g); });
    consRows.forEach(list => {
      if (list.length < 2) return;
      list.forEach(g => {
        const others = list.filter(o => o !== g);
        g.flags.push('Same letters, different vowels/meaning as: ' + others.map(o => o.front + ' (' + o.english + ')').join(', '));
      });
    });
    rows.forEach(g => { g.english = g.englishAll.join(' | ') || g.english || ''; delete g._cons; });
    return rows;
  }

  /* ---------- aggregation ---------- */
  // students: [{ id, name, record }]  groups: output of groupWords
  function summarizeStudent(rec, groups) {
    const out = { words: groups.length, mastered: 0, started: 0, notStarted: 0, stages: {} };
    STAGE_IDS.forEach(id => { out.stages[id] = 0; });
    groups.forEach(g => {
      let any = false, all = true;
      STAGE_IDS.forEach(id => {
        const n = g.keys.reduce((t, k) => t + countFor(rec, k, id), 0);
        if (n > 0) { out.stages[id]++; any = true; }
      });
      MASTERY_STAGES.forEach(id => {
        if (!g.keys.some(k => countFor(rec, k, id) > 0)) all = false;
      });
      if (any) out.started++; else out.notStarted++;
      if (all) out.mastered++;
    });
    return out;
  }

  function wordCounts(rec, group, stageId) { return group.keys.reduce((t, k) => t + countFor(rec, k, stageId), 0); }

  // mode: any | done (all in-scope boys did it) | notdone (someone hasn't) | none (nobody did)
  function stagePasses(recs, group, stageId, mode) {
    if (!stageId || !mode || mode === 'any') return true;
    if (!recs.length) return mode === 'none' || mode === 'notdone';
    const done = recs.map(r => wordCounts(r, group, stageId) > 0);
    if (mode === 'done') return done.every(Boolean);
    if (mode === 'notdone') return done.some(d => !d);
    if (mode === 'none') return done.every(d => !d);
    return true;
  }

  /* ---------- tracing maths (pure so it can be tested) ---------- */
  // letterMasks: [Uint8Array] one per letter, 1 where the glyph has ink.
  // user: Uint8Array of the child's strokes (1 = painted).  tolerance: letters grown by the brush.
  function traceProgress(letterMasks, user, tolerance, opts) {
    const need = (opts && opts.needed) || 0.62, maxOff = (opts && opts.maxOff) || 0.5;
    let userInk = 0, userInside = 0;
    for (let i = 0; i < user.length; i++) if (user[i]) { userInk++; if (tolerance[i]) userInside++; }
    const perLetter = letterMasks.map(m => {
      let total = 0, hit = 0;
      for (let i = 0; i < m.length; i++) if (m[i]) { total++; if (user[i]) hit++; }
      return total ? hit / total : 0;
    });
    const offRatio = userInk ? 1 - userInside / userInk : 0;
    const done = perLetter.map(p => p >= need);
    return { perLetter, done, offRatio, scribbled: offRatio > maxOff, complete: !!done.length && done.every(Boolean) && offRatio <= maxOff };
  }

  /* ---------- multiple choice / matching builders ---------- */
  const normEnglish = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // A choice can carry a picture later: { key, text, picture }.
  function buildChoices(correct, pool, count, rand, pictureFor) {
    rand = rand || Math.random;
    const seen = new Set([normEnglish(correct.english)]);
    const others = [];
    shuffleIn(pool.filter(p => p.key !== correct.key), rand).forEach(p => {
      const n = normEnglish(p.english);
      if (!n || seen.has(n) || others.length >= count - 1) return;
      seen.add(n); others.push(p);
    });
    const all = shuffleIn([correct, ...others], rand);
    return all.map(p => ({ key: p.key, text: p.english, picture: (pictureFor && pictureFor(p)) || null, correct: p.key === correct.key }));
  }
  function shuffleIn(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  return { STAGES, STAGE_IDS, MASTERY_STAGES, recordPractice, countFor, exactKey, consonantKey, meaningsOf, sameMeaning, groupWords, summarizeStudent, wordCounts, stagePasses, traceProgress, buildChoices, shuffleIn };
});
