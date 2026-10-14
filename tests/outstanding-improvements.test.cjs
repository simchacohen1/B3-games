'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(p,'utf8');
function excerpt(s,start,end){const a=s.indexOf(start),b=s.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return s.slice(a,b)}
test('all 613 mitzvos have Hebrew descriptions and the two coveting cards are distinct',()=>{
 const titles=require('../sefer-hamitzvos/hebrew-titles');assert.equal(Object.keys(titles).length,613);
 for(const title of Object.values(titles))assert.match(title,/[א-ת]/);
 assert.equal(titles.N265,'לא תחמד');assert.equal(titles.N266,'לא תתאוה');
 const days=require('../sefer-hamitzvos/schedule');const order=[...new Set(days.flatMap(d=>d.match(/[PN]\d+/g)||[]))];assert.equal(order[475],'N265');assert.equal(order[476],'N266');
});
test('PeerJS signaling recovers without destroying working lesson channels or leaving stale pink errors',()=>{
 const s=read('class-pointer-prototype/classroom.js'),events={},timers=[],reports=[];
 const node={dataset:{},hidden:false};let retries=0;
 const instance={destroyed:false,disconnected:true,on:(name,fn)=>{events[name]=fn},reconnect:()=>{retries++}};
 const context=vm.createContext({window:{},Peer:function(){return instance},isTeacher:false,teacherConnection:{open:true},peer:instance,members:new Map(),$ :()=>node,status:t=>reports.push(t),peerError:()=>{throw Error('Working channels must stay open')},clearError:()=>{node.hidden=true;delete node.dataset.peerWarning},setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout(){},crypto:{randomUUID:()=> 'test'}});
 vm.runInContext(excerpt(s,'function makePeer(id){','async function startClass()'),context);context.makePeer('test');
 events.error({type:'network'});assert.match(reports.at(-1),/Lesson connection is active/);assert.equal(node.hidden,true);
 events.disconnected();assert.equal(timers.length,1);timers.shift()();assert.equal(retries,1);
 events.open();assert.match(reports.at(-1),/restored/);assert.equal(node.dataset.peerWarning,undefined);
});
test('uploaded bank CSV preserves quoted questions, variants and exactly two reviewed rows',()=>{
 const s=read('record_pesukim/teacher.html');const context=vm.createContext({});vm.runInContext(excerpt(s,'function parseTeacherQuestionCsv(','async function uploadTeacherQuestionCsv('),context);
 const rows=context.parseTeacherQuestionCsv('Selected Hebrew Words,Formulated Question,Other Correct Word Variants\r\nאברהם,"Who, in this pasuk?",אַבְרָהָם\r\nפתח האהל,Where?,פתח האהל\r\n');assert.equal(rows.length,3);assert.equal(rows[1][1],'Who, in this pasuk?');
 assert.equal(context.phraseOccursInPasuk('אַבְרָהָם','וַיֵּרָא אֵלָיו אַבְרָהָם'),true);assert.equal(context.phraseOccursInPasuk('שרה','אברהם'),false);
 assert.match(s,/rows.length!==2/);assert.match(s,/Approve and save these two questions/);assert.match(s,/ref.transaction/);
});
test('Posuk builds three voice and two approved tap questions, separated by Sefer/perek/pasuk',async()=>{
 const s=read('record_pesukim/student.html'),paths=[],items=[{question:'Who?',answerPhrases:['אברהם']},{question:'Where?',answerPhrases:['פתח האהל']}];
 const context=vm.createContext({window:{B3SiteSettings:{workspaceId:'test-workspace'}},currentSefer:'Bereishis',currentPerekNum:18,normalizeDivineNames:s=>s,getGeneratedQuestionsForPart:async()=>[1,2,3,4,5].map(i=>({question:'Voice '+i})),db:{ref:path=>{paths.push(path);return{once:async()=>({val:()=>({reviewed:true,updatedAt:1,items})})}}}});
 vm.runInContext(excerpt(s,'function normalizeQuestionHebrewToken(','async function getGeneratedQuestionsForPart('),context);
 const questions=await context.getComprehensionQuestionsForPart({posukNum:1,text:'אברהם פתח האהל',translation:'Sample'});assert.equal(questions.length,5);assert.deepEqual(Array.from(questions,q=>q.answerMode),['voice','voice','voice','tap','tap']);assert.deepEqual(paths,['posukPractice/approvedQuestionBanks/test-workspace/Bereishis/18/1']);
 items.pop();await assert.rejects(context.getComprehensionQuestionsForPart({posukNum:1}),/Two teacher-approved/);
});
test('Posuk approved banks allow authenticated teacher writes and validate the two-question shape',()=>{
 const rules=JSON.parse(read('firebase-rules.json')).rules.posukPractice.approvedQuestionBanks;const leaf=rules.$workspaceId.$sefer.$perek.$pasuk;
 assert.equal(rules['.read'],true);assert.match(leaf['.write'],/auth != null/);assert.match(leaf['.write'],/teachers/);assert.match(leaf['.validate'],/hasChildren\(\['0','1'\]\)/);assert.ok(!JSON.stringify(rules).includes('".write":true'));
});
test('Yiddish has vowel marks on every vocabulary word and sentence navigation resumes continuous playback',()=>{
 const context={window:{}};vm.runInNewContext(read('yiddish/content.js'),context);const words=context.window.YIDDISH_CONTENT.words;assert.equal(words.length,32);for(const w of words)assert.match(w.yiNikud,/[\u05b0-\u05bd\u05c7]/,w.yi);
 const s=read('yiddish/readalong.js');assert.match(excerpt(s,'  function playPhrase(i)',"  $('raAgain')"),/stopAt = null/);
});
test('an admin card merge preserves students outside a filtered dashboard and their progress',async()=>{
 const source=read('shorashim/teacher.js'),all={et:{cards:{'shorashim:duplicate':{learnedAt:10,design:{picture:'kept'}}},progress:{kept:true}},wt:{cards:{'shorashim:duplicate':{learnedAt:20},'shorashim:keeper':{learnedAt:30,design:{picture:'newer'}}},recordings:{kept:true}}};
 let transactionCalled=false;
 const context=vm.createContext({window:{B3SiteSettings:{getCurrentAccess:()=>({role:'admin'})}},state:{catalog:{shorashim:[{id:'keeper',front:'ראה',english:'see'},{id:'duplicate',front:'ראה',english:'see'}]},students:{et:all.et}},SPACE:'sample',hebrewKey:x=>x,englishDuplicateKey:x=>x,listNameOf:()=> 'Main',sanitizeClassArt:x=>x,confirm:()=>true,alert:()=>{},status:()=>{},renderCatalog:()=>{},db:{ref:path=>({set:async()=>{},transaction:async updater=>{transactionCalled=true;updater(all)}})}});
 vm.runInContext(excerpt(source,'async function mergeDuplicateWord(','async function saveCatalog('),context);await context.mergeDuplicateWord('duplicate');
 assert.equal(transactionCalled,true);assert.deepEqual(all.et.progress,{kept:true});assert.deepEqual(all.wt.recordings,{kept:true});assert.equal(all.wt.cards['shorashim:keeper'].learnedAt,20);assert.equal(all.wt.cards['shorashim:keeper'].design.picture,'newer');assert.equal(all.wt.cards['shorashim:duplicate'],undefined);
});
test('spoken question grading does not use Bereishis-only fallback references for another Sefer',async()=>{
 const source=read('backend/functions/index.js'),start=source.indexOf('exports.gradeQuestionAnswer ='),end=source.indexOf('    if (!question ||',start);const section=source.slice(source.indexOf('    const { question,',start),end);
 for(const sefer of ['Bereishis','Shemos','Vayikra','Bamidbar','Devarim']){
  const calls=[];const context=vm.createContext({fields:{question:'Sample',sefer,perekNum:18,posukNum:1},fetchPosukPracticeTorahUmesorahReference:()=>{calls.push('classroom');return 'Sample'},fetchPosukPracticeKehotReference:async()=>{calls.push('kehot');return 'Sample'},console});await vm.runInContext('(async()=>{'+section+'})()',context);assert.equal(calls.length,sefer==='Bereishis'?2:0);
 }
});
test('teacher-reviewed spoken answers retain their final verdict and text is escaped',()=>{
 const s=read('record_pesukim/student.html'),context=vm.createContext({});vm.runInContext(excerpt(s,'function questionIsCorrect(','function questionResultAudioSrc('),context);
 assert.equal(context.questionIsCorrect({verdict:'incorrect',finalVerdict:'correct'}),true);assert.equal(context.questionIsCorrect({verdict:'correct',finalVerdict:'incorrect'}),false);assert.equal(context.questionHtmlText('<img onerror="bad">'),'&lt;img onerror=&quot;bad&quot;&gt;');
});
test('Google teacher sign-in reuses a valid session and rechecks access without an authorization popup',async()=>{
 const source=read('site-settings.js'),user={uid:'sample-teacher',getIdToken:async()=> 'sample-token'};let popups=0;
 const context=vm.createContext({ensureFirebase:()=>({auth:{currentUser:user,signInWithPopup:()=>{popups++;throw Error('Unexpected popup')}}}),currentAccess:{authorized:true},getActingStudent:()=>null,readUserAccess:async()=>({authorized:true,role:'teacher',classIds:['et']}),setSignedInHint:()=>{},showToolVersions:()=>{},document:{readyState:'complete'},window:{firebase:{auth:{GoogleAuthProvider:class{}}}}});
 vm.runInContext(excerpt(source,'  function signInWithGoogle()','  function signOut()'),context);assert.equal(await context.signInWithGoogle(),user);assert.equal(popups,0);
 context.readUserAccess=async()=>({authorized:false,role:'',classIds:[]});await assert.rejects(context.signInWithGoogle(),/no longer authorized/);assert.equal(popups,0);
});
