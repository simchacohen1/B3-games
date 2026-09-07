/*
  B3 Weekly Quiz - Score Release Patch

  Add this file to the same /quiz/ folder as index.html and teacher.html.
  Then add this line immediately before </body> in BOTH files:

    <script src="weekly-quiz-score-release.js"></script>

  Behavior:
  - New launches default to hiding the student's score.
  - Teacher can choose "Show score when finished" before launching.
  - Teacher can change the setting live at any time.
  - Completed students instantly see the final adjusted score when released.
  - Retakes inherit the score-release setting from the original launch.
  - Old launches with no showScore field are treated as hidden.
*/
(function () {
  'use strict';

  function installTeacherPatch() {
    if (typeof launchSelectedQuiz !== 'function' || typeof db === 'undefined') return;

    // ---------- Launch-time setting (OFF by default) ----------
    const launchMsgEl = document.getElementById('launchMsg');
    const launchCard = launchMsgEl && launchMsgEl.closest('.card');
    const launchControls = launchCard && launchCard.querySelector('.launch-controls');

    if (launchControls && !document.getElementById('launchShowScore')) {
      const scoreSetting = document.createElement('div');
      scoreSetting.id = 'launchScoreSetting';
      scoreSetting.className = 'info-box';
      scoreSetting.style.margin = '10px 0';
      scoreSetting.innerHTML =
        '<label style="display:flex;align-items:center;gap:9px;font-weight:800;color:var(--ink);cursor:pointer;">' +
          '<input type="checkbox" id="launchShowScore" style="width:18px;height:18px;">' +
          '<span>Show score when finished</span>' +
        '</label>' +
        '<div style="margin-top:5px;">Off by default. You can also release or hide the score later from the Live Quiz tab.</div>';
      launchControls.parentNode.insertBefore(scoreSetting, launchControls);
    }

    const originalLaunchSelectedQuiz = launchSelectedQuiz;
    launchSelectedQuiz = async function () {
      const classIdEl = document.getElementById('launchClass');
      const classId = classIdEl ? classIdEl.value : '';
      const scoreBox = document.getElementById('launchShowScore');
      const showScore = !!(scoreBox && scoreBox.checked);

      const result = await originalLaunchSelectedQuiz.apply(this, arguments);

      // The original launcher creates the launch first and then makes it active.
      // Read that active launch id and attach the score-release choice to it.
      try {
        if (classId) {
          const activeSnap = await db.ref('b3Quiz/settings/activeLaunchByClass/' + classId).once('value');
          const launchId = activeSnap.val();
          if (launchId) {
            await db.ref('b3Quiz/launches/' + launchId + '/showScore').set(showScore);
          }
        }
      } catch (err) {
        console.warn('Could not save score-release setting for new launch:', err);
      }

      return result;
    };

    // ---------- Live toggle: teacher can release/hide scores at any time ----------
    const liveControls = document.querySelector('#panelLive .card .topline .controls');
    let liveScoreButton = document.getElementById('liveScoreReleaseBtn');

    if (liveControls && !liveScoreButton) {
      liveScoreButton = document.createElement('button');
      liveScoreButton.id = 'liveScoreReleaseBtn';
      liveScoreButton.type = 'button';
      liveScoreButton.className = 'secondary';
      liveScoreButton.textContent = 'Score hidden after finish';
      liveScoreButton.title = 'Students only see their total after completing the test.';
      liveControls.appendChild(liveScoreButton);

      liveScoreButton.onclick = async function () {
        try {
          if (typeof activeLaunchId === 'undefined' || !activeLaunchId) return;
          const currentlyShown = !!(typeof liveLaunch !== 'undefined' && liveLaunch && liveLaunch.showScore === true);
          await db.ref('b3Quiz/launches/' + activeLaunchId + '/showScore').set(!currentlyShown);
        } catch (err) {
          console.warn('Could not change score-release setting:', err);
        }
      };
    }

    function syncLiveScoreButton() {
      const btn = document.getElementById('liveScoreReleaseBtn');
      if (!btn) return;

      let launch = null;
      let launchId = '';
      try {
        launch = (typeof liveLaunch !== 'undefined') ? liveLaunch : null;
        launchId = (typeof activeLaunchId !== 'undefined') ? activeLaunchId : '';
      } catch (err) {
        launch = null;
        launchId = '';
      }

      const shown = !!(launch && launch.showScore === true);
      btn.disabled = !launch || !launchId;
      btn.textContent = shown ? 'Score visible after finish' : 'Score hidden after finish';
      btn.className = shown ? 'good' : 'secondary';
      btn.title = shown
        ? 'Completed students can see their score. Click to hide it.'
        : 'Completed students cannot see their score. Click to release it.';
    }

    if (typeof renderLive === 'function') {
      const originalRenderLive = renderLive;
      renderLive = function () {
        const result = originalRenderLive.apply(this, arguments);
        syncLiveScoreButton();
        return result;
      };
    }

    // ---------- Retakes inherit the original launch's score-release choice ----------
    if (typeof launchRetake === 'function') {
      const originalLaunchRetake = launchRetake;
      launchRetake = async function (studentId) {
        let inheritedShowScore = false;
        try {
          if (typeof allLaunches !== 'undefined' && typeof resultsLaunchId !== 'undefined') {
            const base = allLaunches[resultsLaunchId];
            inheritedShowScore = !!(base && base.showScore === true);
          }
        } catch (err) {
          inheritedShowScore = false;
        }

        const result = await originalLaunchRetake.apply(this, arguments);

        try {
          const activeSnap = await db.ref('b3Quiz/settings/studentActiveLaunch/' + studentId).once('value');
          const retakeLaunchId = activeSnap.val();
          if (retakeLaunchId) {
            await db.ref('b3Quiz/launches/' + retakeLaunchId + '/showScore').set(inheritedShowScore);
          }
        } catch (err) {
          console.warn('Could not copy score-release setting to retake:', err);
        }

        return result;
      };
    }

    try { syncLiveScoreButton(); } catch (err) { /* no active launch yet */ }
  }

  function installStudentPatch() {
    if (typeof render !== 'function' || typeof getQuestions !== 'function' || typeof responseFor !== 'function') return;

    function ensureCompletionUi() {
      const card = document.getElementById('completeCard');
      if (!card) return null;

      let title = document.getElementById('completeTitle');
      if (!title) {
        title = card.querySelector('.big');
        if (title) title.id = 'completeTitle';
      }

      let score = document.getElementById('completedScore');
      if (!score) {
        score = document.createElement('div');
        score.id = 'completedScore';
        score.className = 'hidden';
        score.style.fontSize = '36px';
        score.style.fontWeight = '900';
        score.style.color = 'var(--good)';
        score.style.marginTop = '12px';
        card.insertBefore(score, title ? title.nextSibling : card.firstChild);
      }

      let detail = document.getElementById('completedDetail');
      if (!detail) {
        const candidates = Array.from(card.children).filter(function (el) {
          return el !== title && el !== score;
        });
        detail = candidates[0] || document.createElement('div');
        detail.id = 'completedDetail';
        detail.style.marginTop = '8px';
        detail.style.color = 'var(--muted)';
        if (!detail.parentNode) card.appendChild(detail);
      }

      return { card: card, title: title, score: score, detail: detail };
    }

    function updateCompletionScore() {
      try {
        const questions = getQuestions();
        if (!questions || !questions.length) return;

        let launch = null;
        try { launch = (typeof launchData !== 'undefined') ? launchData : null; } catch (err) { launch = null; }
        if (!launch) return;

        const mode = launch.mode || 'paced';
        const answeredCount = questions.reduce(function (count, _, i) {
          return count + (responseFor(i) ? 1 : 0);
        }, 0);

        // Preserve the existing app behavior: the completion card is used in open-test mode.
        if (mode !== 'test' || answeredCount !== questions.length) return;

        const ui = ensureCompletionUi();
        if (!ui) return;

        if (ui.title) ui.title.textContent = 'Test submitted.';
        ui.card.classList.remove('hidden');

        const showScore = launch.showScore === true;
        if (!showScore) {
          ui.score.textContent = '';
          ui.score.classList.add('hidden');
          ui.detail.textContent = 'Your answers are recorded.';
          return;
        }

        const correct = questions.reduce(function (count, _, i) {
          const r = responseFor(i);
          return count + (r && r.correct === true ? 1 : 0);
        }, 0);
        const total = questions.length;
        const pct = total ? Math.round((correct / total) * 100) : 0;

        ui.score.textContent = correct + ' / ' + total + ' — ' + pct + '%';
        ui.score.classList.remove('hidden');
        ui.detail.textContent = 'Your score is ready.';
      } catch (err) {
        console.warn('Could not render released student score:', err);
      }
    }

    const originalRender = render;
    render = function () {
      const result = originalRender.apply(this, arguments);
      updateCompletionScore();
      return result;
    };

    // Handles the case where the page already rendered before this patch loaded.
    try { updateCompletionScore(); } catch (err) { /* not ready yet */ }
  }

  // The same patch file is safe to load on both pages.
  try {
    if (document.getElementById('panelSetup')) installTeacherPatch();
    if (document.getElementById('completeCard')) installStudentPatch();
  } catch (err) {
    console.error('B3 score-release patch failed to initialize:', err);
  }
})();
