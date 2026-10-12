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
 assert.deepEqual(calendar.lesson('2026-10-18',days).mitzvos,['P236','N289','N296']);
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
 function el(){return {style:{},dataset:{},classList:{toggle(){}},setAttribute(){},appendChild(child){this.children.push(child);},replaceChildren(){this.children=[];},children:[],addEventListener(){},getContext(){return {clearRect(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}}}};}
 const document={getElementById(id){if(!els.has(id))els.set(id,el());return els.get(id);},querySelectorAll(){return els.get('dayCards')?.children||[];},createElement:el};
 const storageApi={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-10-12T14:00:00Z']));}};
 const ctx={document,window:{FTTMitzvahCalendar:calendar,FTT_MITZVAH_DAYS:days,FTTSunTimes:sun},sessionStorage:storageApi,localStorage:storageApi,location:{search:''},URLSearchParams,Date:FixedDate,Intl,confirm:()=>false,setInterval(){}};
 const html=fs.readFileSync('sefer-hamitzvos/index.html','utf8');const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];vm.runInNewContext(source,ctx);
 assert.equal(els.get('outline').src,'coloring-v2/476.png?v=20261012-full');
 els.get('yesterday').onclick();assert.equal(els.get('outline').src,'coloring-v2/475.png?v=20261012-full');
 els.get('tomorrow').onclick();els.get('tomorrow').onclick();assert.equal(els.get('outline').src,'coloring-v2/477.png?v=20261012-full');
 els.get('today').onclick();assert.equal(els.get('outline').src,'coloring-v2/476.png?v=20261012-full');
 for(let i=0;i<6;i++)els.get('tomorrow').onclick();assert.equal(els.get('dayCards').children.length,3);
 els.get('dayCards').children[2].onclick();assert.equal(Number(els.get('card').value),calendar.cardMap(days).N296);
 assert.match(html,/mix-blend-mode:multiply/);assert.match(source,/globalCompositeOperation='multiply'/);
 assert.match(html,/game-gate.js" data-game-id="sefer-hamitzvos"/);
});
