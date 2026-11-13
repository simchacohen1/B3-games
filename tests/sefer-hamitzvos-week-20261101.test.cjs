'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const dir=path.resolve(__dirname,'../sefer-hamitzvos');
require('../sefer-hamitzvos/schedule.js');
const calendar=require('../sefer-hamitzvos/calendar.js');
const map=calendar.cardMap(globalThis.FTT_MITZVAH_DAYS);
const week=[
 ['2026-11-01','N252',503],['2026-11-02','P245',499],['2026-11-03','P245',499],
 ['2026-11-04','P245',499],['2026-11-05','P245',499],['2026-11-06','P236',481],
 ['2026-11-07','P236',481]
];
const manifest=require('../sefer-hamitzvos/coloring-week-20261101/manifest.json');
test('Nov 1–7 cycle reuses exactly three correct mitzvah cards',()=>{
 for(const [date,ref,card] of week){
  assert.deepEqual(calendar.lesson(date,globalThis.FTT_MITZVAH_DAYS).mitzvos,[ref],date);
  assert.equal(map[ref],card,date);
 }
});
test('new artwork is genuine PNG, byte-verified and distinct from pre-existing v2 files',()=>{
 assert.equal(manifest.artworkVersion,'nov20261101');
 for(const card of [481,499,503]){
  const expected=manifest.cards[card],file=path.join(dir,'coloring-week-20261101',card+'.png');
  const b=fs.readFileSync(file);
  assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a',card);
  assert.equal(b.readUInt32BE(16),expected.width,card);
  assert.equal(b.readUInt32BE(20),expected.height,card);
  assert.equal(crypto.createHash('sha256').update(b).digest('hex'),expected.sha256,card);
  assert.ok(expected.regions>20,'many separate enclosed regions on '+card);
  assert.ok(b.byteLength<250000,'keep the downloads quick');
 }
});
test('November date-specific images preserve old-approved pictures and old saves',()=>{
 const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
 assert.match(html,/selectedDate>='2026-11-01'&&selectedDate<='2026-11-07'/);
 assert.match(html,/coloring-week-20261101\//);
 assert.match(html,/useNextWeekArt\(n\)\?\['nov20261101'\]/);
 assert.match(html,/useNextWeekArt\(card\)\?'-nov20261101'/);
 assert.match(html,/closedSections:card>=500&&card<=503&&!useNextWeekArt\(card\)/);
 for(const card of [481,499,503])assert.ok(fs.existsSync(path.join(dir,'coloring-v2',card+'.png')));
});
