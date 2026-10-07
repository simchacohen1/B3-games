const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx={window:{},console,Intl,Date,localStorage:{getItem:()=>null,setItem(){}}};
vm.runInNewContext(fs.readFileSync('site-settings.js','utf8'),ctx);
vm.runInNewContext(fs.readFileSync('class-gallery/access.js','utf8'),ctx);
const api=ctx.window.B3SiteSettings,allowed=ctx.window.B3GalleryAccess;
const locked={siteEnabled:true,games:{'class-gallery':true},classGames:{et:{'class-gallery':true}},classAccess:{et:{mode:'auto',lockWindows:{wed:[{start:'08:45',end:'10:17'}]}}}};
const morning=new Date('2026-10-07T12:50:00Z'),recess=new Date('2026-10-07T14:20:00Z');
test('ET student is blocked during class and allowed during recess',()=>{
 assert.equal(allowed(api,locked,'et','moshe_raichman',false,morning),false);
 assert.equal(allowed(api,locked,'et','moshe_raichman',false,recess),true);
});
test('manual class lock and class activity switch block gallery',()=>{
 const s=structuredClone(locked);s.classAccess.et.mode='locked';
 assert.equal(allowed(api,s,'et','child',false,recess),false);
 s.classAccess.et.mode='open';s.classGames.et['class-gallery']=false;
 s.studentGameOverrides={child:{'class-gallery':true}};
 assert.equal(allowed(api,s,'et','child',false,recess),false);
});
test('only actual gallery exceptions bypass schedule; global switch still wins',()=>{
 const s=structuredClone(locked);s.studentGameOverrides={other:{'class-gallery':true}};
 assert.equal(allowed(api,s,'et','child',false,morning),false);
 assert.equal(allowed(api,s,'et','other',false,morning),true);
 s.games['class-gallery']=false;
 assert.equal(allowed(api,s,'et','other',false,morning),false);
});
test('verified teacher retains access; missing student identity or unresolved class stays blocked',()=>{
 assert.equal(allowed(api,locked,'et','child',true,morning),true);
 assert.equal(allowed(api,locked,'et','',false,morning),false);
 assert.equal(allowed(api,locked,'','child',false,morning),false);
});
