'use strict';
// Principal dashboard (#780): School → Grade → Class → Students → Details.
// Part 1 checks the pure model/filter logic. Part 2 drives the real component
// in Chromium with fictional data: expand/collapse, search, filters, details,
// preserved class cards and a phone-sized viewport.
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const dashboard=require('../principal-dashboard.js');

const ROOT=path.resolve(__dirname,'..');
// Fictional school: two grades, three classes, one student in two classes.
const ITEMS=[
  {id:'b3-et',name:'B3 ET · Morning',teacher:'Rabbi Alef',schoolId:'s1',schoolName:'Test Cheder',students:[
    {id:'st1',name:'Zalman Test'},{id:'st2',name:'Avi Example',online:true},{id:'st3',name:'Mendel Sample'}]},
  {id:'b3-wt',name:'B3 WT · Afternoon',teacher:'Rabbi Beis',schoolId:'s1',schoolName:'Test Cheder',students:[
    {id:'st2',name:'Avi Example',online:true},{id:'st4',name:'Dovid Fictional'}]},
  {id:'b4-et',name:'B4 ET · Morning',teacher:'Rabbi Alef, Rabbi Gimmel',schoolId:'s1',schoolName:'Test Cheder',students:[
    {id:'st5',name:'Levi Placeholder',online:true}]}
];

test('grade labels come from the class record or the class name',()=>{
  assert.equal(dashboard.gradeOf('B3 ET · Morning'),'B3');
  assert.equal(dashboard.gradeOf('B3 WT · Afternoon'),'B3');
  assert.equal(dashboard.gradeOf('B12 ET'),'B12');
  assert.equal(dashboard.gradeOf('Grade 3 Boys'),'Grade 3');
  assert.equal(dashboard.gradeOf('3rd grade girls'),'Grade 3');
  assert.equal(dashboard.gradeOf('Kita Gimmel'),'Kita Gimmel');
  assert.equal(dashboard.gradeOf('ET','4'),'Grade 4');
  assert.equal(dashboard.gradeOf('ET','Mechina'),'Mechina');
  assert.equal(dashboard.gradeOf('Other program'),'Other classes');
  assert.equal(dashboard.gradeOf('Preschool'),'Other classes');
});

test('model nests school, grade, class and students with counts at each level',()=>{
  const model=dashboard.buildModel(ITEMS);
  assert.equal(model.schools.length,1);
  const school=model.schools[0];
  assert.equal(school.name,'Test Cheder');
  assert.deepEqual(school.grades.map(g=>g.name),['B3','B4']);
  assert.deepEqual(school.grades[0].classes.map(c=>c.id),['b3-et','b3-wt']);
  // A student in two classes of one grade is counted once at grade and school level.
  assert.equal(school.grades[0].students,4);
  assert.equal(school.grades[0].online,1);
  assert.equal(school.students,5);
  assert.equal(school.online,2);
  assert.deepEqual(model.totals,{schools:1,grades:2,classes:3,teachers:3,students:5,online:2});
  assert.deepEqual(school.grades[0].classes[0].students.map(s=>s.name),['Avi Example','Mendel Sample','Zalman Test']);
});

test('classes without a school or grade still appear, last',()=>{
  const model=dashboard.buildModel([{id:'x',name:'Preschool'},{id:'y',name:'B2 ET'}],{teacherCount:7});
  assert.equal(model.schools[0].name,'School');
  assert.deepEqual(model.schools[0].grades.map(g=>g.name),['B2','Other classes']);
  assert.equal(model.totals.teachers,7);
  assert.equal(model.totals.students,0);
});

test('search matches students, teachers and classes; filters narrow by grade, class and status',()=>{
  const [et,wt,b4]=dashboard.buildModel(ITEMS).schools[0].grades.flatMap(g=>g.classes);
  const names=r=>r.students.map(s=>s.name);
  // Student search lists only the matching student and flags the class for auto-open.
  let r=dashboard.matchClass(et,{term:'zalman'});
  assert.deepEqual([r.show,r.studentMatch,names(r)],[true,true,['Zalman Test']]);
  assert.equal(dashboard.matchClass(wt,{term:'zalman'}).show,false);
  // Teacher and class searches keep the whole roster.
  r=dashboard.matchClass(wt,{term:'beis'});
  assert.deepEqual([r.show,r.studentMatch,r.students.length],[true,false,2]);
  assert.equal(dashboard.matchClass(et,{term:'beis'}).show,false);
  assert.equal(dashboard.matchClass(b4,{term:'gimmel'}).show,true);
  assert.equal(dashboard.matchClass(et,{term:'afternoon'}).show,false);
  // Grade and class filters.
  assert.equal(dashboard.matchClass(et,{grade:'B4'}).show,false);
  assert.equal(dashboard.matchClass(b4,{grade:'B4'}).show,true);
  assert.equal(dashboard.matchClass(et,{classId:'b3-wt'}).show,false);
  // Status filter.
  assert.deepEqual(names(dashboard.matchClass(et,{status:'online'})),['Avi Example']);
  assert.deepEqual(names(dashboard.matchClass(et,{status:'offline'})),['Mendel Sample','Zalman Test']);
  assert.equal(dashboard.matchClass(b4,{status:'offline'}).show,false);
  // Combined: an online-only search for an offline student finds nothing.
  assert.equal(dashboard.matchClass(et,{status:'online',term:'zalman'}).show,false);
});

