'use strict';
// Issue: this week's pictures (500-503) used the old section mask, which only
// repaired 2 px of white beside lines, leaving small unpaintable slivers.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createObjectMask,createRegionMask,regionFromObjects}=require('../sefer-hamitzvos/fill.js');
function art(w,h,draw){const data=new Uint8ClampedArray(w*h*4).fill(255);const set=(x,y,v)=>{if(x>=0&&y>=0&&x<w&&y<h){const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=v;}};draw(set);return {data,width:w,height:h};}
const rect=(set,x0,y0,x1,y1,t)=>{for(let x=x0;x<=x1;x++)for(let k=0;k<t;k++){set(x,y0+k,0);set(x,y1-k,0);}for(let y=y0;y<=y1;y++)for(let k=0;k<t;k++){set(x0+k,y,0);set(x1-k,y,0);}};
test('a wide white sliver beside a thin line is painted with its section, not left blank',()=>{
 // A 7px-wide line gap: the old 2px fringe left the middle unpainted.
 const a=art(600,500,set=>{rect(set,0,0,599,499,6);rect(set,150,150,450,350,6);for(let y=156;y<345;y++){set(300,y,0);set(301,y,0);}});
 const m=createObjectMask(a,a.width,a.height,[]);
 const mask={width:m.width,height:m.height,labels:m.labels};
 const left=regionFromObjects(mask,220,250),set=new Set(left.pixels);
 assert.ok(set.has(250*a.width+299),'pixel beside the thin line belongs to the section');
 assert.equal(m.labels[5*a.width+5],0,'open page stays unpainted');
});
test('cards 500-503 now get object sections: same fine sections as before, far fewer unpainted slivers, no leak into the page',()=>{
 for(const card of [500,501,502,503]){
  const png=require('./sefer-hamitzvos-objects-png-helper.cjs');
  const a=png(`sefer-hamitzvos/coloring-v2/${card}.png`),total=a.width*a.height;
  const o=createObjectMask(a,a.width,a.height,[]),legacy=createRegionMask(a,a.width,a.height);
  for(let i=0;i<total;i++)if(o.fine[i]!==legacy.labels[i])assert.fail(`saved-picture sections changed on ${card}`);
  let objPainted=0,legacyPainted=0,big=0;const counts=new Map();
  for(let i=0;i<total;i++){if(o.labels[i]){objPainted++;counts.set(o.labels[i],(counts.get(o.labels[i])||0)+1);}if(legacy.labels[i])legacyPainted++;}
  for(const n of counts.values())if(n>total*.18)big++;
  assert.ok(objPainted>legacyPainted,`card ${card}: more of the picture is paintable`);
  assert.equal(big,0,`card ${card}: no section is page-sized`);
  assert.equal(o.labels[0],0);
 }
});
test('the page no longer special-cases 500-503 to the old mask',()=>{
 assert.ok(!/closedSections/.test(fs.readFileSync('sefer-hamitzvos/index.html','utf8')+fs.readFileSync('sefer-hamitzvos/mask-worker.js','utf8')));
});
