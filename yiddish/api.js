window.YiddishAPI={async call(action,data={}){
  if(window.B3_STAGING_FIREBASE_CONFIG?.projectId==='fun-torah-tools-staging'&&window.B3_STAGING_TEST_FIXTURES===true){
    if(action!=='status'&&action!=='login')throw new Error('This Yiddish action is not enabled on staging.');
    const classId=String(data.classId||sessionStorage.getItem('b3Games_studentClass')||'TEST-ALEF');
    const studentId=String(data.studentId||sessionStorage.getItem('b3Games_studentId')||'staging-student');
    const words=(window.YIDDISH_CONTENT?.words||[]);
    const sections=Array.from({length:4},(_,group)=>({verified:true,words:words.filter(word=>word.group===group).map(word=>word.id)}));
    const student={id:studentId,name:sessionStorage.getItem('b3Games_studentName')||'Staging Student',classId};
    if(action==='login')return {token:'staging-yiddish-session',student};
    return {student,config:{sections,unlocked:{[classId]:sections.length},unlockedSteps:{[classId]:sections.length}},progress:{},round:null};
  }
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{const response=await fetch('https://us-central1-b3-games.cloudfunctions.net/yiddishApi',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,token:sessionStorage.getItem('yiddishSession'),...data}),signal:controller.signal});let body;try{body=await response.json()}catch(e){throw Error('Yiddish is not connected yet. Ask your teacher to finish setup.')}if(!response.ok){const e=Error(body.error||'Could not connect.');e.status=response.status;e.details=body.details||null;throw e}return body}catch(e){if(e.name==='AbortError')throw Error('Connection timed out. Please try again.');throw e}finally{clearTimeout(timer)}
}};
