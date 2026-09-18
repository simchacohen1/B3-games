const FIREBASE_CONFIG={apiKey:"AIzaSyDaheO5K2qL8qe3rHIZY4nTd0wuEUG_DEs",authDomain:"b3-games.firebaseapp.com",databaseURL:"https://b3-games-default-rtdb.firebaseio.com",projectId:"b3-games",storageBucket:"b3-games.firebasestorage.app",messagingSenderId:"568530046190",appId:"1:568530046190:web:fd765fdd27e55a3c73f7ff"};
if(!firebase.apps.length)firebase.initializeApp(FIREBASE_CONFIG);const db=firebase.database();const ROOT='posukPractice/shorashimLearning';
// Same teacher passcode used by the existing Posuk Practice teacher dashboard.
const TEACHER_PASSCODE="vayeira5786";
// AI picture-choice helper. Deploy the matching generateShorashimArt Cloud Function.
const GENERATE_SHORASHIM_ART_URL="https://us-central1-b3-games.cloudfunctions.net/generateShorashimArt";
let state={catalog:{shorashim:[],prefix:[],suffix:[]},settings:{minReviewMs:500,studentSiteOpen:true},students:{},leaderboards:{}};let currentTrack='shorashim';
const CATALOG_SEED_VERSION=1; // One-time unit/Perek seed. Firebase remains authoritative afterward.

/* ===== Perek 18 completion migration =====
   The class list previously stopped in pasuk 24 at "אולי יש חמשים ... בתוך העיר".
   These are the genuinely new root/word families that first appear AFTER that
   point through the end of Perek 18.  The migration is teacher-only, runs once
   safely, preserves every existing card/student record, and skips anything
   already present. */
const PEREK18_FINAL_SHORASHIM=[
  {id:'p18-25-chalal',pasuk:'25',front:'חָלַל',hebrew:'חָלִלָה',english:'far be it / profane'},
  {id:'p18-25-mut',pasuk:'25',front:'מוּת',hebrew:'לְהָמִית',english:'die / put to death'},
  {id:'p18-27-anah',pasuk:'27',front:'עָנָה',hebrew:'וַיַּעַן',english:'answered'},
  {id:'p18-27-yaal',pasuk:'27',front:'יָאַל',hebrew:'הוֹאַלְתִּי',english:'began / undertook'},
  {id:'p18-27-afar',pasuk:'27',front:'עָפָר',hebrew:'עָפָר',english:'dust'},
  {id:'p18-27-efer',pasuk:'27',front:'אֵפֶר',hebrew:'וָאֵפֶר',english:'ashes'},
  {id:'p18-28-chasar',pasuk:'28',front:'חָסַר',hebrew:'יַחְסְרוּן',english:'lacked / were missing'},
  {id:'p18-28-shachat',pasuk:'28',front:'שָׁחַת',hebrew:'הֲתַשְׁחִית',english:'destroyed / corrupted'},
  {id:'p18-28-arba',pasuk:'28',front:'אַרְבַּע',hebrew:'אַרְבָּעִים',english:'four'},
  {id:'p18-29-yasaf',pasuk:'29',front:'יָסַף',hebrew:'וַיֹּסֶף',english:'added / continued'},
  {id:'p18-30-charah',pasuk:'30',front:'חָרָה',hebrew:'יִחַר',english:'became angry'},
  {id:'p18-31-eser',pasuk:'31',front:'עֶשֶׂר',hebrew:'עֶשְׂרִים',english:'ten'},
  {id:'p18-32-paam',pasuk:'32',front:'פַּעַם',hebrew:'הַפַּעַם',english:'time / occurrence'}
];
function hebrewKey(v){return String(v||'').normalize('NFD').replace(/[\u0591-\u05C7]/g,'').replace(/[^א-ת]/g,'')}
function ensurePerek18FinalShorashim(){
  state.catalog=state.catalog||{};
  const list=state.catalog.shorashim=Array.isArray(state.catalog.shorashim)?state.catalog.shorashim:[];
  const stopWords=new Set(['עיר','בתוך','חמישים','חמשים','יש','אולי']);
  let anchor=[...list].reverse().find(i=>stopWords.has(hebrewKey(i.front))||stopWords.has(hebrewKey(i.hebrew)));
  if(!anchor)anchor=list[list.length-1];
  const targetListName=anchor?.listName||'Main List';
  const added=[];
  for(const src of PEREK18_FINAL_SHORASHIM){
    const f=hebrewKey(src.front),w=hebrewKey(src.hebrew);
    const exists=list.some(i=>i.id===src.id || hebrewKey(i.front)===f || (w&&hebrewKey(i.hebrew)===w));
    if(exists)continue;
    const item={...src,perek:18,listName:targetListName,art:[],autoArt:true,hidden:false};
    list.push(item);added.push(item);
  }
  return added;
}

