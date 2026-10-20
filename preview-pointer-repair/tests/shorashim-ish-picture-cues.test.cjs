const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../shorashim/teacher.js'),'utf8');
test('singular Ish / man has its own matching picture cues',()=>{
 const block=source.slice(source.indexOf('const SMART_ART_RULES='),source.indexOf('const SMART_ART_FALLBACK='));
 assert.match(block,/\\bman\\b\|\\bish\\b\|איש/);
 assert.match(block,/\['👤','👔','🧢','🎩','👞'\]/);
 assert.ok(block.indexOf('\\bman\\b')<block.indexOf('\\bmen\\b'));
});
test('teacher controls student selection when regenerating pictures',()=>{
 const start=source.indexOf('async function regeneratePictures(id)'),end=source.indexOf('\nfunction englishDuplicateKey',start);
 const block=source.slice(start,end);
 assert.match(block,/const selected=sanitizeClassArt\(item.art\|\|\[\]\)/);
 assert.match(block,/item.artPool=sanitizeSuggestionPool/);
 assert.doesNotMatch(block,/item.art\s*=/);
});