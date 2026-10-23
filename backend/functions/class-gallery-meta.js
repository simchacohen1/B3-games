'use strict';
// Trigger-side helpers. (classGalleryRead keeps its own copy of the read-side
// helpers so it stays a single self-contained file; tests assert the path matches.)
// Tiny per-class "version" counter for Class Gallery posts.
// Every write to a gallery post bumps classGalleryMeta/<classId>/version (done
// by the triggers in class-gallery-version.js). classGalleryRead compares the
// browser's last-seen version with this one small value, so an unchanged poll
// no longer downloads the whole posts tree (with its pictures) from the database.
// Nothing here is readable or writable by browsers: the path has no rules.
const LEGACY_CLASS_NAMES={'B3 ET':'et','B3 WT':'wt'};
const versionPath=classId=>`classGalleryMeta/${classId}/version`;

// Same class mapping classGalleryRead uses to decide who can see a post.
function postClassId(row){
  if(!row||typeof row!=='object')return '';
  return String(row.classId||LEGACY_CLASS_NAMES[row.className]||'');
}

// Which classes' galleries could look different after this write?
// Both the old and the new class count, so moving a post bumps both.
function changedClassIds(before,after,pathClassId){
  const ids=new Set();
  if(pathClassId)ids.add(String(pathClassId));
  else{
    for(const row of [before,after]){const id=postClassId(row);if(id)ids.add(id);}
  }
  return [...ids].filter(id=>/^[A-Za-z0-9_-]{1,100}$/.test(id));
}

async function bumpVersions(db,increment,classIds){
  await Promise.all(classIds.map(id=>db.ref(versionPath(id)).set(increment(1))));
}

module.exports={versionPath,postClassId,changedClassIds,bumpVersions};