const PEREK19_SHORASHIM=[[1, "shnayim", "שְׁנַיִם", "שְׁנֵי", "two"], [1, "malach", "מַלְאָךְ", "הַמַּלְאָכִים", "angel / messenger"], [1, "erev", "עֶרֶב", "בָּעֶרֶב", "evening"], [1, "shaar", "שַׁעַר", "שַׁעַר", "gate"], [2, "sur", "סוּר", "סוּרוּ", "turn aside"], [2, "lun", "לוּן", "וְלִינוּ", "stay overnight"], [2, "shechem", "שְׁכֶם", "וְהִשְׁכַּמְתֶּם", "get up early"], [2, "rechov", "רְחוֹב", "בָרְחוֹב", "street / open square"], [3, "patzar", "פָּצַר", "וַיִּפְצַר", "urge strongly"], [3, "mishteh", "מִשְׁתֶּה", "מִשְׁתֶּה", "feast"], [3, "matzah", "מַצָּה", "מַצּוֹת", "matzah"], [3, "afah", "אָפָה", "וַיֹּאפֶה", "bake"], [4, "terem", "טֶרֶם", "טֶרֶם", "before / not yet"], [4, "shachav", "שָׁכַב", "יִשְׁכָּבוּ", "lie down"], [4, "savav", "סָבַב", "נָסַבּוּ", "surround"], [4, "ad", "עַד", "עַד", "until"], [4, "katzeh", "קָצֶה", "מִקָּצֶה", "edge / end"], [5, "lailah", "לַיְלָה", "הַלַּיְלָה", "night"], [5, "yatza", "יָצָא", "הוֹצֵא", "go out / take out"], [6, "delet", "דֶּלֶת", "הַדֶּלֶת", "door"], [6, "sagar", "סָגַר", "סָגָרוּ", "close"], [7, "ach", "אָח", "אַחַי", "brother"], [7, "raa", "רָעַע", "תָּרֵעוּ", "do evil"], [8, "bat", "בַּת", "בָנוֹת", "daughter"], [8, "rak", "רַק", "רַק", "only"], [8, "tzel", "צֵל", "בְּצֵל", "shade"], [8, "korah", "קוֹרָה", "קֹרָתִי", "roof beam / roof"], [9, "echad", "אֶחָד", "הָאֶחָד", "one"], [9, "gur", "גּוּר", "לָגוּר", "dwell as a stranger"], [9, "halah", "הָלְאָה", "הָלְאָה", "farther / onward"], [9, "shavar", "שָׁבַר", "וַיִּשְׁבֹּר", "break"], [10, "yad", "יָד", "יָדְךָ", "hand"], [11, "nakah", "נָכָה", "הִכּוּ", "strike"], [11, "sanverim", "סַנְוֵרִים", "בַּסַּנְוֵרִים", "blindness"], [11, "katan", "קָטֹן", "מִקָּטֹן", "small"], [11, "laah", "לָאָה", "וַיִּלְאוּ", "become weary"], [12, "mi", "מִי", "מִי", "who"], [12, "poh", "פֹּה", "פֹה", "here"], [12, "chatan", "חָתָן", "חָתָן", "son-in-law / bridegroom"], [15, "boker", "בֹּקֶר", "הַבֹּקֶר", "morning"], [15, "shachar", "שַׁחַר", "הַשַּׁחַר", "dawn"], [15, "alah", "עָלָה", "עֲלֵה", "rise / go up"], [15, "utz", "אוּץ", "וַיָּאִיצוּ", "urge / hurry"], [15, "pen", "פֶּן", "פֶּן", "lest"], [15, "avon", "עָוֹן", "בַּעֲוֹן", "sin"], [16, "hitmahmah", "הִתְמַהְמֵהַּ", "וַיִּתְמַהְמָהּ", "linger"], [16, "chazak", "חָזַק", "וַיַּחֲזִקוּ", "hold strongly"], [16, "chamal", "חָמַל", "בְּחֶמְלַת", "have compassion"], [16, "nuach", "נוּחַ", "וַיַּנִּחֻהוּ", "place / set down"], [16, "chutz", "חוּץ", "מִחוּץ", "outside"], [17, "malat", "מָלַט", "הִמָּלֵט", "escape"], [17, "nefesh", "נֶפֶשׁ", "נַפְשֶׁךָ", "life / soul"], [17, "navat", "נָבַט", "תַּבִּיט", "look"], [17, "kikar", "כִּכָּר", "הַכִּכָּר", "plain / district"], [17, "har", "הַר", "הָהָרָה", "mountain"], [19, "chesed", "חֶסֶד", "חַסְדְּךָ", "kindness"], [19, "yachol", "יָכֹל", "אוּכַל", "be able"], [19, "davak", "דָּבַק", "תִּדְבָּקַנִי", "cling / catch up"], [20, "nus", "נוּס", "לָנוּס", "flee"], [20, "tzoar", "צָעִיר", "מִצְעָר", "small / little"], [21, "bilti", "בִּלְתִּי", "לְבִלְתִּי", "not"], [21, "hafach", "הָפַךְ", "הָפְכִּי", "overturn"], [21, "gam", "גַּם", "גַּם", "also"], [23, "shemesh", "שֶׁמֶשׁ", "הַשֶּׁמֶשׁ", "sun"], [24, "matar", "מָטַר", "הִמְטִיר", "rain down"], [24, "gafrit", "גׇּפְרִית", "גׇּפְרִית", "sulfur"], [24, "esh", "אֵשׁ", "וָאֵשׁ", "fire"], [24, "shamayim", "שָׁמַיִם", "הַשָּׁמָיִם", "heavens"], [25, "tzemach", "צֶמַח", "צֶמַח", "plant / growth"], [25, "adamah", "אֲדָמָה", "הָאֲדָמָה", "ground"], [26, "melach", "מֶלַח", "מֶלַח", "salt"], [28, "kitor", "קִיטוֹר", "קִיטֹר", "smoke"], [28, "kivshan", "כִּבְשָׁן", "הַכִּבְשָׁן", "furnace"], [29, "zachar", "זָכַר", "וַיִּזְכֹּר", "remember"], [30, "mearah", "מְעָרָה", "בַּמְּעָרָה", "cave"], [31, "bechor", "בְּכוֹר", "הַבְּכִירָה", "older / firstborn"], [31, "av", "אָב", "אָבִינוּ", "father"], [31, "ayin-none", "אַיִן", "אַיִן", "none / there is no"], [32, "shakah", "שָׁקָה", "וְנַשְׁקֶה", "give to drink"], [32, "yayin", "יַיִן", "יַיִן", "wine"], [32, "zera", "זֶרַע", "זֶרַע", "offspring / seed"], [34, "mochorat", "מָחֳרָת", "מִמָּחֳרָת", "next day"], [34, "emesh", "אֶמֶשׁ", "אֶמֶשׁ", "last night"], [36, "harah", "הָרָה", "וַתַּהֲרֶיןָ", "become pregnant"]].map(([pasuk,slug,front,hebrew,english])=>({
  id:`19-${pasuk}-${slug}`,
  perek:19,
  listName:'Main List',
  pasuk:String(pasuk),
  front,
  hebrew,
  english,
  art:[],
  autoArt:true,
  hidden:false
}));
function perekOf(i){return Number(i?.perek)||18}
function perekLabel(i){return perekOf(i)===19?'Perek י״ט':'Perek י״ח'}
function vocalizedCatalogKey(i){return String(i?.front||'').normalize('NFC')}
function ensurePerekUnitsAnd19(){
  state.catalog=state.catalog||{};
  const list=state.catalog.shorashim=Array.isArray(state.catalog.shorashim)?state.catalog.shorashim:[];
  let tagged=0;
  for(const item of list){
    if(!item.perek){
      item.perek=String(item.id||'').startsWith('19-')?19:18;
      tagged++;
    }
  }
  const ids=new Set(list.map(i=>String(i.id||'')));
  const exact=new Set(list.map(vocalizedCatalogKey));
  const added=[];
  for(const src of PEREK19_SHORASHIM){
    if(ids.has(src.id)||exact.has(vocalizedCatalogKey(src)))continue;
    const item={...src};
    list.push(item);
    ids.add(item.id);
    exact.add(vocalizedCatalogKey(item));
    added.push(item);
  }
  return {tagged,added};
}

const teacherArtStyle=document.createElement('style');
teacherArtStyle.textContent=`
.teacher-art-preview{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}
.teacher-art-chip{font-size:28px;line-height:1;border:1px solid #d7dbea;background:#fff;border-radius:10px;padding:8px 10px;cursor:pointer}
.teacher-art-chip:hover{background:#fff3f3;border-color:#e39b9b}
`;
document.head.appendChild(teacherArtStyle);
const $=id=>document.getElementById(id);const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/* ===== Meaning-aware picture choices =====
   The old Bulk Add path assigned the exact same three generic choices
   (✨ ⭐ 🖍️) to every imported item.  New imports now receive picture
   choices based on the English meaning.  Existing bulk/custom Shorashim
   items that still have only those generic choices are repaired once when
   the teacher dashboard loads.  Original hand-curated art is left alone. */
const GENERIC_ART_CHOICES=new Set(['✨','⭐','🖍️']);

const UNSUITABLE_ART_CHOICES=new Set([
  '👫','👬','👭','🧑‍🤝‍🧑','👩‍❤️‍👨','👨‍❤️‍👩','👩‍❤️‍👩','👨‍❤️‍👨',
  '💑','💏','👩‍❤️‍💋‍👨','👨‍❤️‍💋‍👩','👩‍❤️‍💋‍👩','👨‍❤️‍💋‍👨',
  '👨‍👩‍👦','👨‍👩‍👧','👨‍👩‍👧‍👦','👨‍👩‍👦‍👦','👨‍👩‍👧‍👧',
  '👩','👩‍🦱','👩‍🦰','👩‍🦳','👩‍🦲','👧','👵','🤰','🤱','👰','👸','🧕',
  '👩‍👦','👩‍👧','👩‍👧‍👦','👩‍👦‍👦','👩‍👧‍👧','👨‍👧','👨‍👧‍👦'
]);

