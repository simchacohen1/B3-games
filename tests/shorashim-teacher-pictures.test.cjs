'use strict';
// Issue #627: the teacher ticks which pictures students see, and can add their own pictures.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const P=require('../shorashim/pictures.js');

const read=p=>fs.readFileSync(p,'utf8');
const teacherJs=read('shorashim/teacher.js');
const teacherHtml=read('shorashim/teacher.html');
const addPicture=read('shorashim/teacher-add-picture.js');
const app=read('shorashim/app.js');
const review=read('shorashim/review-categories.js');
const studentHtml=read('shorashim/index.html');
const rules=JSON.parse(read('firebase-rules.json')).rules;
const hardened=JSON.parse(read('firebase-rules.hardened.json')).rules;
const additive=read('scripts/rules-additive-check.cjs');

// A tiny DOM, enough to run the student picture chooser.
function fakeDom(){
  const make=tag=>({tagName:tag,children:[],dataset:{},style:{},title:'',textContent:'',appendChild(c){this.children.push(c);return c;}});
  const boxes={emojiChoices:make('div'),illustrationChoices:make('div')};
  for(const b of Object.values(boxes))Object.defineProperty(b,'innerHTML',{set(){this.children=[];},get(){return '';}});
  return {boxes,document:{getElementById:id=>boxes[id],createElement:make}};
}
function runStudentChooser(item){
  const line=app.split(/\r?\n/).find(l=>l.startsWith('function renderArtChoices('));
  assert.ok(line,'renderArtChoices exists');
  const dom=fakeDom(),added=[];
  const ctx=vm.createContext({document:dom.document,window:{B3ShorashimPictures:P},addArtToEditor:spec=>added.push(spec)});
  vm.runInContext(line+'\nrenderArtChoices(item);',Object.assign(ctx,{item}));
  return {emojis:dom.boxes.emojiChoices.children,images:dom.boxes.illustrationChoices.children};
}

test('pictures helper: values are recognised strictly',()=>{
  const ref=P.makeRef('teacherUid_1','abc123-x');
  assert.equal(ref,'teacher-picture:teacherUid_1/abc123-x');
  assert.deepEqual(P.parseRef(ref),{uid:'teacherUid_1',id:'abc123-x'});
  assert.equal(P.picturePath(ref),'shorashimTeacherPictures/teacherUid_1/abc123-x');
  for(const bad of ['teacher-picture:../x/abcdef','teacher-picture:a/b/c','teacher-picture:uid/short','teacher-picture:u.d/abcdef'])assert.equal(P.parseRef(bad),null,bad);
  assert.throws(()=>P.makeRef('a/b','abcdef'));
  assert.ok(P.isDrawing('drawing:eye'));
  assert.equal(P.isDrawing('drawing:__proto__'),false);
  assert.ok(P.isAssetIllustration('assets/illustrations/tent.svg'));
  assert.equal(P.isAssetIllustration('assets/illustrations/../../x.svg'),false);
  assert.ok(P.isEmojiValue('👀'));
  for(const v of ['https://evil.example/x.png','javascript:alert(1)','data:image/png;base64,AAAA','<img>'])assert.equal(P.isEmojiValue(v),false,v);
  assert.equal(P.isImageValue('https://evil.example/x.png'),false);
  assert.match(P.srcFor('javascript:alert(1)'),/^data:image\/gif;base64,/);
  assert.equal(P.imgAttrs('teacher-picture:u1/abcdef').includes('data-teacher-picture="teacher-picture:u1/abcdef"'),true);
});

test('pictures helper: only small webp/jpeg/png data URLs are accepted as teacher pictures',()=>{
  assert.ok(P.validDataUrl('data:image/webp;base64,UklGRg=='));
  assert.ok(P.validDataUrl('data:image/jpeg;base64,/9j/4AAQ'));
  assert.equal(P.validDataUrl('data:image/svg+xml;base64,PHN2Zz4='),false);
  assert.equal(P.validDataUrl('data:text/html;base64,PGI+'),false);
  assert.equal(P.validDataUrl('data:image/webp;base64,<script>'),false);
  assert.equal(P.validDataUrl('data:image/webp;base64,'+'A'.repeat(P.MAX_DATA_URL_CHARS)),false);
});

