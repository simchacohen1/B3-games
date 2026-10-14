const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const dir=__dirname+'/../sync-to-nigri/';
const src=fs.readFileSync(dir+'classtime-save.js','utf8');
const previewSrc=fs.readFileSync(dir+'classtime-preview.js','utf8');
const page=fs.readFileSync(dir+'classtime.html','utf8');

// ---- a tiny fake page (made-up names only) ----
function el(){
  return {value:'',hidden:false,disabled:false,checked:false,className:'',textContent:'',children:[],listeners:{},
    addEventListener(t,f){(this.listeners[t]??=[]).push(f)},append(...c){this.children.push(...c)},replaceChildren(...c){this.children=c},
    async fire(t){for(const f of this.listeners[t]||[])await f()},click(){return this.fire('click')},
    createTHead(){const h={rows:[],insertRow(){const r={cells:[],append(c){r.cells.push(c)}};h.rows.push(r);return r}};this._head=h;return h},
    createTBody(){const b={rows:[],insertRow(){const r={cells:[],insertCell(){const c=el();r.cells.push(c);return c}};b.rows.push(r);return r}};this._body=b;return b}};
}
function texts(node){const out=[];(function walk(n){if(!n)return;if(n.textContent)out.push(n.textContent);(n.children||[]).forEach(walk);
  if(n._head)n._head.rows.forEach(r=>r.cells.forEach(walk));if(n._body)n._body.rows.forEach(r=>r.cells.forEach(walk))})(node);return out.join(' | ')}
function load({token='fake-token',reply,confirmAnswer=true}={}){
  const ids=['savePanel','saveWho','saveAnyway','saveAnywayRow','saveBtn','saveStatus','saveResult','saveSummary','previewTopic','previewType','previewDate','previewName'];
  const els=Object.fromEntries(ids.map(i=>[i,el()]));els.savePanel.hidden=true;els.saveAnywayRow.hidden=true;els.saveBtn.disabled=true;
  const docHandlers={},requests=[],confirms=[];
  const sandbox={window:{confirm:m=>{confirms.push(m);return confirmAnswer},ClasstimePreview:{defaultName:r=>r.session_name+' ('+r.session_code+')'}},
    document:{getElementById:i=>els[i],createElement:()=>el(),addEventListener:(t,f)=>{(docHandlers[t]??=[]).push(f)}},
    Option:function(label,value){this.label=label;this.value=value;this.disabled=false},encodeURIComponent,String,Array,Object,Promise,JSON,Boolean};
  sandbox.window.NigriAuth={getToken:async()=>token,request:async(...args)=>{requests.push(args);if(reply==='throw')throw new Error('offline');return reply?reply():{response:{status:200,json:async()=>({})}}}};
  vm.createContext(sandbox);vm.runInContext(src,sandbox);
  const emit=(type,detail)=>docHandlers[type].forEach(f=>f({detail}));
  return {els,requests,confirms,api:sandbox.window.ClasstimeSave,emit,
    open(data=PREVIEW,id='rev1',choices=CHOICES){emit('classtime:preview-ok',{id,result:RESULT,choices,data})},
    pick(name){els.saveWho.value=name;return els.saveWho.fire('change')}};
}
const RESULT={session_code:'ABC123',session_name:'Made Up Quiz',class_section:'B3 ET'};
const CHOICES={topic:'Shoroshim',type:'quiz',date:'2026-10-09',test_name:'Made Up Quiz (ABC123)'};
const PREVIEW={dry_run:true,duplicate_check:{status:'clear'},blockers:[],counts:{},students:[
  {classtime_name:'Ann Made',nigri_name:'Ann Nigri',action:'save',mark_percent:75,report:{attached:true,kb:105}},
  {classtime_name:'Ben Made',nigri_name:'Ben Nigri',action:'blank',report:null},
  {classtime_name:'Cal Made',nigri_name:null,action:'skip',report:null},
  {classtime_name:'Dee Made',nigri_name:'Dee Nigri',action:'save',mark_percent:100,report:{attached:true,kb:99}},
  {classtime_name:'Eli Made',nigri_name:'Eli Nigri',action:'save',mark_percent:50,report:null}]};
