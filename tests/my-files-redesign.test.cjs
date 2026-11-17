'use strict';
// The student My files page: grid and list, date groups, sorting, subjects, the student's own folders, stars, "From my
// teacher", and one item per worksheet. The rules are in class-pointer-prototype/my-files-core.js.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const M=require('../class-pointer-prototype/my-files-core.js');
const Core=require('../class-pointer-prototype/saved-work-core.js');
const files=require('../backend/functions/teacher-student-files-core.cjs');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

// Wednesday 18 November 2026, 12:00 (local time). The week starts on Sunday: Sun 15 is the start of this week.
const NOW=new Date(2026,10,18,12,0,0).getTime();
const at=(month,day,hour=10)=>new Date(2026,month,day,hour,0,0).getTime();
const file=(id,extra={})=>({id,ext:'json',kind:'whiteboard',name:id,folderId:null,subject:'',template:false,worksheet:false,pages:1,sheetId:'',fromTeacher:false,important:false,lastPage:1,zoom:1,savedAt:at(10,18,9),placeAt:0,size:1,...extra});

test('dates are grouped Today, Yesterday, Earlier this week, Last week, Older',()=>{
  assert.equal(M.dateGroup(at(10,18,8),NOW),'Today');
  assert.equal(M.dateGroup(at(10,17,23),NOW),'Yesterday');
  assert.equal(M.dateGroup(at(10,16,9),NOW),'Earlier this week'); // Monday
  assert.equal(M.dateGroup(at(10,15,9),NOW),'Earlier this week'); // Sunday, start of the week
  assert.equal(M.dateGroup(at(10,14,23),NOW),'Last week');         // Saturday
  assert.equal(M.dateGroup(at(10,8,9),NOW),'Last week');
  assert.equal(M.dateGroup(at(10,7,23),NOW),'Older');
  assert.equal(M.dateGroup(0,NOW),'Older');
  assert.deepEqual(M.DAY_GROUPS,['Today','Yesterday','Earlier this week','Last week','Older']);
});

test('a worksheet is ONE item: the teacher\'s PDF, the student\'s copy and the filled-in pictures are merged',()=>{
  const copy=file('copy1',{ext:'pdf',kind:'pdf',name:'Chumash words',sheetId:'sh1',savedAt:at(10,17)});
  const done=file('done1',{name:'Chumash words · יום ג׳',worksheet:true,pages:3,sheetId:'sh1',savedAt:at(10,18,11)});
  const sheets=[{id:'sh1',name:'Chumash words',sentAt:at(10,16),subject:'Chumash',important:true},{id:'sh2',name:'Fresh sheet',sentAt:at(10,18,8),subject:'',important:false}];
  const items=M.buildItems([copy,done,file('plain')],sheets,M.emptyPrefs());
  const worksheets=items.filter(item=>item.kind==='worksheet');
  assert.equal(worksheets.length,2,'one per worksheet, never the PDF and the filled copy separately');
  const started=worksheets.find(item=>item.key==='sheet-sh1');
  assert.equal(started.status,'Your work is saved');assert.equal(started.picture,done);assert.equal(started.filled,done);assert.equal(started.copy,copy);
  assert.equal(started.subject,'Chumash');assert.equal(started.fromTeacher,true);assert.equal(started.time,at(10,18,11));
  assert.equal(items.some(item=>item.files.includes(copy)&&item.kind==='pdf'),false,'the PDF copy is not listed on its own');
  assert.equal(worksheets.find(item=>item.key==='sheet-sh2').status,'New');
  assert.equal(items.filter(item=>item.kind==='whiteboard').length,1);
  // The teacher took the worksheet back: the student's own work is still there.
  const orphan=M.buildItems([copy,done],[],M.emptyPrefs());
  assert.equal(orphan.length,1);assert.equal(orphan[0].name,'Chumash words');
});

