'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const page=fs.readFileSync('shorashim/index.html','utf8');
const app=fs.readFileSync('shorashim/app.js','utf8');

test('card JavaScript still parses',()=>{
 new vm.Script(app);
 const block=page.match(/<script data-shorashim-single-card="v1">([\s\S]*?)<\/script>/);
 assert.ok(block,'Single-card script missing');
 new vm.Script(block[1]);
});
test('new Shorashim words fade in gently, without spinning',()=>{
 assert.doesNotMatch(page,/sc-spinning|scSpin3|rotateY\(1080deg\)/);
 assert.match(page,/\.sc-flipper\.sc-arriving/);
 assert.match(page,/@keyframes scCardArrive/);
 assert.match(page,/function showNewWord\(\)/);
 assert.match(page,/lastKey = key; showNewWord\(\)/);
 assert.match(page,/prefers-reduced-motion/);
});
test('manual front/back flip is still supported',()=>{
 assert.match(page,/flipper\.classList\.toggle\("sc-flipped"\)/);
 assert.match(page,/\.sc-flipper\.sc-flipped\{transform:rotateY\(180deg\)\}/);
});
test('new Hebrew words stay at the normal default size when cards widen',()=>{
 assert.match(app,/hebrewSize:58/);
 assert.match(app,/Math\.min\(1,width\/CARD_DESIGN_WIDTH\)/);
 assert.match(app,/new ResizeObserver\(\(\)=>\{if\(!editor\.classList\.contains\('hidden'\)\)scaleEditorCardContents\(\)/);
});
