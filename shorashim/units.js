/* Shorashim learning units and per-teacher library helpers.
   Nothing here is tied to a particular perek or account.

   Unit = the group a student picks on the "Choose a list" screen.
   - A word with a perek (any whole number 1-200) belongs to unit "perek:<n>".
   - A word with no perek belongs to the unit of its list/category: "list:<name>".
   - Booklet words keep their own separate "booklet" unit.
   A teacher may give any unit a custom label (settings.unitLabels[key]).

   Each teacher's own library lives at shorashimLibraries/<teacherUid>
   ({catalog:{shorashim,prefix,suffix}, settings:{namedLists,unitLabels}}).
   A class catalog (posukPractice/shorashimLearning/classes/<classId>/catalog)
   is still what that class's students see; the teacher copies words from
   their library into a class and decides what each class sees. */
(function(root){
'use strict';
const TRACKS=['shorashim','prefix','suffix'];
const LIBRARY_ROOT='shorashimLibraries';
const MAX_PEREK=200;
const DEFAULT_LIST='Main List';

function hebrewNumeral(value){
  let n=Math.floor(Number(value));
  if(!Number.isFinite(n)||n<1||n>999)return String(value??'');
  const hundreds=['','ק','ר','ש','ת','תק','תר','תש','תת','תתק'];
  const tens=['','י','כ','ל','מ','נ','ס','ע','פ','צ'];
  const ones=['','א','ב','ג','ד','ה','ו','ז','ח','ט'];
  let s=hundreds[Math.floor(n/100)];n%=100;
  if(n===15)s+='טו';else if(n===16)s+='טז';else s+=tens[Math.floor(n/10)]+ones[n%10];
  return s.length>1?s.slice(0,-1)+'״'+s.slice(-1):s+'׳';
}
// Accepts 18, "18", " 18 ". Blank, 0, fractions or out-of-range values mean "no perek".
function perekValue(itemOrValue){
  const raw=itemOrValue&&typeof itemOrValue==='object'?itemOrValue.perek:itemOrValue;
  if(raw===null||raw===undefined||String(raw).trim()==='')return null;
  const n=Number(String(raw).trim());
  return Number.isInteger(n)&&n>=1&&n<=MAX_PEREK?n:null;
}
// For teacher input: returns {ok:true,value:number|null} or {ok:false}.
function parsePerekInput(text){
  const t=String(text??'').trim();
  if(!t)return {ok:true,value:null};
  const n=perekValue(t);
  return n===null?{ok:false}:{ok:true,value:n};
}
// Bulk Add perek: the teacher must choose. Blank is refused. "No perek" is only an
// explicit choice (noPerekChecked) and only where it is allowed: in B3's shared ET/WT
// lists an untagged word is shown to students as Perek 18, so it is never allowed there.
// Returns {ok:true,value:number|null} or {ok:false,error}.
function bulkPerekChoice(text,{noPerekAllowed=false,noPerekChecked=false}={}){
  if(noPerekAllowed&&noPerekChecked)return {ok:true,value:null};
  const t=String(text??'').trim();
  if(!t)return {ok:false,error:noPerekAllowed?'Choose a perek for these words, or tick "No perek".':'Choose a perek for these words before adding them.'};
  const n=perekValue(t);
  return n===null?{ok:false,error:`Perek must be a whole number from 1 to ${MAX_PEREK}.`}:{ok:true,value:n};
}
function listNameOf(item){return String(item?.listName||'').trim()||DEFAULT_LIST;}
function unitKey(item){
  if(item?.bookletWeek)return 'booklet';
  const p=perekValue(item);
  return p!==null?'perek:'+p:'list:'+listNameOf(item);
}
function defaultUnitLabel(key){
  key=String(key||'');
  if(key==='booklet')return '3rd Grade Booklet';
  if(key.startsWith('perek:'))return 'Perek '+hebrewNumeral(key.slice(6));
  if(key.startsWith('list:'))return key.slice(5)||DEFAULT_LIST;
  return key;
}
// Firebase keys cannot contain . # $ / [ ] so custom labels are stored under an escaped key.
function labelStorageKey(key){return String(key||'').replace(/[.#$/\[\]%]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase().padStart(2,'0'));}
function unitLabel(key,labels){
  const custom=labels&&typeof labels==='object'?String(labels[labelStorageKey(key)]||labels[key]||'').trim():'';
  return custom||defaultUnitLabel(key);
}
function itemUnitLabel(item,labels){return unitLabel(unitKey(item),labels);}
// Distinct units, perakim in number order first, then lists alphabetically.
function unitsFor(items,labels){
  const seen=new Map();
  for(const item of items||[]){
    if(!item||item.bookletWeek)continue;
    const key=unitKey(item);
    if(!seen.has(key))seen.set(key,{key,perek:perekValue(item),label:unitLabel(key,labels),count:0});
    seen.get(key).count++;
  }
  return [...seen.values()].sort((a,b)=>{
    if(a.perek!==null&&b.perek!==null)return a.perek-b.perek;
    if(a.perek!==null)return -1;
    if(b.perek!==null)return 1;
    return a.label.localeCompare(b.label);
  });
}
function asList(raw){
  if(Array.isArray(raw))return raw.filter(Boolean);
  if(raw&&typeof raw==='object')return Object.keys(raw).sort((a,b)=>Number(a)-Number(b)).map(k=>raw[k]).filter(Boolean);
  return [];
}
function withAllTracks(c){
  const out={...(c||{})};
  TRACKS.forEach(t=>{out[t]=asList(out[t]);});
  return out;
}
// Copy words from source into target by id. Existing target words are never
// replaced or removed, so a teacher's own edits always win. Returns a new catalog.
function mergeCatalogById(target,source,include){
  const next=withAllTracks(target),from=withAllTracks(source);
  let added=0;
  for(const track of TRACKS){
    const ids=new Set(next[track].map(i=>String(i.id||'')));
    for(const item of from[track]){
      const id=String(item?.id||'');
      if(!id||ids.has(id))continue;
      if(include&&!include(item,track))continue;
      next[track].push(JSON.parse(JSON.stringify(item)));ids.add(id);added++;
    }
  }
  return {catalog:next,added};
}
function mergeSettings(target,source){
  const out={...(target||{})};
  const src=source||{};
  out.namedLists={...(out.namedLists||{})};
  for(const track of TRACKS){
    const a=Array.isArray(out.namedLists[track])?out.namedLists[track]:[];
    const b=Array.isArray(src.namedLists?.[track])?src.namedLists[track]:[];
    const merged=[...new Set([...a,...b])];
    if(merged.length)out.namedLists[track]=merged;
  }
  out.unitLabels={...(src.unitLabels||{}),...(out.unitLabels||{})};
  if(!Object.keys(out.namedLists).length)delete out.namedLists;
  if(!Object.keys(out.unitLabels).length)delete out.unitLabels;
  return out;
}
function countWords(catalog){const c=withAllTracks(catalog);return TRACKS.reduce((n,t)=>n+c[t].length,0);}
function validUid(uid){return typeof uid==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(uid);}
function libraryPath(uid){if(!validUid(uid))throw new Error('Invalid teacher account id.');return LIBRARY_ROOT+'/'+uid;}

const api={TRACKS,LIBRARY_ROOT,MAX_PEREK,DEFAULT_LIST,hebrewNumeral,perekValue,parsePerekInput,bulkPerekChoice,listNameOf,unitKey,defaultUnitLabel,labelStorageKey,unitLabel,itemUnitLabel,unitsFor,withAllTracks,mergeCatalogById,mergeSettings,countWords,validUid,libraryPath};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
else root.B3ShorashimUnits=api;
})(typeof window==='undefined'?globalThis:window);
