'use strict';
// Saved work (issue #770): the pure rules in saved-work-core.js, and the Firebase rules that go with them.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=path.resolve(__dirname,'..');
const Core=require('../class-pointer-prototype/saved-work-core.js');
const empty=()=>({folders:{},saveTarget:null});
function memory(){const data={};return{getItem:key=>key in data?data[key]:null,setItem(key,value){data[key]=String(value)},data}}

test('ids are random-looking and safe for a path; names lose control characters and extra length',()=>{
  assert.ok(Core.validId(Core.newId()));
  assert.ok(Core.validId(Core.newId({getRandomValues:bytes=>bytes.fill(7)})),'works without randomUUID');
  for(const bad of ['','a/b','a.b','../x','a b','x'.repeat(65),null,5])assert.equal(Core.validId(bad),false);
  assert.equal(Core.cleanName('  Chumash\u0000\n  notes\t1 '),'Chumash notes 1');
  assert.equal(Core.cleanName('x'.repeat(200)).length,Core.LIMITS.fileName);
  assert.equal(Core.cleanName('x'.repeat(200),Core.LIMITS.folderName).length,40);
  assert.equal(Core.cleanName(null),'');
});

test('paths keep each student inside their own class folder and each teacher inside their own',()=>{
  assert.equal(Core.studentPrefix('et','student_12'),'studentFiles/et/student_12/');
  assert.equal(Core.teacherPrefix('abcDEF123'),'pointerWhiteboards/abcDEF123/');
  assert.equal(Core.foldersPath('et'),'b3Games/workspaces/b3-2026/classes/et/pointerFileFolders');
  for(const bad of ['../other','a/b','',null])assert.throws(()=>Core.studentPrefix('et',bad));
  assert.throws(()=>Core.studentPrefix('et/../wt','s1'));
  assert.throws(()=>Core.teacherPrefix('a/b'));
  assert.throws(()=>Core.foldersPath('x/y'));
  assert.equal(Core.objectName('abc-1','json'),'abc-1.json');
  assert.throws(()=>Core.objectName('abc','exe'));
  assert.throws(()=>Core.objectName('a/b','pdf'));
  assert.deepEqual(Core.parseObjectName('abc-1.pdf'),{id:'abc-1',ext:'pdf'});
  assert.equal(Core.parseObjectName('abc.pdf.exe'),null);
  assert.equal(Core.parseObjectName('../abc.pdf'),null);
});

test('size limits: whiteboard 3 MB (teacher 10 MB), picture 2 MB, PDF 25 MB',()=>{
  const MB=1024*1024;
  assert.equal(Core.sizeProblem('whiteboard',3*MB),'');
  assert.match(Core.sizeProblem('whiteboard',3*MB+1),/too big/);
  assert.equal(Core.sizeProblem('whiteboard',10*MB,true),'');
  assert.match(Core.sizeProblem('whiteboard',10*MB+1,true),/too big/);
  assert.equal(Core.sizeProblem('png',2*MB),'');
  assert.notEqual(Core.sizeProblem('png',2*MB+1),'');
  assert.equal(Core.sizeProblem('pdf',25*MB),'');
  assert.match(Core.sizeProblem('pdf',25*MB+1),/25 MB/);
  assert.match(Core.sizeProblem('pdf',0),/empty/);
});

