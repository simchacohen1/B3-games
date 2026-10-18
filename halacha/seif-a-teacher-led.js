/* Halacha Seif Alef teacher-led prototype. Additive to legacy scrapbook; no changes to save/auth paths. */
(function () {
  'use strict';
  const ROOT_ID = 'a';
  const ideas = [
    'How Should I Behave in Front of a King?',
    'What Should I Remember When I Wake Up?',
    'Does It Matter How I Behave When Nobody Is Watching?',
    'Remembering Hashem Throughout My Day'
  ];
  const phrases = [
    {he:'שִׁוִּיתִי ה׳ לְנֶגְדִּי תָמִיד',words:[['שִׁוִּיתִי','I place / keep in mind'],['ה׳','Hashem'],['לְנֶגְדִּי','before me'],['תָמִיד','always']]},
    {he:'מְלֹא כָל הָאָרֶץ כְּבוֹדוֹ',words:[['מְלֹא','fills'],['כָל','all'],['הָאָרֶץ','the earth'],['כְּבוֹדוֹ','His glory']]}
  ];
  function make(tag, cls, text) {
    const node=document.createElement(tag);
    if(cls) node.className=cls;
    if(text!==undefined) node.textContent=text;
    return node;
  }
  function button(label,onClick) {
    const node=make('button','hal-a-btn',label);
    node.type='button';node.addEventListener('click',onClick);return node;
  }
  function start(){
    const section=document.getElementById(ROOT_ID);
    if(!section || section.querySelector('.hal-a-panel')) return;
    const panel=make('section','hal-a-panel');
    panel.setAttribute('aria-label','Learn Seif Alef with your teacher');
    const heading=make('div','hal-a-heading');
    const title=make('h2','', 'סימן א׳ · סעיף א׳ — Learn Together');
    const hide=button('Hide learning · Make room for my scrapbook',()=>{
      const collapsed=panel.classList.toggle('hal-a-collapsed');
      hide.textContent=collapsed?'Show / Review learning':'Hide learning · Make room for my scrapbook';
      hide.setAttribute('aria-expanded',String(!collapsed));
    });
    hide.setAttribute('aria-expanded','true');
    heading.append(title,hide);panel.appendChild(heading);
    const body=make('div','hal-a-body');
    const source=make('div','hal-a-source');
    source.append(make('h3','', 'Read and discuss'));
    // Kitzur Shulchan Aruch 1:1, vowelized text: he.chabad.org/library/article_cdo/aid/4298075
    const fullText=make('p','hal-a-full-text',"שִׁוִיתִי ה' לְנֶגְדִּי תָמִיד, הוּא כְּלָל גָּדוֹל בַּתּוֹרָה וּבְמַעֲלוֹת הַצַּדִּיקִים אֲשֶׁר הוֹלְכִים לִפְנֵי הָאֱלֹהִים. כִּי אֵין יְשִׁיבַת הָאָדָם תְּנוּעָתוֹ וַעֲסָקָיו וְהוּא לְבַדּוֹ בְּבֵיתוֹ, כְּמוֹ יְשִׁיבָתוֹ וּתְנוּעָתוֹ וַעֲסָקָיו כַּאֲשֶׁר הוּא לִפְנֵי מֶלֶךְ גָּדוֹל. וְכֵן אֵין דִּבּוּרוֹ וְהַרְחָבַת פִּיו בִּהְיוֹתוֹ עִם אַנְשֵׁי בֵיתוֹ וּקְרוֹבָיו, כְּמוֹ בִהְיוֹתוֹ בְּמוֹשַׁב הַמֶּלֶךְ, כִּי אָז מַשְׁגִּיחַ בְּוַדַּאי עַל כָּל תְּנוּעוֹתָיו וְדִבּוּרָיו שֶׁיִּהְיוּ מְתֻקָּנִים כָּרָאוּי. כָּל שֶׁכֵּן כַּאֲשֶׁר יָשִׂים הָאָדָם אֶל לִבּוֹ כִּי הַמֶּלֶךְ הַגָּדוֹל הַקָּדוֹשׁ בָּרוּךְ הוּא אֲשֶׁר מְלֹא כָל הָאָרֶץ כְּבוֹדוֹ עוֹמֵד עָלָיו וְרוֹאֶה בְמַעֲשָׂיו, כְּמוֹ שֶׁנֶּאֱמַר, אִם יִסָּתֵר אִישׁ בַּמִּסְתָּרִים וַאֲנִי לֹא אֶרְאֶנּוּ נְאֻם ה', הֲלוֹא אֶת הַשָּׁמַיִם וְאֶת הָאָרֶץ אֲנִי מָלֵא, בְּוַדַּאי מִיָּד תַּגִּיעַ אֵלָיו הַיִּרְאָה וְהַהַכְנָעָה מִפַּחַד הַשֵּׁם יִתְבָּרַךְ וְיֵבוֹשׁ מִמֶנּוּ.");
    fullText.lang='he';fullText.dir='rtl';
    fullText.style.cssText='font-size:clamp(21px,2.2vw,29px);line-height:2;text-align:right;direction:rtl;padding:14px 16px;border-radius:12px;background:#fffaf0;white-space:normal';
    source.append(fullText);
    source.append(make('h3','', 'Important phrases — tap to learn the words'));
    for(const phrase of phrases){
      const details=make('details','hal-a-phrase');
      const summary=make('summary','',phrase.he);
      details.appendChild(summary);
      const words=make('div','hal-a-words');
      for(const [he,en] of phrase.words){
        const chip=button(he,()=>{ chip.textContent=chip.textContent===he?he+' — '+en:he; });
        chip.lang='he';chip.dir='rtl';chip.title='Tap to see the meaning';
        words.appendChild(chip);
      }
      details.appendChild(words);source.appendChild(details);
    }
    body.appendChild(source);
    const quiz=make('div','hal-a-scenarios');
    quiz.append(make('h3','', 'Which picture shows the lesson?'));
    quiz.append(make('p','hal-a-note','Talk about the choices with your teacher, then select one.'));
    const feedback=make('p','hal-a-feedback','');feedback.setAttribute('role','status');
    const choices=[
      {picture:'🧒 📖',label:'A boy learns quietly even when nobody watches',correct:true},
      {picture:'🧒 👀 🎭',label:'A boy behaves only when his teacher is looking',correct:false}
    ];
    choices.forEach(c=>{
      const b=button(c.picture+'  '+c.label,()=>{
        feedback.textContent=c.correct?'✓ Yes! We remember Hashem even when nobody else can see us.':'Try again. Would our behavior change when nobody is watching?';
        feedback.classList.toggle('correct',c.correct);
      });b.classList.add('hal-a-choice');quiz.appendChild(b);
    });
    quiz.appendChild(feedback);body.appendChild(quiz);
    const prompt=make('div','hal-a-prompts');
    prompt.append(make('h3','','Choose a scrapbook idea'));
    prompt.append(make('p','hal-a-note','Choose a title to put on your page, or create your own. Pictures are never added automatically.'));
    const menu=make('div','hal-a-prompt-grid');
    ideas.forEach(t=>menu.appendChild(button(t,()=>window.add(ROOT_ID,'text',escapeText(t)))));
    const custom=make('input','hal-a-custom');
    custom.type='text';custom.maxLength=90;custom.placeholder='My own scrapbook title';
    menu.append(custom,button('Add my title',()=>{const s=custom.value.trim();if(s)window.add(ROOT_ID,'text',escapeText(s));}));
    prompt.appendChild(menu);body.appendChild(prompt);
    const note=make('p','hal-a-note','Decorations and scrapbook editing are available before or after answering. You can review this lesson whenever you wish.');
    body.appendChild(note);
    panel.appendChild(body);
    const anchor=section.querySelector('.work');
    section.insertBefore(panel,anchor||section.firstChild);
  }
  function escapeText(s){return String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start);
  else start();
})();
