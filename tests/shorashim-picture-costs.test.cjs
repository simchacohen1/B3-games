'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const js=fs.readFileSync('shorashim/teacher.js','utf8');
const html=fs.readFileSync('shorashim/teacher.html','utf8');
test('Shorashim teacher script parses',()=>new vm.Script(js));
test('automatic missing-picture suggestions never call the paid service',()=>{
 assert.ok(js.includes('const ai=useAI?await generateAiArtForItems(targets,onProgress):new Map();'));
 assert.ok(js.includes('repaired=await fillArtForShorashim(needsArt);'));
 assert.ok(js.includes('await fillArtForShorashim(added);'));
 assert.ok(js.includes('await fillArtForShorashim([i]);'));
 assert.doesNotMatch(js,/fillArtForShorashim\([^)]*useAI:\s*true/);
});
test('words with no ticked picture and no suggestions get free suggestions, never ticks',()=>{
 assert.ok(js.includes('const targets=(items||[]).filter(i=>i&&!sanitizeSuggestionPool(i.artPool).length);'));
 assert.ok(js.includes('const needsArt=(state.catalog.shorashim||[]).filter(i=>!i.hidden&&!sanitizeClassArt(i.art).length&&!sanitizeSuggestionPool(i.artPool).length);'));
 assert.ok(js.includes('if(existing&&!sanitizeSuggestionPool(existing.artPool).length&&pool.length)existing.artPool=pool;'));
 assert.ok(js.includes('if(existing&&!sanitizeClassArt(existing.art).length&&art.length)'));
});
test('the paid Regenerate Pictures request is removed (issue #627)',()=>{
 assert.equal(js.includes('New picture suggestions use separate OpenAI API credits.'),false);
 assert.equal(js.includes('regeneratePictures'),false);
 assert.match(html,/teacher\.js\?v=20261109-pictures-2/);
});
