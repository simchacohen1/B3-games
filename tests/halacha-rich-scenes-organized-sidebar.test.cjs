'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('halacha/index.html','utf8');
const scenes=fs.readFileSync('halacha/illustrated-siman-a-extra.js','utf8');
const organizer=fs.readFileSync('halacha/studio-sidebar-organizer.js','utf8');
const css=fs.readFileSync('halacha/studio-sidebar-organizer.css','utf8');
test('all six later seifim display five real scene pictures, with no broken referenced images',()=>{
 new vm.Script(scenes); new vm.Script(organizer);
 const dataBlock=scenes.slice(scenes.indexOf('const data={'),scenes.indexOf('const photos='));
 assert.equal((dataBlock.match(/scenes:\[/g)||[]).length,6);
 const ids=['b','c','d','e','a6','a7'];
 for(const id of ids) assert.match(dataBlock,new RegExp('(?:^|\\n) '+id+':\\{file:'));
 assert.match(scenes,/config\.scenes\.map/);
 assert.match(scenes,/const gallery=make\('div','hal-extra-scene-grid'\)/);
 assert.match(scenes,/button\('＋ Picture'/);
 assert.match(scenes,/button\('＋ Words'/);
 assert.match(scenes,/window\.studioTarget\(id\)/);
 const allAssets=['alone','speaking','helping','walking','learning'];
 for(const name of allAssets) assert.ok(fs.statSync('halacha/art/scenes/'+name+'.jpg').size>20000);
 for(const name of ['modeh-ani','four-middos','zerizus','night-learning','tehillim','shomea-tefillah'])
   assert.ok(fs.statSync('halacha/art/seifim/'+name+'.jpg').size>20000);
});
test('left-side supplies have keyboard-accessible short tabs and preserve saved artworks',()=>{
 for(const name of ['pictures','words','styles','lesson'])
   assert.ok(organizer.includes("['"+name+"',"),name);
 assert.match(organizer,/setAttribute\('role', 'tablist'\)/);
 assert.match(organizer,/setAttribute\('role', 'tabpanel'\)/);
 assert.match(organizer,/setAttribute\('aria-selected', String\(selected\)\)/);
 assert.match(organizer,/lastTab\.get\(id\)/);
 assert.match(organizer,/previousRender\(lesson\)/);
 assert.match(organizer,/studio-picture-library/);
 // Title suggestions stay in the visible sidebar even when Pictures is active.
 assert.match(organizer,/titleIdeas = side.querySelector\(':scope > \.hal-title-guidance'\)/);
 assert.match(organizer,/titleIdeas\.open = true/);
 assert.match(organizer,/new Set\(\[header, intro, actions, titleIdeas, quickStep, tabs, holder\]\)/);
 assert.doesNotMatch(organizer,/panes\.words\.appendChild\(el\);\s*\} else if \(el.matches\('\.lesson-vocab'\)\)/);
 assert.match(html,/studio-sidebar-organizer\.js\?v=20261019-title-ideas-restored1/);
 assert.match(css,/\.studio-shelf-pane\[hidden\]\{display:none!important\}/);
 assert.doesNotMatch(organizer,/resetScrapbookPage|localStorage\.clear|removeItem|S\[/);
 assert.match(html,/studio-sidebar-organizer\.js\?v=20261019-organized2/);
 assert.match(html,/studio-sidebar-organizer\.css\?v=20261019-organized2/);
 assert.match(html,/illustrated-siman-a-extra\.js\?v=20261019-two-fixed-pictures5-gallery6/);
});
