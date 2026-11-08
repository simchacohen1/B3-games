'use strict';
// Regression tests for Perek 20 (Chof) support and the Bulk Add chapter fix.
// These are synthetic tests that exercise the logic extracted from teacher.js
// without touching Firebase or production data.
const {test}=require('node:test');
const assert=require('node:assert/strict');

// ── Helpers that mirror teacher.js logic ─────────────────────────────────
function perekOf(i){return Number(i?.perek)||18;}

// Expandable chapter labels — mirrors the PEREK_OPTIONS approach in teacher.js.
const PEREK_OPTIONS=[
  {value:'18',label:'Perek י״ח'},
  {value:'19',label:'Perek י״ט'},
  {value:'20',label:'Perek כ'},
];
function perekLabel(i){
  const n=perekOf(i);
  const found=PEREK_OPTIONS.find(o=>Number(o.value)===n);
  return found?found.label:`Perek ${n}`;
}

// Simulated Bulk Add handler — mirrors the corrected saveBulkItems logic.
// explicitPerek must be an explicit string ('18', '19', '20', etc.)
// If falsy/empty the handler rejects with an error (teacher must choose).
function bulkAddItem(line, track, listName, explicitPerek){
  if(track==='shorashim'){
    if(!explicitPerek)throw new Error('Perek required: teacher must select a Perek before adding.');
    const perekNum=Number(explicitPerek);
    if(!Number.isFinite(perekNum)||perekNum<1)throw new Error('Invalid Perek value.');
  }
  const parts=line.split('|').map(x=>x.trim());
  if(parts.length<2||!parts[0]||!parts[1])return null;
  const item={
    id:`bulk-shorashim-test-${Math.random().toString(36).slice(2,7)}`,
    listName,
    front:parts[0],
    english:parts[1],
    art:[],
    autoArt:true,
    hidden:false,
  };
  if(track==='shorashim'){
    item.perek=Number(explicitPerek);
    item.hebrew=parts[2]||parts[0];
    item.pasuk=parts[3]||'';
  }
  return item;
}

// ── Tests ─────────────────────────────────────────────────────────────────

test('perekOf defaults to 18 for items missing perek field',()=>{
  assert.equal(perekOf({}),18);
  assert.equal(perekOf({perek:null}),18);
  assert.equal(perekOf(null),18);
});

test('perekOf returns the correct chapter for items 18, 19, and 20',()=>{
  assert.equal(perekOf({perek:18}),18);
  assert.equal(perekOf({perek:19}),19);
  assert.equal(perekOf({perek:20}),20);
  // String coercion
  assert.equal(perekOf({perek:'20'}),20);
});

test('perekLabel returns correct Hebrew label for chapters 18, 19, 20',()=>{
  assert.equal(perekLabel({perek:18}),'Perek י״ח');
  assert.equal(perekLabel({perek:19}),'Perek י״ט');
  assert.equal(perekLabel({perek:20}),'Perek כ');
});

test('perekLabel falls back gracefully for unknown future chapters',()=>{
  // Chapter 21 is not yet defined in PEREK_OPTIONS but should not crash.
  assert.equal(perekLabel({perek:21}),'Perek 21');
});

test('Bulk Add rejects when no Perek is selected (empty string)',()=>{
  assert.throws(
    ()=>bulkAddItem('רָאָה | saw','shorashim','Perek Twenty',''),
    /Perek required/
  );
});

test('Bulk Add rejects when Perek selector is left at placeholder (undefined)',()=>{
  assert.throws(
    ()=>bulkAddItem('רָאָה | saw','shorashim','Perek Twenty',undefined),
    /Perek required/
  );
});

test('Bulk Add assigns Perek 18 only when teacher explicitly selects 18',()=>{
  const item=bulkAddItem('עִיר | city','shorashim','Main List','18');
  assert.ok(item,'item was created');
  assert.equal(item.perek,18);
});

test('Bulk Add assigns Perek 19 only when teacher explicitly selects 19',()=>{
  const item=bulkAddItem('מַלְאָךְ | angel','shorashim','Main List','19');
  assert.ok(item,'item was created');
  assert.equal(item.perek,19);
});

test('Bulk Add assigns Perek 20 when teacher explicitly selects 20',()=>{
  const item=bulkAddItem('נוּס | flee','shorashim','Perek Twenty','20');
  assert.ok(item,'item was created');
  assert.equal(item.perek,20);
  assert.equal(item.listName,'Perek Twenty');
  assert.equal(item.front,'נוּס');
  assert.equal(item.english,'flee');
});

test('Bulk Add Perek 20 item passes through perekLabel as Perek כ',()=>{
  const item=bulkAddItem('נוּס | flee','shorashim','Perek Twenty','20');
  assert.equal(perekLabel(item),'Perek כ');
});

test('Bulk Add skips malformed lines but does not crash',()=>{
  // Missing the | separator — should return null.
  const item=bulkAddItem('no separator here','shorashim','List','19');
  assert.equal(item,null);
});

test('Bulk Add for non-Shorashim track does not require Perek',()=>{
  // For prefix/suffix tracks explicitPerek is irrelevant — no error.
  const item=bulkAddItem('בְּ | in','prefix','Main List','');
  assert.ok(item,'prefix item was created without Perek selection');
  assert.equal(item.perek,undefined);
});

test('PEREK_OPTIONS array contains entries for 18, 19, and 20',()=>{
  const values=PEREK_OPTIONS.map(o=>o.value);
  assert.ok(values.includes('18'),'18 present');
  assert.ok(values.includes('19'),'19 present');
  assert.ok(values.includes('20'),'20 present');
});

test('PEREK_OPTIONS is expandable: future chapter can be added without breaking existing logic',()=>{
  // Simulate adding chapter 21.
  const extended=[...PEREK_OPTIONS,{value:'21',label:'Perek כ״א'}];
  const ch21=extended.find(o=>o.value==='21');
  assert.ok(ch21,'chapter 21 found after extending');
  assert.equal(ch21.label,'Perek כ״א');
  // Existing entries unchanged.
  const ch20=extended.find(o=>o.value==='20');
  assert.equal(ch20.label,'Perek כ');
});
