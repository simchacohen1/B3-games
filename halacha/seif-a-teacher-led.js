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
      label: 'A boy is learning from a sefer.',
      src: 'assets/storybook/learning.webp',
      correct: false
    },
    {
      label: 'A boy is walking respectfully outside.',
      src: 'assets/storybook/walking.webp',
      correct: false,
    },
    {
      label: 'A boy is helping at home by cleaning the table.',
      src: 'assets/storybook/helping-at-home.webp',
      correct: false
    },
    {
      label: 'Two boys are having a kind, respectful conversation.',
      src: 'assets/storybook/respectful-conversation.webp',
      correct: false
    },
    {
      label: 'A boy pauses to remember the lesson while alone in his bedroom.',
      src: 'assets/storybook/remembering-while-alone.webp',
      correct: true
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
  function start() {
    const section = document.getElementById(ROOT_ID);
    if (!section || section.querySelector('.hal-a-panel')) return;
    if (!document.querySelector('link[data-hal-a-style]')) {
      const stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = 'seif-a-teacher-led.css?v=20261018-2';
      stylesheet.dataset.halAStyle = 'true';
      document.head.appendChild(stylesheet);
    }
    const panel = make('section', 'hal-a-panel');
    panel.setAttribute('aria-label', 'Learn Siman Aleph Seif Aleph with your teacher');
    const heading = make('div', 'hal-a-heading');
    const title = make('h2', '', 'סִימָן א׳ · סְעִיף א׳ — Learn Together');
    const hide = button('Hide Activity · Make room for my scrapbook', () => {
      const collapsed = panel.classList.toggle('hal-a-collapsed');
      hide.textContent = collapsed ? 'Show / Review Activity' : 'Hide Activity · Make room for my scrapbook';
      hide.setAttribute('aria-expanded', String(!collapsed));
      try { sessionStorage.setItem('halacha-learning-hidden:a:' + (document.body.classList.contains('teacherMode') ? 'teacher' : 'student'), String(collapsed)); } catch (_) {}
    });
    hide.setAttribute('aria-expanded', 'true');
    heading.append(title, hide);
    panel.appendChild(heading);

    const body = make('div', 'hal-a-body');
    const source = make('div', 'hal-a-source');
    const reading = document.createElement('details');
    reading.className = 'hal-a-reading';
    reading.open = true;
    const readingTitle = make('summary', '', 'Read the complete seif with your teacher');
    const fullText = make('p', 'hal-a-full-text', sourceText);
    fullText.lang = 'he';
    fullText.dir = 'rtl';
    reading.append(readingTitle, fullText);
    source.appendChild(reading);

    source.append(make('h3', '', 'Key Terms'));
    source.append(make('p', 'hal-a-note', 'Important phrases — tap a word to see its meaning.'));
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
      phraseList.appendChild(details);
    }
    source.appendChild(phraseList);
    body.appendChild(source);

    const quiz = make('section', 'hal-a-scenarios');
    quiz.setAttribute('aria-labelledby', 'hal-a-question-title');
    const qTitle = make('h3', '', 'Examples from Daily Life');
    qTitle.id = 'hal-a-question-title';
    quiz.append(qTitle, make('p', 'hal-a-question', 'Which picture shows the boy remembering the lesson when he is alone?'), make('p', 'hal-a-note', 'Look for the boy who pauses to remember what is right when nobody else is in the room.'));
    const feedback = make('p', 'hal-a-feedback', '');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    const choices = make('div', 'hal-a-choices');
    scenes.forEach((scene, index) => {
      const choice = button('', () => {
        feedback.textContent = scene.correct
          ? '✓ Yes! He remembers the lesson when he is alone.'
          : 'Try again. Find the boy alone in his bedroom, remembering the lesson.';
        feedback.classList.toggle('correct', scene.correct);
        choices.querySelectorAll('button').forEach(item => item.removeAttribute('aria-pressed'));
        choice.setAttribute('aria-pressed', String(scene.correct));
      });
      choice.classList.add('hal-a-choice');
      choice.setAttribute('aria-label', scene.label);
      choice.setAttribute('aria-pressed', 'false');
      const art = document.createElement('img');
      art.className = 'hal-a-scene-art';
      art.src = scene.src;
      art.alt = '';
      art.loading = 'eager';
      art.decoding = 'async';
      choice.append(art, make('span', 'hal-a-choice-label', `Picture ${index + 1}`));
      choices.appendChild(choice);
    });
    quiz.append(choices, feedback);
    body.appendChild(quiz);

    const prompt = make('section', 'hal-a-prompts');
    prompt.append(make('h3', '', 'Choose a scrapbook title'));
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