test('build requires a document element',()=>{
  assert.throws(()=>dashboard.build(null,[]),TypeError);
});

let chromium=null;
try{({chromium}=require('playwright'));}catch{try{({chromium}=require('@playwright/test'));}catch{}}

test('component behaves in a real browser: collapse, expand, search, filters, details, mobile',{timeout:60000,skip:!chromium&&'Playwright is not installed'},async()=>{
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:1200,height:800}});
    const errors=[];page.on('pageerror',e=>errors.push(String(e)));
    // The open/close animation is switched off for reduced motion; use that so
    // visibility checks are not racing a transition.
    await page.emulateMedia({reducedMotion:'reduce'});
    // A real origin so sessionStorage (remembered expansion) is available.
    await page.route('http://dashboard.test/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;font-family:sans-serif"><div id="classes"></div></body>'}));
    await page.goto('http://dashboard.test/');
    await page.addStyleTag({content:fs.readFileSync(path.join(ROOT,'principal-dashboard.css'),'utf8')});
    await page.addScriptTag({content:fs.readFileSync(path.join(ROOT,'principal-dashboard.js'),'utf8')});
    await page.evaluate(items=>{
      window.clicked=[];
      const mount=()=>{
        const withCards=items.map(item=>{
          const card=document.createElement('section');card.className='class-card';card.dataset.classId=item.id;
          card.innerHTML='<h2></h2><p class="sub">Teacher: x</p><a class="tool" href="#tool-'+item.id+'">Chazara</a><button type="button" class="act">Sign in as a Student</button>';
          card.querySelector('h2').textContent=item.name;
          // A handler bound before the card is moved must still fire afterwards.
          card.querySelector('.act').addEventListener('click',()=>window.clicked.push(item.id));
          return Object.assign({},item,{card});
        });
        window.cards=withCards.map(x=>x.card);
        window.ui=window.B3PrincipalDashboard.build(document.getElementById('classes'),withCards,{
          persistKey:'fictional-principal',
          studentActions:(cls,student)=>[{label:'Student Report',href:'student-report/index.html?class='+cls.id+'&student='+student.id}]
        });
      };
      window.mount=mount;mount();
    },ITEMS);
    const visible=sel=>page.locator(sel).filter({visible:true});
    const count=sel=>visible(sel).count();

    // Compact on arrival: statistics and the school row, nothing else.
    assert.deepEqual(await page.locator('.pd-stat').allInnerTexts().then(t=>t.map(x=>x.replace(/\s+/g,' '))),
      ['2 Grades','3 Classes','3 Teachers','5 Students','2 Online now']);
    assert.equal(await count('.principal-grade > summary'),2);
    assert.equal(await count('.principal-class > summary'),0);
    assert.equal(await count('.class-card'),0);
    assert.match(await page.locator('.principal-grade > summary').first().innerText(),/B3[\s\S]*2 classes[\s\S]*4 students[\s\S]*1 online/);
    const collapsedHeight=await page.locator('.principal-overview').evaluate(n=>n.getBoundingClientRect().height);
    assert.ok(collapsedHeight<520,'collapsed dashboard fits in one screen, was '+collapsedHeight);

    // Grade → classes → students → details, one level at a time.
    await page.locator('.principal-grade > summary').first().click();
    assert.equal(await count('.principal-class > summary'),2);
    assert.equal(await count('.principal-student'),0);
    await page.locator('.principal-class > summary').first().click();
    assert.equal(await count('.principal-student'),0);
    await visible('.principal-students > summary').first().click();
    assert.equal(await count('.principal-student'),3);
    await visible('.principal-student > summary').first().click();
    const details=await visible('.principal-student[open] .pd-facts').innerText();
    assert.match(details,/Online now/);assert.match(details,/B3 ET · Morning/);assert.match(details,/Also in\s+B3 WT · Afternoon/);
    assert.equal(await visible('.principal-student[open] .pd-action').getAttribute('href'),'student-report/index.html?class=b3-et&student=st2');

    // The original card is moved, not cloned: same node, links and handlers intact.
    await visible('.principal-tools > summary').first().click();
    assert.equal(await page.evaluate(()=>window.cards.every(c=>c.isConnected&&c.closest('.principal-tools'))),true);
    await visible('.class-card .act').first().click();
    assert.deepEqual(await page.evaluate(()=>window.clicked),['b3-et']);
    assert.equal(await visible('.class-card a.tool').first().getAttribute('href'),'#tool-b3-et');

    // Breadcrumb returns focus to the grade row.
    await visible('.pd-crumb').nth(1).click();
    assert.equal(await page.evaluate(()=>document.activeElement.closest('details').dataset.level),'grade');

    // Collapse all, then Expand all.
    await page.getByRole('button',{name:'Collapse all'}).click();
    assert.equal(await page.locator('details[open]').count(),0);
    assert.equal(await count('.principal-grade'),0);
    await page.getByRole('button',{name:'Expand all'}).click();
    assert.equal(await page.locator('details:not([open])').count(),0);
    assert.equal(await count('.class-card'),3);
    assert.equal(await count('.principal-student'),6);

    // Expansion is remembered across a re-render (for example a permission refresh).
    await page.evaluate(()=>window.mount());
    assert.equal(await page.locator('details:not([open])').count(),0);
    await page.getByRole('button',{name:'Collapse all'}).click();
    await page.evaluate(()=>window.mount());
    assert.equal(await page.locator('details[open]').count(),0);

    // Searching for a student opens the path to that student and hides the rest.
    await page.getByRole('searchbox').fill('dovid');
    assert.deepEqual(await visible('.principal-student > summary').allInnerTexts().then(t=>t.map(x=>x.trim())),['Dovid Fictional']);
    assert.equal(await count('.principal-class'),1);
    assert.match(await page.locator('.principal-overview-summary').innerText(),/Showing 1 of 3 classes · 1 student/);
    // Teacher search.
    await page.getByRole('searchbox').fill('Rabbi Alef');
    assert.deepEqual(await visible('.principal-class > summary .pd-title').allInnerTexts().then(t=>t.map(x=>x.split('\n')[0])),['B3 ET · Morning','B4 ET · Morning']);
    // No match.
    await page.getByRole('searchbox').fill('zzz');
    assert.equal(await count('.pd-empty'),1);
    await page.getByRole('button',{name:'Clear'}).click();
    assert.equal(await count('.pd-empty'),0);

    // Filters.
    await page.getByLabel('Filter by grade').selectOption('B4');
    assert.deepEqual(await visible('.principal-grade > summary .pd-title').allInnerTexts(),['B4']);
    assert.deepEqual(await page.getByLabel('Filter by class').locator('option').allInnerTexts(),['All classes','B4 ET · Morning']);
    await page.getByLabel('Filter by grade').selectOption('');
    await page.getByLabel('Filter by class').selectOption('b3-wt');
    assert.equal(await count('.principal-class'),1);
    await page.getByLabel('Filter by class').selectOption('');
    await page.getByLabel('Filter by status').selectOption('online');
    assert.deepEqual(await visible('.principal-student > summary .pd-title').allInnerTexts(),['Avi Example','Avi Example','Levi Placeholder']);
    await page.getByLabel('Filter by status').selectOption('offline');
    assert.equal(await count('.principal-class'),2);
    await page.getByRole('button',{name:'Clear'}).click();

    // Keyboard: Enter on a focused summary toggles it.
    await page.getByRole('button',{name:'Collapse all'}).click();
    await page.locator('.principal-school > summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await count('.principal-grade'),2);

    // Phone width: nothing overflows sideways, controls stay reachable.
    await page.setViewportSize({width:360,height:740});
    await page.getByRole('button',{name:'Expand all'}).click();
    const overflow=await page.evaluate(()=>({page:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      wide:[...document.querySelectorAll('.principal-overview *')].filter(n=>n.getBoundingClientRect().right>window.innerWidth+1).length}));
    assert.deepEqual(overflow,{page:0,wide:0});
    const box=await page.getByRole('button',{name:'Expand all'}).boundingBox();
    assert.ok(box.height>=40,'touch-sized buttons on a phone');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
