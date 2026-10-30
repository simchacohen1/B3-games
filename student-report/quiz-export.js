/* Read-only exports for the Student Report's All Quizzes section.
   Keeps student information in the browser; no export data is sent to a server.
   PDFs are rendered to canvas so Hebrew and mixed-language quiz names print correctly. */
(function(root){
  'use strict';
  const pdfReady=()=>root.jspdf&&typeof root.jspdf.jsPDF==='function';
  const zipReady=()=>typeof root.JSZip==='function';
  const libraryLoads={};
  function loadLibrary(key,url,ready){
    if(ready())return Promise.resolve();
    if(!libraryLoads[key]){
      libraryLoads[key]=new Promise((resolve,reject)=>{
        const script=document.createElement('script');
        script.src=url;
        script.onload=()=>ready()?resolve():reject(new Error(key+' did not initialize.'));
        script.onerror=()=>reject(new Error(key+' could not load. Check your internet connection.'));
        document.head.appendChild(script);
      }).catch(err=>{delete libraryLoads[key];throw err});
    }
    return libraryLoads[key];
  }
  async function ensureLibraries(withZip){
    await loadLibrary('PDF','https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',pdfReady);
    if(withZip)await loadLibrary('ZIP','https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',zipReady);
  }
  const safeName=(v)=>String(v||'Student').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,90)||'Student';
  function saveBlob(blob,name){
    const url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  function makePdf({name,className,period,history,practice}){
    if(!pdfReady())throw new Error('PDF library is unavailable. Check your internet connection and try again.');
    if(!history||!history.summary)throw new Error('Quiz history has not loaded yet.');
    const q=history.summary, doc=new root.jspdf.jsPDF({orientation:'landscape',unit:'pt',format:'a4',compress:true});
    const W=1200,H=848,M=48,RIGHT=W-M;
    let canvas,ctx,y=0,page=0;
    const font=(size=20,bold=false,color='#26344b')=>{
      ctx.font=(bold?'bold ':'')+size+'px Arial, sans-serif';
      ctx.fillStyle=color;
      ctx.textBaseline='top';
    };
    const line=(s,x,top,size=20,bold=false,color='#26344b')=>{
      font(size,bold,color);ctx.fillText(String(s??''),x,top);
    };
    const rule=(top)=>{ctx.fillStyle='#e2e8f0';ctx.fillRect(M,top,RIGHT-M,2)};
    const wrap=(value,width,size=20,bold=false)=>{
      font(size,bold);
      const words=String(value??'').split(/\s+/).filter(Boolean);
      if(!words.length)return [''];
      const lines=[];let cur='';
      for(const word of words){
        const next=cur?cur+' '+word:word;
        if(ctx.measureText(next).width<=width){cur=next;continue}
        if(cur){lines.push(cur);cur=''}
        let chunk='';
        for(const ch of word){
          if(chunk&&ctx.measureText(chunk+ch).width>width){lines.push(chunk);chunk=''}
          chunk+=ch;
        }
        cur=chunk;
      }
      if(cur)lines.push(cur);
      return lines;
    };
    const paragraph=(s,x,top,width,size=18,color='#475569',leading=25)=>{
      const lines=wrap(s,width,size);
      lines.forEach((l,i)=>line(l,x,top+i*leading,size,false,color));
      return top+lines.length*leading;
    };
    function addCanvas(){
      if(canvas)doc.addImage(canvas.toDataURL('image/jpeg',0.92),'JPEG',0,0,841.89,595.28,undefined,'FAST');
    }
    function newPage(){
      if(canvas){addCanvas();doc.addPage()}
      page++;
      canvas=document.createElement('canvas');
      canvas.width=W*1.5;canvas.height=H*1.5;
      ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw new Error('PDF canvas is unavailable.');
      ctx.scale(1.5,1.5);ctx.fillStyle='white';ctx.fillRect(0,0,W,H);
      ctx.fillStyle='#172033';ctx.fillRect(0,0,W,12);
      line('Fun Torah Tools  |  Weekly Quiz Report',M,33,20,true,'#1e3a5f');
      line(name, M,70,32,true,'#172033');
      line(className+'   |   '+period+'   |   '+new Date().toLocaleDateString(),M,112,18,false,'#64748b');
      rule(152);y=172;
      ctx.fillStyle='#64748b';ctx.font='15px Arial, sans-serif';
      ctx.fillText('Page '+page,RIGHT-70,H-33);
    }
    function room(height){if(y+height>H-80)newPage()}
    function heading(text){
      room(54);line(text,M,y,23,true,'#1e3a5f');y+=39;
    }
    function columns(values,xs,colors){
      values.forEach((v,i)=>line(v,xs[i],y,16,true,colors?.[i]||'#475569'));
      y+=28;rule(y);y+=9;
    }
    newPage();
    const avg=q.avg===null?'—':q.avg+'%';
    const stats=[
      q.assigned+' assigned',q.completed+' completed',q.inProgress+' in progress',q.notStarted+' not started',
      avg+' completed average',q.pointsEarned+' / '+q.pointsPossible+' points'
    ];
    let xx=M;
    for(const label of stats){
      font(17,true);
      const w=ctx.measureText(label).width+32;
      const width=Math.max(w+10,150);
      if(xx+width>RIGHT){xx=M;y+=45}
      ctx.fillStyle='#f1f5f9';ctx.fillRect(xx,y,width-8,35);
      line(label,xx+10,y+8,17,true,'#26344b');xx+=width;
    }
    y+=64;
    heading('Assigned quizzes');
    const xs=[M,M+402,M+548,M+700,M+850,M+959];
    columns(['QUIZ','DATE','STATUS','POINTS','PERCENT','TRIED / GIVEN'],xs);
    const labelStatus={completed:'Completed',in_progress:'In Progress',not_started:'Not Started'};
    for(const z of history.quizzes||[]){
      const titleLines=wrap(z.title,377,19,true);
      const extra=z.attempts?.length>1?'Given '+z.attempts.length+' times':(z.beforeJoined&&z.status==='not_started'?'Given before enrollment':(z.closed&&z.status!=='completed'?'Quiz closed':''));
      const rowHeight=Math.max(58,titleLines.length*26+17+(extra?19:0));
      room(rowHeight);
      titleLines.forEach((l,i)=>line(l,xs[0],y+7+i*26,19,true));
      if(extra)line(extra,xs[0],y+8+titleLines.length*26,15,false,'#64748b');
      line(z.date?new Date(z.date).toLocaleDateString():'—',xs[1],y+11,18);
      const status=labelStatus[z.status]||'Unavailable';
      line(status,xs[2],y+11,17,true,z.status==='completed'?'#15803d':z.status==='in_progress'?'#b45309':'#b91c1c');
      const points=z.status==='completed'?z.correct+' / '+z.total:z.partial?z.partial.correct+' correct':'—';
      line(points,xs[3],y+11,18);
      line(z.status==='completed'?z.pct+'%':z.partial?'In progress':'—',xs[4],y+11,17);
      const tried=(z.attempts||[]).filter(a=>a.status!=='not_started').length;
      line(tried+' of '+(z.attempts||[]).length,xs[5],y+11,18);
      y+=rowHeight;rule(y);y+=8;
    }
    for(const u of history.unavailable||[]){
      room(63);
      line('Quiz record no longer available',xs[0],y+6,19,true);
      line(u.date?new Date(u.date).toLocaleDateString():'—',xs[1],y+6,18);
      line('Data unavailable',xs[2],y+6,17);
      y+=55;rule(y);y+=8;
    }
    if(!(history.quizzes?.length||history.unavailable?.length)){
      room(35);line('No assigned quizzes in this period.',M,y,19);y+=38;
    }
    room(77);
    y=paragraph('Average counts only completed quizzes. Unfinished and not-started quizzes are not counted as zero. For retakes, the newest completed attempt counts.',M,y+14,RIGHT-M,17,'#64748b',24)+20;
    heading('Practice quizzes (not assigned or included in the average)');
    if(practice===null){
      room(37);line('Practice quiz history could not be loaded.',M,y,18);y+=37;
    }else if(!practice?.length){
      room(37);line('No practice quizzes in this period.',M,y,18);y+=37;
    }else{
      const px=[M,M+625,M+810,M+965];
      columns(['PRACTICE','DATE','POINTS','PERCENT'],px);
      for(const p of practice){
        const titleLines=wrap(p.title,600,19);
        const h=Math.max(46,titleLines.length*24+12);
        room(h);
        titleLines.forEach((l,i)=>line(l,px[0],y+5+i*24,19));
        line(p.date?new Date(p.date).toLocaleDateString():'—',px[1],y+6,18);
        line(p.correct+' / '+p.total,px[2],y+6,18);
        line(p.pct===null?'—':p.pct+'%',px[3],y+6,18);
        y+=h;rule(y);y+=7;
      }
    }
    addCanvas();
    return doc.output('arraybuffer');
  }
  async function savePdf(input,filename){
    await ensureLibraries(false);
    const data=makePdf(input);
    saveBlob(new Blob([data],{type:'application/pdf'}),filename);
  }
  async function saveZip(students,className,period,onProgress){
    await ensureLibraries(true);
    if(!zipReady())throw new Error('ZIP library is unavailable. Check your internet connection and try again.');
    if(!pdfReady())throw new Error('PDF library is unavailable. Check your internet connection and try again.');
    if(!students?.length)throw new Error('No students in the selected class.');
    const zip=new root.JSZip(), filenames=new Set();
    for(let i=0;i<students.length;i++){
      const s=students[i];
      const pdf=makePdf({name:s.name,className,period,history:s.history,practice:s.practice});
      const basename=safeName(s.name), suffix=safeName(s.id).slice(0,30);
      let filename=basename+'-quizzes.pdf';
      if(filenames.has(filename))filename=basename+'-'+suffix+'-quizzes.pdf';
      filenames.add(filename);
      zip.file(filename,pdf);
      if(onProgress)onProgress(i+1,students.length);
    }
    const blob=await zip.generateAsync({type:'blob',compression:'STORE'});
    saveBlob(blob,'quiz-reports-'+safeName(className)+'-'+new Date().toISOString().slice(0,10)+'.zip');
  }
  root.B3QuizExports={makePdf,savePdf,saveZip,safeName};
})(window);
