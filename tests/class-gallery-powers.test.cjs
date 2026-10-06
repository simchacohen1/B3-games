const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function server(mode='regular',classId='et'){
  const data={},root=classId==='et'?'b3Games/classGalleryTag/'+(mode==='manhunt'?'manhunt':'all'):'b3Games/workspaces/b3-2026/classes/'+classId+'/resources/gallery/tag/class_'+classId;
  const resource='b3Games/workspaces/b3-2026/classes/'+classId+'/resources/gallery';
  data['studentRewards/students/reward/rewardBalance']=100;
  data['studentRewards/students/reward']={name:'Student'};
  data[classId==='et'?'b3Games/classGalleryPresenceSettings/tagEnabled':resource+'/settings/tagEnabled']=true;
  data[classId==='et'?'b3Games/classGalleryPresence':resource+'/presence']={[classId]:{student:{session:{playingTag:true,tagMode:mode,space:'hallway',updatedAt:Date.now()}}}};
  data['b3Games/workspaces/b3-2026/classes/'+classId]={active:true,members:{student:{active:true}}};
  const read=p=>data[p],snap=v=>({val:()=>v,exists:()=>v!=null,child:p=>snap(p.split('/').reduce((a,k)=>a?.[k],v))});
  const ref=p=>({get:async()=>snap(read(p)),child:k=>ref(p+'/'+k),set:async v=>{data[p]=v},update:async v=>{data[p]={...data[p],...v}},transaction:async fn=>{const v=fn(read(p));if(v===undefined)return {committed:false,snapshot:snap(read(p))};data[p]=v;return {committed:true,snapshot:snap(v)}}});
  const admin={apps:[{}],database:()=>({ref}),auth:()=>({verifyIdToken:async()=>({studentRewardsStudentId:'reward',studentRewardsRole:'student',b3StudentId:'student',b3ClassId:classId})})},exports={};
  vm.runInNewContext(fs.readFileSync('backend/functions/class-gallery-powers.js','utf8'),{exports,require:n=>n==='firebase-admin'?admin:{onRequest:(o,fn)=>fn},console,Date,Math});
  return {data,root,run:async powerId=>{const res={set(){},status(c){this.code=c;return this},json(b){this.body=b;return this}};await exports.classGalleryPowerPurchase({method:'POST',headers:{authorization:'Bearer token'},body:{action:'purchase',b3StudentId:'student',mode,classId,powerId}},res);return res}};
}
for(const [mode,classId] of [['regular','et'],['manhunt','et'],['regular','new_class']])test(`Speed activates in ${mode} / ${classId} and charges once`,async()=>{const s=server(mode,classId),r=await s.run('speed');assert.equal(r.code,200,JSON.stringify(r.body));assert.equal(s.data['studentRewards/students/reward/rewardBalance'],98);assert.ok(s.data[s.root+'/effects/student'].speedUntil>Date.now());assert.equal(s.data[s.root+'/powerSpend/student'].spent,2)});
test('Manhunt runner cannot buy Freeze or lose points',async()=>{const s=server('manhunt'),r=await s.run('freeze');assert.equal(r.code,409);assert.equal(s.data['studentRewards/students/reward/rewardBalance'],100)});
test('Manhunt hunter cannot buy Invisible',async()=>{const s=server('manhunt');s.data[s.root+'/hunters/student']=true;assert.equal((await s.run('invisible')).code,409);assert.equal(s.data['studentRewards/students/reward/rewardBalance'],100)});
test('An active timed power rejects a second purchase without charging',async()=>{const s=server();s.data[s.root+'/effects/student']={speedUntil:Date.now()+10000};assert.equal((await s.run('speed')).code,409);assert.equal(s.data['studentRewards/students/reward/rewardBalance'],100)});
for(const powerId of ['dash','teleport','invisible','shield'])test(`${powerId} is delivered to Regular Tag`,async()=>{const s=server(),r=await s.run(powerId);assert.equal(r.code,200);const effect=s.data[s.root+'/effects/student'];assert.ok(effect[powerId==='dash'?'dashToken':powerId==='teleport'?'teleportToken':powerId+'Until']);});
for(const fails of [false,true])test(`Shop ${fails?'stays open after failure':'closes after activation'}`,async()=>{
  const source=fs.readFileSync('class-gallery/index.html','utf8'),start=source.lastIndexOf('buyTagPower=async function('),end=source.indexOf('openPowerShop=function()',start);
  const note={textContent:''},ctx={TAG_POWERS:{speed:{name:'Speed',icon:'speed'}},powerBusy:false,tagOptedIn:true,tagMode:'regular',isTeacher:false,powerAllowedInCurrentMode:()=>true,powerCurrentlyActive:()=>false,document:{getElementById:()=>note},renderPowerShop(){},showTagPop(){},closePowerShop(){ctx.closed=true},callPowerApi:async()=>{if(fails)throw Error('Purchase failed');return {balance:98,spent:2,cooldownUntil:100}},closed:false};
  vm.runInNewContext(source.slice(start,end),ctx);await ctx.buyTagPower('speed');assert.equal(ctx.closed,!fails);assert.equal(ctx.powerBusy,false);if(fails)assert.equal(note.textContent,'Purchase failed');
});
