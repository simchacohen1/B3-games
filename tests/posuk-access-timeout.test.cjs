'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('game-gate.js','utf8');
const helper=source.slice(source.indexOf('  async function fetchJson('),source.indexOf('  let followLoader='));
const timeout=Number(source.match(/var FETCH_TIMEOUT_MS = (\d+);/)[1]);
function setup(){
  let timer, request, finish;
  const ready=new Promise(resolve=>{finish=resolve;});
  const c={URLSearchParams,AbortController,Promise,Date,Error,FETCH_TIMEOUT_MS:timeout,
    authReadyPromise:Promise.resolve(),window:{firebase:{auth:()=>({currentUser:{getIdToken:async()=>'test-token'}})}},
    setTimeout(fn,ms){timer={fn,ms};return timer;},clearTimeout(){timer=null;},
    fetch(url,options){request={url,options};finish();return new Promise(resolve=>{request.resolve=resolve;});}};
  vm.runInNewContext(helper,c);
  return {c,ready,get timer(){return timer;},get request(){return request;}};
}
test('slow valid access reads have a bounded 15-second window and retain authentication',async()=>{
  const h=setup(),pending=h.c.fetchJson('https://example.test/settings.json');await h.ready;
  assert.equal(h.timer.ms,15000);
  assert.equal(new URL(h.request.url).searchParams.get('auth'),'test-token');
  assert.equal(h.request.options.cache,'no-store');
  assert.equal(h.request.options.signal.aborted,false);
  h.request.resolve({ok:true,json:async()=>({siteEnabled:false})});
  assert.equal((await pending).siteEnabled,false,'closed setting is preserved, not overridden');
  assert.equal(h.timer,null);
});
test('timeout aborts the transport, ignores late replies, and permits a fresh retry',async()=>{
  const h=setup(),pending=h.c.fetchJson('https://example.test/settings.json');await h.ready;
  const first=h.request;
  const rejection=assert.rejects(pending,/Access check timed out/);
  h.timer.fn();await rejection;assert.equal(first.options.signal.aborted,true);
  first.resolve({ok:true,json:async()=>({siteEnabled:true})});
  const retry=h.c.fetchJson('https://example.test/settings.json');
  while(h.request===first)await Promise.resolve();
  h.request.resolve({ok:true,json:async()=>({siteEnabled:false})});
  assert.equal((await retry).siteEnabled,false);
});
test('permission rejection is still an error and cancels its timer',async()=>{
  const h=setup(),pending=h.c.fetchJson('https://example.test/settings.json');await h.ready;
  h.request.resolve({ok:false,status:403});await assert.rejects(pending,/HTTP 403/);
  assert.equal(h.timer,null);
});
test('only Posuk opts into the revised gate asset version in this repair',()=>{
  assert.match(fs.readFileSync('record_pesukim/student.html','utf8'),/game-gate\.js\?v=20261021-posuk-access-timeout/);
});