function isClassSafeArtChoice(value){
  const v=String(value||'').trim();
  if(!v) return false;
  if(UNSUITABLE_ART_CHOICES.has(v)) return false;

  // A simple boy/child icon is useful for literal vocabulary such as נַעַר.
  // Keep these two explicit teaching icons available while continuing to block
  // the broader automatic people/couple/family emoji pool below.
  if(['👦','🧒'].includes(v)) return true;

  // Automatic Unicode people cannot reliably be shown with the required
  // modest clothing and Jewish head covering on every device, so reject
  // person/couple/family emoji and favor objects, symbols, scenery, etc.
  if(/[\u{1F466}-\u{1F469}\u{1F471}-\u{1F478}\u{1F481}-\u{1F487}\u{1F575}\u{1F57A}\u{1F645}-\u{1F647}\u{1F64B}-\u{1F64F}\u{1F9D1}-\u{1F9DD}]/u.test(v)) return false;

  // Explicit romance/affection symbols are not appropriate for these cards.
  if(['🫶','💋','💌'].includes(v)) return false;
  return true;
}

function sanitizeClassArtPool(art){
  return [...new Set((Array.isArray(art)?art:[])
    .map(x=>String(x||'').trim())
    .filter(isClassSafeArtChoice))];
}

function sanitizeClassArt(art){
  return sanitizeClassArtPool(art).slice(0,4);
}

const SMART_ART_RULES=[
  [/entrance|opening|door/,['🚪','🏠','⛺','↔️']],
  [/\btent\b|ohel/,['⛺','🏕️','🏠','🌵']],
  [/\bsee\b|\bsaw\b|\bseen\b|\blook\b|\bappea?r/,['👀','👁️','🔎','✨']],
  [/behold|look!|notice/,['👀','❗','✨','🔎']],
  [/grove|tree|wood/,['🌳','🌲','🌿','🪵']],
  [/\bsit\b|\bsat\b|sitting/,['🪑','🧎','🛋️','🏕️']],
  [/\bheat\b|\bhot\b|warm/,['☀️','🔥','🌡️','🥵']],
  [/\bday\b|daytime/,['☀️','🌤️','📅','🌅']],
  [/\blift\b|\blifted\b|\bcarry\b|\bcarried\b|\braise\b/,['⬆️','🙌','📦','💪']],
  [/\beye\b|\beyes\b/,['👁️','👀','🙂','🔎']],
  [/\bthree\b|\b3\b/,['3️⃣','🔺','🔢','🧩']],
  [/\bman\b|\bmen\b|\bperson\b|\bpeople\b/,['👥','📛','🏠','🗣️']],
  [/\bstand\b|\bstood\b|standing|firm/,['🧍','📍','⬆️','🚶']],
  [/\brun\b|\bran\b|running|hurr(y|ied)|quick/,['🏃','💨','👟','⚡']],
  [/\bcall\b|\bcalled\b|\bsay\b|\bsaid\b|\bspeak\b|\bspoke\b/,['🗣️','💬','📣','👄']],
  [/greet|meet|toward|towards/,['🤝','👥','➡️','📍']],
  [/\bbow\b|bowed|prostrate/,['🙇','🙏','🧎','⬇️']],
  [/\bland\b|\bearth\b|ground/,['🌍','🏞️','🌱','🗺️']],
  [/\bfind\b|\bfound\b/,['🔎','💡','✅','🎯']],
  [/grace|favor|favour|kindness/,['❤️','✨','🤲','😊']],
  [/cross|passed|pass over|across/,['➡️','🌉','🚶','🛣️']],
  [/serve|served|work|worked|labor/,['🛠️','🤲','💼','⚙️']],
  [/\btake\b|\btook\b|\btaken\b/,['✋','🤲','📦','⬅️']],
  [/\blittle\b|\bfew\b|small amount|morsel/,['🤏','1️⃣','🔹','🐜']],
  [/\bwater\b/,['💧','🚰','🌊','🫗']],
  [/\bwash\b|washed|washing/,['🧼','💦','🫧','🚿']],
  [/\bfoot\b|\bfeet\b|\bleg\b|\blegs\b/,['🦶','👣','🧦','👟']],
  [/lean|support|supported|sustain|sustained/,['🌳','🪑','💪','🤲']],
  [/\bbread\b|\bloaf\b/,['🍞','🥖','🥯','🌾']],
  [/\bheart\b|\bhearts\b/,['❤️','💗','🫶','💓']],
  [/\bmake\b|\bmade\b|\bdo\b|\bdid\b/,['🛠️','✅','🧱','🔧']],
  [/\bflour\b/,['🌾','🥣','🍞','✨']],
  [/knead|kneaded/,['🤲','🍞','🥣','👨‍🍳']],
  [/\bcake\b|\bcakes\b/,['🍰','🧁','🥮','🎂']],
  [/cattle|cow|ox|bull/,['🐄','🐂','🐮','🌾']],
  [/\bson\b|\bboy\b|\byouth\b|\blad\b/,['👦','🎒','🧢','📘','👟']],
  [/soft|tender/,['🧸','☁️','🪶','🤲']],
  [/\bgood\b|fine|excellent/,['👍','⭐','😊','✅']],
  [/\bgive\b|\bgave\b|\bgiven\b/,['🎁','🤲','➡️','💝']],
  [/\bbutter\b/,['🧈','🥛','🍞','🐄']],
  [/\bmilk\b/,['🥛','🐄','🍼','🤍']],
  [/\bface\b|\bbefore\b/,['🙂','👤','👀','➡️']],
  [/\beat\b|\bate\b|\beaten\b|food|meal/,['🍽️','🥘','😋','🍴']],
  [/return|returned|back again/,['↩️','🔙','🏠','🔄']],
  [/\btime\b/,['⏰','⌛','🕰️','📅']],
  [/\blive\b|\blived\b|\blife\b/,['❤️','🌱','🙂','🌿']],
  [/\bhear\b|\bheard\b|\blisten\b/,['👂','🔊','🎧','🎶']],
  [/\bafter\b|\bbehind\b/,['⬅️','👣','🚶','🔙']],
  [/\bfire\b|burn/,['🔥','🪵','☀️','🚒']],
  [/\bhouse\b|\bhome\b/,['🏠','🏡','🚪','🛏️']],
  [/\bmaster\b|\blord\b|\bking\b/,['👑','🏛️','⭐','🫅']],
  [/\bhand\b|\bhands\b/,['✋','🤲','🖐️','👋']],
  [/\bhead\b/,['👤','🧠','🎩','🙂']],
  [/\bmouth\b/,['👄','🗣️','💬','😮']],
  [/\bchild\b|\bchildren\b/,['🧒','🎒','🧸','📘','🧩']],
  [/\bmother\b|\bwoman\b|\bwomen\b/,['🏠','❤️','🌷','📛']],
  [/\bfather\b/,['🏠','📘','👔','❤️']],
  [/\bwalk\b|\bgo\b|\bwent\b/,['🚶','👣','➡️','🛣️']],
  [/\bcome\b|\bcame\b/,['➡️','🚶','👋','🏠']],
  [/\bup\b|\babove\b/,['⬆️','🪜','☝️','🚀']],
  [/\bdown\b|\bbelow\b/,['⬇️','👇','🪜','📉']],
  [/\bbig\b|\bgreat\b|\blarge\b/,['🐘','⬆️','🔷','💪']],
  [/\bsmall\b|\blittle\b/,['🐜','🤏','🔹','🐭']],
  [/\bold\b|elder|elderly|aged/,['🦯','⌛','🕰️','📜']],
  [/\bnew\b/,['✨','🆕','🌱','🎁']],
  [/\bnight\b/,['🌙','⭐','🌌','🛏️']],
  [/\bmorning\b/,['🌅','☀️','⏰','☕']],
  [/\blight\b|bright/,['💡','☀️','🔦','✨']],
  [/\bdark\b|darkness/,['🌑','🌙','🌌','🕶️']],
  [/\bbuy\b|\bbought\b/,['🛒','💰','🧾','🛍️']],
  [/\bsell\b|\bsold\b/,['💵','🏷️','🤝','🛍️']],
  [/\bmoney\b|silver|gold/,['💰','💵','🪙','🏦']],
  [/\bcity\b|town/,['🏙️','🏘️','🛣️','🏢']],
  [/\bfield\b/,['🌾','🌱','🚜','🏞️']],
  [/\bmountain\b|\bhill\b/,['⛰️','🏔️','🥾','🌄']],
  [/\briver\b/,['🌊','🏞️','💧','🚣']],
  [/\bwell\b|\bspring\b/,['🪣','💧','🌊','🏞️']],
  [/\banimal\b|\bbeast\b/,['🐄','🐑','🐐','🐎']],
  [/\bsheep\b|\blamb\b/,['🐑','🌾','🐏','🧶']],
  [/\bdonkey\b/,['🫏','🐴','🛤️','📦']],
  [/\bhorse\b/,['🐎','🏇','🌾','🛣️']],
  [/\bbird\b/,['🐦','🪶','🪺','🌳']],
  [/\bseed\b|plant/,['🌱','🌾','🫘','🌻']],
  [/\bhim\b|\bhis\b|\bhe\b/,['👉','👀','📍','🔹']],
  [/\bthem\b|\bthey\b/,['👥','👉','➡️','🔗']],
  [/\byou\b|\byour\b/,['👉','🏠','💬','📍']],
  [/\bto\b|\btoward\b|\btowards\b/,['➡️','👉','🛣️','🏠']],
  [/\bon\b|\bupon\b/,['⬆️','📍','🔝','🧱']]
];
const SMART_ART_FALLBACK=['🎯','💡','📖','🧩','🔎','🌟','📌','🧠','🎨','✅','➡️','👀'];

