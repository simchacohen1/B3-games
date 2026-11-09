'use strict';
// Homework checklist items: one assignment can hold several specific items,
// each an activity plus its exact details (for example Posuk Practice,
// Bereishis perek 18, pesukim 12-14). Students open each item in the real
// activity in "homework mode"; the activity reports when the item is done.
// This file is copied unchanged into homework-staging/ (a test keeps them equal).

const MAX_ITEMS = 12;
const ITEM_TYPES = ['posuk', 'rashiLetters', 'chazara', 'shorashim', 'weeklyQuiz', 'workbook', 'other'];
const SEFORIM = ['Bereishis', 'Shemos', 'Vayikra', 'Bamidbar', 'Devarim'];
const SKILLS = ['reading', 'translate', 'understand'];
const RASHI_UNITS = ['zayin', 'bet', 'tsadi', 'alef', 'tsadisofit', 'memsofit', 'shin', 'samech', 'finalreview'];
const ID = /^[A-Za-z0-9_-]{1,40}$/;

const bad = message => { throw Object.assign(new Error(message), { code: 400 }); };
const clean = (s, n) => String(s == null ? '' : s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f<>]/g, '').trim().slice(0, n);
const int = (v, lo, hi, what) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) bad(what);
  return n;
};
function range(d, label) {
  const perek = int(d.perek, 1, 150, label + ': choose a perek.');
  const from = int(d.from, 1, 200, label + ': choose the first posuk.');
  const to = int(d.to == null || d.to === '' ? from : d.to, 1, 200, label + ': choose the last posuk.');
  if (to < from) bad(label + ': the last posuk must come after the first.');
  if (to - from > 39) bad(label + ': choose 40 pesukim or fewer in one item.');
  return { perek, from, to };
}

// Validates one item and returns only the fields we keep.
function cleanItem(raw, index) {
  const label = 'Item ' + (index + 1);
  if (!raw || typeof raw !== 'object') bad(label + ' is missing.');
  if (!ITEM_TYPES.includes(raw.type)) bad(label + ': choose an activity.');
  const d = raw.details && typeof raw.details === 'object' ? raw.details : {};
  let details = {};
  if (raw.type === 'posuk') {
    const sefer = d.sefer == null || d.sefer === '' ? 'Bereishis' : d.sefer;
    if (!SEFORIM.includes(sefer)) bad(label + ': choose a sefer.');
    const skills = Array.isArray(d.skills) ? [...new Set(d.skills)].filter(s => SKILLS.includes(s)) : [];
    details = { sefer, ...range(d, label), skills: skills.length ? SKILLS.filter(s => skills.includes(s)) : ['reading'] };
  } else if (raw.type === 'chazara') {
    details = { ...range(d, label), times: d.times == null || d.times === '' ? 1 : int(d.times, 1, 5, label + ': times must be 1 to 5.') };
  } else if (raw.type === 'rashiLetters') {
    const letters = Array.isArray(d.letters) ? [...new Set(d.letters)].filter(x => RASHI_UNITS.includes(x)) : [];
    if (!letters.length) bad(label + ': choose at least one Rashi letter.');
    details = { letters: RASHI_UNITS.filter(x => letters.includes(x)) };
  }
  const note = clean(raw.note, 200);
  return { id: typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : '', type: raw.type, details, ...(note ? { note } : {}) };
}

// Validates the whole list. Keeps existing ids (so finished items stay finished
// after an edit) and gives new items a fresh id.
function cleanItems(list, newId) {
  if (list == null) return null;
  if (!Array.isArray(list)) bad('Homework items must be a list.');
  if (!list.length) return null;
  if (list.length > MAX_ITEMS) bad('Use ' + MAX_ITEMS + ' items or fewer in one homework.');
  const seen = new Set();
  return list.map((raw, i) => {
    const item = cleanItem(raw, i);
    if (!item.id || seen.has(item.id)) {
      do { item.id = 'i' + String(newId()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30); } while (seen.has(item.id));
    }
    seen.add(item.id);
    return item;
  });
}

const itemsOf = def => (Array.isArray(def && def.items) ? def.items : []);
// Only ids of items that still exist count as done.
function doneMap(def, rec) {
  const out = {}, done = (rec && rec.itemsDone) || {};
  for (const item of itemsOf(def)) if (done[item.id]) out[item.id] = Number(done[item.id]) || true;
  return out;
}
function allDone(def, rec) {
  const items = itemsOf(def);
  if (!items.length) return false;
  const done = doneMap(def, rec);
  return items.every(item => done[item.id]);
}

module.exports = { MAX_ITEMS, ITEM_TYPES, SEFORIM, SKILLS, RASHI_UNITS, cleanItem, cleanItems, itemsOf, doneMap, allDone };
