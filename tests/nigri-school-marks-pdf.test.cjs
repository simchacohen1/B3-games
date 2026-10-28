'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const page=fs.readFileSync(__dirname+'/../sync-to-nigri/school-marks.html','utf8');
const helper=fs.readFileSync(__dirname+'/../weekly-quiz/report-pdf.js','utf8');
// Drop the page's start-up code (either the plain loadData() call or the sign-in wrapper around it) so only the functions are tested.
const script=page.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\n\(function startWithSignIn\(\)\{[\s\S]*$/,'\n').replace(/\nloadData\(\);\s*$/,'');
test('PDF libraries load before the School Marks sync script',()=>{
  assert.ok(page.indexOf('jspdf.umd.min.js')<page.indexOf('../weekly-quiz/report-pdf.js'));
  assert.ok(page.indexOf('../weekly-quiz/report-pdf.js')<page.indexOf('async function syncMarks()'));
  new vm.Script(helper);new vm.Script(script);
});
function fixture({builder,fetchImpl}={}){
  const elements={
    grade:{value:'B3 ET'},topic:{value:'Chumash Comprehension'},name:{value:'Weekly Quiz'},
    type:{value:'Quiz'},date:{value:'2026-10-26'},status:{textContent:''},sync:{disabled:false}
  };
  const rows=[
    {dataset:{sid:'chaim_chaikin',mark:'100',missing:'0',lid:'retake',attempt:'Retake'},querySelector:()=>({value:'present'})},
    {dataset:{sid:'yossi_gourarie',mark:'0',missing:'1',lid:'',attempt:'Missing'},querySelector:()=>({value:'review'})}
  ];
  const calls=[],pdfCalls=[];
  const window={jspdf:{},B3QuizReportPDF:{buildStudentReportPDF:(...a)=>{
    pdfCalls.push(a);return builder?builder(...a):'BASE64_PDF';
  }}};
  const document={getElementById:(id)=>elements[id],querySelectorAll:()=>rows};
  const firebase={initializeApp:()=>{},database:()=>({})};
  const fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return fetchImpl?fetchImpl(url,options):{ok:true,json:async()=>({status:'success',test_id:17})}};
  const context={window,document,firebase,fetch,alert:()=>{}};
  vm.createContext(context);
  vm.runInContext(script+';this.logic={best,syncMarks,setData:(a,b,c,s)=>{launches=a;responses=b;completions=c;sel=s}};',context);
  const launches={
    orig:{classId:'et',createdAt:1,quizSnapshot:{questions:[{q:'Old question',choices:['A','B'],correctIndex:1}]}},
    retake:{classId:'et',retakeOf:'orig',createdAt:2,attemptNumber:2,quizSnapshot:{questions:[{q:'Retake question',choices:['A','B'],correctIndex:1}]}}
  };
  const responses={orig:{chaim_chaikin:{0:{choiceIndex:0,correct:false}}},
    retake:{chaim_chaikin:{0:{choiceIndex:1,correct:true}}}};
  context.logic.setData(launches,responses,{retake:{chaim_chaikin:true}},'orig');
  return {ctx:context,logic:context.logic,rows,calls,pdfCalls,elements,window};
}
test('completed retake is the selected attempt, and its PDF is included in the Nigri payload',async()=>{
  const f=fixture();
  const best=f.logic.best('orig','chaim_chaikin');
  assert.equal(best.lid,'retake');assert.equal(best.mark,100);assert.equal(best.src,'Retake');
  await f.logic.syncMarks();
  assert.equal(f.calls.length,1);
  const sent=f.calls[0].body.students;
  assert.equal(sent[0].report_base64,'BASE64_PDF');
  assert.match(sent[0].report_filename,/\.pdf$/);
  assert.equal(sent[1].report_base64,undefined);
  assert.equal(f.pdfCalls[0][0].studentName,'Chaikin Mayer Chaim');
  assert.equal(f.pdfCalls[0][0].attemptTag,'Retake');
  assert.equal(f.pdfCalls[0][1][0].q,'Retake question');
  assert.equal(f.pdfCalls[0][2][0].choiceIndex,1);
  assert.equal(f.elements.sync.disabled,false);
});
test('PDF failure stops the whole sync before any marks are sent',async()=>{
  const f=fixture({builder:()=>{throw Error('PDF failed')}});
  await f.logic.syncMarks();
  assert.equal(f.calls.length,0);
  assert.match(f.elements.status.textContent,/Not sent to Nigri: PDF failed/);
  assert.equal(f.elements.sync.disabled,false);
});
test('missing PDF library also blocks any grades from being sent',async()=>{
  const f=fixture();delete f.window.B3QuizReportPDF;
  await f.logic.syncMarks();
  assert.equal(f.calls.length,0);
  assert.match(f.elements.status.textContent,/PDF generator unavailable/);
});
test('existing Hebrew-capable quiz report builder is exposed to School Marks',()=>{
  const w={jspdf:{jsPDF:class{
    constructor(){this.internal={pageSize:{getWidth:()=>612,getHeight:()=>792},getNumberOfPages:()=>1};}
    addFileToVFS(){}addFont(){}setFont(){}setFillColor(){}rect(){}setTextColor(){}setFontSize(){}
    text(){}splitTextToSize(s){return [s]}setPage(){}output(){return 'data:application/pdf;base64,BASE64_PDF'}addPage(){}
  }}};
  vm.runInNewContext(helper,{window:w});
  const pdf=w.B3QuizReportPDF.buildStudentReportPDF({quizTitle:'Quiz',className:'B3 ET',dateStr:'2026-10-26',attemptTag:'Retake',studentName:'Test Student',scoreText:'Score: 100%'},
    [{q:'בחר',choices:['לא','כן'],correctIndex:1}],{0:{correct:true,choiceIndex:1}});
  assert.equal(pdf,'BASE64_PDF');
});

test('network interruption after sending warns that Nigri might already have saved',async()=>{
  const f=fixture({fetchImpl:async()=>{throw Error('connection lost')}});
  await f.logic.syncMarks();
  assert.equal(f.calls.length,1);
  assert.match(f.elements.status.textContent,/Nigri may have saved marks; check Nigri before retrying/);
});
