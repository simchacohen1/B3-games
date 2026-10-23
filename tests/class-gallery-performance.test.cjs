'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('class-gallery/index.html','utf8');
const start=html.indexOf('let lastGalleryPostsSnapshot=null,galleryApplyRevision=0;');
const end=html.indexOf('\nif(dbRef){',start);
assert.ok(start!==-1&&end>start,'Gallery post updater exists');
const keyStart=html.indexOf('function projectCardKey(post)'),keyEnd=html.indexOf('\n',keyStart);
assert.ok(keyStart!==-1,'projectCardKey exists');
const updater=html.slice(keyStart,keyEnd)+'\n'+html.slice(start,end);

function setup(deferredMedia=false){
  const stats={builds:0,refreshes:0,mediaLoads:0,mediaResolvers:[]};
  const context={
    posts:[],scene:{},isTeacher:false,console,pruneProjectCardCache(){},
    updatePending(){},
    buildScene(){stats.builds++;},
    refreshRemoteAvatars(){stats.refreshes++;},
    resolveGalleryMedia(rows){
      stats.mediaLoads++;
      if(!deferredMedia)return Promise.resolve(rows);
      return new Promise(resolve=>stats.mediaResolvers.push(()=>resolve(rows)));
    },
    document:{getElementById:()=>({classList:{contains:()=>false},style:{display:'none'}})}
  };
  vm.createContext(context);
  vm.runInContext(updater,context);
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
