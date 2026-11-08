/**
 * Tests for the Shorashim teacher picture approval flow.
 * Run with: node shorashim-picture-approval.test.js
 * (No test framework required — plain assertions.)
 *
 * Covers:
 *   1. Students see 0 pictures by default (item.art starts empty).
 *   2. Only ticked pictures (item.art) are shown to students; unticked ones stay in artPool only.
 *   3. Uploaded picture URL goes to artPool (unticked), not to art.
 *   4. Ticking a picture moves it from artPool into art.
 *   5. Unticking removes it from art but keeps it in artPool.
 *   6. The 4-picture student cap is enforced when ticking.
 *   7. URL sanitizer passes https:// Firebase Storage URLs.
 *   8. Existing words with art already set keep their selections.
 */
'use strict';

const BUCKET = 'b3-games.firebasestorage.app';
const PREFIX = 'shorashim-teacher-pictures/';
const ART_STUDENT_MAX = 4;
const ART_POOL_MAX = 20;

// ---- Helpers mirrored from teacher.js ----

const UNSUITABLE = new Set(['👫','👬','👭']);
const SAFE_EXTRAS = new Set(['👦','🧒']);

function isClassSafeArtChoice(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  if (UNSUITABLE.has(v)) return false;
  if (SAFE_EXTRAS.has(v)) return true;
  if (v.startsWith('https://')) return true;
  return true;
}

function sanitizeClassArtPool(art) {
  return [...new Set((Array.isArray(art) ? art : [])
    .map(x => String(x || '').trim())
    .filter(isClassSafeArtChoice))];
}

function sanitizeClassArt(art) {
  return sanitizeClassArtPool(art).slice(0, ART_STUDENT_MAX);
}

function sanitizeSuggestionPool(art) {
  return sanitizeClassArtPool(art).slice(0, ART_POOL_MAX);
}

function suggestionPoolOf(item) {
  return sanitizeSuggestionPool([...((item && item.art) || []), ...((item && item.artPool) || [])]);
}

function screenshotURL(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' &&
      url.hostname === 'firebasestorage.googleapis.com' &&
      url.pathname.startsWith('/v0/b/' + BUCKET + '/o/' + encodeURIComponent(PREFIX));
  } catch (_) { return false; }
}

/** Simulate togglePictureChoice from teacher.js */
function togglePictureChoice(item, artValue) {
  const v = String(artValue);
  const selected = sanitizeClassArt(item.art || []);
  item.artPool = suggestionPoolOf(item);
  if (selected.includes(v)) {
    item.art = selected.filter(x => x !== v);
    return { ok: true, action: 'untick' };
  } else if (selected.length >= ART_STUDENT_MAX) {
    return { ok: false, reason: 'cap' };
  } else {
    item.art = [...selected, v];
    return { ok: true, action: 'tick' };
  }
}

/** Simulate what upload() does: add URL to artPool only. */
function simulateUpload(item, url) {
  item.artPool = sanitizeSuggestionPool([...(item.artPool || []), url]);
}

// ---- Assertion helper ----
let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) {
    console.log('  ✓', label);
    passed++;
  } else {
    console.error('  ✗ FAIL:', label);
    failed++;
  }
}

// ---- Tests ----

console.log('\nTest 1: Students see 0 pictures by default');
{
  const item = { id: 'test-1', art: [], artPool: ['🌳', '🌊'] };
  assert(sanitizeClassArt(item.art).length === 0, 'art is empty → students see 0 pictures');
  assert(suggestionPoolOf(item).length === 2, 'pool still has 2 suggestions for teacher to tick');
}

console.log('\nTest 2: Only ticked pictures shown; unticked stay in pool');
{
  const item = { id: 'test-2', art: ['🌳'], artPool: ['🌳', '🌊', '☀️'] };
  assert(sanitizeClassArt(item.art).length === 1, 'one picture ticked → students see 1');
  assert(!sanitizeClassArt(item.art).includes('🌊'), 'unticked 🌊 not shown to students');
  assert(suggestionPoolOf(item).includes('🌊'), '🌊 still visible to teacher');
}

