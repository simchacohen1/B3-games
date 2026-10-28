'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const yaml=require('js-yaml');

const root=path.resolve(__dirname,'..');
const config=yaml.load(fs.readFileSync(path.join(root,'_config.yml'),'utf8'));
const excluded=(config.exclude||[]).map(item=>String(item).replace(/\\/g,'/').replace(/\/$/,''));

function isExcluded(pathname){
  const relative=pathname.replace(/^\/+/, '').split('/').join('/');
  return excluded.some(item=>relative===item||relative.startsWith(item+'/'));
}

test('Pages source excludes backend deployment files and keeps website entry points in the publish set',()=>{
  for(const directory of ['backend','preview-pointer-repair/backend','preview-pr234/backend']){
    assert.ok(excluded.includes(directory),`Jekyll must exclude ${directory}`);
  }
  const resolvePublishedFile=url=>{
    const pathname=decodeURIComponent(new URL(url,'https://pages.test').pathname);
    if(isExcluded(pathname))return null;
    const relative=pathname==='/'?'index.html':pathname.replace(/^\//,'');
    const file=path.resolve(root,relative);
    return file.startsWith(root+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile()?file:null;
  };
  for(const page of ['/','/teacher-home.html','/weekly-quiz/index.html','/chazara/index.html','/preview-pointer-repair/index.html','/preview-pr234/teacher-home.html']){
    const file=resolvePublishedFile(page);
    assert.ok(file,`${page} should remain in the Pages publish set`);
    assert.ok(fs.readFileSync(file,'utf8').length>0,`${page} should have readable page content`);
  }
  assert.ok(resolvePublishedFile('/shared/student-tool-policy.js'),'the shared helper must remain publishable');
  assert.ok(resolvePublishedFile('/preview-pointer-repair/shared/student-tool-policy.js'),'the legacy preview helper must remain publishable');
  assert.ok(resolvePublishedFile('/preview-pr234/shared/student-tool-policy.js'),'the PR preview helper must remain publishable');
  assert.equal(resolvePublishedFile('/backend/functions/index.js'),null,'deployable Functions source must not be published');
  assert.equal(resolvePublishedFile('/preview-pointer-repair/backend/functions/index.js'),null,'nested preview Functions source must not be published');
  assert.equal(resolvePublishedFile('/preview-pr234/backend/functions/index.js'),null,'nested preview Functions source must not be published');
});
