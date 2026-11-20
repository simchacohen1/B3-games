// Returns index.html with the shared-registry tile scripts expanded, so tests can
// keep asserting on the tiles a browser would actually render.
const fs=require('fs'),path=require('path');
require('../shared/home-tool-registry.js');
module.exports=function renderedIndexHtml(){
  const R=globalThis.B3HomeToolRegistry;
  return fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
    .replace(/<script>document\.getElementById\("islandMap"\)[^\n]*<\/script>/,()=>R.renderMap({audience:'student'}))
    .replace(/<script>document\.getElementById\("teacherToolsContainer"\)[^\n]*<\/script>/,()=>R.renderTeacherTools({audience:'admin'}));
};
