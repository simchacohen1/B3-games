const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const dir=__dirname+'/../sync-to-nigri/';
const src=fs.readFileSync(dir+'classtime-preview.js','utf8');
const page=fs.readFileSync(dir+'classtime.html','utf8');
const review=fs.readFileSync(dir+'classtime-review.js','utf8');

// ---- a tiny fake page (made-up names and values only) ----
function el(){
  const e={value:'',hidden:false,disabled:false,className:'',textContent:'',children:[],listeners:{},
    addEventListener(t,f){(this.listeners[t]??=[]).push(f)},append(...c){this.children.push(...c)},
    replaceChildren(...c){this.children=c},click(){return Promise.all((this.listeners.click||[]).map(f=>f()))},
    createTHead(){const h={cells:[],insertRow(){const r={cells:[],insertCell(){const c=el();r.cells.push(c);return c},append(c){r.cells.push(c)}};h.rows.push(r);return r},rows:[]};this._head=h;return h},
    createTBody(){const b={rows:[],insertRow(){const r={cells:[],insertCell(){const c=el();r.cells.push(c);return c}};b.rows.push(r);return r}};this._body=b;return b}};
  return e;
}
function texts(node){ // every piece of visible text under a node
  const out=[];(function walk(n){if(!n)return;if(n.textContent)out.push(n.textContent);(n.children||[]).forEach(walk);
    if(n._head)n._head.rows.forEach(r=>r.cells.forEach(walk));if(n._body)n._body.rows.forEach(r=>r.cells.forEach(walk))})(node);return out.join(' | ')}
function load({token='fake-token',reply}={}){
  const ids=['preview','previewTopic','previewType','previewDate','previewName','previewBtn','previewStatus','previewResult'];
  const els=Object.fromEntries(ids.map(i=>[i,el()]));els.preview.hidden=true;
  els.previewTopic.append=function(o){this.children.push(o)};els.previewType.append=els.previewTopic.append;
  const docListeners={},requests=[],events=[];
  const sandbox={window:{},document:{getElementById:i=>els[i],createElement:()=>el(),addEventListener:(t,f)=>{docListeners[t]=f},dispatchEvent:e=>{events.push(e)}},
    Option:function(label,value){this.label=label;this.value=value},CustomEvent:function(t,o){this.type=t;this.detail=o&&o.detail},encodeURIComponent,String,Date,Array,Object,Promise,JSON};
  sandbox.window.NigriAuth={getToken:async()=>token,request:async(path,opt,key)=>{requests.push({path,opt,key,args:arguments.length});return reply?reply():{response:{ok:true,status:200,json:async()=>({})},via:'signin'}}};
  vm.createContext(sandbox);vm.runInContext(src,sandbox);
  return {els,requests,events,api:sandbox.window.ClasstimePreview,docListeners,
    open(result,id='rev1'){docListeners['classtime:review']({detail:{id,result}})},close(){docListeners['classtime:review-cleared']()}};
}
const RESULT={session_code:'ABC123',session_name:'B3 ET Shoroshim Test Quiz',class_section:'B3 ET'};
const ok=data=>()=>({response:{ok:true,status:200,json:async()=>data},via:'signin'});
const fail=(status,data={})=>()=>({response:{ok:false,status,json:async()=>data},via:'signin'});
const SAMPLE={counts:{will_save:2,left_blank_no_score:1,skipped_unmatched:1},duplicate_check:{status:'clear'},blockers:[],
  students:[{classtime_name:'Ann Made',action:'save',mark_percent:75,points:9,maximum_points:12,report:{attached:true,kb:105}},
            {classtime_name:'Ben Made',action:'blank',mark_percent:null,points:null,maximum_points:12,report:null},
            {classtime_name:'Cal <b>x</b>',action:'skip',mark_percent:null,points:7,maximum_points:12,report:null}]};

