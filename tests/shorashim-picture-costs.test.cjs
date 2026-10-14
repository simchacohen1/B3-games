'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const js=fs.readFileSync('shorashim/teacher.js','utf8');
const html=fs.readFileSync('shorashim/teacher.html','utf8');
const student=fs.readFileSync('shorashim/app.js','utf8');
const review=fs.readFileSync('shorashim/review-categories.js','utf8');
const service=fs.readFileSync('backend/functions/shorashim-art.js','utf8');
const index=fs.readFileSync('shorashim/index.html','utf8');

test('updated student, teacher and cloud generation scripts parse',()=>{
  for(const code of [js,student,review,service])assert.doesNotThrow(()=>new vm.Script(code));
});
test('automatic repairs are free, fill ONLY teacher suggestions and never change approved pictures',()=>{
  assert.ok(js.includes('const ai=useAI?await generateAiArtForItems(targets,onProgress):new Map();'));
  assert.ok(js.includes('repaired=await fillArtForShorashim(needsArt);'));
  assert.ok(js.includes('await fillArtForShorashim(added);'));
  assert.ok(js.includes('await fillArtForShorashim([i]);'));
  assert.ok(js.includes('item.artPool=pool; item.autoArt=false;'));
  assert.ok(!js.includes('item.art=art; item.artPool=pool;'));
  assert.ok(js.includes('!sanitizeSuggestionPool(i.artPool).length'));
  assert.ok(js.includes('existing.artPool=suggestions;'));
});
test('paid button requests genuinely new choices and discloses charges',()=>{
  assert.ok(js.includes('AI picture suggestions use paid API credits, even if no new choices are found.'));
  assert.ok(js.includes('const requestId=freshRequest?'));
  assert.ok(js.includes('avoid:sanitizeSuggestionPool('));
  assert.ok(js.includes('freshRequest:true'));
  assert.ok(js.includes('const fresh=candidates.filter(x=>!oldPool.includes(x));'));
  assert.ok(js.includes('item.artPool=sanitizeSuggestionPool([...selected,...fresh,...oldPool]);'));
  assert.ok(service.includes('avoid: Array.isArray(x?.avoid)'));
  assert.ok(service.includes('!avoid.has(x)'));
  assert.ok(service.includes('temperature: 0.7'));
  assert.ok(service.includes('teacher explicitly selects'));
});
test('student options never include unapproved automatic art or inferred illustrations',()=>{
  assert.ok(student.includes('const choices=Array.isArray(item.approvedIllustrations)?item.approvedIllustrations:[];'));
  assert.ok(review.includes('const art = Array.isArray(item.art) ? item.art : [];'));
  assert.ok(review.includes('const choices = Array.isArray(item.approvedIllustrations) ? item.approvedIllustrations : [];'));
  assert.ok(!student.includes("item.art||['✨']"));
  assert.ok(index.includes('review-categories.js?v=20261014-teacher-approved-art1'));
  assert.ok(html.includes('teacher.js?v=20261014-teacher-approved-art1'));
});
