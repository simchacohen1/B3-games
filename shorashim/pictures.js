/* Shorashim pictures, shared by the student page and the teacher page.

   Picture values on a word:
     item.art       = ticked pictures. Students see only these (max 4).
     item.artPool   = suggested emoji (generated).
     item.customArt = pictures the teacher added.
   A picture value is one of:
   - an emoji, e.g. "👀"
   - a built-in drawing file: "assets/illustrations/<name>.svg"
   - a built-in simple drawing: "drawing:<kind>", e.g. "drawing:eye"
   - an owner screenshot already in Firebase Storage (older feature, still shown)
   - a picture a teacher added: "teacher-picture:<teacherUid>/<pictureId>",
     stored at shorashimTeacherPictures/<teacherUid>/<pictureId>/data as a
     small image data URL. Only that teacher (and the owner/admins) can read it there.
     When the teacher ticks it, a copy goes to <class space>/pictures/<teacherUid>/<pictureId>,
     which that class's students can read. Unticking it deletes the copy. */
(function(root){
'use strict';
const ILLUSTRATIONS={"1-raah":[{"src":"assets/illustrations/seeing-binoculars.svg","label":"Looking through binoculars"}],"1-eilon":[{"src":"assets/illustrations/grove.svg","label":"A grove of trees"}],"1-yashav":[{"src":"assets/illustrations/sitting.svg","label":"A person sitting"}],"1-petach":[{"src":"assets/illustrations/entrance.svg","label":"A doorway entrance"}],"1-ohel":[{"src":"assets/illustrations/tent.svg","label":"A tent"}],"1-chom":[{"src":"assets/illustrations/heat.svg","label":"Hot sun and thermometer"}],"1-yom":[{"src":"assets/illustrations/day.svg","label":"A bright daytime scene"}],"2-nasa":[{"src":"assets/illustrations/carrying.svg","label":"A person carrying a box"}],"2-ayin":[{"src":"assets/illustrations/eye.svg","label":"A close-up eye"}],"2-shalosh":[{"src":"assets/illustrations/three-people.svg","label":"Three people"}]};
const DRAWINGS={cane:'<path d="M62 18c22 0 22 27 3 27H50v49"/><path d="M50 94h-9"/>',door:'<path d="M28 92V18h48v74M38 92V29h28v63"/><circle cx="60" cy="60" r="2"/>',eye:'<path d="M12 55s15-25 38-25 38 25 38 25-15 25-38 25S12 55 12 55Z"/><circle cx="50" cy="55" r="11"/>',tree:'<path d="M50 88V57"/><path d="M50 62c-21 8-33-12-19-23-5-20 23-29 31-12 21-5 29 22 12 33-7 5-16 5-24 2Z"/>',water:'<path d="M50 12C38 31 25 45 25 62a25 25 0 0 0 50 0c0-17-13-31-25-50Z"/>',sun:'<circle cx="50" cy="50" r="19"/><path d="M50 8v13M50 79v13M8 50h13M79 50h13M20 20l9 9M71 71l9 9M80 20l-9 9M29 71l-9 9"/>',book:'<path d="M12 22c18-5 30 1 38 9v55c-8-8-20-14-38-9ZM88 22c-18-5-30 1-38 9v55c8-8 20-14 38-9Z"/>',arrow:'<path d="M13 50h68M62 31l19 19-19 19"/>',clock:'<circle cx="50" cy="50" r="36"/><path d="M50 28v23l16 10"/>',home:'<path d="M12 49 50 17l38 32M24 44v43h52V44M42 87V63h16v24"/>',speech:'<path d="M14 18h72v52H48L28 86V70H14Z"/><path d="M29 39h42M29 51h30"/>',default:'<circle cx="50" cy="50" r="34"/><path d="m31 52 12 12 27-31"/>'};
const DRAWING_LABELS={cane:'Walking stick',door:'Doorway',eye:'Eye',tree:'Tree',water:'Water drop',sun:'Sun',book:'Open book',arrow:'Direction arrow',clock:'Clock',home:'Home',speech:'Speech bubble',default:'Simple symbol'};
const PICTURE_ROOT='shorashimTeacherPictures';
const REF_PREFIX='teacher-picture:';
const MAX_DATA_URL_CHARS=200000;
const DATA_URL_PREFIXES=['data:image/webp;base64,','data:image/jpeg;base64,','data:image/png;base64,'];
const SCREENSHOT_PREFIX='/v0/b/b3-games.firebasestorage.app/o/shorashim-teacher-pictures%2F';
const BLANK='data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

function pictureSvg(kind,label){const drawings=DRAWINGS;const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#fff8dc"/><g fill="none" stroke="#374151" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${drawings[kind]||drawings.default}</g></svg>`;return{src:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),label};}
// The same matching rules the student page has always used, returned as drawing kinds.
function semanticDrawingKinds(item){
  const text=`${item?.english||''} ${item?.front||''}`.toLowerCase(),out=[];
  const add=kind=>{if(!out.includes(kind))out.push(kind);};
  if(/old|aged|זק/.test(text))add('cane');
  if(/door|gate|entrance|פתח|דלת/.test(text))add('door');
  if(/see|look|eye|ראה|עין/.test(text))add('eye');
  if(/tree|grove|wood|עץ|אלון/.test(text))add('tree');
  if(/water|wash|rain|מים|רחץ/.test(text))add('water');
  if(/sun|day|heat|שמש|יום|חם/.test(text))add('sun');
  if(/book|learn|read|ספר/.test(text))add('book');
  if(/go|come|pass|return|toward|הלך|בא|עבר|שב/.test(text))add('arrow');
  if(/time|hour|עת/.test(text))add('clock');
  if(/house|home|tent|בית|אהל/.test(text))add('home');
  if(/say|speak|call|אמר|דבר|קרא/.test(text))add('speech');
  if(!out.length)add('default');
  return out;
}
function semanticIllustrations(item){return semanticDrawingKinds(item).map(k=>pictureSvg(k,DRAWING_LABELS[k]));}

function isScreenshotUrl(value){try{const url=new URL(String(value||''));return url.protocol==='https:'&&url.hostname==='firebasestorage.googleapis.com'&&url.pathname.startsWith(SCREENSHOT_PREFIX);}catch(_){return false;}}
function isAssetIllustration(value){return /^assets\/illustrations\/[a-z0-9-]{1,60}\.svg$/.test(String(value||''));}
function isDrawing(value){const m=/^drawing:([a-z]{1,20})$/.exec(String(value||''));return !!(m&&Object.prototype.hasOwnProperty.call(DRAWINGS,m[1]));}
function validUid(uid){return typeof uid==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(uid);}
function validPictureId(id){return typeof id==='string'&&/^[A-Za-z0-9_-]{6,64}$/.test(id);}
function makeRef(uid,id){if(!validUid(uid)||!validPictureId(id))throw new Error('Invalid picture id.');return REF_PREFIX+uid+'/'+id;}
function parseRef(value){
  const s=String(value||'');if(!s.startsWith(REF_PREFIX))return null;
  const parts=s.slice(REF_PREFIX.length).split('/');
  return parts.length===2&&validUid(parts[0])&&validPictureId(parts[1])?{uid:parts[0],id:parts[1]}:null;
}
function isTeacherPicture(value){return !!parseRef(value);}
function picturePath(value){const r=parseRef(value);if(!r)throw new Error('Not a teacher picture.');return PICTURE_ROOT+'/'+r.uid+'/'+r.id;}
function validDataUrl(s){
  if(typeof s!=='string'||s.length>MAX_DATA_URL_CHARS||!DATA_URL_PREFIXES.some(p=>s.startsWith(p)))return false;
  return /^[A-Za-z0-9+/=]+$/.test(s.slice(s.indexOf(',')+1));
}
function newPictureId(){return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);}
function isImageValue(value){return isScreenshotUrl(value)||isAssetIllustration(value)||isDrawing(value)||isTeacherPicture(value);}
// Emoji text only: links, data URLs and markup are never shown as text.
function isEmojiValue(value){const s=String(value||'').trim();return !!s&&s.length<=16&&!/[:/\\<>]/.test(s);}
function labelFor(value){
  if(isTeacherPicture(value))return 'Teacher picture';
  if(isScreenshotUrl(value))return 'Teacher screenshot';
  if(isDrawing(value))return DRAWING_LABELS[String(value).slice(8)]||'Drawing';
  if(isAssetIllustration(value)){
    for(const list of Object.values(ILLUSTRATIONS))for(const a of list)if(a.src===value)return a.label;
    const m=MEANING_DRAWINGS.find(r=>r[1]===value);return m?m[2]:'Drawing';
  }
  return String(value||'');
}
// Drawing files matched to a word's meaning (moved from review-categories.js, which used to
// show them to every student; now they are teacher options only).
const MEANING_DRAWINGS=[
  [/entrance|opening|door|gate/,'assets/illustrations/entrance.svg','A doorway entrance'],
  [/\btent\b|ohel/,'assets/illustrations/tent.svg','A tent'],
  [/grove|tree|wood|forest/,'assets/illustrations/grove.svg','A grove of trees'],
  [/\bsee\b|\bsaw\b|\bseen\b|\blook\b|\bappear\b|\bappeared\b/,'assets/illustrations/seeing-binoculars.svg','Looking'],
  [/\beye\b|\beyes\b/,'assets/illustrations/eye.svg','An eye'],
  [/\bsit\b|\bsat\b|sitting/,'assets/illustrations/sitting.svg','A person sitting'],
  [/\blift\b|\blifted\b|\bcarry\b|\bcarried\b|\braise\b/,'assets/illustrations/carrying.svg','Carrying'],
  [/\bheat\b|\bhot\b|warm/,'assets/illustrations/heat.svg','Heat'],
  [/\bday\b|daytime/,'assets/illustrations/day.svg','Daytime'],
  [/\bthree\b|\b3\b/,'assets/illustrations/three-people.svg','Three people']
];
// Built-in drawings offered for one word. They are only options until the teacher ticks one.
function builtInOptionsFor(item){
  const text=`${item?.english||''} ${item?.front||''}`.toLowerCase();
  const files=((item&&item.id&&ILLUSTRATIONS[item.id])||[]).map(a=>a.src);
  MEANING_DRAWINGS.forEach(([re,src])=>{if(re.test(text))files.push(src);});
  return [...new Set([...files.filter(isAssetIllustration),...semanticDrawingKinds(item).map(k=>'drawing:'+k)])];
}
// <img> src for a picture value. Teacher pictures fill in once loaded (setImg / hydrate).
function srcFor(value){
  const v=String(value||'');
  if(isDrawing(v)){const k=v.slice(8);return pictureSvg(k,DRAWING_LABELS[k]).src;}
  if(isAssetIllustration(v)||isScreenshotUrl(v))return v;
  if(isTeacherPicture(v))return cache.get(v)||BLANK;
  // Card designs saved before this change stored a built-in drawing's own data: URL.
  if(/^data:image\/svg\+xml;charset=utf-8,/.test(v))return v;
  return BLANK;
}
function escAttr(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function imgAttrs(value){
  const v=String(value||''),attrs='src="'+escAttr(srcFor(v))+'"';
  return isTeacherPicture(v)&&!cache.has(v)?attrs+' data-teacher-picture="'+escAttr(v)+'"':attrs;
}

// The class space whose ticked pictures this page shows: a path, or a function returning one
// (the student page changes class space after sign-in).
let classSpace='';
function setClassSpace(space){classSpace=space;}
function currentClassSpace(){const s=typeof classSpace==='function'?classSpace():classSpace;return typeof s==='string'?s:'';}
function classCopyPath(value,space=currentClassSpace()){
  const r=parseRef(value);if(!r)throw new Error('Not a teacher picture.');
  if(!space)throw new Error('No class is open.');
  return space+'/pictures/'+r.uid+'/'+r.id;
}
function signedInUid(){try{return root.firebase&&root.firebase.auth?(root.firebase.auth().currentUser||{}).uid||'':'';}catch(_){return '';}}
function readData(path){
  return root.firebase.database().ref(path+'/data').once('value').then(snap=>{const v=snap.val();return validDataUrl(v)?v:null;});
}

const cache=new Map(),pending=new Map();
// Students only ever read the class copy. A teacher reads their own original, or the class copy
// of a picture another teacher of the same class ticked.
function resolve(value){
  const key=String(value||'');
  if(!isTeacherPicture(key))return Promise.resolve(null);
  if(cache.has(key))return Promise.resolve(cache.get(key));
  if(pending.has(key))return pending.get(key);
  if(!(root.firebase&&root.firebase.database))return Promise.resolve(null);
  const own=parseRef(key).uid===signedInUid(),space=currentClassSpace();
  const sources=[...(own?[picturePath(key)]:[]),...(space?[classCopyPath(key,space)]:[])];
  const p=sources.reduce((prev,path)=>prev.then(found=>found||readData(path).catch(()=>null)),Promise.resolve(null))
    .then(v=>{if(v)cache.set(key,v);return v;})
    .catch(err=>{console.warn('Could not load teacher picture',err);return null;})
    .finally(()=>pending.delete(key));
  pending.set(key,p);
  return p;
}
// Teacher ticked a picture: copy it into the class so the class's students can see it.
async function publishToClass(value){
  const path=classCopyPath(value),db=root.firebase.database();
  const existing=await db.ref(path+'/createdAt').once('value').then(s=>s.exists()).catch(()=>false);
  if(existing)return;
  let data=null;
  if(parseRef(value).uid===signedInUid())data=await readData(picturePath(value)).catch(()=>null);
  if(!data)throw new Error('Only the teacher who added this picture can show it to students.');
  await db.ref(path).set({data,createdAt:Date.now()});
  cache.set(String(value),data);
}
// Teacher unticked a picture (or the word was removed): students can no longer read it.
function unpublishFromClass(value){return root.firebase.database().ref(classCopyPath(value)).remove();}
function tickedTeacherPictures(catalog){
  const out=new Set();
  Object.values(catalog||{}).forEach(list=>(Array.isArray(list)?list:Object.values(list||{})).forEach(item=>
    (Array.isArray(item?.art)?item.art:[]).forEach(v=>{if(isTeacherPicture(v))out.add(String(v));})));
  return out;
}
function mentionedTeacherPictures(catalog){
  const out=tickedTeacherPictures(catalog);
  Object.values(catalog||{}).forEach(list=>(Array.isArray(list)?list:Object.values(list||{})).forEach(item=>
    (Array.isArray(item?.customArt)?item.customArt:[]).forEach(v=>{if(isTeacherPicture(v))out.add(String(v));})));
  return out;
}
function remember(value,dataUrl){if(isTeacherPicture(value)&&validDataUrl(dataUrl))cache.set(String(value),dataUrl);}
function setImg(img,value){
  const v=String(value||'');
  img.src=srcFor(v);
  if(isTeacherPicture(v)&&!cache.has(v)){
    img.dataset.teacherPicture=v;
    resolve(v).then(src=>{if(src&&img.dataset.teacherPicture===v){img.src=src;delete img.dataset.teacherPicture;}});
  }else delete img.dataset.teacherPicture;
}
function hydrate(scope){
  const el=scope||root.document;if(!el||!el.querySelectorAll)return;
  el.querySelectorAll('img[data-teacher-picture]').forEach(img=>{if(!pending.has(img.dataset.teacherPicture))setImg(img,img.dataset.teacherPicture);});
}
// Pictures drawn from HTML strings (imgAttrs) fill in automatically.
if(root.document&&root.MutationObserver){
  let queued=false;
  const run=()=>{queued=false;hydrate();};
  const start=()=>new root.MutationObserver(()=>{if(!queued){queued=true;root.setTimeout(run,0);}}).observe(root.document.documentElement,{childList:true,subtree:true});
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});else start();
}

// Teacher upload: shrink a pasted or chosen picture to a small WebP (or JPEG) data URL.
const INPUT_TYPES=['image/png','image/jpeg','image/webp','image/gif'];
const MAX_INPUT_BYTES=10*1024*1024;
const TARGET_CHARS=120000;
function compressImage(file){
  if(!file||!INPUT_TYPES.includes(file.type))return Promise.reject(new Error('Choose a PNG, JPG, WebP or GIF picture.'));
  if(file.size>MAX_INPUT_BYTES)return Promise.reject(new Error('That picture is over 10 MB. Crop it first.'));
  const url=URL.createObjectURL(file);
  return new Promise((ok,fail)=>{
    const image=new Image();
    image.onload=()=>{
      try{
        let side=480,quality=0.82,result='';
        for(let attempt=0;attempt<8;attempt++){
          const f=Math.min(1,side/Math.max(image.naturalWidth,image.naturalHeight));
          const c=document.createElement('canvas');
          c.width=Math.max(1,Math.round(image.naturalWidth*f));c.height=Math.max(1,Math.round(image.naturalHeight*f));
          const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(image,0,0,c.width,c.height);
          result=c.toDataURL('image/webp',quality);
          if(!result.startsWith('data:image/webp'))result=c.toDataURL('image/jpeg',quality);
          if(validDataUrl(result)&&result.length<=TARGET_CHARS)break;
          side=Math.round(side*0.8);quality=Math.max(0.5,quality-0.08);
        }
        URL.revokeObjectURL(url);
        if(validDataUrl(result))ok(result);else fail(new Error('That picture is still too large after shrinking it.'));
      }catch(err){URL.revokeObjectURL(url);fail(err);}
    };
    image.onerror=()=>{URL.revokeObjectURL(url);fail(new Error('Could not read that picture.'));};
    image.src=url;
  });
}

const api={ILLUSTRATIONS,DRAWING_LABELS,PICTURE_ROOT,REF_PREFIX,MAX_DATA_URL_CHARS,INPUT_TYPES,pictureSvg,semanticDrawingKinds,semanticIllustrations,isScreenshotUrl,isAssetIllustration,isDrawing,isTeacherPicture,isImageValue,isEmojiValue,makeRef,parseRef,picturePath,validDataUrl,newPictureId,labelFor,builtInOptionsFor,srcFor,imgAttrs,resolve,remember,setImg,hydrate,compressImage,
  setClassSpace,classCopyPath,publishToClass,unpublishFromClass,tickedTeacherPictures,mentionedTeacherPictures};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.B3ShorashimPictures=api;
})(typeof window==='undefined'?globalThis:window);
