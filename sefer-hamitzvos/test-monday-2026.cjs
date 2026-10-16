'use strict';
/*
 * Monday Oct 19, 2026 — guardrails for the three new coloring pictures.
 * Run from repository root: node sefer-hamitzvos/test-monday-2026.cjs
 * These checks are intentionally offline and do not touch student data.
 */
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const base=__dirname;
const calendar=require('./calendar.js');
const days=require('./schedule.js');
const fill=require('./fill.js');
const expected=[['P225',484],['N295',485],['N292',486]];
const mon=calendar.lesson('2026-10-19',days);
assert.deepEqual(mon.mitzvos,expected.map(([ref])=>ref),'Monday schedule must keep the current alternative ordering');
const cards=calendar.cardMap(days);
const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
for(const [ref,number] of expected){
  assert.equal(cards[ref],number,ref+' mapped to the wrong card');
  const name=String(number)+'.svg';
  const svg=fs.readFileSync(path.join(base,'coloring-v2',name),'utf8');
  assert.match(svg,/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg,/width="1200" height="1200"/);
  assert.match(svg,/<rect[^>]*width="1160"[^>]*height="1160"/);
  assert.ok(svg.endsWith('</g></svg>'),name+' is incomplete');
  assert.ok((svg.match(/<path/g)||[]).length>=15,name+' missing illustrated details');
  assert.equal((svg.match(/<g(?:\s|>)/g)||[]).length,(svg.match(/<\/g>/g)||[]).length,'Group tags unbalanced: '+name);
  assert.ok(!/<(?:script|image|foreignObject)\b/i.test(svg),'Unexpected unsafe or external element: '+name);
}
assert.match(html,/svgArt=new Set\(\[484,485,486\]\)/);
assert.match(html,/svgArt\.has\(num\)\?'\.svg':'\.png'/);
assert.match(html,/legacyV2Keys\.has\(n\)/,'Legacy saved colorings must retain their keys');
assert.match(html,/studentStartDate='2026-10-12'/,'Student history must start October 12');
assert.match(html,/iso<studentStartDate/);
assert.match(html,/selectedDate<=studentStartDate/);
// Test the same closed, bright regions that the coloring SVG assets rely on.
const W=12,H=12,pixels=new Uint8ClampedArray(W*H*4);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const i=(y*W+x)*4,v=(x===1||y===1||x===10||y===10)?0:255;
  pixels[i]=pixels[i+1]=pixels[i+2]=v;pixels[i+3]=255;
}
assert.ok(fill.traceRegion({data:pixels},W,H,5,5).pixels?.length>0,'Enclosed white regions should be fillable');
assert.equal(fill.traceRegion({data:pixels},W,H,0,0).reason,'open','Open areas should not fill');
console.log('PASS: Monday image mapping, vector assets, saved coloring keys, October 12 date floor, fill-region basics');
