'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const src=fs.readFileSync('game-gate.js','utf8').replace(/\r\n/g,'\n');

// Browsers allow ~6 connections per host. Every open EventSource keeps one, so idle tabs must not hold streams, and a
// failed access check must retry within seconds (the message promises it) instead of waiting for the 30 s poll.
test('hidden tabs release the settings stream and the class streams',()=>{
  const m=src.match(/addEventListener\("visibilitychange", function \(\) \{([\s\S]*?)\n  \}\);/);
  assert.ok(m,'visibilitychange handler exists');
  assert.match(m[1],/settingsLive\.open\(\)/);
  assert.match(m[1],/settingsLive\.close\(\)/);
  assert.match(m[1],/closeClassWatch\(\)/);
});
test('closeClassWatch closes every class stream and lets the next check reopen them',()=>{
  const m=src.match(/function closeClassWatch\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(m);
  assert.match(m[1],/\.close\(\)/);
  assert.match(m[1],/classWatch\.id = ""/);
});
test('a failed access check retries within seconds and the access decision is unchanged',()=>{
  assert.match(src,/FAILED_CHECK_RETRY_MS = 4000/);
  assert.match(src,/setTimeout\(checkNow, FAILED_CHECK_RETRY_MS\)/);
  // Still fail-closed when settings were never read.
  assert.match(src,/if \(lastSettings && studentActive\) decide\(lastSettings\);\n\s+else \{/);
});
test('the page opens at most three database streams (settings + two class fields)',()=>{
  assert.equal((src.match(/new EventSource\(/g)||[]).length,2,'one settings stream and one per class field');
});
test('background checks in a hidden tab do not reopen the class streams',()=>{
  const m=src.match(/function watchClassLive\(classId, classPath\) \{([\s\S]*?)classWatch\.id = classId;/);
  assert.ok(m);
  assert.match(m[1],/document\.visibilityState === "hidden"\) return;/);
});
