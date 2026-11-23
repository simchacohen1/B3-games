const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../class-pointer-prototype/poll-core.js');
test('optional questions and all four answer types',()=>{
  for(const [type,answers] of [['thumbs',['👍','👎']],['numbers',['1','2','3']],['letters',['A','B','C']],['custom',['Red','Blue','Green','Gold']]]){
    const p=C.create(type,'',answers,'p');assert.deepEqual(p.answers,answers);assert.equal(p.question,'');assert.equal(p.show,false);
  }
  for(const answers of [[],['A'],['A','B','C','D','E'],['A','A'],['A',' '],['A','x'.repeat(81)]])assert.throws(()=>C.create('custom','',answers,'p'));
});
test('one vote per identity, changing answer, invalid and ended votes',()=>{
  const p=C.create('letters','Pick one',[],'p');
  assert.equal(C.vote(p,'fictional-a',0),true);C.vote(p,'fictional-a',2);C.vote(p,'fictional-b',1);
  assert.deepEqual(C.counts(p),[0,1,1]);
  for(const index of [-1,3,'1',null,1.5])assert.equal(C.vote(p,'fictional-a',index),false);
  p.open=false;assert.equal(C.vote(p,'fictional-a',0),false);assert.deepEqual(C.counts(p),[0,1,1]);
});
test('student payload hides totals until shared and never includes names/other votes',()=>{
  const p=C.create('thumbs','',[],'p');C.vote(p,'fictional-a',1);
  let v=C.view(p,'fictional-a');assert.equal(v.choice,1);assert.equal('counts' in v,false);assert.equal('votes' in v,false);
  p.show=true;v=C.view(p,'fictional-b');assert.deepEqual(v.counts,[0,1]);assert.equal(v.choice,null);assert.equal(JSON.stringify(v).includes('fictional-a'),false);
  p.show=false;assert.equal('counts' in C.view(p,'fictional-b'),false);
});
test('auto-close timer: 30s / 1 min / 2 min / none, sent to students as seconds left (never a clock time)',()=>{
  for(const seconds of [30,60,120,0,null,undefined])assert.doesNotThrow(()=>C.create('thumbs','',[],'p',seconds));
  for(const seconds of [5,45,-1,'60',1e6])assert.throws(()=>C.create('thumbs','',[],'p',seconds),/timer/);
  const p=C.create('thumbs','',[],'p',60);p.endsAt=1000+60000;
  assert.equal(C.remaining(p,1000),60);assert.equal(C.remaining(p,1000+59001),1);assert.equal(C.remaining(p,1000+70000),0);
  assert.equal(C.view(p,'a',1000).secondsLeft,60);assert.equal('endsAt' in C.view(p,'a',1000),false);
  p.open=false;assert.equal(C.view(p,'a',1000).secondsLeft,null);
  const none=C.create('thumbs','',[],'p',0);assert.equal(C.view(none,'a').secondsLeft,null);
});
