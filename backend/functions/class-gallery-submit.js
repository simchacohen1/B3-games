'use strict';
// Site-wide student screenshot submission. Every write is authenticated here,
// not by browser-provided student name/class or Realtime Database client rules.
const crypto = require('node:crypto');
const {onRequest} = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const {resolveStudent} = require('./student-login-core.cjs');
const {assertNoProductionFirebaseTarget} = require('./firebase-resource-targets.cjs');
if (!admin.apps.length) admin.initializeApp();
assertNoProductionFirebaseTarget(admin.apps[0]);

const ORIGINS = [
  'https://funtorahtools.com',
  'https://www.funtorahtools.com',
  'https://simchacohen1.github.io'
];
const MAX_IMAGE_BYTES = 900 * 1024;
const IMAGE_RE = /^data:image\/(jpeg|png);base64,([a-zA-Z0-9+/=]+)$/;
const invalid = (status, message) => { throw Object.assign(new Error(message), {status}); };
const cleanText = (s, n) => String(s || '').replace(/[<>\x00-\x1f]/g, '').trim().slice(0, n);
const validKey = s => /^[a-zA-Z0-9_-]{1,100}$/.test(String(s || ''));

exports.classGallerySubmit = onRequest({
  region: 'us-central1', cors: ORIGINS,
  maxInstances: 5, memory: '256MiB', timeoutSeconds: 40
}, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.json({ok:true,ready:true,version:1});
  if (req.method !== 'POST') return res.status(405).json({error:'Use POST.'});
  let imageFile;
  try {
    const body = req.body || {};
    const approx = Buffer.byteLength(JSON.stringify(body));
    if (approx > 1400000) invalid(413, 'This screenshot is too large. Try a smaller window.');
    const get = async path => (await admin.database().ref(path).once('value')).val();
    const student = await resolveStudent(get, {
      b3StudentId: body.studentId,
      name: body.studentName,
      pin: body.pin,
      classId: body.classId
    });
    if (!validKey(student.id) || !validKey(student.classId)) invalid(403, 'Choose your class and sign in again.');
    const title = cleanText(body.title, 70);
    if (!title) invalid(400, 'Please give your work a title.');
    const description = cleanText(body.description, 240);
    const photo = IMAGE_RE.exec(String(body.image || ''));
    if (!photo) invalid(400, 'A JPEG or PNG screenshot is required.');
    const bytes = Buffer.from(photo[2], 'base64');
    const jpeg = photo[1] === 'jpeg';
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) invalid(413, 'Screenshot is too large. Please try again.');
    if (jpeg && !(bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff)) invalid(400, 'Invalid screenshot.');
    if (!jpeg && bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') invalid(400, 'Invalid screenshot.');

    // Per-student rolling limit protects Storage and the teacher queue.
    const limitRef = admin.database().ref('b3Private/gallerySubmitLimits/' + student.id);
    const now = Date.now();
    const tx = await limitRef.transaction(v => {
      const row = v && v.until > now ? v : {count:0, until:now+3600000, last:0};
      if (row.count >= 12 || now - (row.last || 0) < 10000) return;
      return {count:row.count+1, until:row.until, last:now};
    }, undefined, false);
    if (!tx.committed) invalid(429, 'Please wait before sending another picture.');

    const postRef = admin.database().ref(
      ['et','wt'].includes(student.classId)
        ? 'classGallery/posts'
        : 'b3Games/workspaces/b3-2026/classes/' + student.classId + '/resources/gallery/posts'
    ).push();
    const token = crypto.randomUUID();
    const suffix = jpeg ? 'jpg' : 'png';
    const imagePath = 'classGallery/verified/' + student.classId + '/' + postRef.key + '.' + suffix;
    const bucket = admin.storage().bucket();
    imageFile = bucket.file(imagePath);
    await imageFile.save(bytes, {
      resumable:false,
      contentType:jpeg?'image/jpeg':'image/png',
      metadata:{metadata:{firebaseStorageDownloadTokens:token},cacheControl:'private, max-age=0'}
    });
    const imageUrl = 'https://firebasestorage.googleapis.com/v0/b/' +
      encodeURIComponent(bucket.name) + '/o/' + encodeURIComponent(imagePath) +
      '?alt=media&token=' + encodeURIComponent(token);
    const categoryMap = {
      shorashim:'Shorashim', halacha:'Halacha', 'class-pointer':'Class Pointer',
      chumash:'Chumash', yiddish:'Yiddish', chazara:'Chazara',
      'posuk-practice':'Chumash', rashi:'Rashi', other:'Other'
    };
    const source = cleanText(body.source, 36).toLowerCase();
    await postRef.set({
      studentId:student.id,
      workspaceId:'b3-2026',
      classId:student.classId,
      studentName:String(student.profile?.name || student.id),
      className:String(student.cls?.name || student.classId),
      title, description, category:categoryMap[source]||'Other',
      galleryRoom:'hallway', image:imageUrl, link:'',
      audioUrl:null, videoUrl:null, status:'pending',
      source:'verified-site-screenshot', createdAt:new Date(now).toISOString()
    });
    return res.status(201).json({ok:true,pending:true,postId:postRef.key});
  } catch (e) {
    if (imageFile) await imageFile.delete({ignoreNotFound:true}).catch(()=>{});
    const status = e.status || (Number.isInteger(e.code) ? e.code : 500);
    if (status >= 500) console.error('classGallerySubmit:', e);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      error:status >= 500 ? 'Could not send your picture. Please try again.' : e.message
    });
  }
});
