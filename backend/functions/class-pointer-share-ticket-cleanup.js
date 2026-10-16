'use strict';
const {onSchedule}=require('firebase-functions/v2/scheduler');
const admin=require('firebase-admin');
const crypto=require('node:crypto');
if(!admin.apps.length)admin.initializeApp();

const BATCH_LIMIT=500;
async function cleanupExpiredTickets(db,now=Date.now()){
  let count=0;
  const removeExpired=async(path,onRemoved)=>{
    const tickets=db.ref(path);
    const snapshot=await tickets.orderByChild('expiresAt').endAt(now).limitToFirst(BATCH_LIMIT).once('value');
    const expired=snapshot.val()||{},updates={};
    for(const [digest,ticket] of Object.entries(expired)){
      if(!/^[a-f0-9]{64}$/.test(digest)||!Number.isFinite(ticket?.expiresAt)||ticket.expiresAt>now)continue;
      updates[digest]=null;
      if(onRemoved)await onRemoved(digest,ticket);
    }
    const removed=Object.keys(updates).length;
    if(removed)await tickets.update(updates);
    count+=removed;
  };
  await removeExpired('b3Private/classPointerShareTickets');
  await removeExpired('b3Private/classPointerJoinTickets',async(digest,ticket)=>{
    // Remove the student's index only if it still points to this expired ticket; a newer
    // ticket may have been issued after the query snapshot was read.
    if(typeof ticket.studentId!=='string'||!ticket.studentId)return;
    const studentKey=crypto.createHash('sha256').update(ticket.studentId).digest('hex').slice(0,32);
    await db.ref('b3Private/classPointerJoinTicketIndex/'+studentKey).transaction(current=>current===digest?null:undefined);
  });
  return count;
}

exports.cleanupClassPointerShareTickets=onSchedule({
  schedule:'every 15 minutes',
  region:'us-central1',
  maxInstances:1
},async()=>{
  const deleted=await cleanupExpiredTickets(admin.database());
  if(deleted)console.info('Removed expired Class Pointer sharing tickets:',deleted);
});

exports._cleanupExpiredTickets=cleanupExpiredTickets;
exports._ticketCleanupBatchLimit=BATCH_LIMIT;
