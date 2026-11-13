import test from "node:test";
import assert from "node:assert/strict";
import {visibleClasses,visibleTools,dashboardStats} from "../model.mjs";
test("admin preview lists all three imaginary classes",()=>assert.equal(visibleClasses("admin").length,3));
test("teacher preview only includes assigned imaginary classes",()=>assert.deepEqual(visibleClasses("teacher").map(c=>c.id),["demo-alef","demo-gimmel"]));
test("student preview only includes selected imaginary class",()=>assert.deepEqual(visibleClasses("student").map(c=>c.id),["demo-gimmel"]));
test("unknown roles fail closed in preview",()=>assert.deepEqual(visibleClasses("owner-from-url"),[]));
test("school management tile absent for classroom teacher and student",()=>{
 for(const role of ["teacher","student"])assert.ok(!visibleTools(role).some(t=>t.id==="management"));
});
test("unknown role gets no tools",()=>assert.deepEqual(visibleTools("unknown"),[]));
test("student counts reflect role filtered classes",()=>assert.equal(dashboardStats("student",visibleClasses("student"))[1].value,15));
