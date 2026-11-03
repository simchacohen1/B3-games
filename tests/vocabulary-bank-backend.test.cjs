'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../backend/functions/vocabulary-bank-core.cjs');
const lesson={id:'sefer:P1',title:'Knowledge of Hashem',source:'sefer-hamitzvos'};
const word={hebrew:'אֱמוּנָה',english:'faith',source:'sefer-hamitzvos'};

test('word identity ignores nekudos and creates safe Firebase keys',()=>{
  assert.equal(core.wordKey('אֱמוּנָה'),core.wordKey('אמונה'));
  assert.match(core.wordKey('אֱמוּנָה'),/^w_[a-f0-9]{32}$/);
  assert.equal(core.normalizeWord(word).id,'word:אמונה');
});

test('collection deduplicates words but records each distinct lesson and source',()=>{
  let bank=core.mergeCollection({},lesson,[word],'2026-10-19T00:00:00.000Z');
  const second={id:'sefer:P2',title:'One Hashem',source:'sefer-hamitzvos'};
  bank=core.mergeCollection(bank,second,[word],'2026-10-20T00:00:00.000Z');
  const halacha={id:'halacha:a',title:'Daily Awareness',source:'halacha'};
  bank=core.mergeCollection(bank,halacha,[{...word,source:'halacha'}],'2026-10-21T00:00:00.000Z');
  const row=Object.values(bank)[0];
  assert.equal(Object.keys(bank).length,1);
  assert.equal(row.lessons.length,3);
  assert.deepEqual(row.sources.sort(),['halacha','sefer-hamitzvos']);
  assert.equal(row.source,'both');
});

test('review mastery and teacher edits preserve student progress and lesson history',()=>{
  let bank=core.mergeCollection({},lesson,[word],'2026-10-19T00:00:00.000Z');
  const id=Object.values(bank)[0].id;
  for(const result of [true,false,true,true])bank=core.updatePractice(bank,id,result,'2026-10-20T00:00:00.000Z');
  bank=core.editWord(bank,id,{hebrew:'אֱמוּנָה',english:'trusting Hashem'},'2026-10-21T00:00:00.000Z');
  const row=Object.values(bank)[0];
  assert.equal(row.practiceCount,4);assert.equal(row.correctCount,3);assert.equal(row.mastered,true);
  assert.equal(row.lessons.length,1);assert.equal(row.english,'trusting Hashem');assert.ok(row.editorChange.updatedAt);
  bank=core.mergeCollection(bank,{id:'sefer:P2',title:'One Hashem',source:'sefer-hamitzvos'},[word]);
  const merged=Object.values(bank)[0];assert.equal(merged.english,'trusting Hashem');assert.equal(merged.practiceCount,4);assert.equal(merged.lessons.length,2);
});

test('invalid collection payloads and missing word edits are rejected',()=>{
  assert.throws(()=>core.mergeCollection({},lesson,[{hebrew:'',english:'x',source:'sefer-hamitzvos'}]),{status:400});
  assert.throws(()=>core.mergeCollection({},lesson,Array(11).fill(word)),{status:400});
  assert.throws(()=>core.editWord({},'word:missing',{english:'x'}),{status:404});
});