test('file details survive a round trip through Storage metadata; previews and odd names are not files',()=>{
  const custom=Core.fileMetadata({name:' Perek 1 ',kind:'pdf',folderId:'f1',lastPage:7,zoom:1.5,savedAt:1700});
  assert.deepEqual(custom,{displayName:'Perek 1',kind:'pdf',folderId:'f1',lastPage:'7',zoom:'1.5',savedAt:'1700'});
  for(const value of Object.values(custom))assert.equal(typeof value,'string');
  const file=Core.fileFromMetadata({name:'abc.pdf',size:10,customMetadata:{...custom,placeAt:'99'}});
  assert.deepEqual(file,{id:'abc',ext:'pdf',kind:'pdf',name:'Perek 1',folderId:'f1',lastPage:7,zoom:1.5,savedAt:1700,placeAt:99,size:10});
  assert.equal(Core.fileFromMetadata({name:'abc.png'}),null);
  assert.equal(Core.fileFromMetadata({name:'notes.txt'}),null);
  const bare=Core.fileFromMetadata({name:'w1.json',customMetadata:{folderId:'../x',lastPage:'-4',zoom:'900'}});
  assert.equal(bare.name,'Whiteboard');assert.equal(bare.folderId,null);assert.equal(bare.lastPage,1);assert.equal(bare.zoom,5);
  assert.equal(Core.fileMetadata({name:'',folderId:'bad id'}).folderId,'');
});

test('a saved whiteboard is only opened when it is the right kind, version and size',()=>{
  const good=JSON.stringify({version:1,kind:'student-board',strokes:[]});
  assert.deepEqual(Core.parseBoard(good,'student-board',1000),{version:1,kind:'student-board',strokes:[]});
  assert.equal(Core.parseBoard(good,'lesson-whiteboard',1000),null,'a student board is not a lesson whiteboard');
  assert.equal(Core.parseBoard(good,'student-board',10),null,'too big');
  assert.equal(Core.parseBoard('{"version":2,"kind":"student-board"}','student-board',1000),null);
  assert.equal(Core.parseBoard('[1]','student-board',1000),null);
  assert.equal(Core.parseBoard('not json','student-board',1000),null);
  assert.equal(Core.parseBoard('null','student-board',1000),null);
  assert.equal(Core.parseBoard('','student-board',1000),null);
});

test('teacher makes folders and subfolders: two levels, no duplicates, at most 60',()=>{
  let state=empty();
  let step=Core.addFolder(state,{id:'chumash',name:' Chumash ',now:10});
  assert.deepEqual(step.changes,{'folders/chumash':{name:'Chumash',order:10,createdAt:10}});
  state=step.state;
  step=Core.addFolder(state,{id:'p1',name:'Perek 1',parentId:'chumash',now:20});
  assert.deepEqual(step.changes,{'folders/p1':{name:'Perek 1',order:20,createdAt:20,parentId:'chumash'}});
  state=step.state;
  assert.match(Core.addFolder(state,{id:'deep',name:'Too deep',parentId:'p1'}).error,/main folder/);
  assert.match(Core.addFolder(state,{id:'x',name:'chumash'}).error,/already a folder/);
  assert.match(Core.addFolder(state,{id:'x',name:'   '}).error,/Type a name/);
  assert.ok(Core.addFolder(state,{id:'bad id',name:'Navi'}).error);
  assert.ok(Core.addFolder(state,{id:'x',name:'Navi',parentId:'missing'}).error);
  assert.equal(Core.addFolder(state,{id:'p1b',name:'Perek 1'}).error,undefined,'same name is fine at another level');
  assert.equal(Core.folderLabel(state,'p1'),'Chumash › Perek 1');
  assert.equal(Core.folderLabel(state,'gone'),'');
  assert.deepEqual(Core.folderTree(state),[{id:'chumash',name:'Chumash',children:[{id:'p1',name:'Perek 1'}]}]);
  assert.deepEqual(Core.folderOptions(state).map(option=>option.label),['Chumash','Chumash › Perek 1']);
  let full=empty();
  for(let i=0;i<60;i++)full=Core.addFolder(full,{id:'f'+i,name:'Folder '+i,now:i}).state;
  assert.match(Core.addFolder(full,{id:'f60',name:'One more'}).error,/60 folders/);
});

