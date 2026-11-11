/* Shared pure Hebrew/scoring model. Keep backend/kriah-staging/core.js identical. */
(function (root) {
  'use strict';
  const CATEGORIES = ['correct', 'wrong-letter', 'wrong-vowel', 'confusion', 'skipped', 'added', 'repetition', 'hesitation', 'self-correction', 'other'];
  const TYPES = ['Letter recognition', 'Letter + nekudah', 'Syllables', 'Words', 'Phrases', 'Sentences', 'Pesukim / Tehillim', 'Fluency', 'Mixed review'];
  const NEKUDOS = { '\u05b0': 'Sheva', '\u05b1': 'Chataf segol', '\u05b2': 'Chataf patach', '\u05b3': 'Chataf kamatz', '\u05b4': 'Chirik', '\u05b5': 'Tzeirei', '\u05b6': 'Segol', '\u05b7': 'Patach', '\u05b8': 'Kamatz', '\u05b9': 'Cholam', '\u05ba': 'Cholam chaser', '\u05bb': 'Kubutz', '\u05bc': 'Dagesh / shuruk', '\u05c1': 'Shin dot', '\u05c2': 'Sin dot', '\u05c7': 'Kamatz katan' };
  function skillId(kind, label) {
    if (kind === 'letter' && /^[\u05d0-\u05ea]$/.test(label)) return 'letter_' + label.codePointAt(0);
    const mark = Object.keys(NEKUDOS).find(k => NEKUDOS[k] === label);
    if (kind === 'nekudah' && mark) return 'nekudah_' + mark.codePointAt(0);
    throw new Error('Unknown Hebrew skill.');
  }
  const STARTERS = [
    { title: 'Alef-beis and final letters', type: 'Letter recognition', unitType: 'letter', text: 'א ב ג ד ה ו ז ח ט י כ ל מ נ ס ע פ צ ק ר ש ת ך ם ן ף ץ' },
    { title: 'Standard nekudos and dots', type: 'Letter + nekudah', unitType: 'nekudah', text: 'בָּ בַּ בֶּ בֵּ בִּ בֹּ וּ בֻּ בְּ חֱ חֲ חֳ שׁ שׂ' },
    { title: 'Letters to distinguish', type: 'Mixed review', unitType: 'letter', text: 'ב כ ד ר ה ח ו ז ס ם ע צ ך ף' },
    { title: 'Syllable blending', type: 'Syllables', unitType: 'letter', text: 'בָּ בַּ בִּ מָ מַ מִ שָׁ שַׁ שִׁ' },
    { title: 'A few words', type: 'Words', unitType: 'word', text: 'שָׁלוֹם סֵפֶר מֶלֶךְ' }
  ].map(e => ({ ...e, level: 'Starter · customize', pronunciation: 'Teacher chooses acceptable pronunciation. These original examples are not a standardized scale.', countSelfCorrection: false }));
  function units(text) {
    const normalized = String(text).normalize('NFD');
    const words = normalized.match(/[^\s\u05be]+/gu) || [];
    const result = [], clusters = [];
    let index = 0;
    words.forEach((word, wi) => {
      if (!/[\u05d0-\u05ea]/u.test(word)) return;
      result.push({ id: 'w:' + wi, kind: 'word', label: word, word: wi });
      for (const char of word) {
        if (/[\u05d0-\u05ea]/u.test(char)) {
          const cluster = { index: index++, word: wi, letter: char, marks: '', text: char, suffix: '' };
          clusters.push(cluster);
          result.push({ id: 'l:' + cluster.index, kind: 'letter', label: char, word: wi, cluster: cluster.index });
        } else if (clusters.length && /\p{M}/u.test(char)) {
          const cluster = clusters[clusters.length - 1];
          if (cluster.word !== wi) continue;
          cluster.text += char; cluster.marks += char;
          if (NEKUDOS[char] && !result.some(u => u.id === 'n:' + cluster.index + ':' + char.codePointAt(0))) {
            result.push({ id: 'n:' + cluster.index + ':' + char.codePointAt(0), kind: 'nekudah', label: NEKUDOS[char], symbol: char, letter: cluster.letter, word: wi, cluster: cluster.index });
          }
        } else if (clusters.length && clusters[clusters.length - 1].word === wi) clusters[clusters.length - 1].suffix += char;
      }
    });
    return { normalized, words, clusters, units: result };
  }
  function exercise(input) {
    if (!input || typeof input.text !== 'string' || input.text.length > 1000 || !input.text.trim()) throw new Error('Use 1–1,000 characters of Hebrew text.');
    const parsed = units(input.text);
    if (!parsed.clusters.length || parsed.clusters.length > 250) throw new Error('Use 1–250 Hebrew letters per exercise.');
    if (!TYPES.includes(input.type) || !['letter', 'nekudah', 'word'].includes(input.unitType)) throw new Error('Choose an exercise type and scoring unit.');
    const clean = (v, n) => String(v || '').trim().slice(0, n);
    const value = { title: clean(input.title, 100), text: parsed.normalized, type: input.type, level: clean(input.level, 80), pronunciation: clean(input.pronunciation, 300), unitType: input.unitType, countSelfCorrection: input.countSelfCorrection === true };
    if (!value.title || !value.level) throw new Error('Enter a title and teacher-defined level.');
    if (!parsed.units.some(u => u.kind === value.unitType)) throw new Error('No units of that kind in this text.');
    return value;
  }
  function marks(ex, values) {
    const known = new Map(units(ex.text).units.map(u => [u.id, u]));
    if (!Array.isArray(values) || values.length > 1000) throw new Error('Invalid marking list.');
    const seen = new Set();
    return values.map(m => {
      if (!m || !known.has(m.unitId) || seen.has(m.unitId) || !CATEGORIES.includes(m.category)) throw new Error('Invalid or duplicate unit mark.');
      seen.add(m.unitId);
      if (m.time != null && (!Number.isFinite(m.time) || m.time < 0 || m.time > 300)) throw new Error('Timestamp must be between 0 and 300 seconds.');
      return { unitId: m.unitId, category: m.category, correction: String(m.correction || '').slice(0, 100), note: String(m.note || '').slice(0, 300), time: m.time == null ? null : m.time };
    });
  }
  function summary(ex, values, timing) {
    const parsed = units(ex.text), valid = marks(ex, values), byId = new Map(valid.map(m => [m.unitId, m]));
    const relevant = parsed.units.filter(u => u.kind === ex.unitType);
    const error = m => m.category !== 'correct' && (m.category !== 'self-correction' || ex.countSelfCorrection);
    const attempted = relevant.filter(u => byId.has(u.id));
    const incorrect = attempted.filter(u => error(byId.get(u.id))).length;
    const categories = {}, skills = {};
    for (const u of parsed.units) {
      if (u.kind === 'word') continue;
      const key = u.kind + ':' + u.label;
      const row = skills[key] || (skills[key] = { kind: u.kind, label: u.label, assessed: 0, errors: 0, notAssessed: 0 });
      const m = byId.get(u.id);
      if (!m) row.notAssessed++; else { row.assessed++; if (error(m)) row.errors++; }
    }
    valid.forEach(m => { categories[m.category] = (categories[m.category] || 0) + 1; });
    const seconds = timing && timing.confirmed === true && Number.isFinite(timing.seconds) && timing.seconds > 0 && timing.seconds <= 300 ? timing.seconds : null;
    const words = parsed.units.filter(u => u.kind === 'word').length;
    return { unitType: ex.unitType, total: relevant.length, attempted: attempted.length, correct: attempted.length - incorrect, incorrect, notAssessed: relevant.length - attempted.length, percent: attempted.length ? Math.round(100 * (attempted.length - incorrect) / attempted.length) : null, categories, skills: Object.values(skills), wpm: seconds ? Math.round(words * 60 / seconds) : null };
  }
  function report(records) {
    const reviewed = records.filter(r => r.status === 'reviewed'), skills = {};
    reviewed.forEach(r => {
      const s = summary(r.exercise, r.marks || [], r.timing);
      s.skills.forEach(u => { const key = u.kind + ':' + u.label; const row = skills[key] || (skills[key] = { kind: u.kind, label: u.label, assessed: 0, errors: 0, notAssessed: 0 }); ['assessed', 'errors', 'notAssessed'].forEach(k => row[k] += u[k]); });
    });
    return { attempts: records.length, reviewed: reviewed.length, skills: Object.values(skills), trend: reviewed.map(r => ({ id: r.id, date: r.reviewedAt, title: r.exercise.title, ...summary(r.exercise, r.marks || [], r.timing) })) };
  }
  const api = { CATEGORIES, TYPES, NEKUDOS, STARTERS, skillId, units, exercise, marks, summary, report };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.KriahCore = api;
})(typeof window === 'object' ? window : globalThis);
