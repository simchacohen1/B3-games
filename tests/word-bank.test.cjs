'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function loadBrowserCore() {
  const session = new Map([['b3Games_studentId','student-a'],['b3Games_studentClass','et'],['b3Games_workspaceId','b3-2026']]);
  const local = new Map();
  const context = vm.createContext({
    window: {}, location: { search: '' },
    sessionStorage: { getItem:k=>session.get(k)||null, setItem:(k,v)=>session.set(k,String(v)), removeItem:k=>session.delete(k) },
    localStorage: { getItem:k=>local.get(k)||null, setItem:(k,v)=>local.set(k,String(v)), removeItem:k=>local.delete(k) },
    URLSearchParams, Date, setTimeout:()=>1, clearTimeout:()=>{}, CustomEvent: class { constructor(type, init){this.type=type;this.detail=init?.detail} }
  });
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(root,'word-bank/bank-core.js'),'utf8'), context);
  return { context, session, local, api: context.FTTWordBank };
}

test('student bank deduplicates terms and retains all lesson appearances across sources', () => {
  const {api}=loadBrowserCore();
  const hebrew='תּוֹרָה', id='word:תורה';
  api.collect({id:'sefer:P1',title:'Know Hashem'},[{id,hebrew,english:'Torah',source:'sefer-hamitzvos'}]);
  api.collect({id:'sefer:P2',title:'Know Hashem is One'},[{id,hebrew,english:'Torah',source:'sefer-hamitzvos'}]);
  api.collect({id:'halacha:a',title:'Learning Torah'},[{id,hebrew,english:'Torah',source:'halacha'}]);
  const bank=api.read({workspaceId:'b3-2026',classId:'et',studentId:'student-a'});
  assert.equal(Object.keys(bank.words).length,1);
  assert.deepEqual(Array.from(bank.words[id].sources).sort(),['halacha','sefer-hamitzvos']);
  assert.equal(bank.words[id].lessons.length,3);
  assert.equal(api.list('sefer-hamitzvos').length,1);
  assert.equal(api.list('halacha').length,1);
});

test('ET and WT student banks remain isolated', () => {
  const {api}=loadBrowserCore();
  api.collect({id:'sefer:P1',title:'ET'},[{id:'word:אחד',hebrew:'אֶחָד',english:'one',source:'sefer-hamitzvos'}]);
  const wt={workspaceId:'b3-2026',classId:'wt',studentId:'student-a'};
  assert.equal(api.list('all',wt).length,0);
  assert.equal(api.list('all').length,1);
});

test('mastery is tracked separately from collection and practice', () => {
  const {api}=loadBrowserCore(), id='word:שבת';
  api.collect({id:'sefer:N322',title:'Shabbat'},[{id,hebrew:'שַׁבָּת',english:'Shabbat',source:'sefer-hamitzvos'}]);
  assert.equal(api.list()[0].mastered,false);
  api.recordAnswer(id,true);api.recordAnswer(id,false);
  assert.equal(api.list()[0].practiceCount,2);
  assert.equal(api.list()[0].mastered,false);
  api.recordAnswer(id,true);api.recordAnswer(id,true);
  assert.equal(api.list()[0].mastered,true);
});

test('word bank waits for Firebase to restore the signed-in student before syncing', async () => {
  const {context,api}=loadBrowserCore();
  context.setTimeout=(fn,ms)=>setTimeout(fn,ms);
  context.clearTimeout=id=>clearTimeout(id);
  const user={getIdTokenResult:async()=>({claims:{b3StudentId:'student-a',b3ClassId:'et'}})};
  context.firebase={apps:[{auth:()=>({currentUser:null,onAuthStateChanged:callback=>{setTimeout(()=>callback(user),5);return ()=>{}}})}]};
  assert.equal(await api.authFor(),user);
});

