// Posuk Practice: a finished recording is saved right away, and the page says clearly it is NOT SENT yet.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const page = fs.readFileSync('record_pesukim/student.html', 'utf8').replace(/\r\n/g, '\n');

test('a finished recording is saved to storage and the attempt list before it is sent', () => {
  assert.match(page, /saveCombinedDraft\(blob, mime, combinedExt, elapsed, currentPosukKey\)/);
  const save = page.match(/async function saveCombinedDraft[\s\S]*?\n}\n/)[0];
  assert.match(save, /storage\.ref\(path\)\.put\(blob/);
  assert.match(save, /combinedSubmitted: false/);
  assert.doesNotMatch(save, /posuk-submit/, 'saving must never send to the teacher');
});

test('a saved, unsent recording comes back when the posuk is opened again', () => {
  const restore = page.match(/async function restoreCombinedDraft[\s\S]*?\n}\n/)[0];
  assert.match(restore, /combinedSubmitted !== true/);
  assert.match(restore, /!a\.combinedDiscarded/);
  assert.match(restore, /!\(subs && subs\[id\]\)/, 'a recording already sent is not brought back as a draft');
  assert.match(page, /if\(state\.kind === 'open'\) await restoreCombinedDraft\(key, subs, token\)/);
});

test('the page says very clearly that it still has to be sent', () => {
  assert.match(page, /id="combinedUnsentBox"/);
  assert.match(page, /NOT SENT YET! Your teacher does NOT have this recording/);
  assert.match(page, /Tap “📤 Send to my teacher” below to submit it/);
  assert.match(page, /It is NOT SENT to your teacher yet/);
  assert.match(page, /needs-send/);
});

test('sending works with a restored recording, and throwing one away only hides it', () => {
  assert.match(page, /if\(!hasCombinedRecording\(\) \|\| combinedBusy/);
  assert.match(page, /combinedDiscarded: true/);
  assert.doesNotMatch(page.match(/function discardCombinedDraft[\s\S]*?\n}\n/)[0], /\.remove\(\)|\.delete\(\)/);
});
