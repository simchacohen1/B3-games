// Presentation only: reuse existing quiz, class, and launch handlers.
(() => {
  const $ = id => document.getElementById(id);
  function disclosure(title, parent, nodes) {
    const details = document.createElement('details');
    details.className = 'simple-options';
    const summary = document.createElement('summary');
    summary.textContent = title;
    details.append(summary);
    nodes.filter(Boolean).forEach(node => details.append(node));
    parent.append(details);
    return details;
  }
  const tabs = document.querySelector('.tabs');
  tabs.insertBefore($('tabSetup'), $('tabLive'));
  const more = document.createElement('details');
  more.className = 'menu section-more';
  more.innerHTML = '<summary>Reports ▾</summary><div class="menu-list"></div>';
  more.lastElementChild.append($('tabResults'), $('tabProgress'));
  tabs.append(more);
  for (const button of more.querySelectorAll('button')) {
    button.addEventListener('click', () => { more.open = false; });
  }

  const library = $('stepLibrary');
  const newCard = library.querySelector('.card');
  const newOptions = document.createElement('details');
  newOptions.className = 'new-quiz-options';
  newOptions.innerHTML = '<summary>+ New quiz</summary>';
  newOptions.append(newCard.querySelector('.start-tiles'));
  newCard.replaceWith(newOptions);
  const savedCard = library.querySelector('.quiz-grid');
  library.insertBefore(savedCard, newOptions);
  savedCard.querySelector('.small').textContent = 'Choose a quiz, then edit it or give it to your class.';
  $('quizSearch').setAttribute('aria-label', 'Search saved quizzes');

  function addQuizActions() {
    document.querySelectorAll('#quizList .quiz-item').forEach(item => {
      if (item.querySelector('.quiz-item-actions')) return;
      const load = item.onclick;
      item.onclick = null;
      const actions = document.createElement('div');
      actions.className = 'quiz-item-actions';
      for (const [label, style, assign] of [['Give to class', 'primary', true], ['Edit', 'secondary', false]]) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = style; button.textContent = label;
        button.setAttribute('aria-label', label + ': ' + item.querySelector('.quiz-item-title').textContent);
        button.onclick = () => { load.call(item); if (assign) { makeupSourceLaunchId = ''; selectDelivery('live'); showSetupStep('assign'); } };
        actions.append(button);
      }
      item.append(actions);
    });
  }
  const renderLibrary = window.renderQuizList;
  window.renderQuizList = function(...args) { const result = renderLibrary.apply(this, args); addQuizActions(); return result; };
  addQuizActions();
  const originalStep = window.showSetupStep;
  window.showSetupStep = function(step) {
    const result = originalStep(step);
    $('setupStepper').hidden = step === 'library';
    if (step !== 'library') newOptions.open = false;
    return result;
  };

  // Hide specialist launch options until requested, while retaining all inputs.
  const makeupCard = $('deliveryCardMakeup');
  const deliveryStep = makeupCard.closest('.launch-step');
  disclosure('Make-up test', deliveryStep, [makeupCard]);
  const targetPills = $('launchTargetPills');
  disclosure('Choose individual students', targetPills.parentElement, [targetPills]);
  const optionsStep = $('launchModeWrap').closest('.launch-step');
  optionsStep.querySelector('.step-title').textContent = 'How should questions appear?';
  const note = $('launchNote').closest('label');
  disclosure('Score, note & other options', optionsStep, [note, $('launchShowScore').closest('label'), $('launchTypeHelp')]);
  for (const id of ['modeSelect', 'launchMode']) {
    const select = $(id);
    select.options[0].textContent = 'Together — you choose the question';
    select.options[1].textContent = 'At their own pace — all questions available';
  }
  $('deliveryCardLive').querySelector('.launch-mode-desc').textContent = 'Run a class quiz together or let students answer at their own pace.';
  $('deliveryCardAnytime').querySelector('.launch-mode-desc').textContent = 'Leave a quiz available for students to complete independently.';

  const panel = $('panelLive');
  const topCard = panel.querySelector('.card');
  const actions = topCard.querySelector('.live-actions');
  const start = actions.querySelector('[onclick="startLaunch()"]');
  const finish = actions.querySelector('[onclick="stopLaunch()"]');
  const link = actions.querySelector('[onclick="copyStudentLink()"]');
  start.textContent = 'Start class quiz'; finish.textContent = 'Finish quiz';
  link.textContent = 'Copy student link';
  disclosure('Score & session options', topCard, [$('scoreReleaseBtn')]);
  const empty = document.createElement('div');
  empty.className = 'live-empty';
  empty.innerHTML = '<h2>Ready to give a quiz?</h2><p>Choose a saved quiz and use <b>Give to class</b>.</p><button type="button" class="primary btn-lg">Choose a quiz →</button>';
  empty.querySelector('button').onclick = () => { showTab('setup'); showSetupStep('library'); };
  topCard.append(empty);
  const questionCard = panel.querySelector('.question-card');
  const controls = questionCard.querySelector('.q-controls');
  const previous = controls.querySelector('[onclick="prevQuestion()"]');
  const next = controls.querySelector('[onclick="nextQuestion()"]');
  controls.insertBefore(next, controls.firstChild);
  disclosure('Question controls', questionCard, [previous, $('openBtn'), $('lockBtn'), $('questionStrip')]);
  const answersCard = $('liveGrid').closest('.card');
  function syncLive() {
    const ready = !!liveLaunch && liveQuestions().length > 0;
    const running = ready && !!liveLaunch.started;
    empty.hidden = ready;
    actions.hidden = !ready;
    topCard.querySelector('.simple-options').hidden = !ready;
    $('modeSelect').closest('label').hidden = !ready;
    questionCard.hidden = !running;
    answersCard.hidden = !running;
    start.hidden = running;
    finish.hidden = !running;
    $('liveStatus').hidden = !ready;
    $('liveQuizTitle').textContent = ready ? (liveLaunch.quizSnapshot.title || 'Class quiz') : 'Live Class';
    next.disabled = !running || currentQ >= liveQuestions().length - 1;
    previous.disabled = !running || currentQ <= 0;
    if (ready) next.textContent = liveLaunch.mode === 'test' ? 'Next question →' : 'Open next question →';
  }
  const originalLive = window.renderLive;
  window.renderLive = function(...args) { const result = originalLive.apply(this, args); syncLive(); return result; };
  const originalTab = window.showTab;
  window.showTab = function(name) { const result = originalTab(name); if (name === 'live') syncLive(); return result; };
  syncLive();
  showTab('setup');
  showSetupStep('library');
})();
