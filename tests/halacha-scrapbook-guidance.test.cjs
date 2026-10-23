'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('halacha/scrapbook-guidance.js','utf8').replace(/\r\n/g,'\n');
const style=fs.readFileSync('halacha/scrapbook-guidance.css','utf8');
const page=fs.readFileSync('halacha/index.html','utf8');
const ids=[...page.matchAll(/\{(?:"id"|id):"([^"]+)"[^}]*?(?:"title"|title):"([^"]+)"/g)].map(x=>x[1]);
const titleSet=JSON.parse(source.slice(source.indexOf('const titles=')+13,source.indexOf(';\nconst cooldown')));
test('all existing 34 lessons have five distinct source-appropriate title suggestions',()=>{
 new vm.Script(source);
 assert.equal(ids.length,34);
 assert.equal(Object.keys(titleSet).length,34);
 for(const id of ids){
  assert.ok(Array.isArray(titleSet[id]),id+' missing titles');
  assert.equal(titleSet[id].length,5,id+' needs 5 titles');
  assert.equal(new Set(titleSet[id]).size,5,id+' duplicates');
 }
 assert.notDeepEqual(titleSet.a,titleSet.b);
 assert.notDeepEqual(titleSet.c,titleSet.d);
 assert.notDeepEqual(titleSet.s2a,titleSet.s3a);
 assert.match(titleSet.a.join(' '),/Shivisi/);
 assert.match(titleSet.s6g.join(' '),/Hundred|100/);
});
test('uses selected scrapbook page, edit-friendly existing add/persist, escape + cooldown',()=>{
 assert.match(source,/const page=pageNumber\(id\)/);
 assert.match(source,/window\.add\(id,'textbox',markup,page\)/);
 assert.match(source,/window\.persist\(id\)/);
 assert.match(source,/data-ph="Edit your title"/);
 assert.match(source,/const key=id\+'\|'\+page/);
 assert.match(source,/now-\(cooldown\.get\(key\)\|\|0\)<950/);
 assert.match(source,/String\(value\|\|''\)\.trim\(\)\.slice\(0,90\)/);
 assert.match(source,/const readonly=/);
 assert.match(source,/if\(readonly\(\)\|\|typeof window\.add!==/);
 assert.match(source,/if\(!title\)return false/);
});
test('renders for each lesson after cloud reload, no auto-title insertion or overwrite',()=>{
 assert.match(source,/const oldRender=render/);
 assert.match(source,/render=function\(lesson\)/);
 assert.match(source,/lessons\.forEach\(lesson=>install\(lesson\.id\)\)/);
 assert.match(source,/area\.open=true/);
 assert.match(source,/pageSelector\.addEventListener\('change'/);
 assert.match(source,/b\.addEventListener\('click'/);
 assert.match(source,/field\.addEventListener\('keydown'/);
 assert.match(source,/install\(id\)/);
 assert.match(page,/scrapbook-guidance\.js\?v=20261019-guided1/);
 assert.match(page,/scrapbook-guidance\.css\?v=20261019-guided1/);
 assert.match(style,/\.hal-title-guidance/);
 assert.match(style,/\.section#a \.hal-a-prompts\{display:none!important\}/);
});
