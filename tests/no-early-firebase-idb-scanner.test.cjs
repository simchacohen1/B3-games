'use strict';
// Regression guard for the fresh-browser sign-in hang fixed in PR 349.
// An inline page script opened Firebase's own IndexedDB database
// ('firebaseLocalStorageDb') before Firebase Auth did. On a brand-new browser
// that created the database without its object store and kept it open, so Auth
// could not repair it and sign-in stayed on "Checking...". Firebase Auth must be
// the only page code that opens this database.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
// Old copies and hidden preview folders are left alone on purpose.
const skipDir=name=>name==='node_modules'||name==='vendor'||name.startsWith('.')||name.startsWith('backup-before-')||name.startsWith('preview-');
function htmlPages(dir=root,out=[]){
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  if(entry.isDirectory()){if(!skipDir(entry.name))htmlPages(path.join(dir,entry.name),out);}
  else if(entry.name.endsWith('.html'))out.push(path.join(dir,entry.name));
 }
 return out;
}
const opensFirebaseAuthDb=source=>/indexedDB\s*\.\s*open\s*\(\s*['"]firebaseLocalStorageDb['"]/.test(source);

test('the guard recognizes the removed scanner',()=>{
 assert.equal(opensFirebaseAuthDb("const idbReq = indexedDB.open('firebaseLocalStorageDb', 1);"),true);
 assert.equal(opensFirebaseAuthDb('indexedDB.open("myOwnDb", 1)'),false);
});

test('no site page opens Firebase Auth\'s IndexedDB database itself',()=>{
 const pages=htmlPages();
 assert.ok(pages.length>50,'expected to scan the whole site, found '+pages.length+' pages');
 const offenders=pages.filter(file=>opensFirebaseAuthDb(fs.readFileSync(file,'utf8'))).map(file=>path.relative(root,file).replace(/\\/g,'/'));
 assert.deepEqual(offenders,[]);
});

test('pages that used the scanner still load Firebase Auth for sign-in',()=>{
 for(const page of ['chazara/index.html','shorashim/index.html','record_pesukim/student.html','record_pesukim/teacher.html','halacha/index.html','student-rewards/student.html','game-show/player.html','class-gallery/index.html']){
  const source=fs.readFileSync(path.join(root,page),'utf8');
  assert.match(source,/firebase-auth(-compat)?\.js|game-gate\.js|site-settings\.js/,page+' lost its sign-in scripts');
 }
});
