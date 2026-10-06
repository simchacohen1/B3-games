const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('student-rewards/student.js','utf8');
function page(){
  const ctx={state:{student:{},root:{}},nav(){},pointAccountTotals:()=>({}),activeClassGoalsHTML:()=>'',bindClassContributionButtons(){},renderTab(){},e:()=>''};
  let rows;
  const make=()=>['gimkit','other'].map((reward,i)=>{
    const input={id:'give-'+reward,value:'',dataset:{},disabled:false,focus(){ctx.document.activeElement=this},closest:()=>card};
    const modes=['blastball','snowbrawl'].map(id=>({dataset:{gimkitMode:id},checked:false,disabled:false,focus(){ctx.document.activeElement=this},closest:()=>card}));
    const card={querySelectorAll:s=>s.endsWith(':checked')?modes.filter(m=>m.checked):modes};
    const button={dataset:{input:input.id,classContribute:reward},closest:()=>card};
    return {input,modes,card,button};
  });
  rows=make();const node={classList:{add(){},remove(){}}};
  const main={set innerHTML(v){rows=make()}};
  ctx.$=s=>s==='#studentMain'?main:node;
  ctx.document={activeElement:null,querySelectorAll:()=>rows.map(r=>r.button),getElementById:id=>rows.find(r=>r.input.id===id)?.input};
  vm.runInNewContext(source.slice(source.indexOf('function captureContributionForms(){'),source.indexOf('function renderTab(){')),ctx);
  return {ctx,rows:()=>rows};
}
test('background rerender preserves amounts, checked modes, and input focus across cards',()=>{
  const p=page();p.rows()[0].input.value='125';p.rows()[0].modes[1].checked=true;p.rows()[1].input.value='20';p.ctx.document.activeElement=p.rows()[0].input;
  p.ctx.render();assert.equal(p.rows()[0].input.value,'125');assert.equal(p.rows()[1].input.value,'20');assert.equal(p.rows()[0].modes[1].checked,true);assert.equal(p.rows()[0].modes[0].checked,false);assert.equal(p.ctx.document.activeElement,p.rows()[0].input);
  p.rows()[0].input.value='1250';p.ctx.render();assert.equal(p.rows()[0].input.value,'1250');
});
test('successful contribution clears only its reward; other drafts remain',()=>{
  const p=page();p.rows()[0].input.value='100';p.rows()[0].modes[0].checked=true;p.rows()[1].input.value='20';p.ctx.clearContributionForms('gimkit');p.ctx.render();assert.equal(p.rows()[0].input.value,'');assert.equal(p.rows()[0].modes[0].checked,false);assert.equal(p.rows()[1].input.value,'20');
});
test('focused mode checkbox keeps focus across refresh',()=>{const p=page();p.rows()[0].modes[0].checked=true;p.ctx.document.activeElement=p.rows()[0].modes[0];p.ctx.render();assert.equal(p.ctx.document.activeElement,p.rows()[0].modes[0]);assert.equal(p.rows()[0].modes[0].checked,true)});
