'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const js=fs.readFileSync('shorashim/teacher.js','utf8');
const html=fs.readFileSync('shorashim/teacher.html','utf8');
test('Shorashim teacher script parses',()=>new vm.Script(js));
test('automatic missing-picture repair never calls the paid service',()=>{
 assert.ok(js.includes('const ai=useAI?await generateAiArtForItems(targets,onProgress):new Map();'));
 assert.ok(js.includes('repaired=await fillArtForShorashim(needsArt);'));
 assert.ok(js.includes('await fillArtForShorashim(added);'));
 assert.ok(js.includes('await fillArtForShorashim([i]);'));
});
test('teacher-approved words with missing art are not skipped',()=>{
 assert.ok(js.includes('const targets=(items||[]).filter(i=>i&&!sanitizeClassArt(i.art).length);'));
 assert.ok(js.includes('const needsArt=(state.catalog.shorashim||[]).filter(i=>!i.hidden&&!sanitizeClassArt(i.art).length);'));
 assert.ok(js.includes('if(existing&&!sanitizeClassArt(existing.art).length&&art.length)'));
});
test('paid teacher-requested suggestions are opt-in and never replace selected pictures',()=>{
 assert.ok(js.includes('New picture suggestions use separate OpenAI API credits.'));
 assert.ok(js.includes('const fresh=candidates.filter(x=>!oldPool.includes(x));'));
 assert.ok(js.includes('item.artPool=sanitizeSuggestionPool([...selected,...fresh,...oldPool]);'));
 assert.match(html,/teacher\.js\?v=20261019-booklet-1/);
});