test('rename, point students to a folder, and delete a folder safely',()=>{
  let state=Core.addFolder(empty(),{id:'chumash',name:'Chumash',now:1}).state;
  state=Core.addFolder(state,{id:'p1',name:'Perek 1',parentId:'chumash',now:2}).state;
  state=Core.addFolder(state,{id:'navi',name:'Navi',now:3}).state;
  assert.deepEqual(Core.renameFolder(state,'p1','Perek 2').changes,{'folders/p1/name':'Perek 2'});
  assert.match(Core.renameFolder(state,'navi','CHUMASH').error,/already a folder/);
  assert.equal(Core.renameFolder(state,'navi','navi ').error,undefined,'keeping its own name is allowed');
  assert.ok(Core.renameFolder(state,'gone','x').error);
  const pointed=Core.setSaveTarget(state,'p1');
  assert.deepEqual(pointed.changes,{saveTarget:'p1'});
  assert.ok(Core.setSaveTarget(state,'gone').error);
  assert.deepEqual(Core.setSaveTarget(pointed.state,null).changes,{saveTarget:null});
  // Deleting the main folder removes its subfolder and stops pointing students at it. Only folder rows change.
  const removed=Core.removeFolder(pointed.state,'chumash');
  assert.deepEqual(removed.changes,{'folders/chumash':null,'folders/p1':null,saveTarget:null});
  assert.deepEqual(Object.keys(removed.state.folders),['navi']);
  assert.equal(removed.state.saveTarget,null);
  assert.ok(Object.keys(removed.changes).every(key=>key==='saveTarget'||key.startsWith('folders/')),'never touches student files');
  assert.equal(Core.removeFolder(pointed.state,'navi').state.saveTarget,'p1','deleting another folder keeps the pointer');
});

test('folders read from the database are cleaned: bad rows, orphans and a stale pointer are dropped',()=>{
  const state=Core.cleanFolders({saveTarget:'orphan',folders:{
    good:{name:'Chumash',order:2,createdAt:1},
    child:{name:'Perek 1',parentId:'good',order:1,createdAt:1},
    orphan:{name:'Lost',parentId:'missing'},
    grandchild:{name:'Too deep',parentId:'child'},
    'bad id':{name:'x'},
    blank:{name:'  '},
    junk:'text'
  }});
  assert.deepEqual(Object.keys(state.folders).sort(),['child','good']);
  assert.equal(state.saveTarget,null);
  assert.deepEqual(Core.cleanFolders(null),empty());
  assert.deepEqual(Core.cleanFolders({folders:'x',saveTarget:5}),empty());
  assert.equal(Core.cleanFolders({saveTarget:'good',folders:{good:{name:'A'}}}).saveTarget,'good');
});

test('a student sees files by folder; files from a deleted folder move to Other and are never lost',()=>{
  let state=Core.addFolder(empty(),{id:'chumash',name:'Chumash',now:1}).state;
  state=Core.addFolder(state,{id:'p1',name:'Perek 1',parentId:'chumash',now:2}).state;
  const files=[{id:'a',folderId:'p1',savedAt:1},{id:'b',folderId:'p1',savedAt:5},{id:'c',folderId:'chumash',savedAt:2},{id:'d',folderId:null,savedAt:3},{id:'e',folderId:'deleted',savedAt:4}];
  const groups=Core.groupFiles(files,state);
  assert.deepEqual(groups.map(group=>[group.label,group.files.map(file=>file.id)]),[['Chumash',['c']],['Chumash › Perek 1',['b','a']],['Other',['e','d']]]);
  const after=Core.groupFiles(files,Core.removeFolder(state,'chumash').state);
  assert.deepEqual(after.map(group=>group.label),['My files']);
  assert.equal(after[0].files.length,files.length);
  assert.deepEqual(Core.groupFiles([],state),[]);
});