test('built-in drawings become teacher options for the right words',()=>{
  const raah=P.builtInOptionsFor({id:'1-raah',english:'saw / appeared',front:'רָאָה'});
  assert.ok(raah.includes('assets/illustrations/seeing-binoculars.svg'));
  const tent=P.builtInOptionsFor({id:'x',english:'tent',front:'אֹהֶל'});
  assert.deepEqual(tent,['assets/illustrations/tent.svg','drawing:home']);
  assert.equal(P.labelFor('assets/illustrations/tent.svg'),'A tent');
  assert.equal(P.labelFor('drawing:home'),'Home');
  assert.match(P.srcFor('drawing:home'),/^data:image\/svg\+xml;charset=utf-8,/);
});

test('students see no pictures on a word with nothing ticked',()=>{
  const r=runStudentChooser({id:'1-raah',english:'saw',front:'רָאָה',art:[],artPool:['👀','🔭'],customArt:['teacher-picture:u1/abcdef']});
  assert.equal(r.emojis.length,0);
  assert.equal(r.images.length,0);
  const none=runStudentChooser({id:'x',english:'tent',front:'אֹהֶל'});
  assert.equal(none.emojis.length+none.images.length,0);
});

test('students see exactly the ticked pictures, at most four, and never unsafe values',()=>{
  const r=runStudentChooser({id:'x',english:'eye',front:'עַיִן',art:['👀','drawing:eye','javascript:alert(1)','https://evil.example/x.png','teacher-picture:u1/abcdef','🔭']});
  // Unsafe values are dropped before the four-picture limit, so no valid tick is lost.
  assert.deepEqual(r.emojis.map(b=>b.textContent),['👀','🔭']);
  assert.equal(r.images.length,2,'the drawing and the teacher picture');
  const capped=runStudentChooser({id:'x',english:'x',front:'x',art:['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣']});
  assert.equal(capped.emojis.length,4);
});

