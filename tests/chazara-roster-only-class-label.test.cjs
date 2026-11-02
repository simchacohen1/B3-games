const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('chazara/teacher.html','utf8');
const clsMatch=source.match(/function cls\\(id\\)\\{[^}]*\\}/);
function classFor(id,roster){
 assert.ok(clsMatch,'Chazara class label helper is present');
 return vm.runInNewContext('const R='+JSON.stringify(roster)+';'+clsMatch[0]+';cls('+JSON.stringify(id)+')');
}
test('Chazara class label comes from verified roster for ET, WT and arbitrary classes',()=>{
 assert.equal(classFor('student_a',{student_a:{classId:'et'}}),'et');
 assert.equal(classFor('student_b',{student_b:{classId:'wt'}}),'wt');
 assert.equal(classFor('student_c',{student_c:{classId:'alpha'}}),'alpha');
});
test('Chazara does not guess legacy class from student ID when roster lacks class',()=>{
 assert.equal(classFor('mayer_chaim_chaikin',{}),'');
 assert.equal(classFor('ari_greenberg',{}),'');
 assert.equal(classFor('student_a',{student_a:{name:'Synthetic student'}}),'');
 assert.doesNotMatch(source,/\\b(?:ET|WT)\\s*=\\s*new Set\\(/);
});
