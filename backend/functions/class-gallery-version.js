'use strict';
// Database triggers that bump classGalleryMeta/<classId>/version whenever any
// Class Gallery post is created, approved, edited or deleted, by anyone (the
// gallery page, classGallerySubmit, Halacha, private media, teacher tools).
// A trigger sees every write, so no write path can forget to bump the counter.
//
// Deploy these BEFORE the updated classGalleryRead:
//   firebase deploy --only functions:classGalleryVersionLegacy,functions:classGalleryVersionWorkspace,functions:classGalleryRead --project b3-games
const {onValueWritten}=require('firebase-functions/v2/database');
const admin=require('firebase-admin');
const {changedClassIds,bumpVersions}=require('./class-gallery-meta');
const {assertNoProductionFirebaseTarget,databaseInstanceFromUrl}=require('./firebase-resource-targets.cjs');
if(!admin.apps.length)admin.initializeApp();
assertNoProductionFirebaseTarget(admin.apps[0]);

async function handleGalleryWrite(db,{before,after,pathClassId}){
  const classIds=changedClassIds(before,after,pathClassId);
  if(!classIds.length)return {bumped:[]};
  await bumpVersions(db,classIds);
  return {bumped:classIds};
}
exports.handleGalleryWrite=handleGalleryWrite;

const app=admin.apps[0];
const options={region:'us-central1',instance:databaseInstanceFromUrl(app.options.databaseURL,app.options.projectId),memory:'256MiB'};

// ET / WT keep their posts in the original shared list.
exports.classGalleryVersionLegacy=onValueWritten(
  {...options,ref:'/classGallery/posts/{postId}'},
  event=>handleGalleryWrite(admin.database(),{before:event.data.before.val(),after:event.data.after.val()})
);

// Every other class has its own list under its class record.
exports.classGalleryVersionWorkspace=onValueWritten(
  {...options,ref:'/b3Games/workspaces/b3-2026/classes/{classId}/resources/gallery/posts/{postId}'},
  event=>handleGalleryWrite(admin.database(),{before:event.data.before.val(),after:event.data.after.val(),pathClassId:event.params.classId})
);