test('PDF place memory: keyed by name, size and date; cleaned; newest 60 kept; broken storage is harmless',()=>{
  assert.equal(Core.fingerprint({name:'Chumash.pdf',size:1234,lastModified:99}),'file:Chumash.pdf|1234|99');
  assert.notEqual(Core.fingerprint({name:'Chumash.pdf',size:1235,lastModified:99}),Core.fingerprint({name:'Chumash.pdf',size:1234,lastModified:99}));
  assert.equal(Core.fingerprint({name:'x.pdf'}),null);
  assert.equal(Core.fingerprint(null),null);
  assert.deepEqual(Core.cleanPosition({page:'7',zoom:99,top:2,left:-1,at:5,layout:{spread:true,shift:1}}),{page:7,zoom:5,at:5,top:1,left:0,layout:{spread:true,rtl:true,shift:false}});
  assert.deepEqual(Core.cleanPosition({page:-3}),{page:1,zoom:1,at:0});
  assert.equal(Core.cleanPosition('x'),null);
  const storage=memory();
  assert.equal(Core.readPosition(storage,'k'),null);
  assert.equal(Core.savePosition(storage,'k',{page:4,zoom:1.5,top:0.25,left:0,at:10}),true);
  assert.deepEqual(Core.readPosition(storage,'k'),{page:4,zoom:1.5,at:10,top:0.25,left:0});
  for(let i=0;i<80;i++)Core.savePosition(storage,'file'+i,{page:i+1,at:100+i});
  const kept=JSON.parse(storage.data.fttPdfPositions);
  assert.equal(Object.keys(kept).length,60);
  assert.ok(kept.file79&&!kept.file0&&!kept.k,'the oldest places are dropped first');
  storage.data.fttPdfPositions='{broken';
  assert.equal(Core.readPosition(storage,'file79'),null);
  assert.equal(Core.savePosition(storage,'again',{page:2,at:1}),true);
  assert.equal(Core.savePosition({getItem:()=>null,setItem(){throw Error('full')}},'x',{page:1}),false);
  assert.equal(Core.savePosition(storage,null,{page:1}),false);
});

test('errors are shown in plain words; a rules refusal says saving is not turned on yet',()=>{
  assert.equal(Core.errorText({code:'storage/unauthorized',message:'Firebase Storage: User does not have permission'}),'Saving is not turned on yet. Ask your teacher.');
  assert.equal(Core.errorText({code:'PERMISSION_DENIED',message:'PERMISSION_DENIED: Permission denied'}),'Saving is not turned on yet. Ask your teacher.');
  assert.equal(Core.errorText(Error('permission_denied at /b3Games')),'Saving is not turned on yet. Ask your teacher.');
  assert.match(Core.errorText({code:'storage/unauthorized'},true),/Ask the Fun Torah owner/);
  assert.match(Core.errorText({code:'storage/unauthenticated'}),/not signed in/);
  assert.match(Core.errorText({code:'storage/object-not-found'}),/not there any more/);
  assert.match(Core.errorText(Error('Failed to fetch')),/Check the internet/);
  assert.equal(Core.errorText(Core.plain('Type a name first.')),'Type a name first.');
  assert.equal(Core.errorText(Error('TypeError: x is undefined at line 4')),'Something went wrong. Please try again.','internal details are not shown');
  for(const text of [Core.NOT_ON,Core.errorText({}),Core.sizeProblem('pdf',1e12)])assert.ok(!text.includes('—'),'no em dashes in user text');
});

