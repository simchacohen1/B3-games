'use strict';
const {onSchedule}=require('firebase-functions/v2/scheduler');
const admin=require('firebase-admin');
if(!admin.apps.length)admin.initializeApp();

const BATCH_LIMIT=500;
async function cleanupExpiredTickets(db,now=Date.now()){
  const tickets=db.ref('b3Private/classPointerShareTickets');
  const snapshot=await tickets.orderByChild('expiresAt').endAt(now).limitToFirst(BATCH_LIMIT).once('value');
  const expired=snapshot.val()||{};
  const updates={};
  for(const [digest,ticket] of Object.entries(expired)){
    if(/^[a-f0-9]{64}$/.test(digest)&&Number.isFinite(ticket?.expiresAt)&&ticket.expiresAt<=now)updates[digest]=null;
  }
  const count=Object.keys(updates).length;
  if(count)await tickets.update(updates);
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
