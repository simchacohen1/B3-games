const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('record_pesukim/teacher.html', 'utf8');

test('Posuk teacher inline scripts survive HTML script boundaries', () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length);
  for (const script of scripts) new vm.Script(script[1]);
});

test('Posuk print report writes a complete static document', () => {
  const start = html.indexOf('function printReport(){');
  const end = html.indexOf('// The two class sections', start);
  let output = '', closed = false, printed = false;
  const popup = {document:{write:value=>output=value,close:()=>closed=true},focus(){},print:()=>printed=true};
  const context = {reportExportMode:'byStudent',reportExportStudentGroups:[{name:'Test Student',rows:[],hadAnyMatch:false}],window:{open:()=>popup},setTimeout:fn=>fn()};
  vm.runInNewContext(html.slice(start, end)+'\nprintReport();', context);
  assert.match(output, /Posuk Practice Scroll — Report/);
  assert.match(output, /Test Student/);
  assert.match(output, /<\/body><\/html>/);
  assert.doesNotMatch(output, /<script|indexedDB|\$\{/);
  assert.ok(closed && printed);
});
