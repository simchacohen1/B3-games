const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const backend=fs.readFileSync('backend/functions/student-rewards-auto-award.js','utf8');
async function contribute(actual,amount=25,{missing=false,roundFails=false}={}){
 const goal={available:true,modeVoting:false,remainingStudentCap:100,remainingGoal:100,studentCap:100,goalPoints:100,perStudentCost:10,name:'Prize'};
 let balance=actual,round=null,roundWrites=0,historyWrites=0;
 const root={students:{child:{rewardBalance:100}},classRewardCatalog:{prize:{}}};
 const db={ref(path){return {
  async get(){return {val:()=>root}},
  async transaction(fn){
   if(path.endsWith('/rewardBalance')){
    const initial=fn(null);
    if(initial===undefined)return {committed:false,snapshot:{val:()=>null}};
    if(missing)return {committed:true,snapshot:{val:()=>null}};
    const next=fn(balance);if(next===undefined)return {committed:false,snapshot:{val:()=>balance}};
    balance=next;return {committed:true,snapshot:{val:()=>balance}};
   }
   if(roundFails)return {committed:false,snapshot:{val:()=>null}};
   round=fn(null);roundWrites++;return {committed:round!==undefined,snapshot:{val:()=>round}};
  },
  push(){return {key:'contribution',async set(){historyWrites++}}}
 }}};
 const ctx={rtdb:db,SR_ROOT:'studentRewards',chooseStudentClass:()=> 'et',rewardsStore:{storeOpenFor:()=>true,itemInStore:()=>true},classRewardGoalFromRoot:()=>goal,Date,DAY_MS:86400000,console};
 vm.runInNewContext(backend.slice(backend.indexOf('async function contributeToClassReward('),backend.indexOf('async function mirrorChazaraPointStatus(')),ctx);
 const result=await ctx.contributeToClassReward('child','prize',amount);
 return {result,balance,round,roundWrites,historyWrites};
}
test('cold-cache null retries actual balance and deducts contribution exactly once',async()=>{
 const r=await contribute(100);assert.equal(r.result.ok,true);assert.equal(r.balance,75);assert.equal(r.round.totalContributed,25);assert.equal(r.historyWrites,1);
});
test('real insufficient balance, including a concurrent spend, never funds a goal',async()=>{
 for(const actual of [0,20]){const r=await contribute(actual);assert.equal(r.result.ok,false);assert.equal(r.balance,actual);assert.equal(r.roundWrites,0);assert.equal(r.historyWrites,0)}
});
test('missing balance cannot create a free contribution',async()=>{const r=await contribute(100,25,{missing:true});assert.equal(r.result.ok,false);assert.equal(r.roundWrites,0)});
test('failed class-round update refunds deducted points',async()=>{const r=await contribute(100,25,{roundFails:true});assert.equal(r.result.ok,false);assert.equal(r.balance,100);assert.equal(r.historyWrites,0)});
test('contribution uses the same spendable balance as displayed server balance',async()=>{
 const src=fs.readFileSync('student-rewards/student.js','utf8');
 const ctx={state:{serverRewardBalance:100,student:{rewardBalance:0},classGoals:[{rewardId:'gimkit',modeVoting:true,remainingStudentCap:200}],busy:false},C:{toast(){assert.fail('Should accept 25 points')}},isStoreOpen:()=>true,timeMs:()=>0,document:{getElementById:()=>({value:'25'})},render(){},classRewardsApi:async()=>{throw Error('reached server')},console};
 vm.runInNewContext(src.slice(src.indexOf('function spendableRewardBalance(){'),src.indexOf('function classGoalProgress(')),ctx);
 assert.equal(ctx.spendableRewardBalance(),100);
 assert.match(src,/Math\.min\(spendableRewardBalance\(\)/);
 ctx.state.serverRewardBalance=null;ctx.state.student.rewardBalance=40;assert.equal(ctx.spendableRewardBalance(),40);
});
