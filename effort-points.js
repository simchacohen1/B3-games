(function(root){
 'use strict';
 // Effort Points are based only on explicit learning events supplied by a tool.
 // Mouse movement, keyboard activity and time on an open tab are NOT counted.
 const LOGIN_URL='https://us-central1-b3-games.cloudfunctions.net/studentRewardsLogin';
 const AWARD_URL='https://us-central1-b3-games.cloudfunctions.net/studentRewardsAutoAward';
 const VALID=new Set(['yiddish','gematria','rashi-letters']);
 const MIN_PING_MS=12000;
 let lastSentAt=0,busy=false,authPromise=null,nextStartsFresh=true;
 function cached(k){try{return sessionStorage.getItem(k)||''}catch(e){return ''}}
 async function getEffortAuth(){
   if(!root.firebase?.auth||!root.firebase?.initializeApp)return null;
   if(authPromise)return authPromise;
   authPromise=(async()=>{
     const id=cached('b3Games_studentId'),name=cached('b3Games_studentName'),pin=cached('b3Games_classPin');
     const classId=cached('b3Games_studentClass');
     if(!id||!name||!pin||!classId)return null;
     const primary=root.firebase.apps?.[0];
     const config=root.B3_FIREBASE_CONFIG||primary?.options;
     if(!config)return null;
     const app=root.firebase.apps.find(a=>a.name==='effortPoints')||root.firebase.initializeApp(config,'effortPoints');
     const response=await fetch(LOGIN_URL,{
       method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({b3StudentId:id,name,pin,classId})
     });
     if(!response.ok)return null;
     const data=await response.json();
     if(!data.customToken||data.b3StudentId!==id||data.classId!==classId)return null;
     const auth=app.auth();
     await auth.signInWithCustomToken(data.customToken);
     return auth;
   })().catch(e=>{console.warn('Effort Points sign-in unavailable',e);return null});
   return authPromise;
 }
 async function note(tool,options={}){
   if(!VALID.has(tool)||options.disabled===true||root.B3Guest?.isGuest?.()||document.hidden)return;
   const now=Date.now();
   if(busy||now-lastSentAt<MIN_PING_MS)return;
   busy=true;lastSentAt=now;
   try{
     const auth=await getEffortAuth();
     if(!auth?.currentUser)return;
     const token=await auth.currentUser.getIdToken();
     const first=nextStartsFresh;nextStartsFresh=false;
     const id=root.crypto?.randomUUID?.();
     if(!id)return;
     const res=await fetch(AWARD_URL,{
       method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
       body:JSON.stringify({action:'effort-event',tool,eventId:id,breakBefore:first})
     });
     if(!res.ok){const body=await res.json().catch(()=>({}));console.warn('Effort Points not recorded',body.error||res.status);return}
     const data=await res.json();
     if(data.newlyAwarded>0)root.dispatchEvent(new CustomEvent('funTorahEffortAward',{detail:data}));
   }catch(e){console.warn('Effort Points unavailable',e)}
   finally{busy=false}
 }
 document.addEventListener('visibilitychange',()=>{if(document.hidden)nextStartsFresh=true});
 root.addEventListener('pagehide',()=>{nextStartsFresh=true});
 root.FunTorahEffort=Object.freeze({note});
})(window);
