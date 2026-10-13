"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");

function loadCore(){
  const window={};
  const document={
    readyState:"loading",
    addEventListener(){},
    createElement(){
      let html="";
      return {set innerHTML(value){html=String(value)},get textContent(){return html.replace(/<[^>]*>/g,"")},querySelectorAll(){return []}};
    }
  };
  vm.runInNewContext(fs.readFileSync("game-show/question-generator.js","utf8"),{window,document,fetch(){throw new Error("Unexpected fetch in pure builder test")}});
  return window.FunTorahSefariaGeneratorCore;
}

test("open questions preserve the retrieved source text and canonical citation",()=>{
  const core=loadCore();
  const source={ref:"Genesis 18:1",text:"The Lord appeared to him by the terebinths of Mamre."};
  const [item]=core.makeItems([source],"open","");
  assert.equal(item.ans,"by the terebinths of Mamre. (Source: Bereishis 18:1)");
  assert.equal(item.q,"Which words continue this statement: “Hashem appeared to him …”?");
});

test("multiple-choice answers point to one of the verified references",()=>{
  const core=loadCore();
  const sources=[
    {ref:"Genesis 18:1",text:"The Lord appeared to him by the terebinths of Mamre."},
    {ref:"Genesis 18:2",text:"He looked up and saw three men standing near him."},
    {ref:"Genesis 18:3",text:"He said, My lord, if I find favor with you."},
    {ref:"Genesis 18:4",text:"Let a little water be brought."}
  ];
  const items=core.makeItems(sources,"mc","");
  assert.equal(items.length,4);
  for(const [index,item] of items.entries()){
    assert.equal(item.choices.length,4);
    assert.equal(item.choices[item.correctIndex],core.localizeText(core.shortChoice(core.questionAndAnswer(sources[index],"").answer)));
    assert.match(item.ans,new RegExp("Source: Bereishis 18:"+(index+1)));
    assert.ok(item.choices.every(choice=>sources.some(s=>core.localizeText(core.shortChoice(core.questionAndAnswer(s,"").answer))===choice)));
  }
});

test("saving a reviewed multiple-choice question preserves wrong answers and the marked correct choice",()=>{
  const core=loadCore();
  assert.deepEqual(
    JSON.parse(JSON.stringify(core.questionRecord(" Which detail? "," Correct source text ",["Wrong one","Correct source text","Wrong three","Wrong four"],2))),
    {q:"Which detail?",ans:"Correct source text",choices:["Wrong one","Correct source text","Wrong three","Wrong four"],correctIndex:1}
  );
});

test("Bereishis 1:4 asks a comprehension question instead of spotting a phrase",()=>{
  const core=loadCore();
  const sources=[
    {ref:"Genesis 1:1",text:"In the beginning God created the heaven and the earth."},
    {ref:"Genesis 1:2",text:"And the earth was without form, and void."},
    {ref:"Genesis 1:3",text:"And God said, Let there be light."},
    {ref:"Genesis 1:4",displayRef:"Bereishis 1:4",text:"And God saw the light, that it was good; and God divided the light from the darkness."}
  ];
  const item=core.makeItems([sources[3]],"mc","",1,sources)[0];
  assert.equal(item.q,"What did Hashem see on day one?");
  assert.equal(item.choices[item.correctIndex],"the light, that it was good");
  assert.doesNotMatch(item.q,/which phrase appears/i);
});

test("multiple choice refuses to fabricate distractor citations",()=>{
  const core=loadCore();
  assert.throws(()=>core.makeItems([{ref:"Genesis 18:1",text:"A source."},{ref:"Genesis 18:2",text:"A source."},{ref:"Genesis 18:3",text:"A source."},{ref:"Genesis 18:4",text:"A source."}],"mc",""),/four distinct Sefaria excerpts/);
});

test("source text is reduced to a short, readable excerpt for a choice question",()=>{
  const core=loadCore();
  assert.equal(core.phrase(core.cleanText("One <b>two</b> three four five six seven eight.")),"One two three four five six seven");
});


test("teacher-friendly wording localizes common Torah names and divine names",()=>{
  const core=loadCore();
  assert.equal(core.localizeText("Moses spoke to God about Abraham, Isaac, Jacob, Joseph, Aaron, and Pharaoh."),"Moshe spoke to Hashem about Avraham, Yitzchak, Yaakov, Yosef, Aharon, and Paroh.");
  assert.equal(core.localizeText("My lord said"),"My lord said");
});

test("chapter selections are distributed across the full requested range",()=>{
  const core=loadCore();
  assert.deepEqual(Array.from(core.evenlyPick(Array.from({length:33},(_,i)=>i+1),5)),[1,9,17,25,33]);
  assert.equal(core.evenlyPick(Array.from({length:33},(_,i)=>i+1),33).length,33);
});


test("question count can exceed the number of selected pesukim and stays spread across them",()=>{
  const core=loadCore();
  const distributed=core.distribute([{ref:"Bereishis 1:1",text:"First source."},{ref:"Bereishis 1:2",text:"Second source."}],5);
  assert.equal(distributed.length,5);
  assert.equal(distributed[0].ref,"Bereishis 1:1");
  assert.equal(distributed.at(-1).ref,"Bereishis 1:2");
  assert.equal(core.makeItems(distributed,"open","").length,5);
});