test('student page no longer adds its own fallback pictures',()=>{
  assert.doesNotMatch(review,/renderArtChoices\s*=/,'review-categories.js does not replace the picture chooser');
  assert.doesNotMatch(review,/smartIllustrations|ILLUSTRATIONS\[/);
  const chooser=app.split(/\r?\n/).find(l=>l.startsWith('function renderArtChoices('));
  assert.doesNotMatch(chooser,/ILLUSTRATIONS|semanticIllustrations/);
  assert.doesNotMatch(app,/\(item\.art\|\|\['✨'\]\)/,'demo cards get no default sparkle picture');
  assert.match(app,/function demoArtsFor\(item\)\{[^\n]*if\(!v\)return \[\];/);
});

test('teacher page: auto suggestions never tick anything, and existing ticks are kept',()=>{
  const start=teacherJs.indexOf('const GENERIC_ART_CHOICES='),end=teacherJs.indexOf('function splitKey(',start);
  assert.ok(start>=0&&end>start);
  const ctx=vm.createContext({window:{B3ShorashimPictures:P},console,Date,Map,Set,B3PaidApi:{},GENERATE_SHORASHIM_ART_URL:''});
  vm.runInContext(teacherJs.slice(start,end)+'\nthis.api={fillArtForShorashim,pictureOptionsFor,customArtOf,mergeCatalogWithoutReplacingPictures};',ctx);
  const {fillArtForShorashim,pictureOptionsFor,mergeCatalogWithoutReplacingPictures}=ctx.api;
  const fresh={id:'n1',front:'רָאָה',english:'see'};
  const ticked={id:'t1',front:'אָמַר',english:'said',art:['🗣️']};
  return fillArtForShorashim([fresh,ticked]).then(()=>{
    assert.deepEqual([...fresh.art],[],'a new word gets suggestions but no ticked picture');
    assert.ok(fresh.artPool.length>0,'a new word gets suggestions');
    assert.deepEqual([...ticked.art],['🗣️'],'existing ticked pictures are never changed');
    const options=pictureOptionsFor({id:'1-raah',front:'רָאָה',english:'see',art:['👀'],artPool:['👀','🔭'],customArt:['teacher-picture:u1/abcdef','not-a-ref']});
    assert.equal(options[0],'👀','ticked pictures are listed first');
    for(const v of ['🔭','assets/illustrations/seeing-binoculars.svg','teacher-picture:u1/abcdef'])assert.ok(options.includes(v),v);
    assert.equal(options.includes('not-a-ref'),false);
    const merged=mergeCatalogWithoutReplacingPictures({shorashim:[{id:'a',art:[]}]},{shorashim:[{id:'a',art:[],artPool:['👀']}]});
    assert.deepEqual([...merged.shorashim[0].artPool],['👀'],'suggestions are saved to the cloud catalog');
    assert.deepEqual([...merged.shorashim[0].art],[],'but nothing is ticked');
  });
});

test('teacher page: checkboxes, four-picture limit, and no Regenerate button',()=>{
  assert.match(teacherJs,/<input type="checkbox" data-a="art" data-art=/);
  assert.match(teacherJs,/box\.onchange=\(\)=>togglePictureChoice\(id,box\.dataset\.art\)/);
  assert.match(teacherJs,/selected\.length>=ART_STUDENT_MAX\)\{\s*alert\([^)]*\);\s*renderCatalog\(\);/);
  assert.equal(teacherJs.includes('Regenerate'),false);
  assert.equal(teacherJs.includes('data-a="regen"'),false);
});

test('adding a picture stores it under the teacher\'s own account as an unticked option',()=>{
  assert.doesNotThrow(()=>new vm.Script(addPicture));
  assert.match(addPicture,/P\.makeRef\(user\.uid, P\.newPictureId\(\)\)/);
  assert.match(addPicture,/firebase\.database\(\)\.ref\(path\)\.set\(\{ data, createdAt: Date\.now\(\) \}\)/);
  assert.match(addPicture,/item\.customArt = \[\.\.\.added, ref\]; \/\/ a new option, not ticked/);
  assert.doesNotMatch(addPicture,/item\.art\s*=/,'adding a picture never ticks it');
  assert.doesNotMatch(addPicture,/firebase\.storage|simcha5770/,'no Storage and no owner-only gate');
  assert.match(addPicture,/activeTeacherAccess\?\.authorized/);
  assert.match(addPicture,/\.find\(x => x\.type\.startsWith\('image\/'\)\)\?\.getAsFile\(\)/,'paste from clipboard');
  assert.match(addPicture,/fileInput\.accept = P\.INPUT_TYPES\.join/,'choose a file');
  assert.match(addPicture,/item\.customArt = previous;/,'a failed save is rolled back');
});

test('scripts load in the right order on both pages',()=>{
  const t=s=>teacherHtml.indexOf(s);
  assert.ok(t('pictures.js?v=20261109-pictures-2')>=0&&t('pictures.js?v=')<t('teacher.js?v=')&&t('teacher.js?v=')<t('teacher-add-picture.js?v='));
  assert.equal(teacherHtml.includes('teacher-screenshot.js'),false);
  const s=x=>studentHtml.indexOf(x);
  assert.ok(s('pictures.js?v=20261109-pictures-2')>=0&&s('pictures.js?v=')<s('app.js?v=20261109-pictures-2'));
  assert.equal(studentHtml.includes('teacher-add-picture.js'),false);
  assert.equal(fs.existsSync('shorashim/teacher-screenshot.js'),false);
});

test('rules: teacher pictures are written and read only by that active teacher (plus owner/admins)',()=>{
  for(const r of [rules,hardened]){
    const node=r.shorashimTeacherPictures;
    assert.ok(node,'node exists');
    assert.equal(node['.read'],undefined);
    // Students never read a teacher's own pictures; they read the class copy of ticked ones.
    assert.match(node.$uid['.read'],/^\(auth != null && \$uid == auth\.uid && root\.child\('b3Games\/workspaces\/b3-2026\/teachers\/' \+ auth\.uid \+ '\/active'\)\.val\(\) == true\) \|\| \(auth != null && \(auth\.token\.email == 'simcha5770@gmail\.com' && auth\.token\.email_verified == true \|\| root\.child\('b3Games\/admins\/' \+ auth\.uid \+ '\/active'\)\.val\(\) == true\)\)$/);
    assert.equal(node.$uid['.read'].includes('b3StudentId'),false);
    const pic=node.$uid.$pictureId;
    assert.equal(pic['.read'],undefined);
    assert.match(pic['.write'],/\$uid == auth\.uid && root\.child\('b3Games\/workspaces\/b3-2026\/teachers\/' \+ auth\.uid \+ '\/active'\)\.val\(\) == true\) && \(!data\.exists\(\) \|\| !newData\.exists\(\)\)/);
    assert.match(pic['.validate'],/length <= 200000/);
    for(const t of ['webp','jpeg','png'])assert.ok(pic['.validate'].includes(`beginsWith('data:image/${t};base64,')`));
    assert.equal(pic['.validate'].includes('svg'),false);
    assert.equal(pic.$other['.validate'],false);
  }
  assert.match(additive,/\['shorashimTeacherPictures'\]/);
});

