#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
function pages(root, dir = '', out = []) {
  for (const item of fs.readdirSync(path.join(root, dir), {withFileTypes:true})) {
    if (item.name.startsWith('.') || ['node_modules','test-results','playwright-report','staging-results','preview-pr234'].includes(item.name)) continue;
    const rel = path.posix.join(dir, item.name);
    if (item.isDirectory() && !item.isSymbolicLink()) pages(root, rel, out);
    else if (item.isFile() && /\.html$/.test(item.name)) out.push(rel);
  }
  return out.sort();
}
function collect(report) {
  const rows=[];
  function visit(suite) {
    for (const spec of suite.specs || []) for (const test of spec.tests || []) {
      const results=test.results || [], last=results.at(-1);
      // expected-failure tests are regression evidence, never working-feature proof.
      const state=test.expectedStatus === 'failed' ? 'untested'
        : test.status === 'skipped' || last?.status === 'skipped' ? 'blocked'
        : test.status === 'flaky' ? 'flaky'
        : last?.status === 'passed' && test.status === 'expected' ? 'passed'
        : last ? 'failed' : 'blocked';
      rows.push({file:String(spec.file || '').replaceAll('\\','/'), title:spec.title, state});
    }
    for (const child of suite.suites || []) visit(child);
  }
  for (const suite of report.suites || []) visit(suite);
  return {rows, errors:(report.errors || []).length};
}
function evaluate(catalog, reports, routes) {
  const parsed=reports.map(collect), rows=parsed.flatMap(x=>x.rows);
  const errors=parsed.reduce((n,x)=>n+x.errors,0);
  const features=catalog.features.map(feature=>{
    const requirements=feature.checks.map(check=>{
      const matches=rows.filter(row=>(row.file===check.file || row.file.endsWith('/'+check.file)) && row.title===check.title);
      const states=matches.map(x=>x.state);
      const status=!states.length ? 'untested' : states.includes('failed') ? 'failed'
        : states.includes('blocked') ? 'blocked' : states.includes('flaky') ? 'flaky'
        : states.includes('untested') ? 'untested' : 'passed';
      return {...check,status};
    });
    const statuses=requirements.map(x=>x.status);
    const status=statuses.includes('failed') ? 'failed' : errors ? 'blocked'
      : !statuses.length || statuses.includes('untested') ? 'untested'
      : statuses.includes('blocked') ? 'blocked' : statuses.includes('flaky') ? 'flaky' : 'passed';
    return {...feature,status,requirements};
  });
  const mapped=new Set(catalog.features.flatMap(x=>x.routes || []));
  return {features, unmappedPages:routes.filter(x=>!mapped.has(x)), reportErrors:errors,
    // Unknown routes and incomplete declared journeys prevent an all-clear.
    complete:!!features.length && !errors && features.every(x=>x.status==='passed') && routes.every(x=>mapped.has(x))};
}
function cell(value) {
  return String(value).replaceAll('|','/').replace(/[\r\n]/g,' ').replaceAll('<','&lt;').replaceAll('>','&gt;');
}
function markdown(result, meta) {
  const lines=['## Website feature health: '+(result.complete?'PASSED':'INCOMPLETE — see failures and coverage gaps'),'',
    'Commit: '+cell(meta.sha)+' · Tier: '+cell(meta.tier)+' · Generated: '+meta.at,'',
    'Evidence: isolated staging browser results only. Page-open tests do not prove a complete workflow. This report does not verify production.','',
    '| Feature / required journey | Result | Next action |','|---|---|---|'];
  const actions={passed:'No fix indicated by these checks',failed:'Inspect linked run evidence; fix and retest',blocked:'Restore prerequisites and rerun',flaky:'Investigate retry-only success',untested:'Add or execute the required complete journey'};
  for (const f of result.features) lines.push('| '+cell(f.name)+' | '+f.status.toUpperCase()+' | '+actions[f.status]+' |');
  lines.push('','### Required checks','');
  for(const f of result.features) {
    lines.push('- '+cell(f.name)+': '+(f.requirements.length?f.requirements.map(c=>cell(c.file)+' — '+cell(c.title)+' ['+c.status+']').join('; '):'No complete journey mapped yet.'));
  }
  lines.push('','### Pages without a declared feature mapping ('+result.unmappedPages.length+')','',
    'These are unverified inventory entries, not confirmed defects. Auxiliary pages also need explicit classification.');
  for(const route of result.unmappedPages) lines.push('- '+cell(route));
  if(result.reportErrors) lines.push('','Browser runner errors: '+result.reportErrors+'. Passing feature claims are blocked.');
  return lines.join('\n')+'\n';
}
function main() {
  const args=process.argv.slice(2);
  const root=process.cwd(), catalog=JSON.parse(fs.readFileSync(path.join(root,'testing/feature-health.json'),'utf8'));
  const reports=[], missing=[];
  for(const file of args) {
    if(!fs.existsSync(file)) {missing.push(file);continue;}
    reports.push(JSON.parse(fs.readFileSync(file,'utf8')));
  }
  const result=evaluate(catalog,reports,pages(root));
  result.missingReports=missing;
  const meta={sha:process.env.GITHUB_SHA || 'local',tier:process.env.TIER || 'local',at:new Date().toISOString()};
  const output=markdown(result,meta)+(missing.length?'\nMissing result files (unverified): '+missing.map(cell).join(', ')+'\n':'');
  fs.mkdirSync('staging-results',{recursive:true});
  fs.writeFileSync('staging-results/feature-health.md',output);
  fs.writeFileSync('staging-results/feature-health.json',JSON.stringify({meta,...result},null,2)+'\n');
  if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,output);
  console.log(output);
}
if(require.main===module) main();
module.exports={pages,collect,evaluate,markdown};
