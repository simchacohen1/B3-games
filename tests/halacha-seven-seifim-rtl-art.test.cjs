'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('halacha/index.html','utf8');
const aleph=fs.readFileSync('halacha/seif-a-teacher-led.js','utf8');
const art=fs.readFileSync('halacha/illustrated-seif-a.js','utf8');
const gallery=fs.readFileSync('halacha/illustrated-siman-a-extra.js','utf8');
const rtl=fs.readFileSync('halacha/siman-b-guided.css','utf8');
const extra=fs.readFileSync('halacha/siman-a-extra-guided.js','utf8');

test('seven actual Kitzur seifim appear in the correct order without an eighth',()=>{
 assert.match(html,/HALACHA_SEIF_A_SEQUENCE=new Map\(\["a","b","c","d","e","a6","a7"\]/);
 assert.doesNotMatch(html,/HALACHA_SEIF_A_SEQUENCE=new Map\([^)]*,"f"/);
 assert.match(html,/id:"f",siman:"ב",tab:"💧 נעגל וואסער · תרגול"/);
 assert.match(html,/"id":"a6","siman":"א","tab":"6 · תהלים בעל פה"/);
 assert.match(html,/"id":"a7","siman":"א","tab":"7 · שומע תפילה"/);
 assert.match(html,/const HALACHA_LOCAL_KEY="halachaV14"/);
 assert.match(html,/S\[id\+"_scrap_pages"\]/);
});
test('Shivisi restores gallery at top and never remembers stale hidden state',()=>{
 assert.doesNotMatch(aleph,/sessionStorage\.getItem\(\x60halacha-learning-hidden/);
 assert.doesNotMatch(aleph,/sessionStorage\.setItem\('halacha-learning-hidden/);
 assert.match(art,/lessonBody\.insertBefore\(gallery, lessonBody\.firstChild\)/);
 assert.match(html,/seif-a-teacher-led\.js\?v=20261019-shivisi-visible2/);
});
test('Hebrew phrases and matching cards read right to left',()=>{
 assert.match(rtl,/\.hal-b-phrases\{direction:rtl\}/);
 assert.match(rtl,/section#b \.hal-b-phrases/);
 assert.match(rtl,/section#c \.hal-b-phrases/);
 assert.match(extra,/b:\{no:2/);
 assert.match(extra,/c:\{no:3/);
 assert.match(extra,/\['מוֹדֶה אֲנִי לְפָנֶיךָ'/);
 assert.match(extra,/\['עַז כַּנָּמֵר'/);
});
test('all six other seifim have distinct professional picture and sticker actions',()=>{
 new vm.Script(gallery);
 for(const key of ['modeh-ani','four-middos','zerizus','night-learning','tehillim','shomea-tefillah']){
  assert.ok(gallery.includes("file:'"+key+"'"),'missing art '+key);
  assert.ok(fs.statSync('halacha/art/seifim/'+key+'.jpg').size>10000,'missing image bytes '+key);
 }
 assert.match(gallery,/window\.add\(id,'photo'/);
 assert.match(gallery,/window\.persist\(id\)/);
 assert.match(gallery,/readonly\(\)/);
 assert.match(html,/illustrated-siman-a-extra\.js\?v=20261019-alef-scenes2/);
 assert.match(html,/illustrated-siman-a-extra\.css\?v=20261019-alef-scenes2/);
});
