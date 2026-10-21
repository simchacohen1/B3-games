'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const html=fs.readFileSync('class-gallery/index.html','utf8');
 const source=html.slice(html.indexOf('function createProjectCard(post){'),html.indexOf('\nfunction buildClassroom(room){'));
 const images=[],events=[],warnings=[],draws=[];
 const ctx=new Proxy({drawImage:(...args)=>draws.push(args)}, {get:(target,key)=>target[key]||(()=>{}),set:(target,key,value)=>(target[key]=value,true)});
 const canvas={getContext:()=>ctx};
 class FakeImage{
  constructor(){images.push(this);this.width=640;this.height=480;}
  set crossOrigin(value){events.push(['crossOrigin',value]);this.cors=value;}
  set src(value){events.push(['src',value]);if(/^https?:/.test(value))assert.equal(this.cors,'anonymous','Remote image must request anonymous CORS before src starts the load');this.url=value;}
 }
 const env={document:{createElement:()=>canvas},Image:FakeImage,roundedRect(){},wrapCanvasText(){},makeTexture:()=>({needsUpdate:false}),console:{warn:(...args)=>warnings.push(args)},THREE:{DoubleSide:2,PlaneGeometry:class{},MeshStandardMaterial:class{constructor(options){Object.assign(this,options)}},Mesh:class{constructor(geometry,material){this.material=material}}}};
 vm.createContext(env);vm.runInContext(source,env);
 return {...env,images,events,warnings,draws};
}
test('Gallery remote picture requests anonymous CORS before starting its load',()=>{
 const f=fixture(),post=Object.freeze({id:'synthetic',image:'https://firebasestorage.googleapis.com/synthetic.png'});
 const card=f.createProjectCard(post);
 assert.deepEqual(f.events,[['crossOrigin','anonymous'],['src',post.image]]);
 f.images[0].onload();assert.equal(f.draws.length,1);assert.equal(card.material.map.needsUpdate,true);
 assert.equal(post.image,'https://firebasestorage.googleapis.com/synthetic.png');
});
test('Gallery inline legacy artwork still loads and updates the same texture',()=>{
 const f=fixture(),post=Object.freeze({id:'inline',image:'data:image/png;base64,synthetic'});
 const card=f.createProjectCard(post);f.images[0].onload();assert.equal(f.images[0].url,post.image);assert.equal(f.draws.length,1);assert.equal(card.material.map.needsUpdate,true);
});
test('Gallery failed image keeps the placeholder without drawing an unsafe image',()=>{
 const f=fixture(),post=Object.freeze({id:'failed',image:'https://storage.example.test/synthetic.png?token=private'});
 const card=f.createProjectCard(post);f.images[0].onerror();assert.equal(f.draws.length,0);assert.equal(card.material.map.needsUpdate,false);assert.deepEqual(f.warnings,[['Gallery picture could not load for post','failed']]);
});
test('Gallery posts without an image retain their placeholder card',()=>{
 const f=fixture(),card=f.createProjectCard(Object.freeze({id:'text-only',title:'Synthetic'}));assert.equal(f.images.length,0);assert(card.material.map);assert.equal(f.draws.length,0);
});
