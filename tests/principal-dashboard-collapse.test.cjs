const assert=require('node:assert/strict');
const test=require('node:test');
const dashboard=require('../principal-dashboard.js');
test('groups numbered classes by grade without conflating ET/WT',()=>{
  assert.equal(dashboard.gradeOf('B3 ET · Morning'),'B3');
  assert.equal(dashboard.gradeOf('B3 WT · Afternoon'),'B3');
  assert.equal(dashboard.gradeOf('B12 ET'),'B12');
  assert.equal(dashboard.gradeOf('Other program'),'Other classes');
});
test('does not treat teacher names as grade when class label has no grade',()=>{
  assert.equal(dashboard.gradeOf('Preschool'),'Other classes');
});
test('build requires a real DOM root',()=>assert.throws(()=>dashboard.build(null,[]),TypeError));
