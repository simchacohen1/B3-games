const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/../weekly-quiz/nigri-sync.js','utf8');
const page=fs.readFileSync(__dirname+'/../weekly-quiz/teacher.html','utf8');

test('the script is valid JavaScript',()=>{ new vm.Script(src); });
test('teacher page loads the sign-in helper before nigri-sync.js',()=>{
  const a=page.indexOf('../sync-to-nigri/nigri-auth.js'),b=page.indexOf('<script src="nigri-sync.js">');
  assert.ok(a>0&&b>a);
});
test('the old key is still the fallback and the write goes only to /sync-marks',()=>{
  assert.match(src,/window\.NigriAuth\.request\('\/sync-marks'[\s\S]*?,\s*SYNC_KEY\)/);
  assert.match(src,/'X-Sync-Key': SYNC_KEY/);   // used only when the helper is missing
  assert.equal((src.match(/sync-marks/g)||[]).length,2); // SYNC_URL constant + helper call
});

// Run just the sending block with fakes.
const block=src.match(/\/\/ Google sign-in first;[\s\S]*?\$\('nigriVia'\)\.textContent = [^\n]*\n/)[0];
async function send({helper,fetchImpl}){
  const via={textContent:''},calls=[];
  const sandbox={window:helper?{NigriAuth:helper}:{},SYNC_URL:'https://nigrisync.onrender.com/sync-marks',SYNC_KEY:'fake-key',body:{a:1},
    $:id=>via,fetch:async(u,o)=>{calls.push({u,o});return fetchImpl()}};
  vm.createContext(sandbox);
  const result=await vm.runInContext('(async()=>{try{'+block+'return {res,via}}catch(e){return {error:e.message}}})()',sandbox);
  return {via:via.textContent,calls,result};
}
test('shows "Signed in" when the sign-in was accepted and passes the key only as fallback',async()=>{
  let args;const out=await send({helper:{request:async(...a)=>{args=a;return{response:{status:200},via:'signin'}}}});
  assert.equal(out.via,'Signed in');assert.equal(args[0],'/sync-marks');assert.equal(args[2],'fake-key');
  assert.equal(args[1].headers['X-Sync-Key'],undefined);assert.equal(JSON.parse(args[1].body).a,1);
});
test('shows "Used key" when the helper fell back to the key',async()=>{
  const out=await send({helper:{request:async()=>({response:{status:200},via:'key'})}});
  assert.equal(out.via,'Used key');
});
test('works exactly as before with the key if the helper file is missing',async()=>{
  const out=await send({helper:null,fetchImpl:()=>({status:200})});
  assert.equal(out.via,'Used key');assert.equal(out.calls.length,1);
  assert.equal(out.calls[0].o.headers['X-Sync-Key'],'fake-key');assert.equal(out.calls[0].u,'https://nigrisync.onrender.com/sync-marks');
});
test('a network failure is not retried (no double write)',async()=>{
  const out=await send({helper:{request:async()=>{throw new Error('offline')}}});
  assert.equal(out.result.error,'offline');assert.equal(out.via,'');
});
