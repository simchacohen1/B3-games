'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const page=fs.readFileSync('weekly-quiz/teacher.html','utf8');
const scriptStart=page.indexOf('const WQ_CLASS=');
const script=page.slice(scriptStart,page.indexOf('</script>',scriptStart));

test('Weekly Quiz history loads on demand while active classroom answers stay live',()=>{
  assert.doesNotThrow(()=>new vm.Script(script),'teacher page JavaScript must parse');
  assert.match(script,/function showTab\(name\)[\s\S]*?loadQuizHistoryData\(\)/);
  assert.match(script,/async function loadQuizHistoryData\(\)[\s\S]*?QROOT\+'\/responses'\)\.once\('value'\)[\s\S]*?QROOT\+'\/completions'\)\.once\('value'/);
  assert.doesNotMatch(script,/db\.ref\(QROOT\+'\/(?:responses|completions|audit)'\)\.on\('value'/,
    'historical trees must not stay subscribed across every student update');
  assert.doesNotMatch(script,/db\.ref\(QROOT\+'\/audit'\)\.once\('value'/,
    'stored audit history is not needed to render the teacher dashboard');
  assert.match(script,/liveResponseRef=db\.ref\(QROOT\+'\/responses\/'\+id\)[\s\S]*?liveResponseRef\.on\('value'/,
    'the active classroom must retain its per-launch live response listener');
  assert.match(script,/async function refreshQuizLaunch\(lid\)[\s\S]*?QROOT\+'\/responses\/'\+lid\)[\s\S]*?QROOT\+'\/completions\/'\+lid\)/,
    'teacher answer changes should refresh only the selected launch');
});
