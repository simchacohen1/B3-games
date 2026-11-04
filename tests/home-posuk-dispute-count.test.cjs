const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');

test('homepage Posuk dispute count includes recordings kept in private storage',()=>{
  const html=fs.readFileSync('index.html','utf8');
  const start=html.indexOf('function approvalValues'),end=html.indexOf('function countNested');
  const ctx={};vm.createContext(ctx);vm.runInContext(html.slice(start,end)+';this.countPosukDisputes=countPosukDisputes;',ctx);
  const attempts={s1:{p1:{a1:{hebrewAudioStoragePath:'x/y.webm',hebrewDisputeStatus:'pending',
    comprehensionAudioURL:'https://x',comprehensionDisputeStatus:'pending',
    questionResults:{q1:{audioStoragePath:'q.webm',disputeStatus:'pending'},q2:{audioURL:'u',disputeStatus:'resolved'}},
    translationChunkResults:[{audioStoragePath:'t.webm',disputeStatus:'pending'}]}}}};
  assert.equal(ctx.countPosukDisputes(attempts),4);
  assert.equal(ctx.countPosukDisputes({s:{p:{a:{hebrewDisputeStatus:'pending'}}}}),0,'no recording = not reviewable');
});
