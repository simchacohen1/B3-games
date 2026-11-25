'use strict';
// Whiteboard improvements from the principal, added to the existing whiteboard (nothing rebuilt):
//   1. Save, My files and Send to class right on the teacher's toolbar (they stay under More too).
//   2. A full color set including white, a custom color picker, and Fill for shapes.
//   3. Fonts for words (Hebrew-friendly ones included), bold as before, and text color.
// Everything that worked before must work exactly as before: marks without a font or fill are unchanged.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const dir=path.join(__dirname,'../class-pointer-prototype');
const C=require(path.join(dir,'classroom-core.js'));
const Clip=require(path.join(dir,'board-clipboard.js'));
const read=name=>fs.readFileSync(path.join(dir,name),'utf8');
const pdf=read('pdf-mode.js'),annotate=read('classroom-annotate.js'),toolbar=read('annotation-toolbar.js'),html=read('classroom.html');
const P=[{x:.1,y:.1},{x:.5,y:.4}];
const stroke=(extra={})=>({tool:'rectangle',color:'#1f2937',size:.016,points:P,...extra});

test('marks without a font or a fill come out exactly as they did before',()=>{
  assert.deepEqual(C.cleanStroke(stroke()),{tool:'rectangle',color:'#1f2937',size:.016,points:P});
  assert.deepEqual(C.cleanStroke({tool:'text',color:'#1f2937',size:.02,text:'hello',points:P}),{tool:'text',color:'#1f2937',size:.02,points:P,text:'hello'});
  assert.deepEqual(C.cleanStroke({tool:'text',color:'#1f2937',size:.02,text:'hi',bold:true,font:'sans',points:P}),{tool:'text',color:'#1f2937',size:.02,points:P,text:'hi',bold:true},'the plain font is the default and is not stored');
  assert.deepEqual(C.cleanStroke({tool:'pen',color:'#c62828',size:.016,points:P}),{tool:'pen',color:'#c62828',size:.016,points:P});
});

test('any color can be used for a mark (the custom picker), and bad colors still fall back',()=>{
  assert.equal(C.cleanStroke(stroke({color:'#12ab34'})).color,'#12ab34');
  assert.equal(C.cleanStroke(stroke({color:'#FFFFFF'})).color,'#ffffff','white, in any case');
  for(const bad of ['red','#12ab3','#12ab34ff','javascript:alert(1)','url(x)',null,undefined,5])assert.equal(C.cleanStroke(stroke({color:bad})).color,'#ffcc00',String(bad));
  // Pointers keep their short list: a custom color is not a pointer color.
  assert.equal(C.pointStyle({tool:'target',color:'#12ab34'}).color,null);
});

test('shapes can be filled with their own color; nothing else can',()=>{
  for(const tool of ['rectangle','ellipse','triangle'])assert.equal(C.cleanStroke(stroke({tool,fill:true})).fill,true,tool);
  for(const tool of ['pen','line','pen-arrow','highlight','box'])assert.equal('fill' in C.cleanStroke(stroke({tool,fill:true})),false,tool);
  for(const bad of ['yes',1,'#ff0000',{}])assert.equal('fill' in C.cleanStroke(stroke({fill:bad})),false,String(bad));
  assert.deepEqual(C.FILLABLE,['rectangle','ellipse','triangle']);
});

test('words: a font from the list (Hebrew ones included) or the plain font; nothing else',()=>{
  assert.deepEqual(Object.keys(C.FONTS),['sans','david','frank','miriam','serif','mono','comic']);
  for(const key of Object.keys(C.FONTS))assert.ok(C.fontStack(key).length>3,key);
  assert.equal(C.fontStack('sans'),'sans-serif','the plain font is exactly what the whiteboard always used');
  assert.match(C.fontStack('david'),/"David"/);assert.match(C.fontStack('frank'),/FrankRuehl/);assert.match(C.fontStack('miriam'),/Miriam/);
  assert.equal(C.fontStack('nope'),'sans-serif');assert.equal(C.fontStack(undefined),'sans-serif');assert.equal(C.fontStack('__proto__'),'sans-serif');
  const word=(font,extra={})=>C.cleanStroke({tool:'text',color:'#c62828',size:.02,text:'שלום',font,points:P,...extra});
  assert.equal(word('david').font,'david');assert.equal(word('comic',{bold:true}).bold,true);assert.equal(word('comic',{bold:true}).font,'comic');
  for(const bad of ['evil','Arial; x','__proto__','constructor',5,null])assert.equal('font' in word(bad),false,String(bad));
  // A font means nothing on a shape.
  assert.equal('font' in C.cleanStroke(stroke({font:'david'})),false);
  // Saved marks are checked again when a whiteboard is opened, and keep their font and fill.
  const store=new C.HighlightStore();
  store.restore([{owner:'teacher',...stroke({tool:'ellipse',fill:true,color:'#e91e63'})},{owner:'teacher',tool:'text',color:'#ffffff',size:.02,text:'x',font:'serif',points:P}]);
  assert.equal(store.strokes[0].fill,true);assert.equal(store.strokes[0].color,'#e91e63');assert.equal(store.strokes[1].font,'serif');
});