test('teacher items are marked; an important one arrives starred and the student can unstar it',()=>{
  const board=file('t1',{name:'From your teacher 11/16/2026 10:29 AM',subject:'Mishnayos',important:true,fromTeacher:true});
  const own=file('o1');
  const [t,o]=M.buildItems([board,own],[],M.emptyPrefs());
  assert.equal(t.fromTeacher,true);assert.equal(t.subject,'Mishnayos');assert.equal(t.starred,true);
  assert.equal(o.fromTeacher,false);assert.equal(o.starred,false);
  const unstarred=M.buildItems([board],[],M.setStar(M.emptyPrefs(),'t1',false).prefs)[0];
  assert.equal(unstarred.starred,false,'the student\'s choice wins');
  const starredOwn=M.buildItems([own],[],M.setStar(M.emptyPrefs(),'o1',true).prefs)[0];
  assert.equal(starredOwn.starred,true);
  // New copies carry the mark in their saved details; old copies are recognised by their name.
  assert.equal(Core.fileFromMetadata({name:'x.json',customMetadata:Core.fileMetadata({name:'Copy',kind:'whiteboard',fromTeacher:true,important:true,subject:'Chumash'})}).fromTeacher,true);
  assert.equal(Core.fileFromMetadata({name:'x.json',customMetadata:{displayName:'From your teacher 11/16/2026'}}).fromTeacher,true);
  assert.equal(Core.fileFromMetadata({name:'x.json',customMetadata:{displayName:'My notes'}}).fromTeacher,false);
});

test('the student\'s own folders: new, rename, move, delete (files are kept), no duplicates',()=>{
  let prefs=M.emptyPrefs();
  assert.match(M.addFolder(prefs,'   ').error,/Type a name/);
  const made=M.addFolder(prefs,'  Chumash  ',Core.newId());prefs=made.prefs;
  assert.deepEqual(prefs.folders.map(f=>f.name),['Chumash']);
  assert.match(M.addFolder(prefs,'chumash').error,/already have a folder/);
  prefs=M.moveItem(prefs,'file1',made.id).prefs;
  assert.equal(M.buildItems([file('file1')],[],prefs)[0].folder,made.id);
  assert.match(M.moveItem(prefs,'file1','nope').error,/not there/);
  prefs=M.renameFolder(prefs,made.id,'Mishnayos').prefs;assert.equal(prefs.folders[0].name,'Mishnayos');
  prefs=M.removeFolder(prefs,made.id).prefs;
  assert.deepEqual(prefs.folders,[]);assert.equal(M.buildItems([file('file1')],[],prefs)[0].folder,'');
  assert.equal(M.moveItem(M.emptyPrefs(),'../x','').error,'That file cannot be moved.');
  const many=Array.from({length:M.MAX_FOLDERS},(_,i)=>({id:'f'+i,name:'F'+i}));
  assert.match(M.addFolder({...M.emptyPrefs(),folders:many},'one more').error,/already have 30/);
});

test('saved settings are cleaned when read, and pruned when saved',()=>{
  const clean=M.cleanPrefs({version:1,folders:[{id:'a1',name:'Good'},{id:'../b',name:'Bad id'},{id:'a2',name:'good'},{id:'a3',name:''}],place:{k1:'a1',k2:'gone','../x':'a1'},starred:{k1:true,k2:'yes','k 3':true,k4:false}});
  assert.deepEqual(clean.folders,[{id:'a1',name:'Good'}]);
  assert.deepEqual(clean.place,{k1:'a1'});
  assert.deepEqual(clean.starred,{k1:true,k4:false});
  assert.deepEqual(M.cleanPrefs(null),M.emptyPrefs());assert.deepEqual(M.cleanPrefs({version:2}),M.emptyPrefs());
  const pruned=M.prune({...clean,place:{k1:'a1',gone:'a1'},starred:{k1:true,gone:true}},[{key:'k1'}]);
  assert.deepEqual(pruned.place,{k1:'a1'});assert.deepEqual(pruned.starred,{k1:true});
  // The settings file is not one of the student's files and never shows to the teacher.
  assert.equal(Core.fileFromMetadata({name:Core.PREFS_ID+'.json',customMetadata:{kind:'prefs'}}),null);
});

