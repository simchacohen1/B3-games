/* Short, age-appropriate vocabulary introduced by the current Halacha lessons.
   Nekudot are included in the student-facing spelling. */
(function(root){
 const terms={
  emunah:['אֱמוּנָה','faith'],torah:['תּוֹרָה','Torah'],mitzvah:['מִצְוָה','mitzvah'],hashem:['ה׳','Hashem'],
  tefillah:['תְּפִלָּה','prayer'],kavvanah:['כַּוָּנָה','focus and meaning'],berakhah:['בְּרָכָה','blessing'],amen:['אָמֵן','Amen — truly'],
  shema:['שְׁמַע','Shema'],torahstudy:['לִמּוּד תּוֹרָה','Torah learning'],tehillim:['תְּהִלִּים','Psalms'],chatzos:['חֲצוֹת','midnight'],mishnah:['מִשְׁנָה','Mishnah'],neshamah:['נְשָׁמָה','soul'],
  netilah:['נְטִילַת יָדַיִם','washing hands'],ruach:['רוּחַ רָעָה','a harmful spirit'],kli:['כְּלִי','vessel'],yamin:['יָמִין','right'],smol:['שְׂמֹאל','left'],
  tznius:['צְנִיעוּת','modesty'],yiras:['יִרְאַת שָׁמַיִם','reverence for Hashem'],anavah:['עֲנָוָה','humility'],kavod:['כָּבוֹד','respect'],zehirus:['זְהִירוּת','carefulness'],
  nikayon:['נִקָּיוֹן','cleanliness'],privacy:['פְּרָטִיּוּת','privacy'],divrei:['דִּבְרֵי תּוֹרָה','words of Torah'],kedushah:['קְדֻשָּׁה','holiness'],
  asher:['אֲשֶׁר יָצַר','Who formed man'],shem:['שֵׁם שָׁמַיִם','Hashem’s Name'],safek:['סְפֵק בְּרָכוֹת','doubt about blessings'],
  hefsek:['הֶפְסֵק','an interruption'],meah:['מֵאָה בְּרָכוֹת','one hundred blessings'],kavodAdam:['כְּבוֹד הָאָדָם','human dignity'],
  four:['אַרְבַּע מִדּוֹת','four character traits'],oz:['עַז כַּנָּמֵר','brave like a leopard'],kal:['קַל כַּנֶּשֶׁר','light like an eagle'],raz:['רָץ כַּצְּבִי','run like a deer'],gibor:['גִּבּוֹר כָּאֲרִי','strong like a lion'],
  modeh:['מוֹדֶה אֲנִי','I thank You'],nigel:['נֶגְל וָאסֶר','morning handwashing'],chatzosTikkun:['תִּקּוּן חֲצוֹת','midnight prayer'],
  cleanliness:['פֶּה נָקִי','a clean mouth'],answer:['בָּרוּךְ הוּא וּבָרוּךְ שְׁמוֹ','Blessed is He and blessed is His Name'],
  shomer:['שׁוֹמֵר מִצְוָה','one who guards a mitzvah'],
 };
 const map={
  a:['emunah','hashem','mitzvah'],b:['modeh','neshamah','berakhah'],c:['four','oz','kal','raz','gibor'],d:['zehirus','mitzvah','torah'],e:['chatzosTikkun','mishnah','neshamah'],f:['nigel','netilah','kli'],
  a6:['torah','tehillim','torahstudy'],a7:['tefillah','berakhah','hashem'],
  s2a:['netilah','ruach','kedushah'],s2b:['netilah','kli','yamin'],s2c:['berakhah','kavvanah','safek'],s2d:['netilah','kli','kedushah'],
  s3a:['tznius','yiras','kavod'],s3b:['tznius','anavah','mitzvah'],s3c:['kavodAdam','anavah','kavod'],s3d:['yamin','smol','zehirus'],s3e:['kavod','zehirus','yiras'],
  s4a:['nikayon','kedushah','zehirus'],s4b:['tznius','privacy','kavod'],s4c:['nikayon','zehirus','kavod'],s4d:['divrei','torah','kedushah'],s4e:['nikayon','kedushah','zehirus'],s4f:['asher','berakhah','hashem'],
  s6a:['kavvanah','berakhah','tefillah'],s6b:['cleanliness','tehillim','tefillah'],s6c:['shem','kavod','kedushah'],s6d:['berakhah','hashem','kavvanah'],s6e:['shomer','mitzvah','berakhah'],s6f:['safek','berakhah','mitzvah'],s6g:['meah','berakhah','hashem'],s6h:['answer','amen','kavvanah'],s6i:['hefsek','berakhah','tefillah'],s6j:['amen','kavvanah','berakhah'],s6k:['amen','berakhah','yamin']
 };
 root.FTTHalachaVocabulary={terms,map,get(id){return (map[id]||['mitzvah','torah','hashem']).map((key,i)=>({id:'word:'+terms[key][0].normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('he'),hebrew:terms[key][0],english:terms[key][1],source:'halacha'}))}};
})(typeof window==='object'?window:globalThis);
