const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const M=require('../shorashim/mastery-core.js');
const read=f=>fs.readFileSync(path.join(__dirname,'..','shorashim',f),'utf8');

test('recordPractice counts per word and stage without touching cards',()=>{
  const s={cards:{'shorashim:a':{learnedAt:5,design:{x:1}}}};
  assert.equal(M.recordPractice(s,'shorashim:a','trace',100),1);
  assert.equal(M.recordPractice(s,'shorashim:a','trace',200),2);
  assert.equal(M.recordPractice(s,'shorashim:a','bogus'),0);
  assert.deepEqual(s.cards['shorashim:a'],{learnedAt:5,design:{x:1}});
  assert.equal(M.countFor(s,'shorashim:a','trace'),2);
  assert.equal(M.countFor(s,'shorashim:a','learned'),1,'learned comes from the existing card');
  assert.equal(M.countFor({cards:{k:{reviewCount:4}},practice:{k:{review:2}}},'k','review'),4,'review comes from the per-word counter of review cycles (#962)');
});

test('same spelling in several lists is one row; same letters different vowels merge only with the same meaning',()=>{
  const items=[
    {key:'shorashim:1',front:'רָאָה',english:'saw',list:'Perek 18'},
    {key:'shorashim:2',front:'רָאָה',english:'saw',list:'Booklet'},
    {key:'shorashim:3',front:'רָאֹה',english:'to see',list:'Other'},     // same letters+vowels differ, meaning differs -> flag
    {key:'shorashim:4',front:'יָשַׁב',english:'sat / dwelled',list:'A'},
    {key:'shorashim:5',front:'יֶשֶׁב',english:'dwelled',list:'B'},        // different vowels, same meaning -> merged
    {key:'prefix:6',front:'רָאָה',english:'saw',list:'Prefixes'}          // other track never merges
  ];
  const g=M.groupWords(items);
  const saw=g.find(x=>x.keys.includes('shorashim:1'));
  assert.deepEqual(saw.keys,['shorashim:1','shorashim:2']);
  assert.deepEqual(saw.lists,['Perek 18','Booklet']);
  assert.ok(saw.flags.some(f=>/different vowels/.test(f)),'possible duplicate is flagged');
  assert.ok(g.find(x=>x.keys.includes('shorashim:3')).flags.length);
  const sat=g.find(x=>x.keys.includes('shorashim:4'));
  assert.deepEqual(sat.keys,['shorashim:4','shorashim:5']);
  assert.equal(sat.flags.length,0);
  assert.equal(g.find(x=>x.keys.includes('prefix:6')).keys.length,1);
  assert.equal(g.length,4);
  assert.deepEqual(M.groupWords([{key:'shorashim:a',front:'אָמַר',english:'Said'},{key:'shorashim:b',front:'אָמַר',english:'said'}])[0].englishAll,['Said'],'same English in another case is shown once');
});

test('same spelling with different meanings stays one row but is flagged',()=>{
  const g=M.groupWords([{key:'shorashim:1',front:'מִי',english:'who'},{key:'shorashim:2',front:'מִי',english:'water'}]);
  assert.equal(g.length,1);assert.ok(g[0].flags[0].includes('different meanings'));
});

test('per-boy summary: mastered needs learned+tracing+multiple choice+matching; not started means nothing done',()=>{
  const groups=M.groupWords([1,2,3].map(n=>({key:'shorashim:w'+n,front:'א'.repeat(n),english:'e'+n})));
  const rec={cards:{'shorashim:w1':{learnedAt:1},'shorashim:w2':{learnedAt:1}},practice:{'shorashim:w1':{trace:1,mc:3,match:1,g_race:2},'shorashim:w2':{trace:1}}};
  const s=M.summarizeStudent(rec,groups);
  assert.deepEqual([s.words,s.mastered,s.started,s.notStarted],[3,1,2,1]);
  assert.equal(s.stages.trace,2);assert.equal(s.stages.g_race,1);
});

test('stage filter modes',()=>{
  const g=M.groupWords([{key:'shorashim:w',front:'א',english:'e'}])[0];
  const a={practice:{'shorashim:w':{mc:1}}},b={};
  assert.ok(M.stagePasses([a],g,'mc','done'));assert.ok(!M.stagePasses([a,b],g,'mc','done'));
  assert.ok(M.stagePasses([a,b],g,'mc','notdone'));assert.ok(M.stagePasses([b],g,'mc','none'));assert.ok(!M.stagePasses([a],g,'mc','none'));
  assert.ok(M.stagePasses([a,b],g,'',  'done'),'no stage chosen means no filtering');
});

test('tracing: counted only when every letter is covered and the strokes stay on the letters',()=>{
  const N=100,mk=(a,b)=>{const m=new Uint8Array(N);for(let i=a;i<b;i++)m[i]=1;return m;};
  const letters=[mk(0,30),mk(40,70)],tol=mk(0,75);const tolTight=mk(0,40);
  const half=M.traceProgress(letters,mk(0,30),tol);
  assert.deepEqual(half.done,[true,false]);assert.equal(half.complete,false);
  const full=new Uint8Array(N);for(let i=0;i<30;i++)full[i]=1;for(let i=40;i<70;i++)full[i]=1;
  assert.equal(M.traceProgress(letters,full,tol).complete,true);
  const scribble=new Uint8Array(N).fill(1);
  const sc=M.traceProgress(letters,scribble,tolTight);
  assert.equal(sc.scribbled,true);assert.equal(sc.complete,false,'covering everything is not tracing');
});

test('multiple choice: 4 distinct English choices, exactly one correct, picture slot per choice',()=>{
  const pool=['saw','sat','ran','said','sat '].map((e,i)=>({key:'k'+i,english:e}));
  const c=M.buildChoices(pool[0],pool,4,()=>0.3,w=>w.key==='k0'?'pic.png':null);
  assert.equal(c.length,4);assert.equal(c.filter(x=>x.correct).length,1);
  assert.equal(new Set(c.map(x=>x.text.trim())).size,4,'no duplicate meanings');
  assert.equal(c.find(x=>x.correct).picture,'pic.png');
  assert.ok(c.every(x=>'picture' in x));
});

test('wiring: student app records every activity and game; dashboard tab exists',()=>{
  const app=read('app.js'),idx=read('index.html'),pa=read('practice-activities.js'),th=read('teacher.html'),tj=read('teacher.js');
  ['learned','g_match','g_shoot','g_whack','g_race'].forEach(id=>assert.ok(app.includes(`recordPractice(`)&&app.includes(`'${id}'`),id));
  ['trace','mc','match'].forEach(id=>assert.ok(pa.includes(`recordPractice(`)&&pa.includes(`'${id}'`),id));
  assert.ok(app.includes("s.practice=s.practice&&typeof s.practice==='object'?s.practice:{}"));
  assert.ok(idx.indexOf('mastery-core.js')<idx.indexOf('app.js?v='));assert.ok(idx.includes('data-practice="trace"'));
  assert.ok(pa.includes('data-speak'),'English has a read-aloud button');
  assert.ok(th.includes('data-tab="mastery"')&&th.includes('teacher-mastery.js')&&tj.includes('renderShorashimMastery'));
  assert.ok(app.includes("sessionId:existing?.sessionId||null,design:d}")&&!/design:d,practice/.test(app),'saving a card leaves practice alone');
});