test('files are valid and the real-save button is still disabled',()=>{
  new vm.Script(src);
  assert.match(page,/<button disabled aria-disabled="true">Sync to Nigri/);
  assert.equal((page.match(/id="previewBtn"/g)||[]).length,1);
  assert.match(page,/<script src="\.\/classtime-review\.js"><\/script>[\s\S]*<script src="\.\/classtime-preview\.js"><\/script>/);
});
test('the preview code has no key, no write route, no fallback, and never builds HTML from names',()=>{
  assert.doesNotMatch(src,/X-Sync-Key|sync-marks|sync-points|innerHTML|insertAdjacentHTML|eval\(/);
  assert.match(src,/\/sync-preview/);
});
test('the Classtime review and the Test Nigri sign-in button are unchanged apart from two events',()=>{
  assert.match(page,/id="nigriTest"/);assert.match(page,/NOT_A_CLASS/);
  for(const keep of ["api('/classtime/reviews', {method: 'POST'","/classtime/reviews/${id}/pdfs/${student.pdf_id}","Retrieving grades and student reports"])assert.ok(review.includes(keep),keep);
  assert.equal((review.match(/classtime:review/g)||[]).length,2);
  assert.doesNotMatch(review,/sync-preview|NigriAuth/);
});

test('default name matches what the server suggests, and topic is guessed from the title',()=>{
  const {api}=load();
  assert.equal(api.defaultName(RESULT),'B3 ET Shoroshim Test Quiz (ABC123)');
  assert.equal(api.defaultName({session_code:'ABC123',session_name:'x'.repeat(200)}).length,120);
  assert.equal(api.guessTopic(RESULT),'Shoroshim');
  assert.equal(api.guessTopic({session_name:'B3 WT Chumash-Rashi Quiz'}),'Chumash-Rashi');
  assert.equal(api.guessTopic({session_name:'Something else'}),'Shoroshim');
  assert.deepEqual([...api.TOPICS],['Shoroshim','Chumash Comprehension','Chumash Translation','Chumash','Chumash-Rashi','Halacha-Yahadus','Parsha']);
});
test('the plain-language summary covers saved, blank, skipped, duplicates and report problems',()=>{
  const {api}=load();
  const lines=d=>api.summarize(d).map(l=>l.text).join(' // ');
  const clear=lines(SAMPLE);
  assert.match(clear,/Nothing was saved to Nigri/);assert.match(clear,/Not saved yet/);assert.match(clear,/2 boys would be saved/);
  assert.match(clear,/1 boy has no score and would be left blank \(never sent as 0\)/);assert.match(clear,/1 boy is not matched to a Nigri student and would be skipped/);
  const dup=lines({...SAMPLE,duplicate_check:{status:'duplicate',matches:['Made Up Quiz (ABC123)']},blockers:['A mark for this session already exists in Nigri']});
  assert.match(dup,/Already saved: .*Made Up Quiz \(ABC123\)/);assert.doesNotMatch(dup,/Problem: A mark/);
  const unknown=lines({...SAMPLE,duplicate_check:{status:'could_not_check',detail:'offline'},blockers:['Could not check whether this session is already saved; a real save would refuse']});
  assert.match(unknown,/Could not check whether this session is already saved \(offline\)/);
  const pdf=lines({...SAMPLE,blockers:['A report PDF is not verified for a boy with a score; fix this before saving']});
  assert.match(pdf,/Problem with a report: A report PDF is not verified/);
  assert.match(lines({...SAMPLE,counts:{will_save:1,left_blank_no_score:0,skipped_unmatched:0}}),/1 boy would be saved/);
});
test('opening a review shows the form with defaults, and clearing hides it',()=>{
  const t=load();t.open(RESULT);
  assert.equal(t.els.preview.hidden,false);assert.equal(t.els.previewName.value,'B3 ET Shoroshim Test Quiz (ABC123)');
  assert.equal(t.els.previewTopic.value,'Shoroshim');assert.match(t.els.previewDate.value,/^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(t.els.previewType.children.map(o=>o.label),['Quiz','Test/Project','Classwork','Homework']);
  t.close();assert.equal(t.els.preview.hidden,true);
});
test('Preview sync sends the choices to the right route with the sign-in only (no key)',async()=>{
  const t=load({reply:ok(SAMPLE)});t.open(RESULT);
  t.els.previewTopic.value='Chumash';t.els.previewType.value='test';t.els.previewDate.value='2026-10-09';t.els.previewName.value='  My Name (ABC123) ';
  await t.els.previewBtn.click();
  assert.equal(t.requests.length,1);const r=t.requests[0];
  assert.equal(r.path,'/classtime/reviews/rev1/sync-preview');assert.equal(r.opt.method,'POST');assert.equal(r.key,undefined);
  assert.deepEqual(JSON.parse(r.opt.body),{topic:'Chumash',type:'test',date:'2026-10-09',test_name:'My Name (ABC123)'});
  const shown=texts(t.els.previewResult);
  assert.match(shown,/Would save/);assert.match(shown,/Left blank/);assert.match(shown,/Skipped/);assert.match(shown,/75% \(9 \/ 12\)/);assert.match(shown,/Report attached \(105 KB\)/);
  assert.match(shown,/Cal <b>x<\/b>/); // shown as plain text, never as markup
  assert.equal(t.els.previewBtn.disabled,false);
});
test('not signed in: asks you to sign in and sends nothing',async()=>{
  const t=load({token:null});t.open(RESULT);await t.els.previewBtn.click();
  assert.equal(t.requests.length,0);assert.match(t.els.previewStatus.textContent,/Not signed in/);
});
test('refusals and errors are explained in plain words',async()=>{
  for(const [status,data,pattern] of [[401,{},/Sign-in refused/],[404,{},/expired/],[409,{},/not ready/],[400,{error:'Choose one of the Nigri topics'},/Choose one of the Nigri topics/],[500,{},/server answered 500/]]){
    const t=load({reply:fail(status,data)});t.open(RESULT);await t.els.previewBtn.click();
    assert.match(t.els.previewStatus.textContent,pattern);assert.equal(texts(t.els.previewResult),'');
  }
  const down=load({reply:()=>{throw new Error('offline')}});down.open(RESULT);await down.els.previewBtn.click();
  assert.match(down.els.previewStatus.textContent,/Could not reach the server/);assert.equal(down.els.previewBtn.disabled,false);
});
test('an answer for an old review is dropped if a new review was loaded meanwhile',async()=>{
  let release;const t=load({reply:()=>new Promise(r=>{release=()=>r({response:{ok:true,status:200,json:async()=>SAMPLE},via:'signin'})})});
  t.open(RESULT);const click=t.els.previewBtn.click();await new Promise(r=>setTimeout(r,0));
  t.open({...RESULT,session_code:'ZZZ999'});release();await click;
  assert.equal(texts(t.els.previewResult),'');
});

 test('disabled duplicate lookup is honestly described without claiming a clear result',()=>{
  const {api}=load();
  const text=api.summarize({...SAMPLE,duplicate_check:{status:'skipped'}}).map(l=>l.text).join(' ');
  assert.match(text,/Duplicates are not checked in Nigri/);
  assert.doesNotMatch(text,/Not saved yet|would refuse until/);
});
