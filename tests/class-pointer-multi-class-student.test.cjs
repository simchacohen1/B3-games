const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const text=fs.readFileSync(__dirname+'/../class-pointer-prototype/activity-share.js','utf8').replace(/\r\n/g,'\n');
const a=text.indexOf('    async function activeClassIds'),b=text.indexOf('    const startClassIds');
assert.ok(a>0&&b>a,'multi-class helpers are present');
const room=n=>'class-pointer-'+String(n).repeat(8)+'-1234-1234-1234-123456789abc';

function harness(memberships){
  const listeners={},ops=[];
  const ref=path=>({
    once:async()=>({val:()=>memberships}),
    on:(e,ok,bad)=>{listeners[path]={ok,bad};ops.push('on:'+path.split('/')[4])},
    off:()=>{delete listeners[path];ops.push('off:'+path.split('/')[4])}});
  const context=vm.createContext({ws:'b3-2026',firebase:{database:()=>({ref})}});
  vm.runInContext(text.slice(a,b)+'\nthis.activeClassIds=activeClassIds;this.makeSessionsSource=makeSessionsSource;',context);
  const at=c=>listeners['b3Games/workspaces/b3-2026/classes/'+c+'/classPointerSessions'];
  return {context,at,ops,listeners};
}
const ms={
  'b3-2026_b5_et_afternoon':{active:true,classId:'b5_et_afternoon',workspaceId:'b3-2026'},
  'b3-2026_b5_et_morning':{active:true,classId:'b5_et_morning',workspaceId:'b3-2026'},
  'b3-2026_old':{active:false,classId:'old_class',workspaceId:'b3-2026'},
  'other_ws':{active:true,classId:'elsewhere',workspaceId:'another-workspace'},
  'bad':{active:true,classId:'../evil',workspaceId:'b3-2026'}
};

test('a student’s active classes are all listened to; inactive, other-workspace and malformed ones are ignored',async()=>{
  const h=harness(ms);
  const ids=await h.context.activeClassIds('boy','b5_et_afternoon');
  assert.deepEqual([...ids].sort(),['b5_et_afternoon','b5_et_morning']);
  h.context.makeSessionsSource(ids).on('value',()=>{},()=>{});
  assert.deepEqual(Object.keys(h.listeners).map(p=>p.split('/')[4]).sort(),['b5_et_afternoon','b5_et_morning']);
});

test('rows of every class are merged and each lesson says which class it belongs to',async()=>{
  const h=harness(ms);const seen=[];
  h.context.makeSessionsSource(['b5_et_afternoon','b5_et_morning']).on('value',s=>seen.push(s.val()),()=>{});
  h.at('b5_et_afternoon').ok({val:()=>null});
  h.at('b5_et_morning').ok({val:()=>({[room(1)]:{roomId:room(1),createdAt:5}})});
  const last=seen.at(-1);
  assert.equal(last[room(1)].__classId,'b5_et_morning');
  assert.deepEqual(Object.keys(last),[room(1)]);
});

test('one class refusing does not hide a lesson in the other; only all classes failing reports an error',()=>{
  const h=harness(ms);const seen=[],errors=[];
  h.context.makeSessionsSource(['b5_et_afternoon','b5_et_morning']).on('value',s=>seen.push(s.val()),e=>errors.push(e.code));
  h.at('b5_et_morning').ok({val:()=>({[room(1)]:{roomId:room(1),createdAt:5}})});
  h.at('b5_et_afternoon').bad({code:'PERMISSION_DENIED'});
  assert.deepEqual(errors,[]);
  assert.ok(seen.at(-1)[room(1)],'the morning lesson is still there');
  h.at('b5_et_morning').bad({code:'PERMISSION_DENIED'});
  assert.deepEqual(errors,['PERMISSION_DENIED']);
});

test('off() detaches every class listener, and on() never double-subscribes',()=>{
  const h=harness(ms);
  const src=h.context.makeSessionsSource(['b5_et_afternoon','b5_et_morning']);
  src.on('value',()=>{},()=>{});src.on('value',()=>{},()=>{});
  assert.equal(h.ops.filter(o=>o.startsWith('on:')).length,4);
  assert.equal(h.ops.filter(o=>o.startsWith('off:')).length,2,'the second on() first detached the first pair');
  src.off();
  assert.deepEqual(Object.keys(h.listeners),[]);
});

test('the page works in the class of the lesson that is live, and does not treat his own other class as another person',()=>{
  assert.match(text,/if\(next&&next\.__classId&&next\.__classId!==classId\)classId=next\.__classId;/);
  assert.match(text,/classIdSet\.has\(sessionStorage\.getItem\('b3Games_studentClass'\)\)/);
  assert.match(text,/Class Pointer is not turned on for your class/);
});