test('every line of a block of words carries the font; the plain font adds nothing',()=>{
  const width=line=>line.length*50;
  const made=Clip.flowText('one two three four five six seven eight',width,{aspect:1.6,scale:1,block:'b1',size:.02,color:'#1f2937',font:'david',bold:true});
  assert.ok(made.strokes.length>0);for(const line of made.strokes){assert.equal(line.font,'david');assert.equal(line.bold,true)}
  const plain=Clip.flowText('one two',width,{aspect:1.6,scale:1,block:'b2',size:.02,color:'#1f2937',font:'sans'});
  for(const line of plain.strokes)assert.equal('font' in line,false);
});

test('the font and Fill reach every place a mark is drawn: the board picture, the live board and the students',()=>{
  const share=read('activity-share.js'),highlighting=read('highlighting.js');
  // pdf-mode: the picture students see, and the live drawing
  assert.match(pdf,/lc\.font=`\$\{stroke\.bold\?'bold ':''\}\$\{Math\.max\(4,stroke\.size\*W\*2\.4\)\}px \$\{C\.fontStack\(stroke\.font\)\}`/);
  assert.match(pdf,/if\(stroke\.fill\)lc\.fillRect\(x,y,sw,sh\);lc\.strokeRect\(x,y,sw,sh\)/);
  assert.match(pdf,/if\(stroke\.fill\)lc\.fill\(\);lc\.stroke\(\)/);
  assert.match(pdf,/'font-family':C\.fontStack\(stroke\.font\)/);
  assert.match(pdf,/const lineAttrs=\{fill:stroke\.fill===true&&C\.FILLABLE\.includes\(stroke\.tool\)\?color:'none'/);
  // students
  assert.match(share,/fill:stroke\.fill===true&&\['rectangle','ellipse','triangle'\]\.includes\(stroke\.tool\)\?color:'none'/);
  assert.match(share,/'font-family':window\.ClassPointerCore\?\.fontStack\?\.\(stroke\.font\)\|\|'sans-serif'/);
  assert.match(share,/classroom-core\.js\?v=hlshapes2/,'student activity pages load the fonts');
  assert.match(highlighting,/'font-family':window\.ClassPointerCore\?\.fontStack\?\.\(stroke\.font\)\|\|'sans-serif'/);
  assert.match(highlighting,/'fill':stroke\.fill===true&&\['rectangle','ellipse','triangle'\]\.includes\(stroke\.tool\)\?color:'none'/);
  // saving a whiteboard keeps them
  assert.match(pdf,/\.\.\.\(s\.font&&s\.font!=='sans'\?\{font:s\.font\}:\{\}\)/);assert.match(pdf,/\.\.\.\(s\.fill===true\?\{fill:true\}:\{\}\)/);
  // the words are measured in the font they are drawn in
  assert.match(pdf,/ctx\.font=\(bold\?'bold ':''\)\+'100px '\+C\.fontStack\(font\)/);
});

test('fonts: a font control beside bold works on typed, picked and new words, like bold does',()=>{
  assert.match(pdf,/fontSelect=el\('select',null,'pdf-font-select'\)/);
  assert.match(pdf,/textSizeBox\.append\(el\('span',null,'pdf-label','Text size'\),smaller,textSizeValue,bigger,boldBtn,fontSelect,\.\.\.alignBtns\)/);
  assert.match(pdf,/function setTextFont\(next\)/);assert.match(pdf,/function fontSelected\(next\)/);
  assert.match(pdf,/if\(target\.kind==='typing'\)\{inlineEdit\.font=next;sizeInline\(\)\}/);
  assert.match(pdf,/open\.box\.style\.fontFamily=C\.fontStack\(open\.font\)/);
  assert.match(pdf,/bold,boldBefore:bold,font,fontBefore:font/);
  assert.match(read('classroom.css'),/#pdfNav \.pdf-font-select\{/);
  // bold keeps working as before
  assert.match(pdf,/function toggleTextBold\(\)\{const target=textTarget\(\);if\(target\)setTextBold\(!target\.bold\)\}/);
});

test('colors: a full set with white, plus a custom picker that goes to the class like any color',()=>{
  const options=html.match(/<select id="teacherColor">([\s\S]*?)<\/select>/)[1];
  const values=[...options.matchAll(/value="(#[0-9a-f]{6})">([^<]*)</g)].map(m=>[m[1],m[2]]);
  // The nine colors are first, in their old order (so the first choice and the defaults are unchanged).
  assert.deepEqual(values.slice(0,9).map(v=>v[1]),['Sunshine','Sky blue','Coral','Green','Purple','Orange','Teal','Black','Blue ink']);
  const names=values.map(v=>v[1]);for(const name of ['White','Gray','Red','Dark green','Dark purple','Pink','Brown'])assert.ok(names.includes(name),name);
  assert.equal(values.find(v=>v[1]==='White')[0],'#ffffff');
  assert.equal(new Set(values.map(v=>v[0])).size,values.length,'no color twice');
  assert.ok(values.length>=16);
  // the custom picker
  assert.match(toolbar,/customInput\.type='color'/);
  assert.match(toolbar,/customInput\.addEventListener\('input',\(\)=>pickColor\(customInput\.value\.toLowerCase\(\)\)\)/);
  assert.match(toolbar,/\.\.\.\(s\.customColor\?\[customBtn\]:\[\]\)/);
  assert.match(toolbar,/!\(s\.customColor&&\/\^#\[0-9a-f\]\{6\}\$\/i\.test\(st\.color\)\)/,'a custom color is not reset to a palette color');
  assert.match(annotate,/customColor:teacher,\r?\n/);
  assert.match(annotate,/function setColor\(color\)\{/);
  assert.match(annotate,/if\(tool!=='hand'&&tool!=='eraser'&&tool!=='select'\)\{setColor\(color\);set\(sizeSel,size\)\}/);
  // Select + a color still recolors the picked mark (fill and font stay).
  assert.match(pdf,/changeMarks\(textBlock\(stroke\)\.map\(item=>\[item\.id,\{\.\.\.item,color:color\.toLowerCase\(\)\}\]\)\)/);
});

test('shapes: each closed shape comes twice in the Shapes menu (outline and filled); no Fill switch',()=>{
  // The menu, in order, from the adapter's own list.
  const list=annotate.match(/const SHAPES=\[(.*)\];\r?\n/)[1];
  const kinds=[...list.matchAll(/\['([a-z]+)','([^']+)','([^']+)','([a-z-]+)'(,true)?\]/g)].map(m=>({id:m[1],icon:m[2],name:m[3],tool:m[4],filled:!!m[5]}));
  assert.deepEqual(kinds.map(k=>k.name),['Rectangle','Filled rectangle','Circle','Filled circle','Triangle','Filled triangle','Line','Arrow']);
  assert.deepEqual(kinds.filter(k=>k.filled).map(k=>k.tool),['rectangle','ellipse','triangle'],'a filled one for each closed shape; the line and the arrow stay as they were');
  for(const tool of ['rectangle','ellipse','triangle']){
    const pair=kinds.filter(k=>k.tool===tool);assert.equal(pair.length,2,tool);
    assert.notEqual(pair[0].icon,pair[1].icon,'two different icons: an outline and a filled one');
  }
  assert.deepEqual(kinds.filter(k=>['line','pen-arrow'].includes(k.tool)).map(k=>k.filled),[false,false]);
  // Choosing a filled kind draws filled shapes; any other kind draws outlines.
  assert.match(annotate,/window\.ClassPointerPdf\?\.setFill\?\.\(tool==='shape'&&SHAPES\.find\(kind=>kind\[0\]===variant\)\?\.\[4\]===true\)/);
  assert.match(pdf,/\.\.\.\(shapeFill&&C\.FILLABLE\.includes\(tool\)\?\{fill:true\}:\{\}\)/);
  // The Fill switch is gone from the toolbar, and nothing else refers to it.
  assert.doesNotMatch(toolbar,/fillBtn|fa-fill|st\.fill|Fill shapes/);
  assert.doesNotMatch(annotate,/fillState|fill:teacher|fill===true\);/);
  // The chosen kind is highlighted in the menu (the toolbar's own variant menu marks the chosen one).
  assert.match(toolbar,/pressed:id===variantOf\(tool\)/);
  // A change to the lesson's tool menu keeps the filled kind that is chosen (outline and filled share one tool value).
  assert.match(annotate,/variant=current&&valueOf\(current\)===v\?current\[0\]:SHAPES\.find\(kind=>valueOf\(kind\)===v\)\[0\]/);
});

test('a picked shape: a clear Outline / Filled choice with the same two icons, highlighting the one it has now',()=>{
  // toolbar
  assert.match(toolbar,/styleBox\.hidden=!shapeInfo/);
  assert.match(toolbar,/const shapeInfo=st\.tool==='select'\?\(isDelegate\(s\)\?s\.delegate\.shapeStyle\?\.\(\):pickedItemShape\(s\)\):null/);
  assert.match(toolbar,/outlineBtn\.querySelector\('\.fa-ai'\)\.textContent=shapeInfo\.outline;filledBtn\.querySelector\('\.fa-ai'\)\.textContent=shapeInfo\.filled/);
  assert.match(toolbar,/outlineBtn\.setAttribute\('aria-pressed',String\(!shapeInfo\.filledNow\)\);filledBtn\.setAttribute\('aria-pressed',String\(!!shapeInfo\.filledNow\)\)/);
  assert.match(toolbar,/'Outline: only the line',\(\)=>setPickedShape\(false\)/);assert.match(toolbar,/'Filled with its color',\(\)=>setPickedShape\(true\)/);
  assert.match(toolbar,/\.fa-style\[aria-pressed=true\]/);
  // adapter and board: the picked shape and its icons come from the same list as the menu
  assert.match(annotate,/shapeStyle:\(\)=>\{const p=window\.ClassPointerPdf\?\.pickedShape\?\.\(\);if\(!p\)return null;return\{outline:shapeNamed\(p\.tool,false\)\?\.\[1\]\|\|'▭',filled:shapeNamed\(p\.tool,true\)\?\.\[1\]\|\|'▬',filledNow:p\.filled\}\}/);
  assert.match(annotate,/setShapeStyle:filled=>!!window\.ClassPointerPdf\?\.fillSelected\?\.\(filled\)/);
  assert.match(annotate,/JSON\.stringify\(window\.ClassPointerPdf\?\.pickedShape\?\.\(\)\|\|null\),B\.lessonKind/,'the toolbar is redrawn when another shape is picked');
  assert.match(pdf,/const pickedShape=\(\)=>\{const stroke=selecting\(\)\?selectedStroke\(\):null;return !!stroke&&C\.FILLABLE\.includes\(stroke\.tool\)\?\{tool:stroke\.tool,filled:stroke\.fill===true\}:null\};/);
  assert.match(pdf,/function fillSelected\(on\)\{/);
});

test('Save, My files and Send to class are right on the toolbar, with a Send chooser and no duplicates under More',()=>{
  const actions=annotate.slice(annotate.indexOf('function actions(){'),annotate.indexOf('FA.setActions?.(actions)'));
  for(const id of ['quick-save','quick-files','quick-send'])assert.match(actions,new RegExp("id:'"+id+"'"),id);
  assert.match(actions,/id:'quick-save'[^\n]*window\.FTTSavedWork\?\.saveCurrent\?\.\(\)/);
  assert.match(actions,/id:'quick-files'[^\n]*window\.FTTSavedWork\?\.open\?\.\(\)/);
  assert.match(actions,/id:'quick-send'[^\n]*Every student gets their own copy|id:'quick-send'[^\n]*every student gets their own copy/i);
  assert.match(actions,/id:'quick-send'[^\n]*items:sendItems/);
  // The order: Students, Stop, Save, My files, Upload (whiteboard only), Send, Groups (only with student whiteboards), Poll, Lesson, More.
  const order=[...actions.matchAll(/\{id:'([a-z-]+)'/g)].map(m=>m[1]);
  assert.deepEqual(order,['students','stop','quick-save','quick-files','quick-upload','quick-send','groups','poll','lesson','more']);
  const more=annotate.slice(annotate.indexOf('function moreItems(){'),annotate.indexOf('function sendItems(){'));
  assert.doesNotMatch(more,/FTTSavedWork|Send|My files|Save/);
});

test('nothing on the students\' own boards or the other tools changed',()=>{
  // The student's own whiteboard marks use their own model (no fonts or fill there) and the same toolbar as before.
  const boards=read('student-boards.js');
  assert.doesNotMatch(boards,/fontStack|FILLABLE/);
  // The class-wide limits still apply to every mark.
  assert.match(read('classroom-core.js'),/if\(this\.strokes\.length>=400/);
});
