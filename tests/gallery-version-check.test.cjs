'use strict';
// Class Gallery version check: every way a post can change must bump the class
// counter, and classGalleryRead must skip the full posts read only when the
// browser's counter matches, without weakening any access check.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const fnDir=path.join(__dirname,'../backend/functions');
const WS='b3Games/workspaces/b3-2026/';

// ---- tiny in-memory Realtime Database that also fires the registered triggers ----
function makeDb(initial={}){
  let root=JSON.parse(JSON.stringify(initial));
  const log=[];                 // every read the server made, by path
  const triggers=[];            // {pattern, handler}
  const pending=[];
  const parts=p=>String(p).split('/').filter(Boolean);
  const getAt=(tree,p)=>parts(p).reduce((v,k)=>v==null?undefined:v[k],tree);
  const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
  function setAt(tree,p,value){
    const ks=parts(p);if(!ks.length)return value;
    let node=tree;
    ks.slice(0,-1).forEach(k=>{if(typeof node[k]!=='object'||node[k]===null)node[k]={};node=node[k];});
    const last=ks[ks.length-1];
    if(value==null)delete node[last];else node[last]=value;
    return tree;
  }
  // every concrete path that matches a trigger pattern in a tree
  function expand(tree,pattern){
    let hits=[{at:[],params:{},node:tree}];
    for(const seg of parts(pattern)){
      const next=[];
      for(const h of hits){
        if(h.node==null||typeof h.node!=='object')continue;
        const m=/^\{(.+)\}$/.exec(seg);
        if(m)for(const k of Object.keys(h.node))next.push({at:[...h.at,k],params:{...h.params,[m[1]]:k},node:h.node[k]});
        else if(seg in h.node)next.push({at:[...h.at,seg],params:h.params,node:h.node[seg]});
      }
      hits=next;
    }
    return hits;
  }
  function fire(before,after){
    for(const t of triggers){
      const seen=new Map();
      for(const h of expand(before,t.pattern))seen.set(h.at.join('/'),{params:h.params,before:h.node,after:undefined});
      for(const h of expand(after,t.pattern)){const k=h.at.join('/');const prev=seen.get(k)||{params:h.params,before:undefined};seen.set(k,{...prev,params:h.params,after:h.node});}
      for(const ev of seen.values()){
        if(JSON.stringify(ev.before)===JSON.stringify(ev.after))continue;
        pending.push(Promise.resolve(t.handler({params:ev.params,data:{before:{val:()=>clone(ev.before)??null},after:{val:()=>clone(ev.after)??null}}})));
      }
    }
  }
  const resolveValue=(cur,value)=>value&&typeof value==='object'&&'__inc' in value?(Number(cur)||0)+value.__inc:value;
  function ref(p){
    return {
      get:async()=>{log.push(p);const v=getAt(root,p);return snap(clone(v));},
      set:async value=>{const before=clone(root);root=setAt(clone(root),p,resolveValue(getAt(root,p),value))??{};fire(before,root);},
      update:async fields=>{const before=clone(root);let next=clone(root);for(const [k,v] of Object.entries(fields))next=setAt(next,p+'/'+k,v);root=next;fire(before,root);},
      remove:async()=>{const before=clone(root);root=setAt(clone(root),p,null)??{};fire(before,root);},
      transaction:async fn=>{const before=clone(root);const cur=clone(getAt(root,p));const out=fn(cur===undefined?null:cur);const committed=out!==undefined;if(committed){root=setAt(clone(root),p,out);fire(before,root);}return {committed,snapshot:snap(clone(getAt(root,p)))};}
    };
  }
  const snap=value=>({exists:()=>value!=null,val:()=>value??null,child:key=>snap(key.split('/').reduce((v,k)=>v==null?undefined:v[k],value))});
  return {ref,log,triggers,settle:async()=>{while(pending.length)await pending.shift();},raw:()=>root,seed:(p,v)=>{root=setAt(clone(root),p,v)??{};}};
}