test('views: All files shows everything, Starred only starred, a folder only its files',()=>{
  let prefs=M.addFolder(M.emptyPrefs(),'Mine','f1').prefs;
  prefs=M.moveItem(prefs,'a','f1').prefs;prefs=M.setStar(prefs,'b',true).prefs;
  const items=M.buildItems([file('a'),file('b'),file('c',{folderId:'cls1'})],[],prefs);
  assert.equal(M.filterItems(items,{type:'all'}).length,3,'whatever folder it is in');
  assert.deepEqual(M.filterItems(items,{type:'starred'}).map(i=>i.key),['b']);
  assert.deepEqual(M.filterItems(items,{type:'folder',id:'f1'}).map(i=>i.key),['a']);
  assert.deepEqual(M.filterItems(items,{type:'class',id:'cls1'}).map(i=>i.key),['c']);
});

test('sorting: date groups newest first with starred pinned on top of Today; name; type; subject',()=>{
  const prefs=M.setStar(M.emptyPrefs(),'old',true).prefs;
  const list=M.buildItems([
    file('new1',{name:'Beta',savedAt:at(10,18,11),subject:'Navi'}),file('new0',{name:'alpha',savedAt:at(10,18,9)}),
    file('yest',{name:'Yesterday',savedAt:at(10,17)}),file('week',{name:'Week',savedAt:at(10,16)}),file('last',{name:'Last',savedAt:at(10,10)}),
    file('old',{name:'Old starred',savedAt:at(8,1),subject:'Chumash'}),file('pdf1',{ext:'pdf',kind:'pdf',name:'A PDF',savedAt:at(10,18,10)})
  ],[{id:'s1',name:'Sheet',sentAt:at(10,18,7),subject:'Chumash'}],prefs);
  const byDate=M.arrange(list,{sort:'date',now:NOW});
  assert.deepEqual(byDate.map(g=>g.label),['Today','Yesterday','Earlier this week','Last week']);
  assert.deepEqual(byDate[0].items.map(i=>i.name),['Old starred','Beta','A PDF','alpha','Sheet'],'starred first, then newest first');
  assert.equal(byDate[0].pinned,1);
  assert.equal(M.arrange(list,{sort:'date',now:NOW,pin:false}).some(g=>g.label==='Older'),true,'in the Starred view nothing is pinned');
  const byName=M.arrange(list,{sort:'name'});assert.equal(byName.length,1);
  assert.deepEqual(byName[0].items.slice(0,3).map(i=>i.name),['A PDF','alpha','Beta']);
  assert.deepEqual(M.arrange(list,{sort:'type'}).map(g=>g.label),['Worksheets','PDFs','Whiteboards']);
  const bySubject=M.arrange(list,{sort:'subject'});
  assert.deepEqual(bySubject.map(g=>g.label),['Chumash','Navi','No subject']);
  assert.deepEqual(M.arrange([],{sort:'date'}),[]);
});