function hasOnlyGenericArt(art){
  return !Array.isArray(art)||!art.length||art.every(x=>GENERIC_ART_CHOICES.has(x));
}
function smartArtCandidatesFor(english='',front=''){
  const text=`${english} ${front}`.toLowerCase();
  const found=[];
  const add=v=>{if(v&&!found.includes(v))found.push(v)};
  SMART_ART_RULES.forEach(([re,choices])=>{if(re.test(text))choices.forEach(add)});
  // Keep the full pool here so Regenerate Pictures can deliberately choose
  // alternatives that are different from the pictures already on the word.
  return sanitizeClassArtPool(found);
}

function smartArtFor(english='',front=''){
  // Offline fallback must never pad with unrelated brain/lightbulb/arrow icons.
  return smartArtCandidatesFor(english,front).slice(0,4);
}
function hasBadAutoArt(item){
  const art=Array.isArray(item?.art)?item.art:[];
  // Anything created by our recent auto-art versions should be regenerated by AI.
  if(item?.autoArt===true) return true;
  // Old bulk imports used only these generic placeholders.
  if(!art.length || art.every(x=>GENERIC_ART_CHOICES.has(x))) return true;
  // Repair any already-saved picture choice that violates the class image rules.
  if(art.some(x=>!isClassSafeArtChoice(x))) return true;
  return false;
}

async function generateAiArtForItems(items){
  const clean=(items||[]).filter(Boolean).map(i=>({
    id:String(i.id||''),
    front:String(i.front||''),
    english:String(i.english||'')
  })).filter(i=>i.id&&i.english);
  if(!clean.length) return new Map();
  if(!GENERATE_SHORASHIM_ART_URL) return new Map();

  const out=new Map();
  // Batch requests so a large weekly upload does not create one AI call per word.
  for(let n=0;n<clean.length;n+=40){
    const batch=clean.slice(n,n+40);
    try{
      const res=await fetch(GENERATE_SHORASHIM_ART_URL,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({items:batch})
      });
      if(!res.ok) throw new Error(`AI art request failed (${res.status})`);
      const data=await res.json();
      for(const row of (data.items||[])){
        const art=sanitizeClassArt(row.art);
        if(row.id&&art.length) out.set(String(row.id),art);
      }
    }catch(err){
      console.warn('generateShorashimArt failed; using local fallback for this batch',err);
    }
  }
  return out;
}

async function fillArtForShorashim(items,{force=false}={}){
  const targets=(items||[]).filter(i=>force||hasBadAutoArt(i));
  if(!targets.length) return 0;
  const ai=await generateAiArtForItems(targets);
  let changed=0;
  for(const item of targets){
    let art=ai.get(String(item.id));
    // Offline/service fallback: use the local semantic rules rather than leaving a blank card.
    if(!art||!art.length) art=smartArtFor(item.english,item.front);
    if(art&&art.length){
      item.art=sanitizeClassArt(art);
      if(item.art.length){
        item.autoArt=false;       // finished AI/fallback result; do not regenerate every login
        item.aiArtGenerated=true;
        item.aiArtGeneratedAt=Date.now();
        changed++;
      }else{
        item.art=[];
        item.autoArt=true;
      }
    }else{
      // Keep it eligible for a future retry if both AI and local fallback fail.
      item.art=[];
      item.autoArt=true;
    }
  }
  return changed;
}

