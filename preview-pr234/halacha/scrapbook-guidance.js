/* Shared optional title inspiration for every current Halacha lesson and both pages.
 * Never seed or overwrite a scrapbook. Use the existing add/persist pipeline.
 */
(function(){
'use strict';
const titles={
  "a": [
    "How Should I Behave Before a King?",
    "Hashem Is With Me",
    "Shivisi Hashem",
    "Hashem Sees Me Everywhere",
    "My Actions Matter Even When I Am Alone"
  ],
  "b": [
    "Thank You Hashem",
    "A New Morning",
    "Hashem Returned My Neshama",
    "I Wake Up with Thanks",
    "Modeh Ani"
  ],
  "c": [
    "Four Middos for a Chayol",
    "I Can Be Strong for Hashem",
    "I Run to Do Mitzvos",
    "Serving Hashem with Strength",
    "עז כנמר"
  ],
  "d": [
    "I Get Up with Zerizus",
    "I Start My Day Right",
    "Overcoming the Yetzer Hara",
    "No More Morning Excuses",
    "Ready to Serve Hashem"
  ],
  "e": [
    "Learning Torah at Night",
    "Using My Time Well",
    "Torah with Kavanah",
    "Tikun Chatzos",
    "A Quiet Time for Torah"
  ],
  "a6": [
    "Reading from a Sefer",
    "Respecting Words of Torah",
    "Saying Tehillim Carefully",
    "Words of Torah Are Precious",
    "I Read Pesukim the Right Way"
  ],
  "a7": [
    "Hashem Hears My Tefillah",
    "Davening with Respect",
    "Choosing the Correct Words",
    "ברוך שומע תפילה",
    "My Words to Hashem"
  ],
  "f": [
    "I Prepare My Negel Vasser",
    "Washing My Hands in the Morning",
    "A Fresh Start with Clean Hands",
    "Right Hand, Left Hand",
    "Ready for a New Day"
  ],
  "s2a": [
    "Why Do We Wash in the Morning?",
    "A New Day to Serve Hashem",
    "Washing Like the Kohanim",
    "My Tzitzis in the Morning",
    "Preparing for Avodas Hashem"
  ],
  "s2b": [
    "The Right Way to Wash",
    "Three Times, Alternating Hands",
    "The Cup and the Water",
    "What May I Touch Before Washing?",
    "Keeping Negel Vasser Water Safe"
  ],
  "s2c": [
    "Making the Morning Bracha",
    "Doing Netilas Yadayim Properly",
    "What If I Have No Water?",
    "When Do I Say the Bracha?",
    "My Morning Washing Questions"
  ],
  "s2d": [
    "When Else Do We Wash?",
    "After Cutting My Nails",
    "Washing After the Bathroom",
    "Keeping My Hands Clean",
    "Times That Need Netilas Yadayim"
  ],
  "s3a": [
    "Tznius Even When I Am Alone",
    "Dressing with Respect",
    "Hashem Is Always With Me",
    "My Clothes Show Kavod",
    "Being a Chossid at Home"
  ],
  "s3b": [
    "A Yid Dresses Like a Yid",
    "I Do Not Copy Every Fashion",
    "Proud of My Jewish Clothing",
    "My Chassidishe Clothes",
    "Choosing What Is Right"
  ],
  "s3c": [
    "Simple, Clean, and Respectful",
    "Clothing Without Showing Off",
    "Finding the Right Balance",
    "Kavod Without Gaavah",
    "My Clothes Show Respect"
  ],
  "s3d": [
    "Right Side First",
    "My Shoes in the Right Order",
    "Why the Left Shoe Is Tied First",
    "Getting Dressed the Halacha Way",
    "Practicing Yemin and Smol"
  ],
  "s3e": [
    "Keeping My Head Covered",
    "Walking with Humility",
    "Everyday Halacha Habits",
    "Being Careful When Getting Dressed",
    "My Jewish Way of Walking"
  ],
  "s4a": [
    "Cleanliness Is Important",
    "Taking Care of My Body",
    "Good Bathroom Habits",
    "Do Not Delay When You Need to Go",
    "A Healthy Morning Routine"
  ],
  "s4b": [
    "Tznius in Private Places",
    "Respectful Bathroom Behavior",
    "Privacy and Kavod",
    "Making Good Choices in Private",
    "My Halacha Habits"
  ],
  "s4c": [
    "Keeping Clean the Right Way",
    "Being Careful in the Bathroom",
    "My Cleanliness Routine",
    "Respect and Cleanliness",
    "Healthy Halacha Habits"
  ],
  "s4d": [
    "What May I Think About Here?",
    "Respect for Torah Thoughts",
    "Being Careful with Kedusha",
    "Proper Bathroom Behavior",
    "Honoring Holy Words"
  ],
  "s4e": [
    "Staying Clean Properly",
    "Cleanliness After the Bathroom",
    "My Good Hygiene Habits",
    "Doing Things the Halacha Way",
    "Keeping Myself Clean"
  ],
  "s4f": [
    "Thank You for My Healthy Body",
    "Understanding Asher Yatzar",
    "The Wonders of My Body",
    "Saying Asher Yatzar with Kavanah",
    "Every Part of My Body Matters"
  ],
  "s6a": [
    "Thinking Before a Bracha",
    "I Know Which Bracha to Say",
    "Brachas with Kavanah",
    "Saying Every Word Carefully",
    "I Do Not Rush My Bracha"
  ],
  "s6b": [
    "A Clean Mouth for a Bracha",
    "Preparing to Praise Hashem",
    "I Say Brachas Clearly",
    "My Mouth Is Ready",
    "ימלא פי תהלתך"
  ],
  "s6c": [
    "Respecting Hashem's Name",
    "Words of Kedusha",
    "Careful with Holy Names",
    "I Speak with Respect",
    "שם שמים"
  ],
  "s6d": [
    "Avoiding a Bracha Levatala",
    "Brachas Are Precious",
    "What If I Said the Wrong Bracha?",
    "Thinking Before I Bless",
    "I Do Not Say Extra Brachas"
  ],
  "s6e": [
    "What If I Already Said a Bracha?",
    "The Water and the Bracha",
    "Doing the Right Thing Carefully",
    "Shomer Mitzvah",
    "Remembering the Halacha"
  ],
  "s6f": [
    "Did I Say the Bracha?",
    "When I Am Not Sure",
    "The Rule of Safek Brachas",
    "I Do Not Repeat a Doubtful Bracha",
    "Thinking Carefully About Brachas"
  ],
  "s6g": [
    "One Hundred Brachas a Day",
    "My Daily Bracha Goal",
    "Finding Brachas in My Day",
    "100 Chances to Thank Hashem",
    "מאה ברכות"
  ],
  "s6h": [
    "Answering Amen Properly",
    "Baruch Hu Uvaruch Shemo",
    "Listening to Another Person's Bracha",
    "What Does Amen Mean?",
    "I Listen and Answer"
  ],
  "s6i": [
    "Knowing When Not to Interrupt",
    "A Time for Silence",
    "Respecting the Bracha",
    "When May I Answer?",
    "Avoiding a Hefsek"
  ],
  "s6j": [
    "Saying Amen Clearly",
    "Not Too Early, Not Too Late",
    "The Right Time for Amen",
    "I Answer with Kavanah",
    "A Beautiful Amen"
  ],
  "s6k": [
    "Do I Answer Amen to My Own Bracha?",
    "The Boneh Yerushalayim Exception",
    "When the Chazzan Finishes",
    "Listening and Answering Correctly",
    "The Right Way to Answer Amen"
  ]
};
const cooldown=new Map();
const safe=s=>String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const readonly=()=>typeof HALACHA_TEACHER_VIEW!=='undefined'&&!!HALACHA_TEACHER_VIEW;
function pageNumber(id){
 const selector=document.querySelector('#'+id+' .studio-target');
 return selector?.value==='1'?1:0;
}
function updateTarget(id){
 const box=document.querySelector('#'+id+' .hal-title-guidance');
 if(!box)return;
 const label=box.querySelector('.hal-title-target');
 if(label)label.textContent='Adding to Page '+(pageNumber(id)+1);
}
function addTitle(id,value,source){
 if(readonly()||typeof window.add!=='function')return false;
 const title=String(value||'').trim().slice(0,90);
 if(!title)return false;
 const page=pageNumber(id);
 const key=id+'|'+page+'|'+source+'|'+title;
 const now=Date.now();
 // Prevent accidental duplicates from a double-click or double-tap.
 if(now-(cooldown.get(key)||0)<950)return false;
 cooldown.set(key,now);
 const markup='<div class="tb-text hal-scrapbook-title" contenteditable="true" data-ph="Edit your title">'+safe(title)+'</div>';
 const piece=window.add(id,'textbox',markup,page);
 if(!piece){cooldown.delete(key);return false;}
 piece.classList.add('hal-title-piece');
 piece.style.width='260px';
 piece.style.minHeight='54px';
 if(typeof window.persist==='function')window.persist(id);
 const status=document.querySelector('#'+id+' .hal-title-status');
 if(status)status.textContent='Added to Page '+(page+1)+' ✓ Move or edit your title on the page.';
 return true;
}
function make(tag,cls,text){
 const el=document.createElement(tag);if(cls)el.className=cls;
 if(text!==undefined)el.textContent=text;return el;
}
function install(id){
 const section=document.getElementById(id);
 if(!section||!titles[id]||section.querySelector('.hal-title-guidance'))return;
 const side=section.querySelector('.work .side');
 if(!side)return;
 const area=make('details','hal-title-guidance');
 area.open=true;
 area.setAttribute('aria-label','Scrapbook title ideas for this Halacha lesson');
 const summary=make('summary','','✏️ Add a title to my scrapbook');
 area.append(summary,make('p','hal-title-hint','Pick a title and edit it on your page, or write your own.'));
 const target=make('div','hal-title-target');
 target.setAttribute('aria-live','polite');area.appendChild(target);
 const buttons=make('div','hal-title-ideas');
 for(const label of titles[id]){
  const b=make('button','hal-title-choice',label);b.type='button';b.disabled=readonly();
  b.addEventListener('click',()=>addTitle(id,label,'idea'));
  buttons.appendChild(b);
 }
 area.appendChild(buttons);
 const line=make('div','hal-title-custom-row');
 const field=make('input','hal-title-input');
 field.type='text';field.maxLength=90;field.placeholder='My own scrapbook title';
 field.setAttribute('aria-label','My own scrapbook title for the selected page');
 field.disabled=readonly();
 const submit=make('button','hal-title-submit','＋ Add my title');
 submit.type='button';submit.disabled=readonly();
 const doCustom=()=>{if(addTitle(id,field.value,'custom'))field.value='';};
 submit.addEventListener('click',doCustom);
 field.addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();doCustom();}});
 line.append(field,submit);area.appendChild(line);
 const status=make('p','hal-title-status');
 status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 area.appendChild(status);
 const anchor=side.querySelector('.studio-actions');
 if(anchor)anchor.insertAdjacentElement('afterend',area);
 else side.querySelector('.studio-intro')?.insertAdjacentElement('afterend',area) || side.prepend(area);
 const pageSelector=side.querySelector('.studio-target');
 if(pageSelector)pageSelector.addEventListener('change',()=>updateTarget(id));
 updateTarget(id);
}
const oldRender=render;
render=function(lesson){oldRender(lesson);if(lesson)install(lesson.id);};
lessons.forEach(lesson=>install(lesson.id));
})();
