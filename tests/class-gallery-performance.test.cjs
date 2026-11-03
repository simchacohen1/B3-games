'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('class-gallery/index.html','utf8');
const start=html.indexOf('let lastGalleryPostsSnapshot=null,galleryApplyRevision=0;');
const end=html.indexOf('\nif(dbRef){',start);
assert.ok(start!==-1&&end>start,'Gallery post updater exists');
const updater=html.slice(start,end);
// The scene signature uses the real project-card cache key from the page.
const keyMatch=html.match(/function projectCardKey\(post\)\{[^\n]*\}/);
assert.ok(keyMatch,'Gallery project card key exists');

function setup(deferredMedia=false){
  const stats={builds:0,refreshes:0,mediaLoads:0,mediaResolvers:[]};
  const context={
    posts:[],scene:{},isTeacher:false,console,
    updatePending(){},
    buildScene(){stats.builds++;},
    refreshRemoteAvatars(){stats.refreshes++;},
    pruneProjectCardCache(){},
    resolveGalleryMedia(rows){
      stats.mediaLoads++;
      if(!deferredMedia)return Promise.resolve(rows);
      return new Promise(resolve=>stats.mediaResolvers.push(()=>resolve(rows)));
    },
    document:{getElementById:()=>({classList:{contains:()=>false},style:{display:'none'}})}
  };
  vm.createContext(context);
  vm.runInContext(keyMatch[0]+'\n'+updater,context);
  return {context,stats};
}

test('unchanged gallery polls do not rebuild the 3D environment',async()=>{
  const {context,stats}=setup();
  context.applyGalleryPosts({a:{title:'First',status:'approved'}});
  assert.equal(stats.builds,1);
  context.applyGalleryPosts({a:{title:'First',status:'approved'}});
  assert.equal(stats.builds,1);
  assert.equal(stats.mediaLoads,1);
  context.applyGalleryPosts({a:{title:'Updated',status:'approved'}});
  assert.equal(stats.builds,2);
  await Promise.resolve();
});

test('posts appear before private audio or video links resolve',async()=>{
  const {context,stats}=setup(true);
  context.applyGalleryPosts({a:{title:'First',status:'approved'}});
  assert.equal(stats.builds,1);
  assert.equal(context.posts.length,1);
  assert.equal(context.posts[0].title,'First');
  stats.mediaResolvers.shift()();
  await Promise.resolve();
  assert.equal(stats.builds,1,'Media completion must not rebuild the room');
});

test('out-of-order media completion cannot rebuild or replace current posts',async()=>{
  const {context,stats}=setup(true);
  // Only approved posts are drawn in the 3D scene, so only they trigger rebuilds.
  context.applyGalleryPosts({a:{title:'Old',status:'approved'}});
  context.applyGalleryPosts({a:{title:'New',status:'approved'}});
  assert.equal(stats.builds,2);
  stats.mediaResolvers[0]();
  await Promise.resolve();
  assert.equal(context.posts[0].title,'New');
  stats.mediaResolvers[1]();
  await Promise.resolve();
  assert.equal(stats.builds,2);
});

test('gallery limits graphics work and pauses polling in background tabs',()=>{
  assert.match(html,/galleryLowGraphics\?1:1\.5/);
  assert.match(html,/renderer\.shadowMap\.enabled=!galleryLowGraphics/);
  assert.match(html,/if\(!document\.hidden\)loadScopedPosts\(\)/);
  assert.match(html,/20000\)/);
  assert.match(html,/resolveGalleryMedia\(posts\)/);
});


// Extract and run the real room-selection code with fictional class rosters.
function setupPersonalRoom(records){
  const begin=html.indexOf('function normalizeGalleryStudentName(');
  const end=html.indexOf('function buildGalleryClassroom(',begin);
  assert.ok(begin!==-1&&end>begin,'Personal-room identity matcher is present');
  const rooms=[];
  const context={
    galleryClassId:'et',
    PRESENCE_STUDENTS:{
      first_id:{name:'Mayer Chaim Chaikin',classId:'et'},
      first_old_id:{name:'Mayer Chaim Chaikin',classId:'et'},
      second_id:{name:'Mayer Chaim Chaikin Jr',classId:'et'},
      other_id:{name:'Yossi Gourarie',classId:'et'},
      wt_id:{name:'Mayer Chaim Chaikin',classId:'wt'}
    },
    posts:records,
    buildGalleryClassroom(room){rooms.push(room);}
  };
  vm.createContext(context);
  vm.runInContext(html.slice(begin,end),context);
  return {context,rooms};
}

test('student room includes every approved subject-wall project and historical full-name variant',()=>{
  const {context,rooms}=setupPersonalRoom([
    {id:'recent',studentId:'first_id',studentName:'Mayer Chaim Chaikin',status:'approved',galleryRoom:'halacha'},
    {id:'alias',studentId:'first_old_id',studentName:'Old spelling in metadata',status:'approved',galleryRoom:'parsha'},
    {id:'legacy',studentName:'  MAYER   CHAIM CHAikin  ',status:'approved',galleryRoom:'perek18'},
    {id:'legacy2',studentName:'Mayer Chaim Chaikin',status:'approved',galleryRoom:'hallway'},
    {id:'pending',studentId:'first_id',studentName:'Mayer Chaim Chaikin',status:'pending'}
  ]);
  context.buildStudentGallery('Mayer Chaim Chaikin');
  assert.deepEqual(Array.from(rooms[0].roomPosts,p=>p.id).sort(),['alias','legacy','legacy2','recent']);
  assert.equal(rooms[0].roomPosts.length,4);
  assert.match(rooms[0].subtitle,/All Approved Work/);
});

test('explicit student IDs never fall back to a matching room name',()=>{
  const {context,rooms}=setupPersonalRoom([
    {id:'wrongId',studentId:'other_id',studentName:'Mayer Chaim Chaikin',status:'approved'},
    {id:'wrongClassId',studentId:'wt_id',studentName:'Mayer Chaim Chaikin',status:'approved'},
    {id:'nearName',studentName:'Mayer Chaim Chaikin Jr',status:'approved'},
    {id:'correct',studentId:'first_id',studentName:'Different saved name',status:'approved'}
  ]);
  context.buildStudentGallery('Mayer Chaim Chaikin');
  assert.deepEqual(Array.from(rooms[0].roomPosts,p=>p.id),['correct']);
});

test('a teacher or classmate can enter the right boy\'s room without using their own ID',()=>{
  const {context,rooms}=setupPersonalRoom([
    {id:'firstPost',studentId:'first_id',status:'approved'},
    {id:'secondPost',studentId:'other_id',status:'approved'}
  ]);
  context.buildStudentGallery('Yossi Gourarie');
  assert.deepEqual(Array.from(rooms[0].roomPosts,p=>p.id),['secondPost']);
  context.buildStudentGallery('Mayer Chaim Chaikin');
  assert.deepEqual(Array.from(rooms[1].roomPosts,p=>p.id),['firstPost']);
});

test('personal rooms have no hallway preview limit',()=>{
  const rows=Array.from({length:9},(_,i)=>({id:'post'+i,studentId:'first_id',status:'approved',galleryRoom:i%2?'halacha':'parsha'}));
  const {context,rooms}=setupPersonalRoom(rows);
  context.buildStudentGallery('Mayer Chaim Chaikin');
  assert.equal(rooms[0].roomPosts.length,9);
  assert.match(html,/\(byStudent\[name\]\|\|\[\]\)\.slice\(0,4\)/,'Hallway preview remains capped at four');
});
