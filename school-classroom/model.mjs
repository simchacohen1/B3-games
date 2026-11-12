// FICTIONAL examples only. No identities or records from production.
export const exampleClasses = Object.freeze([
  {id:"demo-alef",name:"Alef · Morning",grade:"Alef",teacher:"Demo Teacher A",studentCount:16,teacherIds:["teacher-a"]},
  {id:"demo-beis",name:"Beis · Afternoon",grade:"Beis",teacher:"Demo Teacher B",studentCount:18,teacherIds:["teacher-b"]},
  {id:"demo-gimmel",name:"Gimmel · Morning",grade:"Gimmel",teacher:"Demo Teacher A",studentCount:15,teacherIds:["teacher-a"]}
]);
export const exampleTools = Object.freeze([
 {id:"assignments",name:"Assignments",description:"Create, complete, and review classroom work",icon:"📝",roles:["admin","teacher","student"]},
 {id:"games",name:"Learning Games",description:"Practice skills through engaging activities",icon:"🎲",roles:["admin","teacher","student"]},
 {id:"rewards",name:"Points & Achievements",description:"Celebrate effort and improvement",icon:"🏆",roles:["admin","teacher","student"]},
 {id:"library",name:"Teaching Library",description:"Discover reusable learning materials",icon:"📚",roles:["admin","teacher"]},
 {id:"reports",name:"Progress Reports",description:"Understand learning progress",icon:"📊",roles:["admin","teacher"]},
 {id:"management",name:"School Management",description:"Manage grades, classrooms, and staff",icon:"🏫",roles:["admin"]}
]);
export function visibleClasses(role, teacherId="teacher-a", studentClassId="demo-gimmel", classes=exampleClasses) {
 if (!["admin","teacher","student"].includes(role)) return [];
 if (role==="admin") return classes;
 if (role==="teacher") return classes.filter(c=>c.teacherIds.includes(teacherId));
 return classes.filter(c=>c.id===studentClassId);
}
export function visibleTools(role,tools=exampleTools) {
 return tools.filter(t=>t.roles.includes(role));
}
export function dashboardStats(role,classes) {
 return [{label:"Visible classes",value:classes.length},{label:"Students in view",value:classes.reduce((sum,c)=>sum+c.studentCount,0)},{label:"Learning tools",value:visibleTools(role).length}];
}
// This model powers a non-security preview only; backend must independently verify roles.
