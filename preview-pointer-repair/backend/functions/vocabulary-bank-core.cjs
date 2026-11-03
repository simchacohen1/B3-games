'use strict';
const crypto = require('node:crypto');
const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const SOURCES = new Set(['sefer-hamitzvos', 'halacha']);
const clean = value => String(value || '').trim().replace(/\s+/g, ' ');
function validId(value) { return ID_RE.test(String(value || '')); }
function validLessonId(value) { return /^[A-Za-z0-9_:-]{1,120}$/.test(String(value || '')); }
function wordKey(hebrew) {
  const normalized = clean(hebrew).normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('he');
  return 'w_' + crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}
function normalizeWord(value) {
  const hebrew = clean(value?.hebrew), english = clean(value?.english), source = clean(value?.source);
  if (!hebrew || hebrew.length > 100 || !english || english.length > 180 || !SOURCES.has(source)) return null;
  return { id: 'word:' + hebrew.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('he'), key: wordKey(hebrew), hebrew, english, source };
}
function mergeWord(existing, word, lesson, now = new Date().toISOString()) {
  const row = existing && typeof existing === 'object' ? existing : {};
  const sources = new Set(Array.isArray(row.sources) ? row.sources : row.source ? [row.source] : []);
  sources.add(word.source);
  const lessons = Array.isArray(row.lessons) ? row.lessons.slice() : [];
  const lessonRow = lesson && { id: clean(lesson.id), title: clean(lesson.title), source: word.source, openedAt: now };
  if (lessonRow?.id && !lessons.some(item => item.id === lessonRow.id && item.source === lessonRow.source)) lessons.push(lessonRow);
  const override = row.editorChange && typeof row.editorChange === 'object' ? row.editorChange : null;
  const correctCount = Number(row.correctCount || 0);
  return {
    id: word.id, hebrew: clean(override?.hebrew || word.hebrew), english: clean(override?.english || word.english),
    sources: [...sources], source: sources.size > 1 ? 'both' : word.source, lessons,
    collectedAt: row.collectedAt || now, practiceCount: Number(row.practiceCount || 0), correctCount,
    mastered: Boolean(row.mastered) || correctCount >= 3, lastPracticedAt: row.lastPracticedAt || null,
    ...(override ? { editorChange: override } : {})
  };
}
function mergeCollection(existing, lesson, rawWords, now = new Date().toISOString()) {
  if (!lesson || !validLessonId(lesson.id) || !SOURCES.has(lesson.source) || !Array.isArray(rawWords) || rawWords.length < 1 || rawWords.length > 10) {
    const error = new Error('Invalid lesson vocabulary.'); error.status = 400; throw error;
  }
  if (rawWords.some(w => normalizeWord({ ...w, source: w.source || lesson.source }) === null)) {
    const error = new Error('Each word needs Hebrew text, an English meaning, and a valid source.'); error.status = 400; throw error;
  }
  const bank = existing && typeof existing === 'object' ? structuredClone(existing) : {};
  for (const raw of rawWords) {
    const word = normalizeWord({ ...raw, source: raw.source || lesson.source });
    const current = bank[word.key];
    bank[word.key] = mergeWord(current, word, lesson, now);
  }
  return bank;
}
function updatePractice(existing, wordId, correct, now = new Date().toISOString()) {
  const bank = existing && typeof existing === 'object' ? structuredClone(existing) : {};
  const entry = Object.values(bank).find(row => row?.id === wordId);
  if (!entry) { const error = new Error('Word was not found.'); error.status = 404; throw error; }
  entry.practiceCount = Number(entry.practiceCount || 0) + 1;
  entry.correctCount = Number(entry.correctCount || 0) + (correct ? 1 : 0);
  entry.mastered = Boolean(entry.mastered) || entry.correctCount >= 3;
  entry.lastPracticedAt = now;
  return bank;
}
function editWord(existing, wordId, change, now = new Date().toISOString()) {
  const bank = existing && typeof existing === 'object' ? structuredClone(existing) : {};
  const entry = Object.values(bank).find(row => row?.id === wordId);
  if (!entry) { const error = new Error('Word was not found.'); error.status = 404; throw error; }
  const hebrew = change?.hebrew === undefined ? entry.hebrew : clean(change.hebrew);
  const english = change?.english === undefined ? entry.english : clean(change.english);
  if (!hebrew || hebrew.length > 100 || !english || english.length > 180) { const error = new Error('Enter a Hebrew word and a short English meaning.'); error.status = 400; throw error; }
  entry.hebrew = hebrew; entry.english = english; entry.editorChange = { hebrew, english, updatedAt: now };
  return bank;
}
function summary(bank) {
  const rows = Object.values(bank || {});
  return { collected: rows.length, practiced: rows.filter(row => Number(row.practiceCount || 0) > 0).length, mastered: rows.filter(row => row.mastered === true).length };
}
module.exports = { validId, validLessonId, wordKey, normalizeWord, mergeWord, mergeCollection, updatePractice, editWord, summary };
