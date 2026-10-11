'use strict';
// Annual prices are launch PROPOSALS except Shorashim Lab ($39).
// Confirm ALL prices, tax handling and tool isolation before enabling live checkout.
const PRODUCTS=Object.freeze({
 posuk:{name:'Posuk Practice',price:7900,grant:'posuk-practice-scroll'},
 chazara:{name:'Chazara Chart',price:2900,grant:'chazara'},
 shorashim:{name:'Shorashim Lab',price:3900,grant:'shorashim'},
 yiddish:{name:'Yiddish Explorer',price:2900,grant:'yiddish'},
 halacha:{name:'Halacha Lessons',price:2900,grant:'halacha'},
 rashi:{name:'Rashi Letters',price:1900,grant:'rashi-letters'},
 gematria:{name:'Gematria',price:1200,grant:'gematria'},
 weekly:{name:'Weekly Quiz',price:1900,grant:'weekly-quiz'},
 gameshow:{name:'Game Show',price:1500,grant:'game-show'},
 tag:{name:'Tag Game',price:1200,grant:'tag'},
 rewards:{name:'Student Rewards',price:1900,grant:'student-rewards'},
 gallery:{name:'Class Gallery',price:1200,grant:'gallery'}
});
function fail(message){throw Object.assign(new Error(message),{status:400});}
function quote(input){
 const seats=Number(input&&input.seats);
 if(!Number.isSafeInteger(seats)||seats<1||seats>300)fail('Student count must be between 1 and 300.');
 const ids=input&&input.tools;
 if(!Array.isArray(ids)||ids.length<1||ids.length>Object.keys(PRODUCTS).length||
   ids.some(id=>typeof id!=='string'||!Object.hasOwn(PRODUCTS,id))||
   new Set(ids).size!==ids.length)fail('Choose valid, distinct tools.');
 const selection=ids.slice().sort();
 const lines=[{name:'Teacher account and first 5 students',unit_amount:10000,quantity:1}];
 if(seats>5)lines.push({name:'Additional student account',unit_amount:1000,quantity:seats-5});
 for(const id of selection)lines.push({name:PRODUCTS[id].name,unit_amount:PRODUCTS[id].price,quantity:1});
 return {
  seats,toolIds:selection,
  amountCents:lines.reduce((sum,line)=>sum+line.unit_amount*line.quantity,0),
  grants:Object.fromEntries(selection.map(id=>[PRODUCTS[id].grant,true])),
  lines
 };
}
function normalizeOrder(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('Invalid registration details.');
 const clean=(v,min,max,label)=>{
  if(typeof v!=='string')fail('Enter '+label+'.');
  const s=v.trim().replace(/\s+/g,' ');
  if(s.length<min||s.length>max||/[\u0000-\u001f<>]/.test(s))fail('Enter a valid '+label+'.');
  return s;
 };
 const teacherName=clean(raw.teacherName,2,100,'teacher name');
 const teacherEmail=clean(raw.teacherEmail,5,254,'teacher email').toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(teacherEmail))fail('Enter a valid teacher email.');
 const school=clean(raw.school,2,100,'school name');
 const className=clean(raw.className,2,100,'class name');
 return {teacherName,teacherEmail,school,className,quote:quote(raw)};
}
function stripeLineItems(quote){
 return quote.lines.map(line=>({
  price_data:{currency:'usd',unit_amount:line.unit_amount,
   product_data:{name:line.name},recurring:{interval:'year'}},
  quantity:line.quantity
 }));
}
module.exports={PRODUCTS,quote,normalizeOrder,stripeLineItems};
