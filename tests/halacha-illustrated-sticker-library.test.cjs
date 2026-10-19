'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const editor=fs.readFileSync('halacha/scrapbook-editor.js','utf8');
const css=fs.readFileSync('halacha/scrapbook-editor.css','utf8');
const html=fs.readFileSync('halacha/index.html','utf8');
const art=fs.readFileSync('halacha/illustrated-siman-a-extra.js','utf8');
const all=['bed-window','book','boy-walking','globe','heart','house','lamp','shtender','speech','table-chair','thought','toybox'];
test('all illustrated picture stickers are available from every lesson, on chosen page',()=>{
 new vm.Script(editor);
 for(const name of all){
  assert.match(editor,new RegExp("'"+name+"'"));
  assert.ok(fs.statSync('halacha/art/stickers/'+name+'.jpg').size>4000,'missing '+name);
 }
 assert.match(editor,/const stickerKeys=stickerPacks\[id\]/);
 assert.match(editor,/halachaPictureStickers\.map/);
 assert.match(editor,/window\.studioPictureSticker=\(id,key\)=>/);
 assert.match(editor,/const target=window\.studioTarget\(id\)/);
 assert.match(editor,/add\(id,'photo',[^\n]+,target\)/);
 assert.match(editor,/persist\(id\)/);
 assert.match(editor,/sticker(s)?\.querySelectorAll\('\[data-illustrated-sticker\]'\)/);
 assert.match(editor,/readonly\(\)/);
 assert.match(css,/\.studio-picture-library/);
 assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});
test('new gallery remains optional: no automatic new pieces seeded into existing student pages',()=>{
 assert.match(editor,/const target=window\.studioTarget\(id\)/);
 assert.match(editor,/sticker(s)?\.querySelectorAll\('\[data-illustrated-sticker\]'\)/);
 assert.match(editor,/b\.addEventListener\('click'/);
 assert.match(editor,/halachaPictureLookup\.has\(key\)/);
 assert.match(editor,/if\(readonly\(\)\|\|!halachaPictureLookup\.has\(key\)\)return/);
});
test('corrected images are present and cache versions force a fresh download',()=>{
 for(const f of ['modeh-ani','four-middos'])assert.ok(fs.statSync('halacha/art/seifim/'+f+'.jpg').size>20000);
 assert.match(art,/const cache='\?v=20261019-two-fixed-pictures5'/);
 assert.match(html,/illustrated-siman-a-extra\.js\?v=20261019-two-fixed-pictures5/);
 assert.match(html,/scrapbook-editor\.js\?v=20261019-all-stickers1/);
 assert.match(html,/scrapbook-editor\.css\?v=20261019-all-stickers1/);
});