test('all 613 Maimonides P/N entries have three mitzvah-scoped matching words', () => {
  const context=vm.createContext({window:{}});context.window=context;
  vm.runInContext(fs.readFileSync(path.join(root,'word-bank/mitzvah-titles.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'word-bank/sefer-vocabulary-catalog.js'),'utf8'),context);
  const titles=context.FTT_MITZVAH_TITLES, catalog=context.FTTSeferVocabulary;
  assert.equal(Object.keys(titles).length,613);
  for(const prefix of ['P','N'])for(let n=1;n<=(prefix==='P'?248:365);n++){
    const ref=prefix+n,words=catalog.forRef(ref);
    assert.ok(titles[ref]&&!titles[ref].startsWith('Mitzvah '),`missing title ${ref}`);
    assert.ok(words.length>=3&&words.length<=5,`wrong word count ${ref}`);
    assert.ok(words.every(word=>word.hebrew&&word.english&&word.source==='sefer-hamitzvos'),`incomplete vocabulary ${ref}`);
  }
  assert.equal(catalog.topic(titles.P1,'P1'),'faith');
  assert.equal(catalog.topic(titles.N1,'N1'),'idols');
  assert.equal(Object.values(titles).filter((title, index) => catalog.topic(title, Object.keys(titles)[index]).startsWith('general')).length,0);
});

test('every existing Halacha lesson has at least three lesson-specific terms', () => {
  const context=vm.createContext({window:{}});context.window=context;
  vm.runInContext(fs.readFileSync(path.join(root,'word-bank/halacha-vocabulary.js'),'utf8'),context);
  const html=fs.readFileSync(path.join(root,'halacha/index.html'),'utf8'),start=html.indexOf('const lessons=['),end=html.indexOf('\n// Seven original Siman Aleph',start);
  assert.ok(start>=0&&end>start);
  const lessonContext=vm.createContext({});vm.runInContext(html.slice(start,end)+';globalThis.out=lessons;',lessonContext);
  assert.equal(lessonContext.out.length,34);
  for(const lesson of lessonContext.out){
    const words=context.FTTHalachaVocabulary.get(lesson.id);
    assert.ok(words.length>=3,`missing words for ${lesson.id}`);
    assert.ok(words.every(w=>w.hebrew&&w.english&&w.source==='halacha'),`invalid words for ${lesson.id}`);
  }
});

test('Sefer matching gives immediate feedback and celebrates the completed set', () => {
  class El {
    constructor(id=''){this.id=id;this.children=[];this.dataset={};this.className='';this.classList={add:()=>{},remove:()=>{},toggle:()=>{}};this.textContent='';this.disabled=false;}
    append(...items){this.children.push(...items)}
    replaceChildren(){this.children=[]}
    setAttribute(){}
    querySelectorAll(selector){return this.children.filter(x=>selector==='.vocab-en'?x.className==='vocab-en':x.className==='vocab-he')}
    querySelector(selector){const m=selector.match(/data-word="([^"]+)"/);return this.children.find(x=>selector.includes('.vocab-en')?x.className==='vocab-en'&&x.dataset.word===m?.[1]:x.dataset.word===m?.[1])||null}
  }
  const els={vocabMatches:new El(),vocabStatus:new El(),vocabCelebrate:new El(),vocabTitle:new El()};
  const words=[
    {id:'word:אחד',hebrew:'אֶחָד',english:'one',source:'sefer-hamitzvos'},
    {id:'word:אהבה',hebrew:'אַהֲבָה',english:'love',source:'sefer-hamitzvos'},
    {id:'word:תורה',hebrew:'תּוֹרָה',english:'Torah',source:'sefer-hamitzvos'}
  ];
  const context=vm.createContext({document:{getElementById:id=>els[id],createElement:()=>new El()},CSS:{escape:x=>x},setTimeout:()=>0,Math});
  context.window=context;context.FTTSeferVocabulary={forRef:()=>words,title:()=> 'Test mitzvah'};context.FTTWordBank={collect:()=>{}};context.FTTMitzvahCalendar=null;
  vm.runInContext(fs.readFileSync(path.join(root,'word-bank/sefer-activity.js'),'utf8'),context);
  context.FTTSeferWordActivity.open('P1');
  assert.equal(els.vocabMatches.children.length,6);
  const he=els.vocabMatches.children.find(x=>x.className==='vocab-he'),english=els.vocabMatches.children.find(x=>x.className==='vocab-en'&&x.dataset.word===he.dataset.word);
  english.onclick();he.onclick();
  assert.equal(he.disabled,true);
  assert.match(els.vocabStatus.textContent,/right|Fantastic/i);
  for(const target of els.vocabMatches.children.filter(x=>x.className==='vocab-he'&&!x.disabled)){
    const match=els.vocabMatches.children.find(x=>x.className==='vocab-en'&&x.dataset.word===target.dataset.word);match.onclick();target.onclick();
  }
  assert.match(els.vocabStatus.textContent,/Fantastic/i);
  assert.ok(els.vocabCelebrate.textContent.includes('🎉'));
});
