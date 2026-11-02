'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'sefer-hamitzvos/drafts/2026-10-25-week');
const calendar=require('../sefer-hamitzvos/calendar.js'),days=require('../sefer-hamitzvos/schedule.js');
const week=[["2026-10-25","N250",500],["2026-10-26","N250",500],["2026-10-27","N251",501],["2026-10-28","N251",501],["2026-10-29","N253",502],["2026-10-30","N253",502],["2026-10-31","N252",503]];
test('Oct 25-31 2026 schedule and existing card numbers',()=>{
 const map=calendar.cardMap(days);
 for(const [date,ref,card] of week){
  assert.deepEqual(calendar.lesson(date,days).mitzvos,[ref],date);
  assert.equal(map[ref],card,date);
 }
});
test('seven coloring sources use closed paths, white interiors, black outlines and safe dimensions',()=>{
 const unique=new Set();
 for(const [date,ref] of week){
  const file=path.join(dir,date+'-'+ref+'.svg');
  assert.ok(fs.existsSync(file),file);
  const svg=fs.readFileSync(file,'utf8');unique.add(svg);
  assert.match(svg,/<svg[^>]*width="1427" height="950" viewBox="0 0 1200 800"/);
  assert.ok(svg.includes('<rect width="1200" height="800" fill="#fff"/>'));
  assert.doesNotMatch(svg,/<(?:script|image|text|line|polyline|use)\b/i);
  assert.doesNotMatch(svg,/\b(?:href|filter|opacity|gradient|mask)=/i);
  assert.doesNotMatch(svg,/fill="#(?!fff\b)|stroke="#(?!000\b)/i);
  const paths=[...svg.matchAll(/<path d="([^"]+)"/g)].map(m=>m[1]);
  assert.ok(paths.length>10,'insufficient shapes');
  for(const d of paths)assert.match(d,/Z$/,'open path in '+file);
  assert.ok(Buffer.byteLength(svg)<60000,'art too complex');
 }
 assert.equal(unique.size,4,'repeated mitzvos should reuse exactly four scenes');
});
test('new PNG assets are the exact four scenes routed by the existing engine',()=>{
 const html=fs.readFileSync(path.join(root,'sefer-hamitzvos/index.html'),'utf8');
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'sefer-hamitzvos/region-manifest.json'),'utf8'));
 for(const n of [500,501,502,503]){
  const file=path.join(root,'sefer-hamitzvos/coloring-v2',String(n).padStart(3,'0')+'.png');
  assert.ok(fs.existsSync(file),file);assert.ok(fs.statSync(file).size>10000,file+' raster content');
  assert.equal(manifest[n].source,`coloring-v2/${String(n).padStart(3,'0')}.png`);
 }
 assert.match(html,/newArt=new Set\([^)]*500,501,502,503\]\)/);
 assert.match(html,/versionedSaveArt=new Set\([^)]*500,501,502,503\]\)/);
});