const withStatus=(status,extra={})=>({...PREVIEW,duplicate_check:{status,...extra}});
const answer=(status,data)=>()=>({response:{status,json:async()=>data},via:'signin'});
const SAVED={saved:true,partial_mark_may_exist:false,do_not_retry:false,test_id:'4242',mark_name:'TEST DELETE ME - Made Up Quiz (ABC123)',message:'Saved to Nigri as mark #4242.',warnings:[],
  per_boy:[{classtime_name:'Ann Made',nigri_name:'Ann Nigri',outcome:'saved',detail:''}]};

test('Classtime saving stays paused until the separate write workflow is approved',()=>{
  new vm.Script(src);
  assert.match(page,/<button disabled aria-disabled="true">Sync to Nigri/);
  assert.match(page,/Saving paused for safety/);
  assert.match(page,/classtime-preview\.js(?:\?[^\"]*)?"/);
  assert.doesNotMatch(page,/<script[^>]+src="[^\"]*classtime-save\.js/);
  assert.match(page,/<button[^>]*id="saveBtn"[^>]*\bdisabled/);
  assert.match(page,/<div[^>]*id="savePanel"[^>]*(?:hidden|display:\s*none)/);
});
test('no key, no fallback, no old-route use, no HTML built from names',()=>{
  assert.doesNotMatch(src,/X-Sync-Key|sync-marks|sync-points|innerHTML|insertAdjacentHTML|eval\(/);
  assert.match(src,/\/sync-save/);
  assert.doesNotMatch(src,/Sync to Nigri/);               // it never touches or enables the old button
});
test('the Preview script announces start and success with the choices (and nothing for a failed preview)',()=>{
  assert.match(previewSrc,/classtime:preview-start/);assert.match(previewSrc,/classtime:preview-ok/);assert.match(previewSrc,/data\.dry_run === true/);
});

test('the mark name rule matches the server (test vectors shared with the server tests)',()=>{
  const {api}=load();
  assert.equal(api.effectiveName('Made Up Quiz (ABC123)'),'TEST DELETE ME - Made Up Quiz (ABC123)');
  assert.equal(api.effectiveName('  My Name (ABC123) '),'TEST DELETE ME - My Name (ABC123)');
  assert.equal(api.effectiveName('TEST DELETE ME - Already'),'TEST DELETE ME - Already');
  assert.equal(api.effectiveName('test delete me again'),'test delete me again');
  assert.equal(api.effectiveName('x'.repeat(200)).length,120);
});
test('the Save section appears only after a preview, lists only boys with a score and a verified report, and whole class is disabled',()=>{
  const t=load();assert.equal(t.els.savePanel.hidden,true);
  t.open();assert.equal(t.els.savePanel.hidden,false);
  const options=t.els.saveWho.children;
  assert.deepEqual(options.map(o=>o.label),['Choose one boy…','Ann Made','Dee Made','Whole class: not available yet']);
  assert.equal(options[3].disabled,true);assert.equal(options[3].value,'__class__');
  assert.match(t.els.saveSummary.textContent,/TEST DELETE ME - Made Up Quiz \(ABC123\)/);
  assert.equal(t.els.saveBtn.disabled,true);                          // nobody chosen yet
});
test('choosing the disabled whole-class option never enables saving',async()=>{
  const t=load();t.open();await t.pick('__class__');assert.equal(t.els.saveBtn.disabled,true);
  await t.els.saveBtn.click();assert.equal(t.requests.length,0);assert.equal(t.confirms.length,0);
});
test('the section hides when the choices change, a new preview starts, or another review loads',async()=>{
  for(const trigger of [t=>t.els.previewName.fire('input'),t=>t.els.previewTopic.fire('change'),t=>t.emit('classtime:preview-start'),t=>t.emit('classtime:review',{}),t=>t.emit('classtime:review-cleared')]){
    const t=load();t.open();assert.equal(t.els.savePanel.hidden,false);await trigger(t);assert.equal(t.els.savePanel.hidden,true);
  }
});
test('"Save anyway" appears only for a duplicate or an unreadable check, and is required then',async()=>{
  const clear=load();clear.open(withStatus('clear'));await clear.pick('Ann Nigri');
  assert.equal(clear.els.saveAnywayRow.hidden,true);assert.equal(clear.els.saveBtn.disabled,false);
  for(const status of ['duplicate','could_not_check']){
    const t=load();t.open(withStatus(status));await t.pick('Ann Nigri');
    assert.equal(t.els.saveAnywayRow.hidden,false);assert.equal(t.els.saveBtn.disabled,true);
    t.els.saveAnyway.checked=true;await t.els.saveAnyway.fire('change');assert.equal(t.els.saveBtn.disabled,false);
  }
});
test('the confirmation shows class, mark name and boy count; cancelling sends nothing',async()=>{
  const t=load({confirmAnswer:false});t.open();await t.pick('Ann Nigri');await t.els.saveBtn.click();
  assert.equal(t.confirms.length,1);assert.match(t.confirms[0],/Class: B3 ET/);assert.match(t.confirms[0],/Mark name: TEST DELETE ME - Made Up Quiz \(ABC123\)/);
  assert.match(t.confirms[0],/Boys: 1 \(Ann Made\)/);assert.match(t.confirms[0],/will not be retried automatically/);
  assert.equal(t.requests.length,0);assert.equal(t.els.saveBtn.disabled,false);
});
test('the request goes to sync-save with the sign-in only, and carries the exact override only when needed',async()=>{
  const clear=load({reply:answer(200,SAVED)});clear.open();await clear.pick('Ann Nigri');await clear.els.saveBtn.click();
  const [path,options,third]=clear.requests[0];
  assert.equal(clear.requests.length,1);assert.equal(path,'/classtime/reviews/rev1/sync-save');assert.equal(options.method,'POST');assert.equal(third,undefined);assert.equal(clear.requests[0].length,2);
  assert.deepEqual(JSON.parse(options.body),{topic:'Shoroshim',type:'quiz',date:'2026-10-09',test_name:'Made Up Quiz (ABC123)',only_student:'Ann Nigri'});
  const dup=load({reply:answer(200,SAVED)});dup.open(withStatus('duplicate'));await dup.pick('Ann Nigri');dup.els.saveAnyway.checked=true;await dup.els.saveBtn.click();
  assert.deepEqual(JSON.parse(dup.requests[0][1].body),{topic:'Shoroshim',type:'quiz',date:'2026-10-09',test_name:'Made Up Quiz (ABC123)',only_student:'Ann Nigri',
    allow_duplicate:true,confirm_session_code:'ABC123',confirm_test_name:'TEST DELETE ME - Made Up Quiz (ABC123)'});
  assert.match(dup.confirms[0],/You ticked "Save anyway"/);
});
test('after a save: per-boy result, mark number, greyed button saying Saved, and no second send',async()=>{
  const t=load({reply:answer(200,SAVED)});t.open();await t.pick('Ann Nigri');await t.els.saveBtn.click();
  assert.equal(t.els.saveBtn.textContent,'Saved, mark #4242');assert.equal(t.els.saveBtn.disabled,true);assert.equal(t.els.saveWho.disabled,true);
  const shown=texts(t.els.saveResult);assert.match(shown,/Saved to Nigri as mark #4242/);assert.match(shown,/Ann Made \| Saved/);
  await t.els.saveBtn.click();assert.equal(t.requests.length,1);assert.equal(t.confirms.length,1);
  t.emit('classtime:preview-ok',{id:'rev1',result:RESULT,choices:CHOICES,data:PREVIEW});   // previewing again cannot unlock it
  assert.equal(t.els.saveBtn.disabled,true);assert.equal(t.els.saveBtn.textContent,'Saved, mark #4242');
});
test('a partial save shows the server warnings plainly, locks the button, and is never retried',async()=>{
  const partial={saved:false,partial_mark_may_exist:true,do_not_retry:true,test_id:'77',message:'Partly saved: mark #77 exists in Nigri but some boys did not save. Check Nigri. It will not be retried automatically.',
    warnings:["Could not set 'Marking done'"],per_boy:[{classtime_name:'Ann Made',nigri_name:'Ann Nigri',outcome:'failed',detail:'field not found'}]};
  for(const status of [200,500]){
    const t=load({reply:answer(status,partial)});t.open();await t.pick('Ann Nigri');await t.els.saveBtn.click();
    const shown=texts(t.els.saveResult);
    assert.match(shown,/Partly saved: mark #77/);assert.match(shown,/partial mark may exist/i);assert.match(shown,/Warning: Could not set 'Marking done'/);assert.match(shown,/Ann Made \| FAILED \| field not found/);
    assert.equal(t.els.saveBtn.disabled,true);assert.match(t.els.saveBtn.textContent,/Partly saved, mark #77/);
    await t.els.saveBtn.click();assert.equal(t.requests.length,1);
  }
});
test('a stop with an unknown outcome locks the button and says check Nigri',async()=>{
  const stopped={saved:false,partial_mark_may_exist:true,do_not_retry:true,message:'The save was stopped (the server stopped it to protect its memory). A partial mark MAY exist in Nigri. Check Nigri before doing anything else. It will not be retried automatically.'};
  const t=load({reply:answer(500,stopped)});t.open();await t.pick('Ann Nigri');await t.els.saveBtn.click();
  assert.match(texts(t.els.saveResult),/memory/);assert.match(t.els.saveBtn.textContent,/unknown: check Nigri/);assert.equal(t.els.saveBtn.disabled,true);
});
test('losing contact with the server mid-save locks the button and never retries',async()=>{
  const t=load({reply:'throw'});t.open();await t.pick('Ann Nigri');await t.els.saveBtn.click();
  assert.match(texts(t.els.saveResult),/not known whether the save happened/);assert.match(t.els.saveBtn.textContent,/unknown: check Nigri/);assert.equal(t.els.saveBtn.disabled,true);
  await t.els.saveBtn.click();assert.equal(t.requests.length,1);
});
test('refusals before saving explain themselves and leave the button usable (nothing was written)',async()=>{
  for(const [status,data,pattern] of [[401,{error:'unauthorized'},/Sign-in refused/],[404,{error:'x'},/expired/],[400,{saved:false,error:'That boy has no score'},/no score/],[409,{saved:false,error:'Not saved: A report PDF is not verified',can_override:false},/not verified/]]){
    const t=load({reply:answer(status,data)});t.open();await t.pick('Ann Nigri');await t.els.saveBtn.click();
    assert.match(t.els.saveStatus.textContent,pattern);assert.equal(t.els.saveBtn.disabled,false);assert.equal(texts(t.els.saveResult),'');
  }
});
test('if the server says a duplicate needs the override, the tick appears; "already saved" locks the button',async()=>{
  const dup=load({reply:answer(409,{saved:false,error:'Nigri already has a mark for this session. Nothing was saved.',can_override:true})});
  dup.open();await dup.pick('Ann Nigri');await dup.els.saveBtn.click();
  assert.equal(dup.els.saveAnywayRow.hidden,false);assert.equal(dup.els.saveBtn.disabled,true);assert.match(dup.els.saveStatus.textContent,/Tick "Save anyway"/);
  const done=load({reply:answer(409,{saved:false,error:'This review was already saved to Nigri (mark #99). It will not be saved twice.'})});
  done.open();await done.pick('Ann Nigri');await done.els.saveBtn.click();
  assert.equal(done.els.saveBtn.textContent,'Saved, mark #99');assert.equal(done.els.saveBtn.disabled,true);
});
test('not signed in: nothing is sent and the button stays usable',async()=>{
  const t=load({token:null});t.open();await t.pick('Ann Nigri');await t.els.saveBtn.click();
  assert.equal(t.requests.length,0);assert.match(t.els.saveStatus.textContent,/Not signed in/);assert.equal(t.els.saveBtn.disabled,false);
});
test('a locked review stays locked if its Save section is shown again, and other reviews are unaffected',async()=>{
  const t=load({reply:answer(200,SAVED)});t.open();await t.pick('Ann Nigri');await t.els.saveBtn.click();
  t.emit('classtime:review',{});t.open(PREVIEW,'rev2');await t.pick('Ann Nigri');
  assert.equal(t.els.saveBtn.textContent,'Save to Nigri');assert.equal(t.els.saveBtn.disabled,false);
  t.open(PREVIEW,'rev1');assert.equal(t.els.saveBtn.textContent,'Saved, mark #4242');
});

test('skipping the remote duplicate lookup does not require Save anyway or enable whole class',async()=>{
  const t=load();t.open(withStatus('skipped'));await t.pick('Ann Nigri');
  assert.equal(t.els.saveAnywayRow.hidden,true);
  assert.equal(t.els.saveBtn.disabled,false);
  await t.pick('__class__');assert.equal(t.els.saveBtn.disabled,true);
});
