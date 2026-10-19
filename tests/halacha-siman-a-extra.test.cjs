'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync('halacha/siman-a-extra-source.js','utf8');
const ui=fs.readFileSync('halacha/siman-a-extra-guided.js','utf8');
const html=fs.readFileSync('halacha/index.html','utf8');
test('complete teacher-provided original Seif Beis through Zayin remain distinct and vowelized',()=>{
 const window={};vm.runInNewContext(src,{window});
 const text=window.HalachaSimanAExtraSource;
 assert.equal(text.length,6);
 assert.ok(text.every(x=>x.length>90));
 assert.match(text[0],/^וְגַם בְּשָׁכְבוֹ/);
 assert.match(text[1],/^יְהוּדָה בֶן תֵּימָא/);
 assert.match(text[2],/^לָכֵן צָרִיךְ/);
 assert.match(text[3],/^אִם אֶפְשָׁר/);
 assert.match(text[4],/^מִזְמוֹרֵי תְהִלִּים/);
 assert.match(text[5],/^יֵשׁ לִמְחוֹת/);
 assert.match(text[5],/בְּלֹא שֵׁם/);
 assert.match(text[3],/לְהִתְפַּלֵּל עִם הַצִּבּוּר/);
});
test('new Seif Vav and Zayin lessons preserve supplementary Niggel Vasser lesson identity',()=>{
 assert.match(html,/"id":"a6"/);
 assert.match(html,/"id":"a7"/);
 assert.match(html,/id:"f",tab:"💧 נעגל וואסער · extra lesson"/);
 assert.match(html,/siman-a-extra-source\.js\?v=20261019-seif2to7/);
 assert.match(html,/siman-a-extra-guided\.js\?v=20261019-seif2to7/);
});
test('student activity retains full text collapsed while highlighting phrases in the original source',()=>{
 new vm.Script(ui);
 assert.match(ui,/const reading=mk\('details','hal-b-seif-source'\)/);
 assert.match(ui,/src\[config\.no-2\]/);
 assert.match(ui,/const m=mk\('mark','hal-b-source-highlight'/);
 assert.match(ui,/reading\.open=true/);
 assert.match(ui,/window\.persist\(id\)/);
 assert.match(ui,/add\.disabled=readonly\(\)/);
 assert.match(ui,/b:\{no:2/);
 assert.match(ui,/c:\{no:3/);
 assert.match(ui,/d:\{no:4/);
 assert.match(ui,/e:\{no:5/);
 assert.match(ui,/a6:\{no:6/);
 assert.match(ui,/a7:\{no:7/);
});

test('Siman Aleph has seven ordered, consecutively numbered Seifim and an unnumbered washing extra',()=>{
 const sequence=['a','b','c','d','e','a6','a7','f'];
 assert.match(html,/HALACHA_SEIF_A_SEQUENCE=new Map\(\["a","b","c","d","e","a6","a7","f"\]/);
 const tabs=Object.fromEntries((html.match(/(?:id:"[a-f]"|"id":"a[67]").*?(?:tab:"[^"]+"|"tab":"[^"]+")/g)||[]).map(x=>{
  const id=(x.match(/id:"([a-z][0-9]?)"/)||[])[1],label=(x.match(/tab:"([^"]+)"/)||[])[1];return[id,label];
 }));
 assert.deepEqual(sequence.slice(0,7).length,7);
 assert.match(html,/"tab":"6 · תהלים בעל פה"/);
 assert.match(html,/"tab":"7 · שומע תפילה"/);
 assert.match(html,/tab:"💧 נעגל וואסער · extra lesson"/);
});
test('Hebrew teaching material and artwork appear right to left, and starter never clears existing pieces',()=>{
 const artwork=fs.readFileSync('halacha/illustrated-siman-a-extra.js','utf8');
 const css=fs.readFileSync('halacha/illustrated-siman-a-extra.css','utf8');
 new vm.Script(artwork);
 assert.match(artwork,/grid\.dir='rtl'/);
 assert.match(artwork,/Object\.keys\(packs\)\.forEach\(install\)/);
 for(const seif of ['b','c','d','e','a6','a7','f'])assert.ok(artwork.includes(seif+':{title:'),seif+' should have illustrated lesson artwork');
 assert.match(artwork,/const hasPieces=pages\.some/);
 assert.match(artwork,/if\(hasPieces&&!confirm/);
 assert.match(artwork,/window\.persist/);
 assert.doesNotMatch(artwork,/resetScrapbookPage|localStorage\.clear|delete S\[/);
 assert.match(css,/\.hal-b-phrases[^}]*direction:rtl/);
 assert.match(css,/\.matchgrid\.m4\{direction:rtl/);
 assert.match(html,/id=seqout class="dropzone hal-hebrew-order" dir=rtl lang=he/);
 assert.match(html,/class="matchgrid m4" dir="rtl" lang="he"/);
});
