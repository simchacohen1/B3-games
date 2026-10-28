'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { MODES, migrate, validate, grade } = require('../weekly-quiz/question-modes-v2.js');
const cases = [
  [{q:'Translate',choices:['said','went'],correctIndex:0}, {choiceIndex:0}, {choiceIndex:1}],
  [{mode:'multi_select',q:'Select both',choices:['A','B','C'],correctIndices:[0,2]}, {indices:[2,0]}, {indices:[0]}],
  [{mode:'true_false',q:'The claim is true',correct:true}, {value:true}, {value:false}],
  [{mode:'free_text',q:'Translate ויאמר',answers:['and he said','he said']}, {text:' AND  HE said '}, {text:'he went'}],
  [{mode:'essay',q:'Explain the idea',rubric:'Teacher grades comprehension'}, {text:'An explanation'}, {text:'Other'}],
  [{mode:'sorter',q:'Put in order',items:['one','two','three'],correctOrder:['two','one','three']}, {order:['two','one','three']}, {order:['one','two','three']}],
  [{mode:'categorizer',q:'Categorize',items:['a','b'],categories:['X','Y'],key:{a:'X',b:'Y'}}, {key:{a:'X',b:'Y'}}, {key:{a:'Y',b:'Y'}}],
  [{mode:'multi_categorizer',q:'Categorize many',items:['a','b'],categories:['X','Y'],key:{a:['X','Y'],b:['Y']}}, {key:{a:['Y','X'],b:['Y']}}, {key:{a:['X'],b:['Y']}}],
  [{mode:'highlight_text',q:'Highlight',passage:'abcdef',spans:[{start:1,end:3}]}, {spans:[{start:1,end:3}]}, {spans:[{start:0,end:3}]}],
  [{mode:'hot_spot',q:'Click the box',imageUrl:'https://example.com/img.png',regions:[{shape:'rect',x:0.1,y:0.2,width:0.3,height:0.3}]}, {point:{x:0.2,y:0.3}}, {point:{x:0.9,y:0.9}}],
  [{mode:'fill_gaps',q:'Fill missing words',template:'{{a}} then {{b}}',gaps:[{id:'a',answers:['First']},{id:'b',answers:['Last'],options:['Last','Now']}]}, {values:{a:'first',b:'last'}}, {values:{a:'first',b:'now'}}]
];
test('all eleven question modes represented',()=>assert.equal(MODES.length,11));
for (const [q,yes,no] of cases) {
  test((q.mode||'legacy single select')+' validates and grades',()=>{
    assert.deepEqual(validate(q),[]);
    assert.equal(grade(q,yes).status,q.mode==='essay'?'needs_review':'correct');
    assert.equal(grade(q,no).status,q.mode==='essay'?'needs_review':'incorrect');
  });
}
test('legacy question migration leaves source unchanged',()=>{
  const input={q:'a',choices:['yes','no'],correctIndex:0};
  assert.equal(migrate(input).mode,'single_select');
  assert.equal(input.mode,undefined);
});
test('invalid data never receives a score',()=>{
  const invalid={mode:'multi_select',q:'Question',choices:['A','B'],correctIndices:[7]};
  assert.equal(grade(invalid,{indices:[7]}).status,'invalid');
});
test('incomplete essay rubric is invalid',()=>{
  assert.notDeepEqual(validate({mode:'essay',q:'Answer this'}),[]);
});
test('unsupported mode is invalid',()=>{
  assert.notDeepEqual(validate({mode:'magic',q:'Answer this'}),[]);
});
test('highlight coordinates reject overlaps',()=>{
  assert.notDeepEqual(validate({mode:'highlight_text',q:'Find',passage:'123456',spans:[{start:0,end:3},{start:2,end:5}]}),[]);
});

const {empty} = require('../weekly-quiz/question-modes-student.js');
test('student answer shapes cover all supported modes',()=>{
 for(const mode of MODES) assert.equal(typeof empty(mode),'object');
 assert.deepEqual(empty('multi_select'),{indices:[]});
 assert.deepEqual(empty('fill_gaps'),{values:{}});
 assert.deepEqual(empty('essay'),{text:''});
});