function splitKey(k){const i=k.indexOf(':');return[k.slice(0,i),k.slice(i+1)]}function itemFor(key){const[t,id]=splitKey(key);return(state.catalog[t]||[]).find(x=>x.id===id)||null}function fmtSec(sec){sec=Math.round(sec||0);const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60);return h?`${h}h ${m}m`:m?`${m}m`:`${sec}s`}function dateLabel(ts){if(!ts)return'Never';return new Date(ts).toLocaleString()}function today(){const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function learned(s,type){return Object.values(s.cards||{}).filter(c=>c.learnedAt&&(!type||c.itemType===type)&&itemFor(c.itemKey)&&!itemFor(c.itemKey).hidden)}function reviewDone(s){const r=s.dailyReview||{};const total=learned(s).length;const seen=r.date===today()?Object.keys(r.seen||{}).length:0;return{total,seen,complete:!!total&&r.date===today()&&seen>=total}}
function status(t,k=''){const e=$('teacherCloudStatus');e.textContent=t;e.className='cloud-status '+k}
async function loadAll(){
  status('☁️ Loading…','syncing');
  const[a,b,c,d]=await Promise.all([db.ref(`${ROOT}/catalog`).once('value'),db.ref(`${ROOT}/settings`).once('value'),db.ref(`${ROOT}/students`).once('value'),db.ref(`${ROOT}/leaderboards`).once('value')]);
  state.catalog=a.val()||state.catalog;
  state.settings={minReviewMs:500,studentSiteOpen:true,...(b.val()||{})};
  state.students=c.val()||{};
  state.leaderboards=d.val()||{};
  // Seed the Perek-unit catalog only once.  The version flag is stored in Firebase,
  // so a word deleted later stays deleted even after page reloads or file updates.
  const needsCatalogSeed=Number(state.settings.catalogSeedVersion||0)<CATALOG_SEED_VERSION;
  const p18Added=needsCatalogSeed?ensurePerek18FinalShorashim():[];
  const unitMigration=needsCatalogSeed?ensurePerekUnitsAnd19():{tagged:0,added:[]};
  if(needsCatalogSeed)state.settings.catalogSeedVersion=CATALOG_SEED_VERSION;
  const needsArt=(state.catalog.shorashim||[]).filter(hasBadAutoArt);
  let repaired=0;
  if(needsArt.length){
    status(`☁️ Creating picture choices for ${needsArt.length} word${needsArt.length===1?'':'s'}…`,'syncing');
    repaired=await fillArtForShorashim(needsArt);
  }
  if(repaired||p18Added.length||unitMigration.tagged||unitMigration.added.length) await db.ref(`${ROOT}/catalog`).set(state.catalog);
  if(needsCatalogSeed)await db.ref(`${ROOT}/settings/catalogSeedVersion`).set(CATALOG_SEED_VERSION);
  $('teacherMinReview').value=String(state.settings.minReviewMs||500);
  renderStudentSiteControl();
  renderAll();
  const updates=[];
  if(p18Added.length)updates.push(`${p18Added.length} Perek 18 word${p18Added.length===1?'':'s'} added`);
  if(unitMigration.tagged)updates.push(`${unitMigration.tagged} existing word${unitMigration.tagged===1?'':'s'} tagged Perek 18`);
  if(unitMigration.added.length)updates.push(`${unitMigration.added.length} Perek 19 word${unitMigration.added.length===1?'':'s'} added`);
  if(repaired)updates.push(`${repaired} picture set${repaired===1?'':'s'} created`);
  status(updates.length?`☁️ Connected • ${updates.join(' • ')}`:'☁️ Connected');
}
function renderAll(){renderDashboard();renderCatalog();renderLeaderboard()}
function renderDashboard(){const arr=Object.entries(state.students),total=arr.reduce((n,[,s])=>n+learned(s).length,0),done=arr.filter(([,s])=>reviewDone(s).complete).length,time=arr.reduce((n,[,s])=>n+(s.totalActiveSeconds||0),0);$('teacherStats').innerHTML=[['Students',arr.length],['Learned cards',total],['Class study time',fmtSec(time)],['Review complete today',`${done}/${arr.length}`]].map(([a,b])=>`<div class="tstat"><span>${a}</span><b>${b}</b></div>`).join('');const body=$('teacherStudentsBody');body.innerHTML='';arr.sort((a,b)=>(a[1].name||a[0]).localeCompare(b[1].name||b[0])).forEach(([id,s])=>{const r=reviewDone(s),tr=document.createElement('tr');tr.innerHTML=`<td><b>${esc(s.name||id)}</b></td><td>${learned(s,'shorashim').length}</td><td>${learned(s,'prefix').length+learned(s,'suffix').length}</td><td>${fmtSec(s.totalActiveSeconds)}</td><td>${r.total?`${r.seen}/${r.total}${r.complete?' ✓':''}`:'—'}</td><td>${dateLabel(s.lastActive)}</td>`;tr.onclick=()=>openStudent(id);body.appendChild(tr)})}
function openStudent(id){const s=state.students[id];if(!s)return;const cards=learned(s);$('studentDetail').classList.remove('hidden');$('studentDetail').innerHTML=`<div class="student-detail-head"><div><div class="eyebrow">Student details</div><h2>${esc(s.name||id)}</h2></div><button id="closeStudentCloud" class="ghost">Close</button></div><div class="teacher-grid">${[['Shorashim',learned(s,'shorashim').length],['Affixes',learned(s,'prefix').length+learned(s,'suffix').length],['Study time',fmtSec(s.totalActiveSeconds)],['Sessions',(s.sessions||[]).length+(s.activeSession?1:0)]].map(([a,b])=>`<div class="tstat"><span>${a}</span><b>${b}</b></div>`).join('')}</div><h3>Learning history</h3><div>${cards.slice().sort((a,b)=>b.learnedAt-a.learnedAt).map(c=>{const i=itemFor(c.itemKey);return`<div class="history-row-cloud"><b dir="rtl">${esc(i?.front||c.itemId)}</b><span>${esc(i?.english||'')}</span><span>${esc(c.itemType)}${c.itemType==='shorashim'&&i?` • ${perekLabel(i)}`:''}</span><span>${dateLabel(c.learnedAt)}</span></div>`}).join('')||'<p>No learned cards yet.</p>'}</div><h3>Card gallery</h3><div class="teacher-gallery">${cards.map(cardHTML).join('')}</div>`;$('closeStudentCloud').onclick=()=>$('studentDetail').classList.add('hidden');$('studentDetail').scrollIntoView({behavior:'smooth'})}
function cardHTML(c){const i=itemFor(c.itemKey);if(!i)return'';const d=c.design||{},arts=(d.arts||[]).map(a=>a.kind==='illustration'?`<div class="art" style="left:${a.left||50}%;top:${a.top||66}%;width:${(a.size||84)*.55}px;height:${(a.size||84)*.4}px"><img src="${esc(a.value)}"></div>`:`<div class="art" style="left:${a.left||50}%;top:${a.top||66}%;font-size:${(a.size||84)*.55}px">${a.value||''}</div>`).join('');return`<div class="teacher-card-mini"><div class="teacher-card-face" style="background:${d.backgroundColor||'#fff9e8'}"><div class="term" style="left:${d.hebrewPos?.left||50}%;top:${d.hebrewPos?.top||28}%;font-size:${Math.min(34,(d.hebrewSize||58)*.55)}px;color:${d.hebrewColor||'#222'}">${esc(i.front)}</div>${arts}${d.drawing?`<img class="drawing" src="${esc(d.drawing)}">`:''}</div><div class="teacher-card-meta">${esc(i.english)}${c.itemType==='shorashim'?` • ${perekLabel(i)}`:''} • ${dateLabel(c.learnedAt)}</div></div>`}
function listNameOf(i){return i.listName||'Main List'}
function namedLists(){
  state.settings.namedLists=state.settings.namedLists||{};
  const saved=Array.isArray(state.settings.namedLists[currentTrack])?state.settings.namedLists[currentTrack]:[];
  const fromItems=(state.catalog[currentTrack]||[]).map(listNameOf);
  return [...new Set(['Main List',...saved,...fromItems])].sort((a,b)=>a.localeCompare(b));
}
function refreshNamedLists(prefer){const sel=$('teacherListName');if(!sel)return;const names=namedLists();const wanted=prefer||sel.value||'Main List';sel.innerHTML=names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');sel.value=names.includes(wanted)?wanted:'Main List'}
function commonnessOf(item){const n=Number(item?.commonness??item?.commonnessScore??item?.frequency);return Number.isFinite(n)?Math.max(1,Math.min(10,Math.round(n))):null;}
function needsTeacherApproval(item){const n=commonnessOf(item);return currentTrack==='shorashim'&&n!==null&&n<=5;}
async function toggleTeacherApproval(id){const item=(state.catalog[currentTrack]||[]).find(x=>x.id===id);if(!item)return;item.teacherApproved=item.teacherApproved!==true;renderCatalog();await saveCatalog();}
function renderCatalog(){
  currentTrack=$('teacherTrack').value;
  refreshNamedLists();
  const chosen=$('teacherListName')?.value||'Main List',
        perekFilter=$('teacherPerekFilter')?.value||'all',
        all=state.catalog[currentTrack]||[],
        list=all.filter(i=>listNameOf(i)===chosen).filter(i=>currentTrack!=='shorashim'||perekFilter==='all'||perekOf(i)===Number(perekFilter));
  const perekWrap=$('teacherPerekWrap');if(perekWrap)perekWrap.classList.toggle('hidden',currentTrack!=='shorashim');

  $('teacherCatalog').innerHTML=list.map((i,idx)=>{
    const art=(Array.isArray(i.art)?i.art:[]).map(a=>`<button type="button" class="teacher-art-chip" data-a="art" data-art="${esc(a)}" title="Click to remove this picture">${esc(a)}</button>`).join('');
    const commonness=commonnessOf(i),approvalNeeded=needsTeacherApproval(i),approvalBlock=approvalNeeded?`<div class="approval-box ${i.teacherApproved===true?'approved':'pending'}"><b>Commonness ${commonness}/10</b> — ${i.teacherApproved===true?'Approved for students':'Waiting for your approval'}<button data-a="approve" class="${i.teacherApproved===true?'ghost':'primary'}">${i.teacherApproved===true?'Remove Approval':'✓ Approve Word'}</button></div>`:(commonness?`<div class="mini-note">Commonness ${commonness}/10 • Automatically included</div>`:'');
    const duplicateKeeper=duplicateKeeperFor(i),duplicateBlock=duplicateKeeper?`<div class="approval-box pending"><b>Possible duplicate</b> — another ${esc(i.front)} with the same English meaning (${esc(i.english)}) is already in this list. <button data-a="merge-duplicate" class="danger">Merge Duplicate</button> <button data-a="dismiss-duplicate" class="ghost">Dismiss Suggestion</button></div>`:'';
    const artBlock=currentTrack==='shorashim'
      ? `<div class="teacher-art-preview">${art||'<span class="mini-note">No pictures yet</span>'}</div>
         <div class="mini-actions">
           <button data-a="regen" class="ghost">↻ Regenerate Pictures</button>
         </div>`
      : '';

    return `<div class="catalog-teacher-row${i.hidden?' hidden-item':''}" data-id="${esc(i.id)}">
      <div class="mini-actions"><button data-a="up" ${idx===0?'disabled':''}>▲</button><button data-a="down" ${idx===list.length-1?'disabled':''}>▼</button></div>
      <div class="hebrew">${esc(i.front)}</div>
      <div>
        <b>${esc(i.english)}</b>
        <div class="mini-note">${currentTrack==='shorashim'?`<span class="unit-pill">${perekLabel(i)}</span> • `:''}${i.pasuk?`Pasuk ${esc(i.pasuk)} • `:''}${i.hidden?'Hidden from future learning':'Active'} • ${esc(chosen)}</div>
        ${approvalBlock}
        ${duplicateBlock}
        ${artBlock}
      </div>
      <div class="mini-actions">
        <button data-a="edit" class="ghost">Edit Word</button>
        <button data-a="hide" class="${i.hidden?'primary':'ghost'}">${i.hidden?'Restore':'Hide'}</button>
        <button data-a="delete" class="danger catalog-remove-btn">🗑 Delete</button>
      </div>
    </div>`;
  }).join('')||'<p class="mini-note">This list is empty.\nAdd an item or use Bulk Add.</p>';

  [...$('teacherCatalog').querySelectorAll('.catalog-teacher-row')].forEach(row=>{
    const id=row.dataset.id;
    row.querySelector('[data-a=up]').onclick=()=>moveNamed(id,-1);
    row.querySelector('[data-a=down]').onclick=()=>moveNamed(id,1);
    row.querySelector('[data-a=edit]').onclick=()=>openEdit(id);
    row.querySelector('[data-a=hide]').onclick=()=>toggleHide(id);
    row.querySelector('[data-a=delete]').onclick=()=>deleteCatalogItem(id);
    const approve=row.querySelector('[data-a=approve]');
    if(approve)approve.onclick=()=>toggleTeacherApproval(id);
    const mergeDuplicate=row.querySelector('[data-a=merge-duplicate]');
    if(mergeDuplicate)mergeDuplicate.onclick=()=>mergeDuplicateWord(id);
    const dismissDuplicate=row.querySelector('[data-a=dismiss-duplicate]');
    if(dismissDuplicate)dismissDuplicate.onclick=()=>dismissDuplicateSuggestion(id);
    const regen=row.querySelector('[data-a=regen]');
    if(regen) regen.onclick=()=>regeneratePictures(id);
    row.querySelectorAll('[data-a=art]').forEach(btn=>{
      btn.onclick=()=>removePictureChoice(id,btn.dataset.art);
    });
  });
}

async function regeneratePictures(id){
  const item=(state.catalog[currentTrack]||[]).find(x=>x.id===id);
  if(!item)return;

  const before=sanitizeClassArt(item.art||[]);
  status('☁️ Looking for different matching pictures…','syncing');

  // First ask the AI picture helper for a fresh semantic set.
  const ai=await generateAiArtForItems([item]);
  const aiChoices=sanitizeClassArtPool(ai.get(String(item.id))||[]);

  // Then add any locally-known semantic alternatives.  Most importantly,
  // remove pictures already showing before deciding whether regeneration worked.
  // This prevents the button from appearing to do nothing when AI repeats itself.
  const localChoices=smartArtCandidatesFor(item.english,item.front);
  const fresh=[];
  const addFresh=value=>{
    if(!value||before.includes(value)||fresh.includes(value))return;
    fresh.push(value);
  };
  aiChoices.forEach(addFresh);
  localChoices.forEach(addFresh);

  if(!fresh.length){
    item.autoArt=false;
    status('☁️ No different matching pictures found');
    alert(`No additional clear picture choices were found for “${item.front} — ${item.english}”.\n\nThe current pictures were kept.`);
    return;
  }

  // Put genuinely new choices first. If there are fewer than four good new
  // choices, keep the strongest existing choices at the end rather than padding
  // the set with unrelated symbols.
  const combined=[...fresh,...before.filter(x=>!fresh.includes(x))];
  item.art=sanitizeClassArt(combined);
  item.autoArt=false;
  item.aiArtGenerated=true;
  item.aiArtGeneratedAt=Date.now();

  renderCatalog();
  await saveCatalog();
  status(`☁️ Saved • ${Math.min(fresh.length,4)} new picture choice${Math.min(fresh.length,4)===1?'':'s'}`);
}

function englishDuplicateKey(value){
  return String(value||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
}
function duplicateKeeperFor(item){
  if(currentTrack!=='shorashim'||!item||item.duplicateSuggestionDismissed===true)return null;
  const list=state.catalog.shorashim||[], key=hebrewKey(item.front), englishKey=englishDuplicateKey(item.english);
  if(!key||!englishKey)return null;
  const itemIndex=list.findIndex(x=>x.id===item.id);
  if(itemIndex<=0)return null;
  // A suggestion is shown only on later appearances when BOTH the Hebrew and English match.
  for(let n=0;n<itemIndex;n++){
    const x=list[n];
    if(!x.hidden && listNameOf(x)===listNameOf(item) && hebrewKey(x.front)===key && englishDuplicateKey(x.english)===englishKey)return x;
  }
  return null;
}
async function dismissDuplicateSuggestion(id){
  const item=(state.catalog.shorashim||[]).find(x=>x.id===id);
  if(!item)return;
  item.duplicateSuggestionDismissed=true;
  renderCatalog();
  await saveCatalog();
  status(`☁️ Duplicate suggestion dismissed • ${item.front}`);
}

async function mergeDuplicateWord(duplicateId){
  const list=state.catalog.shorashim||[], duplicate=list.find(x=>x.id===duplicateId);
  if(!duplicate)return;
  const key=hebrewKey(duplicate.front), englishKey=englishDuplicateKey(duplicate.english);
  const duplicateIndex=list.findIndex(x=>x.id===duplicate.id);
  const keeper=list.slice(0,duplicateIndex).find(x=>!x.hidden && listNameOf(x)===listNameOf(duplicate) && hebrewKey(x.front)===key && englishDuplicateKey(x.english)===englishKey);
  if(!keeper)return alert('No matching duplicate was found.');
  if(!confirm(`Merge duplicate “${duplicate.front}” into the first copy?\n\nThe duplicate entry will be removed. Student learning history will be moved to the remaining copy.`))return;

  // Keep the strongest useful metadata from both copies.
  keeper.art=sanitizeClassArt([...(keeper.art||[]),...(duplicate.art||[])]);
  if(!keeper.english&&duplicate.english)keeper.english=duplicate.english;
  if(!keeper.hebrew&&duplicate.hebrew)keeper.hebrew=duplicate.hebrew;
  if(!keeper.pasuk&&duplicate.pasuk)keeper.pasuk=duplicate.pasuk;
  if(!keeper.perek&&duplicate.perek)keeper.perek=duplicate.perek;
  if(duplicate.teacherApproved===true)keeper.teacherApproved=true;
  if(Number(duplicate.commonness||0)>Number(keeper.commonness||0))keeper.commonness=duplicate.commonness;

  const oldKey=`shorashim:${duplicate.id}`, newKey=`shorashim:${keeper.id}`;
  for(const student of Object.values(state.students||{})){
    if(!student||!student.cards||!student.cards[oldKey])continue;
    const oldCard=student.cards[oldKey], newCard=student.cards[newKey];
    if(!newCard){
      student.cards[newKey]={...oldCard,itemKey:newKey,itemId:keeper.id};
    }else{
      const times=[newCard.learnedAt,oldCard.learnedAt].filter(Boolean);
      if(times.length)newCard.learnedAt=Math.min(...times);
    }
    delete student.cards[oldKey];
  }
  state.catalog.shorashim=list.filter(x=>x.id!==duplicate.id);
  status('☁️ Merging duplicate…','syncing');
  await Promise.all([
    db.ref(`${ROOT}/catalog`).set(state.catalog),
    db.ref(`${ROOT}/students`).set(state.students)
  ]);
  renderCatalog();
  status(`☁️ Duplicate merged • ${duplicate.front}`);
}

async function removePictureChoice(id,artValue){
  const item=(state.catalog[currentTrack]||[]).find(x=>x.id===id);
  if(!item)return;
  item.art=(Array.isArray(item.art)?item.art:[]).filter(x=>String(x)!==String(artValue));
  item.art=sanitizeClassArt(item.art);
  item.autoArt=false;
  renderCatalog();
  await saveCatalog();
}

async function moveNamed(id,dir){const all=state.catalog[currentTrack],chosen=$('teacherListName').value,pf=$('teacherPerekFilter')?.value||'all',list=all.filter(i=>listNameOf(i)===chosen).filter(i=>currentTrack!=='shorashim'||pf==='all'||perekOf(i)===Number(pf)),i=list.findIndex(x=>x.id===id),j=i+dir;if(i<0||j<0||j>=list.length)return;const ai=all.indexOf(list[i]),aj=all.indexOf(list[j]);[all[ai],all[aj]]=[all[aj],all[ai]];renderCatalog();await saveCatalog()}
async function saveCatalog(){status('☁️ Saving…','syncing');await db.ref(`${ROOT}/catalog`).set(state.catalog);status('☁️ Saved')}
async function move(id,dir){const l=state.catalog[currentTrack],i=l.findIndex(x=>x.id===id),j=i+dir;if(i<0||j<0||j>=l.length)return;[l[i],l[j]]=[l[j],l[i]];renderCatalog();await saveCatalog()}
async function toggleHide(id){const i=(state.catalog[currentTrack]||[]).find(x=>x.id===id);if(!i)return;if(!i.hidden&&!confirm(`Remove “${i.front}” from the student learning list?\n\nIt will no longer appear in future learning or review. Any existing student history will be kept, and you can Restore the item later.`))return;i.hidden=!i.hidden;renderCatalog();await saveCatalog()}
async function deleteCatalogItem(id){
  const list=state.catalog[currentTrack]||[],i=list.find(x=>x.id===id);
  if(!i)return;
  if(!confirm(`Permanently delete “${i.front}”?\n\nThis removes the word from Firebase. It will stay deleted after page reloads and future website-file updates. This cannot be undone.`))return;
  state.catalog[currentTrack]=list.filter(x=>x.id!==id);
  renderCatalog();
  await saveCatalog();
}
function openEdit(id=null){
  const i=id?(state.catalog[currentTrack]||[]).find(x=>x.id===id):null;
  $('tDialogTitle').textContent=i?'Edit Item':'Add Item';
  $('tEditId').value=i?.id||'';
  $('tListName').value=i?listNameOf(i):($('teacherListName')?.value||'Main List');
  const selectedPerek=$('teacherPerekFilter')?.value;
  $('tPerek').value=String(i?perekOf(i):(selectedPerek&&selectedPerek!=='all'?selectedPerek:19));
  $('tFront').value=i?.front||'';
  $('tEnglish').value=i?.english||'';
  $('tPasuk').value=i?.pasuk||'';
  $('tWord').value=i?.hebrew||'';
  $('tExamples').value=(i?.examples||[]).map(x=>`${x.hebrew} | ${x.english}`).join('\n');
  $('tWordWrap').classList.toggle('hidden',currentTrack!=='shorashim');
  $('tExamplesWrap').classList.toggle('hidden',currentTrack==='shorashim');
  $('tPerekWrap').classList.toggle('hidden',currentTrack!=='shorashim');
  $('teacherCatalogDialog').showModal();
}
async function saveEdit(e){
  e.preventDefault();
  const l=state.catalog[currentTrack],id=$('tEditId').value;
  let i=id?l.find(x=>x.id===id):null;
  if(!i){
    i={id:`custom-${currentTrack}-${Date.now()}`,art:[],autoArt:currentTrack==='shorashim',hidden:false};
    l.push(i);
  }
  i.listName=$('tListName').value.trim()||'Main List';
  const proposedFront=$('tFront').value.trim();
  if(currentTrack==='shorashim'){
    const clash=l.find(x=>x.id!==i.id && listNameOf(x)===i.listName && hebrewKey(x.front)===hebrewKey(proposedFront));
    if(clash){alert(`“${proposedFront}” is already in this list. Edit the existing copy instead of creating a duplicate.`);return;}
  }
  i.front=proposedFront;
  i.english=$('tEnglish').value.trim();
  i.pasuk=$('tPasuk').value.trim();
  if(currentTrack==='shorashim'){
    i.perek=Number($('tPerek').value)||18;
    i.hebrew=$('tWord').value.trim();
    // New words and edited meanings get fresh AI-selected picture choices.
    i.autoArt=true;
    status('☁️ Creating picture choices…','syncing');
    await fillArtForShorashim([i],{force:true});
  }else{
    if(!Array.isArray(i.art)||!i.art.length)i.art=['✨','⭐','🖍️'];
    i.examples=$('tExamples').value.split('\n').map(x=>x.trim()).filter(Boolean).map(line=>{const[a,...b]=line.split('|');return{hebrew:a.trim(),english:b.join('|').trim()}});
  }
  $('teacherCatalogDialog').close();
  renderCatalog();
  await saveCatalog();
}
function renderStudentSiteControl(){
  const btn=$('toggleStudentSite'), text=$('studentSiteStatusText');
  if(!btn||!text)return;
  const open=state.settings.studentSiteOpen!==false;
  text.textContent=open?'OPEN — students can use Shorashim right now.':'CLOSED — students cannot use Shorashim right now.';
  btn.textContent=open?'🔒 Close Student Website':'🔓 Open Student Website';
  btn.className=open?'danger':'primary';
  const wrap=btn.closest('.site-access-control');if(wrap)wrap.classList.toggle('closed',!open);
}
async function toggleStudentSite(){
  const currentlyOpen=state.settings.studentSiteOpen!==false;
  if(currentlyOpen&&!confirm('Close the Shorashim student website now? Students who are already using it will also be shown the closed screen.'))return;
  state.settings.studentSiteOpen=!currentlyOpen;
  renderStudentSiteControl();
  status('☁️ Saving…','syncing');
  await db.ref(`${ROOT}/settings/studentSiteOpen`).set(state.settings.studentSiteOpen);
  status('☁️ Saved');
}
async function loadAccess(){const[p,a]=await Promise.all([db.ref('posukPractice/settings/classPin').once('value'),db.ref('posukPractice/allowedStudents').once('value')]);$('accessPin').value=p.val()||'';renderRoster(a.val()||{})}
function renderRoster(v){const rows=Object.entries(v).map(([id,x])=>({id,name:x?.name||id})).sort((a,b)=>a.name.localeCompare(b.name));$('rosterList').innerHTML=rows.map(r=>`<div class="roster-row"><span>${esc(r.name)}</span><button class="danger small" data-remove="${esc(r.id)}">Remove</button></div>`).join('')||'<p>No approved students yet.</p>';[...$('rosterList').querySelectorAll('[data-remove]')].forEach(b=>b.onclick=async()=>{if(!confirm('Remove this student from approved access?'))return;await db.ref('posukPractice/allowedStudents/'+b.dataset.remove).remove();loadAccess()})}
function slug(n){return n.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')}
function renderLeaderboard(){const match=state.leaderboards.match||{};$('leaderboardTeacher').innerHTML=Object.keys(match).sort((a,b)=>Number(a)-Number(b)).map(k=>{const rows=Object.entries(match[k]||{}).map(([id,x])=>({id,...x})).filter(x=>Number.isFinite(Number(x.time))).sort((a,b)=>a.time-b.time);return`<h3>${esc(k)}-pair Match</h3>${rows.length?`<table class="teacher-table"><thead><tr><th>#</th><th>Student</th><th>Time</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.name||r.id)}</td><td>${(r.time/1000).toFixed(2)}s</td></tr>`).join('')}</tbody></table>`:'<p class="mini-note">No scores yet.</p>'}`}).join('')||'<p>No leaderboard scores yet.</p>'}
function bindTabs(){document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.teacher-tab').forEach(x=>x.classList.add('hidden'));$('tab-'+b.dataset.tab).classList.remove('hidden');if(b.dataset.tab==='access'){loadAccess();renderStudentSiteControl()}})}

$('teacherEnter').onclick=()=>{if($('teacherPasscode').value!==TEACHER_PASSCODE){$('teacherGateMsg').textContent='Incorrect passcode.';return}$('teacherGate').classList.add('hidden');$('teacherApp').classList.remove('hidden');sessionStorage.setItem('shorashimTeacher','1');loadAll()};
$('teacherPasscode').addEventListener('keydown',e=>{if(e.key==='Enter')$('teacherEnter').click()});
$('teacherLogout').onclick=()=>{sessionStorage.removeItem('shorashimTeacher');location.reload()};
$('teacherTrack').onchange=()=>{refreshNamedLists();renderCatalog()};
$('teacherListName').onchange=renderCatalog;
$('teacherPerekFilter').onchange=renderCatalog;
$('teacherNewList').onclick=async()=>{
  const n=prompt('Name the new learning list:');if(!n?.trim())return;
  const name=n.trim();state.settings.namedLists=state.settings.namedLists||{};
  const lists=Array.isArray(state.settings.namedLists[currentTrack])?state.settings.namedLists[currentTrack]:[];
  if(namedLists().some(x=>x.toLowerCase()===name.toLowerCase())){alert('A list with that name already exists.');refreshNamedLists(name);return}
  state.settings.namedLists[currentTrack]=[...lists,name];
  status('☁️ Saving…','syncing');await db.ref(`${ROOT}/settings`).set(state.settings);status('☁️ Saved');
  refreshNamedLists(name);renderCatalog();$('teacherListName').value=name;renderCatalog()
};
$('teacherBulkAdd').onclick=()=>{
  $('bulkListLabel').textContent=$('teacherListName').value||'Main List';
  const pf=$('teacherPerekFilter')?.value||'all';
  $('bulkPerekLabel').textContent=currentTrack==='shorashim'?(pf==='18'?'Perek י״ח':'Perek י״ט'):'';
  $('bulkPerekLabel').style.display=currentTrack==='shorashim'?'inline-block':'none';
  $('bulkItems').value='';
  $('teacherBulkDialog').showModal();
};
$('saveBulkItems').onclick=async e=>{
  e.preventDefault();
  const name=$('teacherListName').value||'Main List',
        lines=$('bulkItems').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),
        l=state.catalog[currentTrack],
        added=[];
  for(const line of lines){
    const parts=line.split('|').map(x=>x.trim());
    if(parts.length<2||!parts[0]||!parts[1])continue;
    const isShoreshim=currentTrack==='shorashim';
    if(isShoreshim && l.some(x=>listNameOf(x)===name && hebrewKey(x.front)===hebrewKey(parts[0])))continue;
    const item={
      id:`bulk-${currentTrack}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      listName:name,
      front:parts[0],
      english:parts[1],
      art:isShoreshim?[]:['✨','⭐','🖍️'],
      autoArt:isShoreshim,
      hidden:false
    };
    if(isShoreshim){
      const pf=$('teacherPerekFilter')?.value||'all';
      item.perek=pf==='18'?18:19;
      item.hebrew=parts[2]||parts[0];
      item.pasuk=parts[3]||'';
    }
    l.push(item);
    if(isShoreshim)added.push(item);
  }
  $('teacherBulkDialog').close();
  renderCatalog();
  if(added.length){
    status(`☁️ Creating pictures for ${added.length} new word${added.length===1?'':'s'}…`,'syncing');
    await fillArtForShorashim(added,{force:true});
  }
  await saveCatalog();
};
$('toggleStudentSite').onclick=toggleStudentSite;
$('teacherMinReview').onchange=async()=>{state.settings.minReviewMs=+$('teacherMinReview').value;await db.ref(`${ROOT}/settings`).set(state.settings)};
$('teacherAddItem').onclick=()=>openEdit();
$('tCancelItem').onclick=()=>$('teacherCatalogDialog').close();
$('cancelBulkItems').onclick=()=>$('teacherBulkDialog').close();
$('tSaveItem').onclick=saveEdit;
$('saveAccessPin').onclick=async()=>{await db.ref('posukPractice/settings/classPin').set($('accessPin').value.trim());$('accessPinMsg').textContent='Saved ✓'};
$('addAccessName').onclick=async()=>{const name=$('newAccessName').value.trim(),id=slug(name);if(!id)return;await db.ref('posukPractice/allowedStudents/'+id).set({name});$('newAccessName').value='';$('accessNameMsg').textContent='Added ✓';loadAccess()};
bindTabs();
if(sessionStorage.getItem('shorashimTeacher')==='1'){$('teacherGate').classList.add('hidden');$('teacherApp').classList.remove('hidden');loadAll()}

db.ref(ROOT).on('value',snap=>{
  if($('teacherApp').classList.contains('hidden'))return;
  const v=snap.val()||{};
  if(v.catalog)state.catalog=v.catalog;
  if(v.settings){state.settings={minReviewMs:500,studentSiteOpen:true,...v.settings};renderStudentSiteControl();}
  if(v.students)state.students=v.students;
  if(v.leaderboards)state.leaderboards=v.leaderboards;
  renderAll()
});