console.log('\nTest 3: Uploaded picture goes to artPool (unticked), not art');
{
  const url = 'https://firebasestorage.googleapis.com/v0/b/b3-games.firebasestorage.app/o/shorashim-teacher-pictures%2Fuid%2F123.webp?alt=media';
  const item = { id: 'test-3', art: ['🌳'], artPool: ['🌳', '🌊'] };
  simulateUpload(item, url);
  assert(!item.art.includes(url), 'uploaded URL not in art (unticked by default)');
  assert(item.artPool.includes(url), 'uploaded URL in artPool (teacher can tick it)');
  assert(sanitizeClassArt(item.art).length === 1, 'students still only see 1 picture');
}

console.log('\nTest 4: Ticking a picture moves it into art');
{
  const url = 'https://firebasestorage.googleapis.com/v0/b/b3-games.firebasestorage.app/o/shorashim-teacher-pictures%2Fuid%2F456.webp?alt=media';
  const item = { id: 'test-4', art: [], artPool: ['🌳', url] };
  const result = togglePictureChoice(item, url);
  assert(result.ok && result.action === 'tick', 'toggle returns tick');
  assert(item.art.includes(url), 'URL now in art');
  assert(sanitizeClassArt(item.art).length === 1, 'students now see 1 picture');
}

console.log('\nTest 5: Unticking removes from art but keeps in artPool');
{
  const item = { id: 'test-5', art: ['🌳', '🌊'], artPool: ['🌳', '🌊', '☀️'] };
  const result = togglePictureChoice(item, '🌊');
  assert(result.ok && result.action === 'untick', 'toggle returns untick');
  assert(!item.art.includes('🌊'), '🌊 removed from art');
  assert(item.artPool.includes('🌊'), '🌊 still in pool for future use');
}

console.log('\nTest 6: Student cap enforced (max 4 ticked)');
{
  const item = { id: 'test-6', art: ['🌳','🌊','☀️','🌲'], artPool: ['🌳','🌊','☀️','🌲','🔥'] };
  const result = togglePictureChoice(item, '🔥');
  assert(!result.ok && result.reason === 'cap', 'cap enforced at 4');
  assert(!item.art.includes('🔥'), '🔥 not added');
  assert(sanitizeClassArt(item.art).length === 4, 'still 4 ticked');
}

console.log('\nTest 7: URL sanitizer accepts Firebase Storage URLs');
{
  const good = 'https://firebasestorage.googleapis.com/v0/b/b3-games.firebasestorage.app/o/shorashim-teacher-pictures%2Fuid%2Fabc.webp?alt=media';
  const bad1 = 'http://firebasestorage.googleapis.com/v0/b/b3-games.firebasestorage.app/o/shorashim-teacher-pictures%2Fuid%2Fabc.webp';
  const bad2 = 'https://evil.example.com/img.png';
  assert(screenshotURL(good), 'valid Firebase Storage URL accepted');
  assert(!screenshotURL(bad1), 'http URL rejected');
  assert(!screenshotURL(bad2), 'foreign hostname rejected');
  assert(isClassSafeArtChoice(good), 'Firebase URL passes art safety check');
}

console.log('\nTest 8: Existing words with art keep their selections');
{
  const item = { id: 'test-8', art: ['🌳', '🌊'], artPool: ['🌳', '🌊', '☀️'] };
  // Simulate a re-render (artPool rebuilt from art + artPool)
  const rebuilt = suggestionPoolOf(item);
  assert(rebuilt.includes('🌳') && rebuilt.includes('🌊'), 'ticked items in rebuilt pool');
  assert(rebuilt.includes('☀️'), 'unticked item still in pool');
  assert(sanitizeClassArt(item.art).length === 2, 'still 2 ticked after re-render');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
