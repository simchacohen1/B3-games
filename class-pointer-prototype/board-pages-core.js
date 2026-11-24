'use strict';
// Class Pointer whiteboards: pages (slides) in one whiteboard file.
//
// A whiteboard file used to be exactly one page ({version:1, kind, ...page}). A file can now hold several pages:
//   {version:2, kind, current:0, pages:[{...one page...}, ...]}
// where each page has the same shape the one-page file had (the teacher's page: pictures + strokes; a student's page:
// strokes, word text, tile places, and an optional background picture). Old one-page files still open: pagesOf()
// turns a version 1 file into a one-page list. Nothing here touches the network or the page; it only works on lists.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.ClassPointerPages=api;
})(typeof window!=='undefined'?window:null,function(){
  // Twenty pages keeps a saved file well inside the 3 MB student / teacher file limits and a Send-to-class affordable.
  const MAX_PAGES=20;
  const ID=/^[A-Za-z0-9_-]{1,24}$/;
  let seq=0;
  const newId=()=>'pg'+Date.now().toString(36)+(++seq).toString(36);
  const validId=id=>typeof id==='string'&&ID.test(id);

  // The pages of a saved file as a list of raw page objects (not yet checked by the board code), or null when the
  // file is not a whiteboard of this kind. Version 1 (one page) becomes a list of one: the file itself is the page.
  function pagesOf(raw,kind){
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.kind!==kind)return null;
    if(raw.version===1)return[raw];
    if(raw.version===2&&Array.isArray(raw.pages)&&raw.pages.length)return raw.pages.filter(p=>p&&typeof p==='object'&&!Array.isArray(p)).slice(0,MAX_PAGES);
    return null;
  }
  function currentOf(raw,count){const n=Math.floor(Number(raw?.current));return Number.isFinite(n)&&n>=0&&n<count?n:0}
  // The saved file for a list of pages. A one-page list is still written as version 2, so one reader handles both.
  function wrap(kind,pages,current){
    const list=pages.slice(0,MAX_PAGES);
    return{version:2,kind,current:currentOf({current},list.length),pages:list};
  }

  // Page ids are how a page is named on the network and in the page strip. These return a NEW list and never
  // go below one page or above MAX_PAGES (they hand back the same list when nothing can change).
  function insert(list,at,page){
    if(list.length>=MAX_PAGES)return list;
    const index=Math.max(0,Math.min(list.length,Math.floor(Number.isFinite(at)?at:list.length)));
    return[...list.slice(0,index),page,...list.slice(index)];
  }
  function remove(list,id){
    if(list.length<=1)return list;
    const at=list.findIndex(p=>p.id===id);
    return at<0?list:[...list.slice(0,at),...list.slice(at+1)];
  }
  // Put the page `id` at position `to` (0 = first).
  function move(list,id,to){
    const from=list.findIndex(p=>p.id===id);
    if(from<0)return list;
    const index=Math.max(0,Math.min(list.length-1,Math.floor(Number.isFinite(to)?to:from)));
    if(index===from)return list;
    const next=list.slice(),[page]=next.splice(from,1);next.splice(index,0,page);
    return next;
  }
  // Which page to show after page `id` is removed from `list` (the list BEFORE the removal): the page that takes its
  // place, or the last one. This is a position in the list that is left after the removal.
  function after(list,id){
    const at=list.findIndex(p=>p.id===id);
    return Math.max(0,Math.min(list.length-2,at<0?0:at));
  }
  // A list of ids the other side sent (page order for a student's board) checked against the pages that exist.
  function sameIds(list,ids){return Array.isArray(ids)&&ids.length===list.length&&list.every(p=>ids.includes(p.id))&&new Set(ids).size===ids.length}
  function reorder(list,ids){
    if(!sameIds(list,ids))return list;
    return ids.map(id=>list.find(p=>p.id===id));
  }
  return{MAX_PAGES,newId,validId,pagesOf,currentOf,wrap,insert,remove,move,after,reorder};
});
