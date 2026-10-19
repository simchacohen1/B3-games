/* Teacher-led Siman Aleph, Seif Aleph lesson. The existing scrapbook remains the save owner. */
(function () {
  'use strict';
  const ROOT_ID = 'a';
  const ideas = [
    'How Should I Behave in Front of a King?',
    'What Should I Remember When I Wake Up?',
    'Does It Matter How I Behave When Nobody Is Watching?',
    'How Should I Act?',
    'Hashem Is Everywhere?',
    'Remembering Hashem Throughout My Day'
  ];
  const phrases = [
    { he: 'שִׁוִיתִי ה׳ לְנֶגְדִּי תָמִיד', words: [['שִׁוִיתִי', 'I keep in mind'], ['ה׳', 'Hashem'], ['לְנֶגְדִּי', 'before me'], ['תָמִיד', 'always']] },
    { he: 'מְלֹא כָל הָאָרֶץ כְּבוֹדוֹ', words: [['מְלֹא', 'fills'], ['כָל', 'all'], ['הָאָרֶץ', 'the earth'], ['כְּבוֹדוֹ', 'His glory']] }
  ];
  const scenes = [
    {
      label: 'A boy puts his toys away carefully at home, even when he is alone.',
      correct: true,
      svg: '<svg viewBox="0 0 240 150" role="img" aria-hidden="true"><rect x="13" y="15" width="214" height="122" rx="16" fill="#fff8e9"/><path d="M29 113h182" stroke="#c89a5b" stroke-width="5" stroke-linecap="round"/><rect x="39" y="38" width="53" height="49" rx="7" fill="#d8f1ff" stroke="#70a9c7" stroke-width="4"/><path d="M65 39v47M40 62h51" stroke="#70a9c7" stroke-width="3"/><circle cx="137" cy="52" r="18" fill="#f3c69b"/><path d="M119 50q0-27 24-25q17 2 17 24q-12-10-41 1" fill="#382f2b"/><path d="M125 72q12-10 25 0l11 35h-49z" fill="#477db4"/><path d="M133 103 123 122m25-19 13 19" stroke="#334b68" stroke-width="8" stroke-linecap="round"/><path d="m116 89-20 21m47-18 20 16" stroke="#f3c69b" stroke-width="7" stroke-linecap="round"/><rect x="82" y="105" width="36" height="22" rx="4" fill="#eaa84b"/><rect x="91" y="97" width="20" height="12" rx="3" fill="#ec6c68"/><path d="m82 106 18-8 18 8" fill="none" stroke="#a75c35" stroke-width="3"/></svg>'
    },
    {
      label: 'A boy leaves his toys scattered and speaks unkindly when no grown-up is watching.',
      correct: false,
      svg: '<svg viewBox="0 0 240 150" role="img" aria-hidden="true"><rect x="13" y="15" width="214" height="122" rx="16" fill="#f2f5fb"/><path d="M29 113h182" stroke="#aebbd0" stroke-width="5" stroke-linecap="round"/><rect x="39" y="38" width="53" height="49" rx="7" fill="#d8f1ff" stroke="#70a9c7" stroke-width="4"/><path d="M65 39v47M40 62h51" stroke="#70a9c7" stroke-width="3"/><circle cx="137" cy="52" r="18" fill="#f3c69b"/><path d="M119 50q0-27 24-25q17 2 17 24q-12-10-41 1" fill="#382f2b"/><path d="M125 72q12-10 25 0l11 35h-49z" fill="#a277b6"/><path d="M133 103 123 122m25-19 13 19" stroke="#46526a" stroke-width="8" stroke-linecap="round"/><path d="m116 89-20 12m47-9 20 12" stroke="#f3c69b" stroke-width="7" stroke-linecap="round"/><path d="m73 107 11-9 12 12-9 9zM166 116l11-10 11 12-10 9z" fill="#ec6c68" stroke="#a8464c" stroke-width="2"/><path d="m104 87 18-13" stroke="#db605c" stroke-width="3" stroke-linecap="round"/><path d="M113 78q8-8 15 0" fill="none" stroke="#db605c" stroke-width="3"/></svg>'
    }
  ];
  // Kitzur Shulchan Aruch 1:1, transcribed in full with nekudos from Beit Chabad.
  const sourceText = 'שִׁוִיתִי ה\' לְנֶגְדִּי תָמִיד, הוּא כְּלָל גָּדוֹל בַּתּוֹרָה וּבְמַעֲלוֹת הַצַּדִּיקִים אֲשֶׁר הוֹלְכִים לִפְנֵי הָאֱלֹהִים. כִּי אֵין יְשִׁיבַת הָאָדָם תְּנוּעָתוֹ וַעֲסָקָיו וְהוּא לְבַדּוֹ בְּבֵיתוֹ, כְּמוֹ יְשִׁיבָתוֹ וּתְנוּעָתוֹ וַעֲסָקָיו כַּאֲשֶׁר הוּא לִפְנֵי מֶלֶךְ גָּדוֹל. וְכֵן אֵין דִּבּוּרוֹ וְהַרְחָבַת פִּיו בִּהְיוֹתוֹ עִם אַנְשֵׁי בֵיתוֹ וּקְרוֹבָיו, כְּמוֹ בִהְיוֹתוֹ בְּמוֹשַׁב הַמֶּלֶךְ, כִּי אָז מַשְׁגִּיחַ בְּוַדַּאי עַל כָּל תְּנוּעוֹתָיו וְדִבּוּרָיו שֶׁיִּהְיוּ מְתֻקָּנִים כָּרָאוּי. כָּל שֶׁכֵּן כַּאֲשֶׁר יָשִׂים הָאָדָם אֶל לִבּוֹ כִּי הַמֶּלֶךְ הַגָּדוֹל הַקָּדוֹשׁ בָּרוּךְ הוּא אֲשֶׁר מְלֹא כָל הָאָרֶץ כְּבוֹדוֹ עוֹמֵד עָלָיו וְרוֹאֶה בְמַעֲשָׂיו, כְּמוֹ שֶׁנֶּאֱמַר, אִם יִסָּתֵר אִישׁ בַּמִּסְתָּרִים וַאֲנִי לֹא אֶרְאֶנּוּ נְאֻם ה\', הֲלוֹא אֶת הַשָּׁמַיִם וְאֶת הָאָרֶץ אֲנִי מָלֵא, בְּוַדַּאי מִיָּד תַּגִּיעַ אֵלָיו הַיִּרְאָה וְהַהַכְנָעָה מִפַּחַד הַשֵּׁם יִתְבָּרַךְ וְיֵבוֹשׁ מִמֶּנּוּ (אוֹרַח חַיִּים סָעִיף א).';

  function make(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(label, onClick) {
    const node = make('button', 'hal-a-btn', label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }
  function addTitle(value) {
    const title = String(value || '').trim();
    if (title && typeof window.add === 'function') {
      window.add(ROOT_ID, 'textbox', `<div class="tb-text" contenteditable="true" data-ph="Edit your title">${escapeText(title)}</div>`);
    }
  }
  function addScrapbookText(value, rightToLeft) {
    if (typeof HALACHA_TEACHER_VIEW !== 'undefined' && HALACHA_TEACHER_VIEW) return;
    if (typeof window.add !== 'function') return;
    const phrase = escapeText(String(value || '').trim());
    if (!phrase) return;
    const rtl = rightToLeft ? ' dir="rtl" lang="he"' : '';
    const e = window.add(ROOT_ID, 'textbox', '<div class="tb-text" contenteditable="true"'+rtl+'>'+phrase+'</div>');
    if (e) {
      e.classList.add('hal-lesson-text-piece');
      e.style.width = '280px';
      if (typeof window.persist === 'function') window.persist(ROOT_ID);
    }
  }
  function start() {
    const section = document.getElementById(ROOT_ID);
    if (!section || section.querySelector('.hal-a-panel')) return;
    if (!document.querySelector('link[data-hal-a-style]')) {
      const stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = 'seif-a-teacher-led.css?v=20261019-compact1';
      stylesheet.dataset.halAStyle = 'true';
      document.head.appendChild(stylesheet);
    }
    const panel = make('section', 'hal-a-panel');
    panel.setAttribute('aria-label', 'Learn Siman Aleph Seif Aleph with your teacher');
    const heading = make('div', 'hal-a-heading');
    const title = make('h2', '', 'סִימָן א׳ · סְעִיף א׳');
    const hide = button('Hide lesson', () => {
      const collapsed = panel.classList.toggle('hal-a-collapsed');
      hide.textContent = collapsed ? 'Show lesson' : 'Hide Activity · Make room for my scrapbook';
      hide.setAttribute('aria-expanded', String(!collapsed));
      try { sessionStorage.setItem('halacha-learning-hidden:a:' + (document.body.classList.contains('teacherMode') ? 'teacher' : 'student'), String(collapsed)); } catch (_) {}
    });
    hide.setAttribute('aria-expanded', 'true');
    const jumps = make('nav', 'hal-a-jumps');
    jumps.setAttribute('aria-label', 'Jump to Halacha section');
    jumps.append(
      button('🖼 Pictures', () => section.querySelector('.hal-story-gallery, .hal-a-scenarios')?.scrollIntoView({behavior:'smooth',block:'start'})),
      button('🎨 Scrapbook', () => section.querySelector('.work')?.scrollIntoView({behavior:'smooth',block:'start'}))
    );
    heading.append(title, jumps, hide);
    panel.appendChild(heading);

    const body = make('div', 'hal-a-body');
    const source = make('div', 'hal-a-source');
    const reading = document.createElement('details');
    reading.className = 'hal-a-reading';
    reading.open = false;
    const readingTitle = make('summary', '', '📖 Full Kitzur text — click to read');
    const fullText = make('p', 'hal-a-full-text');
    fullText.lang = 'he';
    fullText.dir = 'rtl';
    // Highlight exact words IN the source text, preserving the original nekudos.
    const startFirst = sourceText.indexOf('שִׁוִיתִי');
    const endFirst = sourceText.indexOf('תָמִיד', startFirst) + 'תָמִיד'.length;
    const startSecond = sourceText.indexOf('מְלֹא כָל הָאָרֶץ כְּבוֹדוֹ');
    const matches = [
      { start: startFirst, end: endFirst, label: 'shivisi' },
      { start: startSecond, end: startSecond + 'מְלֹא כָל הָאָרֶץ כְּבוֹדוֹ'.length, label: 'melo' }
    ].filter(m => m.start >= 0 && m.end > m.start).sort((a,b)=>a.start-b.start);
    let from = 0;
    matches.forEach((hit) => {
      fullText.appendChild(document.createTextNode(sourceText.slice(from,hit.start)));
      const marked = make('mark', 'hal-a-source-mark hal-a-mark-' + hit.label, sourceText.slice(hit.start,hit.end));
      marked.id = 'hal-a-source-' + hit.label;
      marked.setAttribute('title', 'Important phrase from this seif');
      fullText.appendChild(marked);
      from = hit.end;
    });
    fullText.appendChild(document.createTextNode(sourceText.slice(from)));
    reading.append(readingTitle, fullText);
    source.appendChild(make('p', 'hal-a-short-intro', 'Remembering Hashem helps us speak and behave carefully — at home, outside and when alone.'));
    source.appendChild(reading);
    const useThought = button('＋ Put this idea in my scrapbook', () => addScrapbookText('Remembering Hashem helps me act with care wherever I am.'));
    useThought.classList.add('hal-a-add-text');
    source.appendChild(useThought);
    source.append(make('h3', '', 'Important phrases — tap a word to see its meaning'));
    const phraseList = make('div', 'hal-a-phrase-list');
    for (const phrase of phrases) {
      const details = make('details', 'hal-a-phrase');
      details.open = true;
      details.dir = 'rtl';
      details.appendChild(make('summary', '', phrase.he));
      const words = make('div', 'hal-a-words');
      words.dir = 'rtl';
      for (const [he, en] of phrase.words) {
        const chip = button(he, () => {
          const translated = chip.getAttribute('aria-pressed') === 'true';
          chip.textContent = translated ? he : `${he} · ${en}`;
          chip.setAttribute('aria-pressed', String(!translated));
        });
        chip.lang = 'he';
        chip.dir = 'rtl';
        chip.setAttribute('aria-pressed', 'false');
        chip.setAttribute('aria-label', `${he}, tap to ${en}`);
        words.appendChild(chip);
      }
      details.appendChild(words);
      const phraseKey = phrase.he.includes('שִׁוִיתִי') ? 'shivisi' : 'melo';
      const findSource = button('🔎 Find in the seif', () => {
        reading.open = true;
        const target = fullText.querySelector('#hal-a-source-' + phraseKey);
        if (target) {
          target.scrollIntoView({behavior: 'smooth', block: 'center'});
          target.classList.add('hal-a-source-found');
          setTimeout(() => target.classList.remove('hal-a-source-found'), 1800);
        }
      });
      findSource.classList.add('hal-a-find-source');
      details.appendChild(findSource);
      const savePhrase = button('＋ Add this phrase to my scrapbook', () => addScrapbookText(phrase.he, true));
      savePhrase.classList.add('hal-a-add-text');
      details.appendChild(savePhrase);
      phraseList.appendChild(details);
    }
    source.appendChild(phraseList);
    body.appendChild(source);

    const quiz = make('section', 'hal-a-scenarios');
    quiz.setAttribute('aria-labelledby', 'hal-a-question-title');
    const qTitle = make('h3', '', 'Which picture shows the lesson?');
    qTitle.id = 'hal-a-question-title';
    const quizBody = make('details', 'hal-a-quiz-details');
    quizBody.appendChild(make('summary', '', '❓ Try a picture question'));
    quizBody.append(qTitle, make('p', 'hal-a-note', 'We try to act thoughtfully at home and at school, even when we are alone.'));
    const feedback = make('p', 'hal-a-feedback', '');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    const choices = make('div', 'hal-a-choices');
    scenes.forEach((scene, index) => {
      const choice = button('', () => {
        feedback.textContent = scene.correct
          ? '✓ Yes! We remember the lesson even when nobody else is watching.'
          : 'Try again. Which picture shows careful behavior when the boy is alone?';
        feedback.classList.toggle('correct', scene.correct);
        choices.querySelectorAll('button').forEach(item => item.removeAttribute('aria-pressed'));
        choice.setAttribute('aria-pressed', String(scene.correct));
      });
      choice.classList.add('hal-a-choice');
      choice.setAttribute('aria-label', scene.label);
      choice.setAttribute('aria-pressed', 'false');
      const art = make('span', 'hal-a-scene-art');
      art.innerHTML = scene.svg;
      choice.append(art, make('span', 'hal-a-choice-label', `Picture ${index + 1}`));
      choices.appendChild(choice);
    });
    quizBody.append(choices, feedback);
    quiz.appendChild(quizBody);
    body.appendChild(quiz);

    const prompt = make('details', 'hal-a-prompts');
    prompt.appendChild(make('summary', '', '✏️ Add a title to my scrapbook'));
    prompt.append(make('p', 'hal-a-note', 'Pick a title and edit it on your page, or write your own. Your artwork stays yours to create.'));
    const menu = make('div', 'hal-a-prompt-grid');
    ideas.forEach(idea => menu.appendChild(button(idea, () => addTitle(idea))));
    const custom = make('input', 'hal-a-custom');
    custom.type = 'text';
    custom.maxLength = 90;
    custom.placeholder = 'My own scrapbook title';
    custom.setAttribute('aria-label', 'My own scrapbook title');
    menu.append(custom, button('Add my title', () => addTitle(custom.value)));
    prompt.appendChild(menu);
    body.appendChild(prompt);

    const notes = make('details', 'hal-a-teacher-notes teacherOnly');
    notes.appendChild(make('summary', '', '💡 Optional teacher discussion notes'));
    const noteList = make('ul', '');
    [
      'Compare how we sit, move, speak, and act when alone with how we would behave before an important person.',
      'Ask: What can help us choose kind, careful actions when nobody else is in the room?',
      'Keep the conversation focused on the idea of remembering Hashem; no picture represents Hashem.'
    ].forEach(note => noteList.appendChild(make('li', '', note)));
    notes.appendChild(noteList);
    body.appendChild(notes);
    panel.appendChild(body);
    const anchor = section.querySelector('.work');
    section.insertBefore(panel, anchor || section.firstChild);
    try {
      const mode = document.body.classList.contains('teacherMode') ? 'teacher' : 'student';
      if (sessionStorage.getItem(`halacha-learning-hidden:a:${mode}`) === 'true') {
        panel.classList.add('hal-a-collapsed');
        hide.textContent = 'Show / Review Activity';
        hide.setAttribute('aria-expanded', 'false');
      }
    } catch (_) {}
  }
  function escapeText(value) {
    return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
