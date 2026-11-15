const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../shorashim/teacher.js'),'utf8');
test('singular Ish / man has its own matching picture cues',()=>{
 const block=source.slice(source.indexOf('const SMART_ART_RULES='),source.indexOf('const SMART_ART_FALLBACK='));
 assert.match(block,/\\bman\\b\|\\bish\\b\|איש/);
 assert.match(block,/\['👤','👔','🧢','🎩','👞'\]/);
 assert.ok(block.indexOf('\\bman\\b')<block.indexOf('\\bmen\\b'));
});
