#!/usr/bin/env node
'use strict';
// Issue #706: turn an old "one row per student per class" roster CSV (for
// example the Master Import tab of the SOLS sheet, downloaded as CSV) into the
// new format: one row per person, every class in one "Classes" cell.
//
//   node scripts/convert-legacy-roster.cjs old.csv new.csv [review.csv]
//
// Rows are combined ONLY when the name AND the passcode are the same (that is
// one child; two accounts like that could never sign in anyway). The same name
// with different passcodes stays separate and is written to the review file,
// together with every other problem, so nobody is merged by guesswork.
// Runs locally; touches no database. The files contain passcodes: keep private.
const fs=require('node:fs');
const R=require('../bulk-roster.js');
const [input,output,reviewFile]=process.argv.slice(2);
if(!input||!output){console.error('usage: convert-legacy-roster.cjs old.csv new.csv [review.csv]');process.exit(2);}
const parsed=R.parse(fs.readFileSync(input,'utf8'));
// Classes named on student/teacher rows but not listed as Class rows are added
// as Class rows, so the new file is complete and in the right order.
const classNames=[];const seen=new Set();
const addClass=n=>{const k=R.classKey(n);if(k&&!seen.has(k)){seen.add(k);classNames.push(n);}};
parsed.rows.filter(r=>r.type==='class').forEach(r=>addClass(r.name));
parsed.rows.forEach(r=>r.classes.forEach(addClass));
const plan=R.plan({...parsed,legacyFormat:true,rows:[...classNames.filter(n=>!parsed.rows.some(r=>r.type==='class'&&R.classKey(r.name)===R.classKey(n))).map((name,i)=>({row:'added '+(i+1),type:'class',name,email:'',passcode:'',classes:[],rosterId:''})),...parsed.rows]},[]);
const rows=[['Type','Name','Email','Passcode','Classes','Student ID']];
classNames.forEach(n=>rows.push(['Class',n,'','','','']));
plan.staff.forEach(s=>rows.push([s.role==='principal'?'Principal':'Teacher',s.name,s.email,'',s.classes.join('; '),'']));
plan.students.forEach(s=>rows.push(['Student',s.name,'',s.passcode,s.classes.join('; '),s.rosterId]));
fs.writeFileSync(output,R.toCsv(rows)+'\n');
const review=[['Kind','Message'],...plan.errors.map(m=>['Problem',m]),...plan.warnings.map(m=>['Check',m])];
if(reviewFile)fs.writeFileSync(reviewFile,R.toCsv(review)+'\n');
const inStudents=parsed.rows.filter(r=>r.type==='student').length;
console.log(`Student rows in: ${inStudents}. Students out: ${plan.students.length} (one row each). Classes: ${classNames.length}. Staff: ${plan.staff.length}.`);
console.log(`Problems: ${plan.errors.length}. Things to check: ${plan.warnings.length}.`+(reviewFile?' See '+reviewFile:''));