// ---- Follow-up (#627): students read only class copies of ticked pictures ----
function fakeFirebase(uid,store,denied=()=>false){
  const db={ref:path=>({
    once:async()=>{if(denied(path,'read'))throw Object.assign(new Error('permission_denied'),{code:'PERMISSION_DENIED'});
      const parts=path.split('/');let v=store;for(const k of parts){v=v==null?undefined:v[k];}
      return {val:()=>v===undefined?null:v,exists:()=>v!==undefined&&v!==null};},
    set:async value=>{if(denied(path,'write'))throw new Error('permission_denied');
      const parts=path.split('/'),last=parts.pop();let o=store;for(const k of parts)o=o[k]=o[k]||{};o[last]=value;},
    remove:async()=>{const parts=path.split('/'),last=parts.pop();let o=store;for(const k of parts){if(!o[k])return;o=o[k];}delete o[last];}
  })};
  return {database:()=>db,auth:()=>({currentUser:uid?{uid}:null})};
}
function freshPictures(firebase){
  // Load a separate copy of pictures.js with its own cache and its own window.firebase.
  const code=read('shorashim/pictures.js');
  const win={firebase};
  vm.runInNewContext(code,{window:win,globalThis:win,URL,console,setTimeout});
  return win.B3ShorashimPictures;
}
const DATA='data:image/webp;base64,UklGRhYAAABXRUJQVlA4';
const SPACE='posukPractice/shorashimLearning/classes/alpha';

test('teacher picture: ticking copies it into the class; unticking deletes the copy',async()=>{
  const store={shorashimTeacherPictures:{t1:{'pic-000001':{data:DATA,createdAt:1}}}};
  const P2=freshPictures(fakeFirebase('t1',store));
  P2.setClassSpace(SPACE);
  const ref='teacher-picture:t1/pic-000001';
  assert.equal(P2.classCopyPath(ref),SPACE+'/pictures/t1/pic-000001');
  await P2.publishToClass(ref);
  assert.equal(store.posukPractice.shorashimLearning.classes.alpha.pictures.t1['pic-000001'].data,DATA);
  await P2.unpublishFromClass(ref);
  assert.equal(store.posukPractice.shorashimLearning.classes.alpha.pictures.t1['pic-000001'],undefined);
});

