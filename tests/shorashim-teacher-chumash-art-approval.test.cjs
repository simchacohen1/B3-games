const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const js=fs.readFileSync(path.join(__dirname,'..','shorashim','teacher.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','shorashim','teacher.html'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'..','shorashim','app.js'),'utf8');

test('Chumash lists are copied into the class catalog once, with the same ids',()=>{
  assert.match(js,/const CHUMASH_VOCAB_SEED_VERSION=1;/);
  assert.match(js,/function ensureChumashVocabLists\(\)\{[\s\S]*?legacyScoped\(\)\|\|Number\(state\.settings\.chumashVocabSeedVersion\|\|0\)>=CHUMASH_VOCAB_SEED_VERSION[\s\S]*?id:w\.id,front:w\.front,english:w\.english/);
  assert.match(js,/chumashVocabSeedVersion`\)\.set\(CHUMASH_VOCAB_SEED_VERSION\)/);
});
test('automatic pictures go straight to students unless blocked; no waiting step',()=>{
  assert.match(js,/item.art=art; item.artPool=pool; delete item.pendingArt;/);
  assert.doesNotMatch(js,/data-a="approve-art"/);
  assert.doesNotMatch(html,/teacherApproveAllArt/);
  assert.ok(js.includes('if(blockedArtList().includes(v)) return false;'));
});
test('one simple Block / Unblock list of pictures',()=>{
  assert.match(html,/id="teacherPictureBlockPanel"/);
  assert.match(js,/data-block-art/);
  assert.match(js,/data-unblock-art/);
  assert.ok(js.includes('function refillItemArt('));
  assert.ok(app.includes('function unblockedArt('));
});
test('student app does not list a copied Chumash word twice',()=>{
  assert.match(app,/function chumashExtra\(\)\{[\s\S]*?!have\.has\(String\(i\.id\)\)/);
});
