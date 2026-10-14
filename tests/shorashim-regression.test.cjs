const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const teacher = fs.readFileSync(path.join(__dirname, '../shorashim/teacher.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../shorashim/teacher.html'), 'utf8');

test('teacher page includes Shorashim teacher script', () => {
  assert.match(html, /src="teacher\.js\?/);
});
test('recordings and points approval remain available', () => {
  assert.match(teacher, /recordingEvents/);
  assert.match(teacher, /reviewShorashimRecording/);
  assert.match(teacher, /teacherRewardsToken/);
  assert.match(teacher, /pointRequestId/);
  assert.match(teacher, /repairShorashimRecording/);
  assert.match(teacher, /repair-shorashim-recording/);
});
test('recording duration remains available', () => {
  assert.match(teacher, /function recordingDurationLabel\(/);
  assert.match(teacher, /function updateShorashimAudioDurations\(/);
  assert.match(teacher, /data-recording-duration/);
  assert.match(teacher, /preload="metadata"/);
  assert.match(teacher, /updateShorashimAudioDurations\(\);/);
});
test('teacher picture pool and student selection remain available', () => {
  assert.match(teacher, /ART_POOL_MAX=20/);
  assert.match(teacher, /ART_STUDENT_MAX=4/);
  assert.match(teacher, /togglePictureChoice/);
});
