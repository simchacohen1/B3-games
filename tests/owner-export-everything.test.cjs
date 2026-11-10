'use strict';
// Issue #724: Owner Admin "Export Everything". Fictional people and an
// in-memory database only. Runs against the live functions folder and the
// staging mirror so the two copies cannot drift.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const X=require('../owner-export.js');

const OWNER={uid:'owner_uid',email:'simcha5770@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};
const ADMIN={uid:'admin_uid',email:'admin@test.example',email_verified:true,firebase:{sign_in_provider:'google.com'}};
const TEACHER={uid:'teacher_uid',email:'rabbi.one@test.example',email_verified:true,firebase:{sign_in_provider:'google.com'}};
const PRINCIPAL={uid:'principal_uid',email:'principal.north@test.example',email_verified:true,firebase:{sign_in_provider:'google.com'}};

function db(tree){
 const parts=p=>p.split('/').filter(Boolean);
 const get=async p=>{const v=parts(p).reduce((o,k)=>o?.[k],tree);return v===undefined?null:structuredClone(v)};
 const set=(p,v)=>{const k=parts(p),last=k.pop();let o=tree;for(const x of k)o=o[x]??={};if(v===null||v===undefined)delete o[last];else o[last]=structuredClone(v)};
 const writes=[];
 return {tree,get,writes,update:async u=>{writes.push(u);for(const [p,v] of Object.entries(u))set(p,v)}};
}
const member=(id,name,extra={})=>({studentId:id,name,active:true,...extra});
const ship=classId=>({['b3-2026_'+classId]:{workspaceId:'b3-2026',classId,active:true}});
function site(){
 return db({
  b3Games:{
   admins:{admin_uid:{active:true}},
   students:{
    s_avi:{profile:{id:'s_avi',name:'Avi Alef',active:true},memberships:{...ship('north_a'),...ship('north_b')},halacha:{done:2}},
    s_bina:{profile:{id:'s_bina',name:'Bina, "Bee" Beis',active:true},memberships:ship('north_a')},
    s_chaim:{profile:{id:'s_chaim',name:'חיים גימל',active:true},memberships:ship('south_a')},
    // In no class, and turned off.
    s_dov:{profile:{id:'s_dov',name:'Dov Daled',active:false},memberships:{'b3-2026_north_a':{workspaceId:'b3-2026',classId:'north_a',active:false}}},
    // Passcode still in the old public place.
    s_ezra:{profile:{id:'s_ezra',name:'Ezra Hey',active:true,passcode:'004455'},memberships:ship('noschool_a')},
    demo_abc:{profile:{id:'demo_abc',name:'Rabbi One (demo)',active:true,demo:true},memberships:ship('north_a')}
   },
   workspaces:{'b3-2026':{
    schools:{north:{name:'North School'},south:{name:'South School'},empty_school:{name:'Empty School'}},
    classes:{
     north_a:{name:'North A',active:true,schoolId:'north',members:{s_avi:member('s_avi','Avi Alef'),s_bina:member('s_bina','Bina, "Bee" Beis'),demo_abc:member('demo_abc','Rabbi One (demo)',{demo:true}),s_dov:member('s_dov','Dov Daled',{active:false})}},
     north_b:{name:'North B',active:true,schoolId:'north',members:{s_avi:member('s_avi','Avi Alef')}},
     north_empty:{name:'North Empty',active:true,schoolId:'north'},
     south_a:{name:'South A',active:true,schoolId:'south',members:{s_chaim:member('s_chaim','חיים גימל')}},
     noschool_a:{name:'No School A',active:true,members:{s_ezra:member('s_ezra','Ezra Hey')}}
    },
    students:{s_avi:{schoolId:'north',classIds:{north_a:true,north_b:true}},s_dov:{schoolId:'north'}},
    teacherInvites:{
     rabbi_one:{email:'rabbi.one@test.example',name:'Rabbi One',role:'teacher',active:true,schoolId:'north',classIds:{north_a:true,north_b:true},claimedUid:'teacher_uid'},
     rabbi_two:{email:'rabbi.two@test.example',name:'Rabbi Two',role:'teacher',active:true,schoolId:'north',classIds:{north_a:true}},
     rabbi_empty:{email:'rabbi.empty@test.example',name:'Rabbi Empty Class',role:'teacher',active:true,schoolId:'north',classIds:{north_empty:true}},
     rabbi_idle:{email:'rabbi.idle@test.example',name:'Rabbi Idle',role:'teacher',active:false,schoolId:'south'},
     principal_north:{email:'principal.north@test.example',name:'Principal North',role:'principal',accountType:'principal',schoolId:'north',claimedUid:'principal_uid'},
     principal_spare:{email:'principal.spare@test.example',name:'Principal Spare',role:'principal',accountType:'principal'}
    },
    teachers:{teacher_uid:{email:'rabbi.one@test.example',active:true,classIds:{north_a:true,north_b:true}},principal_uid:{email:'principal.north@test.example',active:true,accountType:'principal',classIds:{north_a:true}}}
   }}
  },
  b3Private:{passcodes:{s_avi:{passcode:'012345'},s_bina:{passcode:'222222'},s_chaim:{passcode:'333333'},s_dov:{passcode:'444444'},demo_abc:{passcode:'demo-secret'}}}
 });
}

// Reads back a stored (uncompressed) zip, checking each entry's CRC.
function unzip(bytes){
 const buf=Buffer.from(bytes),files={};
 const end=buf.lastIndexOf(Buffer.from([0x50,0x4b,5,6]));
 assert.ok(end>=0,'zip end record');
 let at=buf.readUInt32LE(end+16);
 for(let i=0;i<buf.readUInt16LE(end+10);i++){
  assert.equal(buf.readUInt32LE(at),0x02014b50,'central directory entry');
  assert.equal(buf.readUInt16LE(at+10),0,'stored, not compressed');
  const crc=buf.readUInt32LE(at+16),size=buf.readUInt32LE(at+24),nameLen=buf.readUInt16LE(at+28),local=buf.readUInt32LE(at+42);
  const name=buf.toString('utf8',at+46,at+46+nameLen);
  assert.equal(buf.readUInt32LE(local),0x04034b50,'local header');
  const start=local+30+buf.readUInt16LE(local+26)+buf.readUInt16LE(local+28),data=buf.subarray(start,start+size);
  assert.equal(X.crc32(data),crc,'crc of '+name);
  files[name]=data.toString('utf8');
  at+=46+nameLen+buf.readUInt16LE(at+30)+buf.readUInt16LE(at+32);
 }
 return files;
}
const unxml=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&');
function sheetRows(xml,width){
 return [...xml.matchAll(/<row r="\d+">(.*?)<\/row>/gs)].map(m=>{
  const row=Array(width).fill('');
  for(const c of m[1].matchAll(/<c r="([A-Z]+)\d+" t="inlineStr"[^>]*><is><t xml:space="preserve">(.*?)<\/t><\/is><\/c>/gs))row[c[1].charCodeAt(0)-65]=unxml(c[2]);
  return row;
 });
}
function csvRows(text){
 assert.equal(text.charCodeAt(0),0xFEFF,'byte-order mark');
 const rows=[];let row=[],cur='',q=false;
 for(let i=1;i<text.length;i++){
  const ch=text[i];
  if(q){if(ch==='"'&&text[i+1]==='"'){cur+='"';i++;}else if(ch==='"')q=false;else cur+=ch;}
  else if(ch==='"')q=true;
  else if(ch===','){row.push(cur);cur='';}
  else if(ch==='\r'&&text[i+1]==='\n'){row.push(cur);rows.push(row);row=[];cur='';i++;}
  else cur+=ch;
 }
 return rows;
}

for(const dir of ['functions','functions-staging']){
 const {manageStudents}=require(path.join(__dirname,'..','backend',dir,'student-management-core.cjs'));
 const run=(store,who=OWNER)=>manageStudents(store,who,{action:'exportEverything'},1767225600000);
 const byName=r=>Object.fromEntries(r.rows.filter(x=>x[0]).map(x=>[x[0],x]));

 test(dir+': only the owner check lets the export through',async()=>{
  for(const who of [TEACHER,PRINCIPAL,{...OWNER,email_verified:false},{...OWNER,firebase:{sign_in_provider:'password'}},{uid:'x',email:'simcha5770@gmail.com.evil.example',email_verified:true,firebase:{sign_in_provider:'google.com'}}]){
   const store=site();
   await assert.rejects(run(store,who),e=>e.code===403);
   assert.equal(store.writes.length,0);
  }
  // The existing check also accepts an active site administrator.
  assert.equal((await run(site(),ADMIN)).ok,true);
 });

 test(dir+': one row per student with passcode, school, classes, teachers and principal',async()=>{
  const r=await run(site());
  assert.deepEqual(r.header,['Student name','Passcode','School','Classes','Teachers','Principal','Note']);
  const s=byName(r);
  assert.deepEqual(Object.keys(s).sort(),['Avi Alef','Bina, "Bee" Beis','Dov Daled','Ezra Hey','חיים גימל'].sort(),'every student once, no demo student');
  assert.deepEqual(s['Avi Alef'],['Avi Alef','012345','North School','North A; North B','Rabbi One; Rabbi Two','Principal North','']);
  // No owner record: the school comes from the student's classes.
  assert.deepEqual(s['Bina, "Bee" Beis'],['Bina, "Bee" Beis','222222','North School','North A','Rabbi One; Rabbi Two','Principal North','']);
  assert.deepEqual(s['חיים גימל'],['חיים גימל','333333','South School','South A','','','']);
  assert.deepEqual(s['Dov Daled'],['Dov Daled','444444','North School','','','Principal North','Account is turned off; Not in any class']);
  assert.deepEqual(s['Ezra Hey'],['Ezra Hey','004455','','No School A','','','No school chosen']);
  assert.equal(r.counts.students,5);
  assert.ok(!JSON.stringify(r.rows).includes('demo-secret'));
 });

 test(dir+': classes, teachers, principals and schools with no students are still listed',async()=>{
  const r=await run(site());
  const extra=r.rows.filter(x=>!x[0]);
  assert.deepEqual(extra,[
   ['','','North School','North Empty','Rabbi Empty Class','Principal North','Class with no students'],
   ['','','South School','','Rabbi Idle','','Teacher with no students'],
   ['','','','','','Principal Spare','Principal with no students'],
   ['','','Empty School','','','','School with no students']
  ]);
  assert.equal(r.counts.withoutStudents,4);
  // Nothing on the site is missing from the table.
  const all=JSON.stringify(r.rows),ws=site().tree.b3Games.workspaces['b3-2026'];
  for(const group of [ws.schools,ws.classes,ws.teacherInvites])for(const v of Object.values(group))assert.ok(all.includes(JSON.stringify(v.name).slice(1,-1)),v.name+' is in the export');
 });

 test(dir+': the export changes nothing except one audit entry',async()=>{
  const store=site(),before=structuredClone(store.tree);
  await run(store);
  assert.equal(store.writes.length,1);
  const [[p,entry]]=Object.entries(store.writes[0]);
  assert.match(p,/^b3Private\/studentAudit\/[0-9a-f-]{36}$/);
  assert.equal(entry.action,'exportEverything');assert.equal(entry.byEmail,OWNER.email);
  assert.ok(!JSON.stringify(entry).includes('012345'),'no passcode in the audit log');
  delete store.tree.b3Private.studentAudit;
  assert.deepEqual(store.tree,before);
 });

 test(dir+': the Excel file and the CSV hold identical data',async()=>{
  const r=await run(site()),table=[r.header,...r.rows];
  const files=unzip(X.toXlsx(table,'Everything'));
  assert.deepEqual(Object.keys(files).sort(),['[Content_Types].xml','_rels/.rels','xl/_rels/workbook.xml.rels','xl/styles.xml','xl/workbook.xml','xl/worksheets/sheet1.xml']);
  const fromXlsx=sheetRows(files['xl/worksheets/sheet1.xml'],r.header.length),fromCsv=csvRows(X.toCsv(table));
  assert.deepEqual(fromXlsx,table);
  assert.deepEqual(fromCsv,table);
  // Passcodes are text in Excel, so a leading zero is kept.
  assert.match(files['xl/worksheets/sheet1.xml'],/t="inlineStr"><is><t xml:space="preserve">012345</);
  assert.ok(!/<c [^>]*t="n"|<v>/.test(files['xl/worksheets/sheet1.xml']),'no numeric cells');
 });
}

test('files survive awkward text',()=>{
 const table=[['A','B'],['x & <y> "z"','line\nbreak, comma'],['=1+1','\u0001ctrl']];
 const clean=table.map(r=>r.map(X.cellText));
 assert.deepEqual(csvRows(X.toCsv(table)),clean);
 assert.deepEqual(sheetRows(unzip(X.toXlsx(table))['xl/worksheets/sheet1.xml'],2),clean);
 assert.equal(clean[2][1],'ctrl');
});

test('Owner Admin has the button, wired to the server export',()=>{
 const html=fs.readFileSync(path.join(__dirname,'..','owner-admin.html'),'utf8');
 assert.match(html,/<script src="owner-export\.js\?v=[\w-]+"><\/script>/);
 assert.match(html,/<button id="exportEverything" type="button">Export Everything<\/button>/);
 assert.ok(html.indexOf('id="exportEverythingCard"')>html.indexOf('id="ownerArea"'),'inside the owner-only area');
 assert.match(html,/manageCall\(\{action:"exportEverything"\}\)/);
 assert.match(html,/downloadFile\(name\+"\.xlsx",FTTOwnerExport\.toXlsx\(table,/);
 assert.match(html,/downloadFile\(name\+"\.csv",FTTOwnerExport\.toCsv\(table\)/);
 // The page never reads passcodes itself; they only come from the owner-checked function.
 assert.ok(!/b3Private/.test(html.replace(/\/\/.*$/gm,'')));
});