// ---------- Firebase rules (HIGH RISK; nothing here is deployed by tests) ----------
test('class folder rule: only the class teacher, admin or owner may write; shape and depth are validated',()=>{
  // The rule is a proposal in the doc only; the live rules file must not carry it until the owner approves.
  const live=JSON.parse(fs.readFileSync(path.join(base,'firebase-rules.json'),'utf8')).rules.b3Games.workspaces.$workspaceId.classes.$classId;
  assert.equal(live.pointerFileFolders,undefined,'not added to the live rules file without owner approval');
  const doc=fs.readFileSync(path.join(base,'class-pointer-prototype/SAVED-WORK-RULES.md'),'utf8');
  const at=doc.indexOf('"pointerFileFolders": {'),end=doc.indexOf('```',at);
  assert.ok(at>=0);
  const rule=JSON.parse('{'+doc.slice(at,end)+'}').pointerFileFolders;
  assert.match(rule['.write'],/exactly the classPointerSessions \.write expression/,'same teacher-of-this-class condition as live Pointer sessions');
  assert.equal(rule['.read'],undefined,'no new read grant');
  const folder=rule.folders.$folderId;
  assert.match(folder['.validate'],/hasChildren\(\['name', 'order', 'createdAt'\]\)/);
  assert.match(folder.name['.validate'],/length <= 40/);
  assert.match(folder.parentId['.validate'],/child\('parentId'\)\.exists\(\)/,'a subfolder cannot hold another folder');
  assert.equal(folder.$other['.validate'],false);
  assert.equal(rule.$other['.validate'],false);
  assert.match(rule.saveTarget['.validate'],/child\('folders'\)\.child\(newData\.val\(\)\)\.exists\(\)/);
});

test('proposed Storage rules keep student files private to that student in that class, with type and size limits',()=>{
  const doc=fs.readFileSync(path.join(base,'class-pointer-prototype/SAVED-WORK-RULES.md'),'utf8');
  assert.match(doc,/HIGH RISK/);assert.match(doc,/NOT DEPLOYED/);
  const at=doc.indexOf('match /studentFiles/{classId}/{studentId}/{fileId}'),end=doc.indexOf('```',at);
  assert.ok(at>=0);
  const rules=doc.slice(at,end);
  assert.match(rules,/request\.auth\.token\.b3StudentRole == 'student'/);
  assert.match(rules,/request\.auth\.token\.b3StudentId == studentId/);
  assert.match(rules,/request\.auth\.token\.b3ClassId == classId/);
  assert.match(rules,/request\.resource\.size <= 3 \* 1024 \* 1024/);
  assert.match(rules,/request\.resource\.size <= 2 \* 1024 \* 1024/);
  assert.match(rules,/request\.resource\.size <= 25 \* 1024 \* 1024/);
  assert.match(rules,/match \/pointerWhiteboards\/\{teacherUid\}\/\{fileId\}/);
  assert.match(rules,/request\.auth\.uid == teacherUid/);
  assert.ok(!/if true/.test(rules),'nothing public');
  assert.ok(!rules.includes('=**'),'no recursive wildcard');
  // The limits in the rules and in the page must agree.
  assert.equal(Core.LIMITS.boardBytes,3*1024*1024);assert.equal(Core.LIMITS.pngBytes,2*1024*1024);
  assert.equal(Core.LIMITS.pdfBytes,25*1024*1024);assert.equal(Core.LIMITS.teacherBoardBytes,10*1024*1024);
  assert.match(rules,/request\.resource\.size <= 10 \* 1024 \* 1024/);
});

test('saved-work Storage rules are present in review candidates, not selected by Firebase deploy config',()=>{
  for(const file of ['storage-rules.hardened.rules','security/pointer-pdf-library-merged-storage.rules']){
    const text=fs.readFileSync(path.join(base,file),'utf8');
    assert.match(text,/match \/studentFiles\/\{classId\}\/\{studentId\}\/\{fileId\}/,file);
    assert.match(text,/match \/pointerWhiteboards\/\{teacherUid\}\/\{fileId\}/,file);
    assert.match(text,/request\.auth\.token\.b3StudentId == studentId/,file);
    assert.match(text,/request\.auth\.token\.b3ClassId == classId/,file);
    assert.match(text,/request\.auth\.uid == teacherUid/,file);
    assert.match(text,/request\.resource\.size <= 25 \* 1024 \* 1024/,file);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(base,'firebase.json'),'utf8')).storage,undefined);
  assert.equal(JSON.parse(fs.readFileSync(path.join(base,'firebase.security-test.json'),'utf8')).storage.rules,'storage-rules.hardened.rules');
});