test('the page: one Open button, grid and list, remembered choices, folders with drag and drop and Move, stars, badge',()=>{
  const js=read('class-pointer-prototype/my-files.js'),html=read('class-pointer-prototype/my-files.html');
  for(const old of ["'Continue'","'Fill in'","'See picture'","'See pictures'","ui.manageButtons"])assert.equal(js.includes(old),false,old+' is gone');
  assert.match(js,/ui\.button\('Open',\(\)=>openItem\(item\),'main'\)/);
  assert.match(js,/function openItem\(item\)\{\s*if\(item\.kind==='worksheet'\)\{\s*if\(item\.filled\)return openFilled\(item\.filled\)/,'Open continues where the student left off');
  assert.match(js,/localStorage\.setItem\('fttMyFiles:'/);assert.match(js,/remember\('view',mode\)/);assert.match(js,/remember\('sort',sort\)/);
  assert.match(html,/id="viewGrid"/);assert.match(html,/id="viewList"/);assert.match(html,/<option value="date">Date<\/option><option value="name">Name<\/option><option value="type">Type<\/option><option value="subject">Subject<\/option>/);
  assert.match(html,/id="newFolder"[^>]*>＋ New folder</);
  assert.match(js,/node\.draggable=true/);assert.match(js,/addEventListener\('drop'/);assert.match(js,/Move to folder/);
  assert.match(js,/ui\.h\('span','mf-badge','From my teacher'\)/);
  assert.match(js,/item\.starred\?'★':'☆'/);
  assert.match(js,/navButton\('All files'/);assert.match(js,/navButton\('⭐ Starred'/);
  assert.doesNotMatch(html,/Worksheets from your teacher/,'worksheets are listed with everything else');
  assert.match(html,/my-files-core\.js\?v=20261116-live2/);
});

test('the teacher\'s send: "Mark as important" on boards and worksheets, subject travels with it',()=>{
  const boards=read('class-pointer-prototype/student-boards.js'),lib=read('class-pointer-prototype/pdf-library.js'),saved=read('class-pointer-prototype/saved-work.js');
  assert.match(boards,/box\.id='boardsImportant'/);assert.match(boards,/Mark as important/);
  assert.match(boards,/raw\.important===true\?\{important:true\}/);
  assert.match(boards,/keepTeacherCopy\?\.\(\{kind:'image',data:activity\.data,id:activity\.id,subject:activity\.subject,important:activity\.important\}\)/);
  assert.match(lib,/Mark as important/);assert.match(lib,/function askSend\(title\)/);
  assert.match(saved,/\{subject:file\.subject\|\|''\}/,'a board sent from a subject folder carries the subject');
  assert.match(saved,/subject:Core\.cleanName\(activity\.subject,Core\.LIMITS\.folderName\),fromTeacher:true,important:activity\.important===true/);
  assert.match(saved,/worksheetCall\(\{action:'send',pdfId,name,subject:options\.subject\|\|'',important:options\.important===true\}\)/);
});

test('the worksheet function carries subject and important; no rules change; the settings file is invisible to the teacher',async()=>{
  const ws=require('../backend/functions/class-worksheets-core.cjs');
  assert.equal(read('backend/functions/class-worksheets-core.cjs'),read('backend/functions-staging/class-worksheets-core.cjs'));
  const store=new Map([['pointerPdfLibrary/t1/a.pdf',{type:'application/pdf',size:100,custom:{displayName:'Sheet A'}}]]);
  const bucket={async getFiles({prefix}){return[[...store.entries()].filter(([n])=>n.startsWith(prefix)).map(([name,o])=>({name,metadata:{size:String(o.size),metadata:o.custom||{}}}))]},
    file(name){return{name,async exists(){return[store.has(name)]},async getMetadata(){const o=store.get(name);return[{contentType:o.type,size:String(o.size),metadata:o.custom}]},async copy(dest){store.set(dest.name,{...store.get(name)})},async setMetadata(m){const o=store.get(name);o.custom={...o.custom,...m.metadata}},async delete(){store.delete(name)}}}};
  const get=async p=>({'b3Games/workspaces/b3-2026/teachers/t1':{active:true,classIds:{c1:true}},'b3Games/workspaces/b3-2026/classes/c1/active':true}[p]??null);
  const identity={uid:'t1',firebase:{sign_in_provider:'google.com'}};
  const sent=await ws.handle({body:{action:'send',classId:'c1',pdfId:'a.pdf',subject:'  Chumash ',important:true},identity,get,bucket,ownerEmail:'',stagingPassword:false});
  assert.equal(sent.subject,'Chumash');assert.equal(sent.important,true);
  const plain=await ws.handle({body:{action:'send',classId:'c1',pdfId:'a.pdf'},identity,get,bucket,ownerEmail:'',stagingPassword:false});
  assert.equal(plain.important,false);
  const list=(await ws.handle({body:{action:'list',classId:'c1'},identity,get,bucket,ownerEmail:'',stagingPassword:false})).worksheets;
  assert.deepEqual(list.map(w=>[w.subject,w.important]).sort(),[['','false'].map((v,i)=>i?false:v),['Chumash',true]].sort());
  // The teacher's list of a student's files never shows the settings file.
  const studentBucket={async getFiles(){return[[
    {name:'studentFiles/c1/s1/ftt-prefs.json',metadata:{metadata:{kind:'prefs',displayName:'My files settings'}}},
    {name:'studentFiles/c1/s1/abc.json',metadata:{metadata:{kind:'whiteboard',displayName:'Real board',savedAt:'5'}}}]]}};
  assert.deepEqual((await files.listFiles({bucket:studentBucket,classId:'c1',studentId:'s1'})).map(f=>f.name),['Real board']);
  for(const rules of ['staging/storage.rules','storage-rules.hardened.rules'])assert.doesNotMatch(read(rules),/ftt-prefs|classWorksheets/,rules);
});
