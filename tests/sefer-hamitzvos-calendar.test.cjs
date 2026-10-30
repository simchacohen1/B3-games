const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const calendar=require('../sefer-hamitzvos/calendar.js'),days=require('../sefer-hamitzvos/schedule.js'),sun=require('../sefer-hamitzvos/sun-times.js');
test('verified yesterday, today and tomorrow use the correct daily mitzvos and cards',()=>{
 const map=calendar.cardMap(days);
 for(const [date,day,ref,card] of [['2026-10-11',251,'N247',475],['2026-10-12',252,'N265',476],['2026-10-13',253,'N266',477]]){
  const result=calendar.lesson(date,days);assert.equal(result.day,day);assert.deepEqual(result.mitzvos,[ref]);assert.equal(map[ref],card);
 }
 assert.equal(calendar.hebrewDate('2026-10-12'),'1 Cheshvan 5787');
 assert.equal(calendar.hebrewDate('2026-10-11'),'30 Tishrei 5787');
});
test('all 613 mitzvos map once, repeats reuse cards, and multi-mitzvah days retain every item',()=>{
 const map=calendar.cardMap(days);assert.equal(Object.keys(map).length,613);assert.equal(new Set(Object.values(map)).size,613);
 assert.deepEqual(calendar.lesson('2026-10-16',days).mitzvos,calendar.lesson('2026-10-17',days).mitzvos);
 assert.deepEqual(calendar.lesson('2026-10-18',days).mitzvos,['P236','N289','N295']);
 assert.deepEqual(calendar.lesson('2026-02-07',days).mitzvos,['P1','N1','P2']);
});
test('calendar shifts across Hebrew month, civil year, leap day and both DST changes',()=>{
 for(const date of ['2026-10-11','2026-12-31','2028-02-28','2026-03-08','2026-11-01'])assert.equal(calendar.shift(calendar.shift(date,1),-1),date);
 assert.equal(calendar.shift('2026-12-31',1),'2027-01-01');assert.equal(calendar.shift('2028-02-28',1),'2028-02-29');
});
test('Hebrew today advances at sunset, not midnight, and is independent of viewer timezone',()=>{
 const sunset=sun.getTimes(new Date('2026-10-12T12:00:00Z'),41.2626,-75.8969).sunset;
 assert.equal(calendar.studyToday(new Date(sunset.getTime()-1),sun),'2026-10-12');
 assert.equal(calendar.studyToday(sunset,sun),'2026-10-13');
 assert.equal(calendar.studyToday(new Date('2026-10-13T02:00:00Z'),sun),'2026-10-13');
 assert.equal(calendar.studyToday(new Date('2026-10-13T05:00:00Z'),sun),'2026-10-13');
});
test('cycle rollover shows introductory lessons without selecting an unrelated coloring card',()=>{
 assert.equal(calendar.lesson('2027-01-07',days).day,339);
 const next=calendar.lesson('2027-01-08',days);assert.equal(next.day,1);assert.deepEqual(next.mitzvos,[]);
 assert.equal(calendar.lesson('2027-01-12',days).day,5);
});
test('date navigation selects daily cards, can return to Today, and makes every assigned mitzvah selectable',()=>{
 const els=new Map(),storage=new Map();
 function el(){return {style:{},dataset:{},classList:{toggle(){},add(){},remove(){}},setAttribute(){},appendChild(child){this.children.push(child);},replaceChildren(){this.children=[];},children:[],addEventListener(){},getContext(){return {clearRect(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}}}};}
 const document={getElementById(id){if(!els.has(id))els.set(id,el());return els.get(id);},querySelectorAll(){return els.get('dayCards')?.children||[];},createElement:el};
 const storageApi={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-10-12T14:00:00Z']));}};
 const ctx={document,window:{addEventListener(){},FTTMitzvahCalendar:calendar,FTT_MITZVAH_DAYS:days,FTTSunTimes:sun,B3SiteSettings:{onAuthStateChanged(callback){callback({uid:"teacher"},true,{role:"teacher",authorized:true});}}},sessionStorage:storageApi,localStorage:storageApi,location:{search:''},URLSearchParams,Date:FixedDate,Intl,confirm:()=>false,setInterval(){},setTimeout(fn){fn();return 1;},clearTimeout(){}};
 const html=fs.readFileSync('sefer-hamitzvos/index.html','utf8');const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];vm.runInNewContext(source,ctx);
 assert.equal(els.get('outline').src,'coloring-v2/476.png?v=20261016-october');
 els.get('yesterday').onclick();assert.equal(els.get('outline').src,'coloring-v2/475.png?v=20261016-october');
 els.get('tomorrow').onclick();els.get('tomorrow').onclick();assert.equal(els.get('outline').src,'coloring-v2/477.png?v=20261016-october');
 els.get('today').onclick();assert.equal(els.get('outline').src,'coloring-v2/476.png?v=20261016-october');
 for(let i=0;i<2;i++)els.get('tomorrow').onclick();assert.equal(els.get('outline').src,'coloring-v2/478.png?v=20261016-october');
 els.get('tomorrow').onclick();assert.equal(els.get('dayCards').children.length,2);assert.equal(els.get('outline').src,'coloring-v2/479.png?v=20261016-october');
 els.get('dayCards').children[1].onclick();assert.equal(els.get('outline').src,'coloring-v2/480.png?v=20261016-october');
 els.get('tomorrow').onclick();assert.equal(els.get('outline').src,'coloring-v2/481.png?v=20261016-october');
 els.get('tomorrow').onclick();assert.equal(els.get('outline').src,'coloring-v2/481.png?v=20261016-october');
 els.get('tomorrow').onclick();assert.equal(els.get('dayCards').children.length,3);
 els.get('dayCards').children[2].onclick();assert.equal(Number(els.get('card').value),calendar.cardMap(days).N295);
 assert.match(html,/mix-blend-mode:multiply/);assert.match(source,/globalCompositeOperation='multiply'/);
 assert.match(html,/game-gate.js(?:\?[^\"]*)?" data-game-id="sefer-hamitzvos"/);
});

test('mitzvah artwork comes before tools and Hebrew phrases keep correct mitzvah numbers',()=>{
 const html=fs.readFileSync('sefer-hamitzvos/index.html','utf8');
 assert.ok(html.indexOf('id="workspace"')<html.indexOf('id="colorControls"'),'artwork should be shown before the tools');
 assert.match(html,/N265:'לא תחמוד'/);
 assert.match(html,/N266:'לא תתאוה'/);
 assert.match(html,/P225:'גלות'/);
 assert.match(html,/const refLabel=ref=>.*Lo Saaseh /);
});

test('October 19–23 cards map to their verified mitzvos and new coloring pages',()=>{
 const map=calendar.cardMap(days);
 const expected=[
  ['2026-10-18',['P236','N289','N295'],[481,482,485]],
  ['2026-10-19',['P225','N296','N292'],[484,483,486]],
  ['2026-10-20',['P247','N293','N297','P182'],[487,488,489,490]],
  ['2026-10-21',['P181','N309','N298','P184'],[491,492,493,494]],
  ['2026-10-22',['N299','P202','P203','N270'],[495,496,497,498]],
  ['2026-10-23',['P245'],[499]],
 ];
 for(const [date,refs,cards] of expected){
  const lesson=calendar.lesson(date,days);assert.deepEqual(lesson.mitzvos,refs,date);
  assert.deepEqual(refs.map(ref=>map[ref]),cards,date);
  for(const card of cards){
   const filename='sefer-hamitzvos/coloring-v2/'+String(card).padStart(3,'0')+'.png';
   const image=fs.readFileSync(filename);
   assert.equal(image.subarray(0,8).toString('hex'),'89504e470d0a1a0a',filename+' PNG signature');
   assert.ok(image.readUInt32BE(16)>=1000,filename+' width');
   assert.ok(image.readUInt32BE(20)>=750,filename+' height');
   assert.ok(image.includes(Buffer.from('IDAT')),filename+' image data');
  }
 }
});

test('new October artwork has isolated coloring keys and cloud save paths',()=>{
 const html=fs.readFileSync('sefer-hamitzvos/index.html','utf8');
 assert.match(html,/newArt=new Set\(\[475,476,477,478,479,480,481,482,483,484,485,486,487,488,489,490,491,492,493,494,495,496,497,498,499,500,501,502,503\]\)/);
 assert.match(html,/versionedSaveArt=new Set\(\[482,483,484,485,486,487,488,489,490,491,492,493,494,495,496,497,498,499,500,501,502,503\]\)/);
 const savePathSource=html.match(/function studentCardPath\(card\)\{[^}]+\}/)[0];
 const savePath=vm.runInNewContext('('+savePathSource+')',{sessionStorage:{getItem:key=>key==='b3Games_studentId'?'student-1':null},versionedSaveArt:new Set(Array.from({length:22},(_,i)=>i+482)),replacementArt:new Set([502,503]),useNextWeekArt:()=>false});
 assert.equal(savePath(481),'b3Games/students/student-1/seferHamitzvos/coloring/481');
 assert.equal(savePath(482),'b3Games/students/student-1/seferHamitzvos/coloring/482-v2');
 assert.equal(savePath(499),'b3Games/students/student-1/seferHamitzvos/coloring/499-v2');
 assert.equal(savePath(500),'b3Games/students/student-1/seferHamitzvos/coloring/500-approved-20261025');
 assert.equal(savePath(501),'b3Games/students/student-1/seferHamitzvos/coloring/501-approved-20261025');
 assert.equal(savePath(502),'b3Games/students/student-1/seferHamitzvos/coloring/502-replacement-20261026');
 assert.equal(savePath(503),'b3Games/students/student-1/seferHamitzvos/coloring/503-replacement-20261026');
 assert.match(html,/20261016-october/);
 assert.match(html,/20261025-week/);
});
