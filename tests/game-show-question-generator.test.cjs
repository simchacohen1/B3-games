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
      return {set innerHTML(value){html=String(value)},get textContent(){return html.replace(/<[^>]*>/g,"")}};
    }
  };
  vm.runInNewContext(fs.readFileSync("game-show/question-generator.js","utf8"),{window,document,fetch(){throw new Error("Unexpected fetch in pure builder test")}});
  return window.FunTorahSefariaGeneratorCore;
}

test("open questions preserve the retrieved source text and canonical citation",()=>{
  const core=loadCore();
  const source={ref:"Genesis 18:1",text:"The Lord appeared to him by the terebinths of Mamre."};
  const [item]=core.makeItems([source],"open","");
  assert.equal(item.ans,"The Lord appeared to him by the terebinths of Mamre. (Source: Genesis 18:1)");
  assert.match(item.q,/Genesis 18:1/);
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
  for(const item of items){
    assert.equal(item.choices.length,4);
    assert.equal(item.choices[item.correctIndex],core.phrase(sources.find(s=>item.ans.includes(s.ref)).text));
    assert.ok(sources.some(s=>s.ref===item.ans));
    assert.ok(item.choices.every(choice=>sources.some(s=>core.phrase(s.text)===choice)));
  }
});

test("multiple choice refuses to fabricate distractor citations",()=>{
  const core=loadCore();
  assert.throws(()=>core.makeItems([{ref:"Genesis 18:1",text:"A source."},{ref:"Genesis 18:2",text:"A source."},{ref:"Genesis 18:3",text:"A source."},{ref:"Genesis 18:4",text:"A source."}],"mc",""),/four distinct source excerpts/);
});

test("source text is reduced to a short, readable excerpt for a choice question",()=>{
  const core=loadCore();
  assert.equal(core.phrase(core.cleanText("One <b>two</b> three four five six seven eight.")),"One two three four five six seven");
});
