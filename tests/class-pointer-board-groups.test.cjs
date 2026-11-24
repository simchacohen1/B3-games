'use strict';
// Groups on student boards: the rules for splitting students, moving them, and reading back what was remembered.
const test=require('node:test');
const assert=require('node:assert/strict');
const G=require('../class-pointer-prototype/board-groups-core.js');
const people=n=>Array.from({length:n},(_,i)=>({key:'s'+i,name:'Student '+i}));
const sizes=state=>state.groups.map(g=>G.membersOf(state,g.id).length).sort();
// A fixed "random" so the tests are repeatable.
const seeded=()=>{let x=7;return()=>{x=(x*16807)%2147483647;return(x-1)/2147483646}};

test('split by number of groups: everyone is placed once and the groups differ by at most one student',()=>{
  for(const [n,groups] of [[10,3],[7,2],[5,5],[3,9],[1,1],[30,4]]){
    const made=G.split(G.empty(),people(n),{count:groups},seeded());
    assert.ok(made.state,String(n));
    const state=made.state,s=sizes(state);
    assert.equal(state.groups.length,Math.min(groups,n),'never more groups than students');
    assert.equal(Object.keys(state.assign).length,n,'everyone has a group');
    assert.ok(s[s.length-1]-s[0]<=1,'balanced '+n+'/'+groups+': '+s);
  }
});

test('split by group size makes enough groups of about that size',()=>{
  const state=G.split(G.empty(),people(9),{size:3},seeded()).state;
  assert.deepEqual(sizes(state),[3,3,3]);
  assert.equal(G.split(G.empty(),people(10),{size:4},seeded()).state.groups.length,3);
});

test('split is random but fair: different draws put students in different groups, nobody is dropped or doubled',()=>{
  const a=G.split(G.empty(),people(12),{count:3},()=>0.1).state,b=G.split(G.empty(),people(12),{count:3},()=>0.9).state;
  assert.notDeepEqual(Object.fromEntries(Object.entries(a.assign).map(([k,v])=>[k,v.g])),Object.fromEntries(Object.entries(b.assign).map(([k,v])=>[k,v.g])));
  for(const state of [a,b])assert.deepEqual(Object.keys(state.assign).sort(),people(12).map(p=>p.key).sort());
});

test('split refuses nothing-to-split and unclear requests, and ignores duplicate or empty students',()=>{
  assert.match(G.split(G.empty(),[],{count:2}).error,/No students/);
  assert.match(G.split(G.empty(),people(4),{}).error,/how many groups/);
  assert.match(G.split(G.empty(),people(4),{count:0,size:0}).error,/how many groups/);
  const state=G.split(G.empty(),[{key:'a',name:'A'},{key:'a',name:'A again'},{key:'',name:'X'},null],{count:2},seeded()).state;
  assert.deepEqual(Object.keys(state.assign),['a']);
  assert.equal(state.groups.length,1);
});

test('every student in a group has a code that is different from everyone else in that group',()=>{
  const state=G.split(G.empty(),people(20),{count:4},seeded()).state;
  for(const g of state.groups){
    const codes=G.membersOf(state,g.id).map(k=>G.codeOf(state,k));
    assert.equal(new Set(codes).size,codes.length);
    for(const c of codes)assert.match(c,/^m[0-9]+$/);
  }
});

test('moving a student keeps the others where they are; a moved student gets a new code; "no group" leaves the groups',()=>{
  const state=G.split(G.empty(),people(6),{count:2},seeded()).state;
  const [g1,g2]=state.groups.map(g=>g.id);
  const who=G.membersOf(state,g1)[0],old=G.codeOf(state,who),others=G.membersOf(state,g1).slice(1);
  assert.equal(G.move(state,who,g2,'Moved'),true);
  assert.equal(G.groupOf(state,who),g2);assert.notEqual(G.codeOf(state,who),old);
  for(const k of others)assert.equal(G.groupOf(state,k),g1);
  assert.equal(G.move(state,who,g2),false,'already there: nothing changes');
  assert.equal(G.move(state,who,'g999'),false,'a group that does not exist');
  assert.equal(G.move(state,who,''),true);assert.equal(G.groupOf(state,who),'');
  assert.equal(G.move(state,who,''),false);
  // A student who was never in a group can be put in one.
  assert.equal(G.move(state,'newcomer',g1,'New Kid'),true);
  assert.equal(state.assign.newcomer.n,'New Kid');
});

test('new groups get free names; renaming is cleaned; an empty group can be dropped',()=>{
  const state=G.empty();
  const a=G.newGroup(state),b=G.newGroup(state);
  assert.deepEqual([a.name,b.name],['Group 1','Group 2']);
  assert.equal(G.rename(state,a.id,'  The   Lions  '),true);
  assert.equal(G.groupById(state,a.id).name,'The Lions');
  assert.equal(G.rename(state,a.id,'   '),false);
  assert.equal(G.rename(state,'nope','x'),false);
  assert.equal(G.rename(state,a.id,'x'.repeat(100)),true);
  assert.equal(G.groupById(state,a.id).name.length,G.LIMITS.name);
  G.move(state,'s1',a.id,'S1');
  assert.equal(G.dropEmpty(state),true);
  assert.deepEqual(state.groups.map(g=>g.id),[a.id]);
  const gone=G.empty();for(let i=0;i<40;i++)G.newGroup(gone);
  assert.equal(gone.groups.length,G.LIMITS.groups);
});

test('what is remembered in the browser is checked when it is read back',()=>{
  const good=G.split(G.empty(),people(6),{count:2},seeded()).state;
  assert.deepEqual(G.clean(JSON.parse(JSON.stringify(good))).assign,good.assign);
  assert.deepEqual(G.clean(null),G.empty());
  assert.deepEqual(G.clean('x'),G.empty());
  assert.deepEqual(G.clean({v:2,groups:[],assign:{}}),G.empty());
  const messy=G.clean({v:1,groups:[{id:'g1',name:'<b>A</b>'},{id:'g1',name:'dup'},{id:'bad',name:'x'},{id:'g2'}],
    assign:{a:{g:'g1',c:'m1',n:'A'},b:{g:'g9',c:'m2'},c:{g:'g1',c:'m1'},d:{g:'g2',c:'zz'},e:{g:'g2',c:'m3',n:'E'}},next:2});
  assert.deepEqual(messy.groups.map(g=>g.id),['g1','g2']);
  assert.deepEqual(Object.keys(messy.assign).sort(),['a','e'],'a missing group, a repeated code and a bad code are dropped');
  assert.ok(messy.next>3,'new ids and codes can never repeat old ones');
  assert.equal(G.cleanName('a‮b'),'a b');
});

test('the person key and the name are cleaned before they are kept',()=>{
  const state=G.empty();const g=G.newGroup(state);
  assert.equal(G.move(state,'  ‮bob\u0000 ',g.id,'  Bob\n\tSmith '),true);
  assert.deepEqual(Object.keys(state.assign),['bob']);
  assert.equal(state.assign.bob.n,'Bob Smith');
});
