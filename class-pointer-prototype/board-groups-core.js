'use strict';
// Class Pointer whiteboards: small groups that share one board.
//
// The teacher splits the students who are here into groups. This file only holds the rules: who is in which group,
// random and balanced splitting, moving a student, renaming, and checking what was remembered in the browser. It does not
// touch the network or the page (student-boards.js uses it).
//
//   state = {v:1, groups:[{id:'g1',name:'Group 1'}], assign:{<person>:{g:'g1', c:'m1', n:'Dan'}}, next:3}
//   person = the student's id (or, for a student without one, a name key). g = group id, c = a short code that marks
//   that person's lines on the group board, n = their name (so the list can still show them when they are away).
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.ClassPointerGroups=api;
})(typeof window!=='undefined'?window:null,function(){
  const LIMITS={groups:30,people:200,name:30,key:80};
  // Control and direction-changing characters never belong in a name (built from code numbers, so none sits in this file).
  const range=(a,b)=>String.fromCharCode(a)+'-'+String.fromCharCode(b);
  const CONTROL=new RegExp('['+[range(0,0x1f),range(0x7f,0x7f),range(0x200b,0x200f),range(0x2028,0x202e),range(0x2066,0x2069),range(0xfeff,0xfeff)].join('')+']','g');
  const cleanName=(value,max)=>String(value==null?'':value).replace(CONTROL,' ').replace(/\s+/g,' ').trim().slice(0,max||LIMITS.name);
  const cleanKey=value=>String(value==null?'':value).replace(CONTROL,'').trim().slice(0,LIMITS.key);
  const validGroup=id=>typeof id==='string'&&/^g[0-9]{1,4}$/.test(id);
  const validCode=code=>typeof code==='string'&&/^m[0-9]{1,5}$/.test(code);
  const empty=()=>({v:1,groups:[],assign:{},next:1});

  // Anything read back from the browser's storage is checked: groups that are not named properly, people in groups that
  // do not exist, and codes that are not unique inside their group are dropped.
  function clean(raw){
    const state=empty();
    if(!raw||typeof raw!=='object'||raw.v!==1||!Array.isArray(raw.groups))return state;
    const seen=new Set();
    for(const group of raw.groups.slice(0,LIMITS.groups)){
      if(!group||!validGroup(group.id)||seen.has(group.id))continue;
      seen.add(group.id);state.groups.push({id:group.id,name:cleanName(group.name)||'Group'});
    }
    const codes=new Set();
    let count=0;
    for(const key of Object.keys(raw.assign&&typeof raw.assign==='object'?raw.assign:{})){
      const entry=raw.assign[key],person=cleanKey(key);
      if(count>=LIMITS.people||!person||!entry||!seen.has(entry.g)||!validCode(entry.c))continue;
      const unique=entry.g+':'+entry.c;
      if(codes.has(unique))continue;
      codes.add(unique);count++;
      state.assign[person]={g:entry.g,c:entry.c,n:cleanName(entry.n)};
    }
    const top=Math.max(0,...state.groups.map(g=>Number(g.id.slice(1))),...Object.values(state.assign).map(a=>Number(a.c.slice(1))));
    state.next=Math.max(Math.floor(Number(raw.next))||1,top+1);
    return state;
  }

  const groupOf=(state,person)=>state.assign[cleanKey(person)]?.g||'';
  const codeOf=(state,person)=>state.assign[cleanKey(person)]?.c||'';
  const groupById=(state,id)=>state.groups.find(g=>g.id===id)||null;
  const membersOf=(state,id)=>Object.keys(state.assign).filter(key=>state.assign[key].g===id);

  // Names are "Group 1", "Group 2" ... and a name that is free is used again after a group is removed.
  function freeName(state){
    const used=new Set(state.groups.map(g=>g.name));
    for(let i=1;i<=LIMITS.groups+1;i++)if(!used.has('Group '+i))return 'Group '+i;
    return 'Group';
  }
  function newGroup(state){
    if(state.groups.length>=LIMITS.groups)return null;
    const group={id:'g'+state.next++,name:freeName(state)};
    state.groups.push(group);return group;
  }

  // Split the people who are here into groups: `count` groups, or groups of about `size`. Everyone is placed, the groups
  // differ by at most one person. `random` is a function
  // that gives a number from 0 up to (not including) 1. Earlier groups are replaced; students who are not here keep none.
  function split(state,people,options={},random=Math.random){
    const list=[],seen=new Set();
    for(const person of Array.isArray(people)?people:[]){
      const key=cleanKey(person?.key);
      if(key&&!seen.has(key)){seen.add(key);list.push({key,name:cleanName(person.name)})}
    }
    list.length=Math.min(list.length,LIMITS.people);
    if(!list.length)return{error:'No students are here yet.'};
    let count=Math.floor(Number(options.count));
    if(!(count>=1)){
      const size=Math.floor(Number(options.size));
      if(!(size>=1))return{error:'Choose how many groups, or how many students in each group.'};
      count=Math.ceil(list.length/size);
    }
    count=Math.min(count,list.length,LIMITS.groups);
    for(let i=list.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[list[i],list[j]]=[list[j],list[i]]}
    const next=empty();next.next=state.next;
    const made=[];for(let i=0;i<count;i++)made.push(newGroup(next));
    list.forEach((person,index)=>{
      const group=made[index%count];
      next.assign[person.key]={g:group.id,c:'m'+next.next++,n:person.name};
    });
    return{state:next};
  }

  // Move one student into a group, or out of all groups ('' = no group). A new code is made when the group changes, so two
  // people in one group never share a code.
  function move(state,person,groupId,name){
    const key=cleanKey(person);
    if(!key)return false;
    if(!groupId){const had=!!state.assign[key];delete state.assign[key];return had}
    if(!groupById(state,groupId))return false;
    const old=state.assign[key];
    if(old&&old.g===groupId){if(name)old.n=cleanName(name)||old.n;return false}
    if(!old&&Object.keys(state.assign).length>=LIMITS.people)return false;
    state.assign[key]={g:groupId,c:'m'+state.next++,n:cleanName(name)||old?.n||''};
    return true;
  }
  function rename(state,groupId,name){
    const group=groupById(state,groupId),next=cleanName(name);
    if(!group||!next||group.name===next)return false;
    group.name=next;return true;
  }
  // An empty group is removed (the groups list never keeps one nobody is in, except while the teacher is arranging).
  function dropEmpty(state){
    const used=new Set(Object.values(state.assign).map(a=>a.g)),before=state.groups.length;
    state.groups=state.groups.filter(g=>used.has(g.id));
    return state.groups.length!==before;
  }
  const ungroup=()=>empty();
  return{LIMITS,empty,clean,groupOf,codeOf,groupById,membersOf,newGroup,split,move,rename,dropEmpty,ungroup,cleanName};
});
