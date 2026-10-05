'use strict';
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
if(!admin.apps.length)admin.initializeApp();
const db=admin.database();
const {makeService}=require('./yiddish-service/core.cjs');
const service=makeService({get:async p=>(await db.ref(p).once('value')).val(),set:(p,v)=>db.ref(p).set(v),tx:async(p,f)=>{const ref=db.ref(p);const snap=await ref.once('value');let pass=0;const note=(cur,out,skipped)=>{try{console.log(JSON.stringify({yiddishTx:{pass:++pass,skipped,curNull:cur===null,hasRound:!!(cur&&cur.round),roundIds:cur&&cur.rounds?Object.keys(cur.rounds).map(k=>k.slice(0,6)):[],aborted:out===undefined}}))}catch(e){}};if(snap.val()===null)return ref.transaction(cur=>{const out=f(cur);note(cur,out,false);return out});return ref.transaction(cur=>{if(cur===null){note(cur,cur,true);return cur}const out=f(cur);note(cur,out,false);return out})}},token=>admin.auth().verifyIdToken(token,true));
exports.yiddishApi=onRequest({region:'us-central1',cors:['https://simchacohen1.github.io'],maxInstances:5},async(req,res)=>{res.set('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});if(Buffer.byteLength(JSON.stringify(req.body||{}))>30000)return res.status(413).json({error:'Request too large.'});try{res.json(await service(req.body,req.ip))}catch(e){res.status(e.code&&Number.isInteger(e.code)?e.code:500).json({error:e.code?e.message:'Could not save right now. Please try again.'})}});