test('teacher picture: another teacher cannot share a picture that is not theirs',async()=>{
  const store={shorashimTeacherPictures:{t1:{'pic-000001':{data:DATA,createdAt:1}}}};
  const P2=freshPictures(fakeFirebase('t2',store,p=>p.startsWith('shorashimTeacherPictures/t1')));
  P2.setClassSpace(SPACE);
  await assert.rejects(P2.publishToClass('teacher-picture:t1/pic-000001'),/Only the teacher who added this picture/);
  assert.equal(store.posukPractice,undefined,'nothing was copied');
});

test('student page reads only the class copy, never the teacher original',async()=>{
  const reads=[];
  const store={shorashimTeacherPictures:{t1:{'pic-000001':{data:DATA,createdAt:1},'pic-000002':{data:DATA,createdAt:1}}},
    posukPractice:{shorashimLearning:{classes:{alpha:{pictures:{t1:{'pic-000001':{data:DATA,createdAt:2}}}}}}}};
  const fb=fakeFirebase('student_uid',store,(p,kind)=>{if(kind==='read')reads.push(p);return p.startsWith('shorashimTeacherPictures');});
  const P2=freshPictures(fb);
  let space=SPACE;P2.setClassSpace(()=>space);
  assert.equal(await P2.resolve('teacher-picture:t1/pic-000001'),DATA,'ticked picture shows from the class copy');
  assert.equal(await P2.resolve('teacher-picture:t1/pic-000002'),null,'unticked picture has no class copy, so nothing shows');
  assert.equal(reads.some(p=>p.startsWith('shorashimTeacherPictures')),false,'the student never asks for the original');
});

test('tickedTeacherPictures and mentionedTeacherPictures find pictures across tracks',()=>{
  const catalog={shorashim:[{art:['👀','teacher-picture:t1/pic-000001'],customArt:['teacher-picture:t1/pic-000001','teacher-picture:t1/pic-000002']}],
    prefix:{0:{art:['teacher-picture:t2/pic-000003']}},suffix:[]};
  assert.deepEqual([...P.tickedTeacherPictures(catalog)].sort(),['teacher-picture:t1/pic-000001','teacher-picture:t2/pic-000003']);
  assert.deepEqual([...P.mentionedTeacherPictures(catalog)].sort(),['teacher-picture:t1/pic-000001','teacher-picture:t1/pic-000002','teacher-picture:t2/pic-000003']);
});

test('teacher page shares a picture with the class before ticking it and cleans up on save',()=>{
  assert.match(teacherJs,/window\.B3ShorashimPictures\.setClassSpace\(SPACE\)/);
  const toggle=teacherJs.slice(teacherJs.indexOf('async function togglePictureChoice('));
  assert.ok(toggle.indexOf('publishToClass(v)')>0&&toggle.indexOf('publishToClass(v)')<toggle.indexOf('item.art=[...selected,v]'),'copy first, tick second');
  assert.match(teacherJs,/async function saveCatalog\(\)\{.*\.set\(state\.catalog\);await syncClassPictures\(\);/);
  assert.match(teacherJs,/unpublishFromClass\(v\)/);
  assert.match(app,/B3ShorashimPictures\.setClassSpace\(\(\)=>CLOUD_ROOT\)/);
});

test('teachers can add a picture three ways: file, paste and camera snapshot',()=>{
  assert.match(addPicture,/📁 Add picture from computer/);
  assert.match(addPicture,/Ctrl\+V to paste/);
  assert.match(addPicture,/📷 Take snapshot/);
  assert.match(addPicture,/getUserMedia\(\{ video:/);
  assert.match(addPicture,/getTracks\(\)\.forEach\(t => t\.stop\(\)\)/,'camera is turned off');
  assert.match(addPicture,/new File\(\[blob\], 'snapshot\.png', \{ type: 'image\/png' \}\)/);
  assert.match(addPicture,/\[data-picture-camera\]/);
});
