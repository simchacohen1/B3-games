'use strict';
/*
 * Mishnayos Practice — pure helpers (no Firebase, no network) so they can be
 * unit-tested. The Silverstein English lives ONLY in data/mishnayos/*.en.json,
 * bundled with the Cloud Functions; nothing in this file ever returns English
 * to a student-facing response except through the explicit "answer key"
 * helpers used for teacher-only storage.
 */
const path = require('path');

const MASECHTOS = {
  berachos: { file: 'berachos.en.json', label: 'Berachos', hebrew: 'ברכות' }
};
const dataCache = new Map();

function loadMaseches(maseches) {
  const key = String(maseches || '').toLowerCase();
  const meta = MASECHTOS[key];
  if (!meta) return null;
  if (!dataCache.has(key)) {
    dataCache.set(key, require(path.join(__dirname, 'data', 'mishnayos', meta.file)));
  }
  return { key, meta, data: dataCache.get(key) };
}

/* Sections are numbered 1..N straight through a perek (the same way the
   student page numbers them), so "section 4 of perek 1" might be the second
   part of Mishnah 2. */
function sectionsOfPerek(maseches, perek) {
  const m = loadMaseches(maseches);
  if (!m) return [];
  const p = m.data.perakim[Number(perek) - 1];
  if (!p) return [];
  const out = [];
  p.mishnayos.forEach(mishnah => {
    (mishnah.sections || []).forEach((hebrew, i) => {
      out.push({
        mishnah: mishnah.mishnah,
        part: i + 1,
        partsCount: mishnah.sections.length,
        hebrew
      });
    });
  });
  return out;
}

function resolveSection(maseches, perek, section) {
  const m = loadMaseches(maseches);
  if (!m) return null;
  const perekNum = Number(perek), sectionNum = Number(section);
  if (!Number.isInteger(perekNum) || !Number.isInteger(sectionNum) || sectionNum < 1) return null;
  const list = sectionsOfPerek(m.key, perekNum);
  const s = list[sectionNum - 1];
  if (!s) return null;
  const mishnah = m.data.perakim[perekNum - 1].mishnayos[s.mishnah - 1];
  return {
    maseches: m.key,
    masechesLabel: m.meta.label,
    perek: perekNum,
    section: sectionNum,
    mishnah: s.mishnah,
    part: s.part,
    partsCount: s.partsCount,
    hebrew: s.hebrew,
    mishnahHebrew: (mishnah.sections || []).join(' '),
    translation: mishnah.translation || '',
    withBartenura: mishnah.withBartenura || '',
    key: m.meta.label + '_' + perekNum + '_' + sectionNum
  };
}

function hebrewWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean);
}

function normalizeHebrew(text) {
  return String(text || '').normalize('NFD')
    .replace(/[֑-ׇ]/g, '')
    .replace(/[^א-ת\s]/g, '')
    .replace(/\s+/g, ' ').trim();
}

/* Checks that every level tiles the whole section, in order, with no
   missing or extra words — the student page depends on this. */
function validTranslationLevels(levels, sectionHebrew) {
  const target = normalizeHebrew(sectionHebrew);
  if (!Array.isArray(levels) || !levels.length) return false;
  return levels.every(level => Array.isArray(level?.chunks) && level.chunks.length &&
    level.chunks.every(c => typeof c?.hebrew === 'string' && c.hebrew.trim() &&
      Array.isArray(c.english) && c.english.some(e => String(e || '').trim())) &&
    normalizeHebrew(level.chunks.map(c => c.hebrew).join(' ')) === target);
}

/* What a student is allowed to see: the Hebrew chunk boundaries only. */
function publicTranslationLevels(levels) {
  return (levels || []).map(level => ({
    chunks: (level.chunks || []).map(c => ({ hebrew: String(c.hebrew || '').trim() }))
  }));
}

/* Finds the accepted English for one chunk the student is translating.
   Prefer the exact level/chunk position; fall back to a Hebrew match on any
   level, since the page can merge chunks for a range. */
function findAnswerChunk(levels, levelIndex, chunkIndex, chunkHebrew) {
  const target = normalizeHebrew(chunkHebrew);
  const direct = levels?.[Number(levelIndex)]?.chunks?.[Number(chunkIndex)];
  if (direct && (!target || normalizeHebrew(direct.hebrew) === target)) return direct;
  for (const level of levels || []) {
    for (const chunk of level.chunks || []) {
      if (normalizeHebrew(chunk.hebrew) === target) return chunk;
    }
  }
  return null;
}

/* Questions: students get the question and which Hebrew words answer it
   (they tap those words); the English expected answer and source fact stay
   in the teacher-only answer key. */
function publicQuestionItems(items) {
  return (items || []).map(item => ({
    question: String(item.question || ''),
    answerHebrewPhrases: Array.isArray(item.answerHebrewPhrases) ? item.answerHebrewPhrases : [],
    answerWordSets: Array.isArray(item.answerWordSets) ? item.answerWordSets : []
  }));
}

function findAnswerQuestion(items, questionIndex, questionText) {
  const q = String(questionText || '').trim().toLowerCase();
  const direct = items?.[Number(questionIndex)];
  if (direct && String(direct.question || '').trim().toLowerCase() === q) return direct;
  return (items || []).find(item => String(item.question || '').trim().toLowerCase() === q) || null;
}

/* Words a model must never echo back to a child: if feedback quotes a long
   run of the hidden translation, replace it with a neutral line. */
function feedbackLeaksTranslation(feedback, translation) {
  const f = String(feedback || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const t = String(translation || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
  if (!f || t.length < 6) return false;
  for (let i = 0; i + 6 <= t.length; i++) {
    if (f.includes(t.slice(i, i + 6).join(' '))) return true;
  }
  return false;
}

function cleanJsonText(text) {
  let cleaned = String(text || '').replace(/```json|```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) cleaned = match[0];
  return JSON.parse(cleaned);
}

function safeKey(text) {
  return String(text || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
}

module.exports = {
  MASECHTOS,
  loadMaseches,
  sectionsOfPerek,
  resolveSection,
  hebrewWords,
  normalizeHebrew,
  validTranslationLevels,
  publicTranslationLevels,
  findAnswerChunk,
  publicQuestionItems,
  findAnswerQuestion,
  feedbackLeaksTranslation,
  cleanJsonText,
  safeKey
};