function loadModule(file,mocks){
  const mod={exports:{}};
  const requireShim=name=>{
    if(name in mocks)return mocks[name];
    if(name.startsWith('./')){const m=loadModule(path.join(fnDir,name.replace(/^\.\//,'')+(name.endsWith('.js')?'':'.js')),mocks);return m;}
    return require(name);
  };
  new Function('require','module','exports',fs.readFileSync(file,'utf8'))(requireShim,mod,mod.exports);
  return mod.exports;
}

function setup({identity,seed={}}={}){
  const db=makeDb(seed);
  const admin={apps:[{}],initializeApp(){},auth:()=>({verifyIdToken:async()=>identity}),database:()=>db};
  const mocks={
    'firebase-admin':admin,
    'firebase-functions/v2/https':{onRequest:(options,handler)=>handler},
    'firebase-functions/v2/database':{onValueWritten:(options,handler)=>{db.triggers.push({pattern:options.ref,handler,options});return handler;}}
  };
  const version=loadModule(path.join(fnDir,'class-gallery-version.js'),mocks);
  const read=loadModule(path.join(fnDir,'class-gallery-read.js'),mocks);
  return {db,version,read,call:async(classId,{v,since,authed=true}={})=>{
    let code=200,body;
    const res={set(){},status(c){code=c;return this;},json(b){body=b;return this;}};
    db.log.length=0;
    await read.classGalleryRead({method:'GET',headers:authed?{authorization:'Bearer t'}:{},query:{classId,...(v!=null?{v}:{}),...(since?{since}:{})}},res);
    return {code,body,reads:[...db.log]};
  }};
}
const verCls=(db,id)=>db.raw().classGalleryMeta?.[id]?.version??0;
const student=(cls,id='one')=>({uid:'u',b3StudentRole:'student',b3ClassId:cls,b3StudentId:id});
const ws=obj=>({b3Games:{workspaces:{'b3-2026':obj}}});
const baseSeed=cls=>ws({classes:{[cls]:{active:true,members:{one:{active:true}}}}});

// ---------- trigger wiring ----------
test('triggers are registered for the legacy and per-class post lists',()=>{
  const {db}=setup({identity:{}});
  assert.deepEqual(db.triggers.map(t=>t.pattern).sort(),[
    '/b3Games/workspaces/b3-2026/classes/{classId}/resources/gallery/posts/{postId}',
    '/classGallery/posts/{postId}'
  ]);
  assert.ok(db.triggers.every(t=>t.options.region==='us-central1'&&t.options.instance==='b3-games-default-rtdb'));
});
test('read function and trigger helper use the same counter path',()=>{
  const meta=require(path.join(fnDir,'class-gallery-meta.js'));
  const src=fs.readFileSync(path.join(fnDir,'class-gallery-read.js'),'utf8');
  assert.ok(src.includes('`classGalleryMeta/${classId}/version`'));
  assert.equal(meta.versionPath('et'),'classGalleryMeta/et/version');
});
test('index.js exports both triggers',()=>{
  const src=fs.readFileSync(path.join(fnDir,'index.js'),'utf8');
  assert.match(src,/exports\.classGalleryVersionLegacy=/);assert.match(src,/exports\.classGalleryVersionWorkspace=/);
});

// ---------- every write path bumps the counter ----------
for(const cls of ['et','wt']){
  const name=cls==='et'?'B3 ET':'B3 WT',other=cls==='et'?'wt':'et';
  test(`${cls} legacy list: submit, approve, edit, delete each bump only ${cls}`,async()=>{
    const {db}=setup({identity:{}});
    const posts=db.ref('classGallery/posts');
    let last=verCls(db,cls);
    const expectBump=async(label,action)=>{await action();await db.settle();const now=verCls(db,cls);assert.ok(now>last,label+' should bump '+cls);last=now;assert.equal(verCls(db,other),0,label+' must not bump '+other);};
    await expectBump('submit (classGallerySubmit / page push with classId)',()=>db.ref('classGallery/posts/p1').set({classId:cls,studentId:'one',status:'pending',title:'A'}));
    await expectBump('submit of an old-style post that only has className',()=>db.ref('classGallery/posts/p2').set({className:name,status:'pending'}));
    await expectBump('approve (teacher update status)',()=>db.ref('classGallery/posts/p1').update({status:'approved'}));
    await expectBump('edit title',()=>db.ref('classGallery/posts/p1/title').set('B'));
    await expectBump('edit by field update',()=>db.ref('classGallery/posts/p1').update({description:'hello'}));
    await expectBump('reject / hide',()=>db.ref('classGallery/posts/p2').update({status:'removed'}));
    await expectBump('delete',()=>db.ref('classGallery/posts/p1').remove());
    await expectBump('delete of an old-style post',()=>db.ref('classGallery/posts/p2').remove());
    void posts;
  });
}
test('workspace class list: submit, approve, edit, delete bump that class only',async()=>{
  const {db}=setup({identity:{}});
  let last=0;
  const p=id=>`${WS}classes/sc/resources/gallery/posts/${id}`;
  const expectBump=async(label,action)=>{await action();await db.settle();const now=verCls(db,'sc');assert.ok(now>last,label+' should bump sc');last=now;assert.equal(verCls(db,'et'),0);assert.equal(verCls(db,'wt'),0);};
  await expectBump('submit',()=>db.ref(p('a')).set({classId:'sc',studentId:'one',status:'pending'}));
  await expectBump('approve',()=>db.ref(p('a')).update({status:'approved'}));
  await expectBump('edit',()=>db.ref(p('a')+'/title').set('X'));
  await expectBump('delete',()=>db.ref(p('a')).remove());
});
test('a post moved between classes bumps both the old and the new class',async()=>{
  const {db}=setup({identity:{},seed:{classGallery:{posts:{m:{classId:'et',status:'approved'}}}}});
  await db.ref('classGallery/posts/m').update({classId:'wt'});await db.settle();
  assert.ok(verCls(db,'et')>0);assert.ok(verCls(db,'wt')>0);
});
test('overwriting or deleting the whole list bumps every class that had posts',async()=>{
  const {db}=setup({identity:{},seed:{classGallery:{posts:{a:{classId:'et'},b:{className:'B3 WT'}}}}});
  await db.ref('classGallery/posts').remove();await db.settle();
  assert.ok(verCls(db,'et')>0);assert.ok(verCls(db,'wt')>0);
});
test('unrelated writes (presence, settings, other classes) do not bump any counter',async()=>{
  const {db}=setup({identity:{}});
  await db.ref('b3Games/classGalleryPresence/et/s1').set({x:1});
  await db.ref('b3Games/siteSettings/foo').set(true);
  await db.ref(`${WS}classes/et/members/one`).set({active:true});
  await db.ref(`${WS}classes/sc/resources/other/thing`).set(1);
  await db.settle();
  assert.equal(db.raw().classGalleryMeta,undefined);
});
test('two quick writes in a row produce two different counter values',async()=>{
  const {db}=setup({identity:{}});
  await db.ref('classGallery/posts/a').set({classId:'et'});await db.settle();const one=verCls(db,'et');
  await db.ref('classGallery/posts/a').update({status:'approved'});await db.settle();
  assert.ok(verCls(db,'et')>one);
});

test('bulk "approve all" and bulk remove (one multi-path update) bump the class, in both list layouts',async()=>{
  const {db}=setup({identity:{},seed:{
    classGallery:{posts:{a:{classId:'et',status:'pending'},b:{classId:'et',status:'pending'}}},
    ...ws({classes:{sc:{resources:{gallery:{posts:{x:{classId:'sc',status:'pending'},y:{classId:'sc',status:'pending'}}}}}}})}});
  await db.ref('classGallery/posts').update({'a/status':'approved','b/status':'approved'});await db.settle();
  const etAfterApprove=verCls(db,'et');assert.ok(etAfterApprove>0);
  await db.ref('classGallery/posts').update({'a':null,'b':null});await db.settle();
  assert.ok(verCls(db,'et')>etAfterApprove);
  await db.ref(`${WS}classes/sc/resources/gallery/posts`).update({'x/status':'approved','y/status':'approved'});await db.settle();
  const scAfter=verCls(db,'sc');assert.ok(scAfter>0);
  await db.ref(`${WS}classes/sc/resources/gallery/posts`).update({'x':null});await db.settle();
  assert.ok(verCls(db,'sc')>scAfter);
  assert.equal(verCls(db,'wt'),0);
});
test('replacing a picture link or deleting a picture field bumps the class so no stale picture is shown',async()=>{
  const {db}=setup({identity:{},seed:{classGallery:{posts:{p:{classId:'wt',status:'approved',image:'https://example.test/one.jpg'}}}}});
  await db.ref('classGallery/posts/p/image').set('https://example.test/two.jpg');await db.settle();
  const first=verCls(db,'wt');assert.ok(first>0);
  await db.ref('classGallery/posts/p/image').remove();await db.settle();
  assert.ok(verCls(db,'wt')>first);
});
test('a student-side stale browser (older counter) is never told "unchanged" after a picture edit',async()=>{
  const {db,call}=setup({identity:student('et'),seed:readSeed('et')});
  const first=await call('et');
  await db.ref('classGallery/posts/a/image').set('https://example.test/new.jpg');await db.settle();
  const next=await call('et',{v:String(first.body.version)});
  assert.equal(next.body.posts.a.image,'https://example.test/new.jpg');
});
test('the page writes gallery posts only through paths the triggers watch',()=>{
  const writes=[...page.matchAll(/dbRef\.(?:child\([^)]*\)\.)?(push|update|set|remove|transaction)\(/g)].map(m=>m[1]);
  assert.ok(writes.length>=5);
  assert.ok(!/firebase\.database\(\)\.ref\(['"`](?!\.info)[^'"`]*gallery[^'"`]*posts/i.test(page.replace(/readUrl[^;]*;/g,'')),'no second, unwatched write path');
});

// ---------- the read function ----------
const readSeed=cls=>({...baseSeed(cls),classGallery:{posts:{
  a:{classId:'et',status:'approved',image:'data:image/jpeg;base64,AAAA'},
  mine:{classId:'et',studentId:'one',status:'pending'},
  peer:{classId:'et',studentId:'two',status:'pending'},
  w:{className:'B3 WT',status:'approved'}}}});
test('first load does a full read and returns a version; matching version then skips the posts read',async()=>{
  const {call}=setup({identity:student('et'),seed:readSeed('et')});
  const first=await call('et');
  assert.equal(first.code,200);assert.deepEqual(Object.keys(first.body.posts).sort(),['a','mine']);
  assert.ok(Number.isSafeInteger(first.body.version)&&first.body.version>0);
  assert.ok(first.reads.includes('classGallery/posts'));
  const again=await call('et',{v:String(first.body.version)});
  assert.deepEqual(again.body,{unchanged:true,version:first.body.version});
  assert.ok(!again.reads.includes('classGallery/posts'),'unchanged poll must not read the posts tree');
});
test('after any post change the old version gets a full reply with a newer version',async()=>{
  const {db,call}=setup({identity:student('et'),seed:readSeed('et')});
  const first=await call('et');
  await db.ref('classGallery/posts/a').update({status:'removed'});await db.settle();
  const next=await call('et',{v:String(first.body.version)});
  assert.ok(next.body.posts);assert.ok(next.body.version>first.body.version);
  assert.deepEqual(Object.keys(next.body.posts),['mine']);
  assert.ok(next.reads.includes('classGallery/posts'));
});
test('approving a pending post is seen by the next poll',async()=>{
  const {db,call}=setup({identity:student('et'),seed:readSeed('et')});
  const first=await call('et');
  await db.ref('classGallery/posts/peer').update({status:'approved'});await db.settle();
  const next=await call('et',{v:String(first.body.version)});
  assert.deepEqual(Object.keys(next.body.posts).sort(),['a','mine','peer']);
});
test('missing counter is created once; a bad or unknown v never skips the read',async()=>{
  const {db,call}=setup({identity:student('et'),seed:readSeed('et')});
  assert.equal(db.raw().classGalleryMeta,undefined);
  const first=await call('et');assert.equal(first.body.version,1);assert.equal(verCls(db,'et'),1);
  for(const bad of ['abc','0','-1','1.5','999','',' 1','1e3','9999999999999999999']){
    const r=await call('et',{v:bad});
    assert.ok(r.body.posts,'v='+JSON.stringify(bad)+' must give full posts');
  }
});
test('if the counter cannot be read the function falls back to the full read',async()=>{
  const {db,call}=setup({identity:student('et'),seed:readSeed('et')});
  const realRef=db.ref;
  db.ref=p=>{const r=realRef(p);if(String(p).startsWith('classGalleryMeta')){return {get:async()=>{throw new Error('boom');},transaction:async()=>{throw new Error('boom');}};}return r;};
  const r=await call('et',{v:'1'});
  assert.equal(r.code,200);assert.ok(r.body.posts);assert.equal(r.body.version,undefined);
});
test('the older hash check still works as before',async()=>{
  const {call}=setup({identity:student('et'),seed:readSeed('et')});
  const first=await call('et');
  const same=await call('et',{since:first.body.hash});
  assert.deepEqual(same.body,{unchanged:true,hash:first.body.hash,version:first.body.version});
});
test('a student only gets their own pending posts, with or without the version check',async()=>{
  const {call}=setup({identity:student('et','two'),seed:{...readSeed('et'),...ws({classes:{et:{active:true,members:{two:{active:true}}}}})}});
  const r=await call('et');
  assert.deepEqual(Object.keys(r.body.posts).sort(),['a','peer']);
});

// ---------- access is still enforced, even when the version matches ----------
test('no token gets 401, wrong class gets 403, inactive class gets 403 - a matching v changes nothing',async()=>{
  const {call}=setup({identity:student('et'),seed:readSeed('et')});
  const first=await call('et');
  assert.equal((await call('et',{authed:false,v:String(first.body.version)})).code,401);
  assert.equal((await call('wt',{v:String(first.body.version)})).code,403);
  const inactive=setup({identity:student('et'),seed:{...readSeed('et'),...ws({classes:{et:{active:false,members:{one:{active:true}}}}})}});
  assert.equal((await inactive.call('et',{v:'1'})).code,403);
});
test('a removed student is refused even with a current version',async()=>{
  const {db,call}=setup({identity:student('et'),seed:readSeed('et')});
  const first=await call('et');
  await db.ref(`${WS}classes/et/members/one`).update({active:false});
  assert.equal((await call('et',{v:String(first.body.version)})).code,403);
});
test('an unassigned teacher is refused; an assigned teacher sees the pending queue',async()=>{
  const teacher={uid:'t',firebase:{sign_in_provider:'google.com'}};
  const seed={...readSeed('et'),...ws({classes:{et:{active:true},wt:{active:true}},teachers:{t:{active:true,classIds:{et:true}}}})};
  const {call}=setup({identity:teacher,seed});
  const ok=await call('et');assert.deepEqual(Object.keys(ok.body.posts).sort(),['a','mine','peer']);
  assert.equal((await call('wt',{v:'1'})).code,403);
});
test('one student cannot reuse another viewer\'s counter to learn anything: unchanged reply carries no posts',async()=>{
  const {call}=setup({identity:student('et'),seed:readSeed('et')});
  const first=await call('et');
  const again=await call('et',{v:String(first.body.version)});
  assert.equal(again.body.posts,undefined);
});

// ---------- the Class Gallery page ----------
const page=fs.readFileSync(path.join(__dirname,'../class-gallery/index.html'),'utf8');
test('page sends the version, resets it per signed-in user, and refreshes fully every 5 minutes',()=>{
  assert.match(page,/&v='\+galleryVersion/);
  assert.match(page,/galleryResponseHash=null;galleryVersion=null;galleryFullAt=0;/);
  assert.match(page,/GALLERY_FULL_REFRESH_MS=5\*60\*1000/);
  assert.match(page,/const sendVersion=!!galleryVersion&&Date\.now\(\)-galleryFullAt<GALLERY_FULL_REFRESH_MS/);
});
test('page keeps skipping hidden tabs and catches up when a tab returns',()=>{
  assert.match(page,/setInterval\(\(\)=>\{if\(!document\.hidden\)loadScopedPosts\(\)\},20000\)/);
  assert.match(page,/visibilitychange',\(\)=>\{if\(!document\.hidden\)loadScopedPosts\(\)\}/);
});
test('the other-class waiting count reuses its last answer only when the server says unchanged',()=>{
  assert.match(page,/otherClassVersion/);
  assert.match(page,/reuse&&otherReply\.unchanged===true\)n=otherClassCount/);
});
test('page and counter files do not touch Follow Teacher or the access gate',()=>{
  for(const f of ['game-gate.js','follow-teacher/student.js','follow-teacher/teacher.js']){
    assert.ok(!fs.readFileSync(path.join(__dirname,'..',f),'utf8').includes('classGalleryMeta'));
  }
});
