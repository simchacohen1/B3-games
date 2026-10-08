/* Shared credentials for paid learning services; never send them to other hosts. */
(function (root) {
  'use strict';
  const endpoint = /^https:\/\/us-central1-b3-games\.cloudfunctions\.net\/(gradeComprehension|gradeTranslationChunk|gradeQuestionAnswer|generateTranslationChunks|generateComprehensionQuestions|generateWeeklyQuiz|generateShorashimArt|synthesizeSpeech)$/;
  async function paidFetch(url, options) {
    if (!endpoint.test(String(url))) throw new Error('Unknown learning service.');
    const headers = new Headers(options && options.headers);
    const teacherPage = /\/teacher\.html$/.test(root.location.pathname);
    const id = sessionStorage.getItem('b3Games_studentId') || sessionStorage.getItem('posukPractice_studentId');
    const pin = sessionStorage.getItem('b3Games_classPin');
    const user = root.firebase?.auth && root.firebase.auth().currentUser;
    // Student tabs keep their own identity even when a teacher is signed in
    // in a different tab in the same browser.
    if (!teacherPage && id && pin) {
      headers.set('X-B3-Student-Id', id);
      headers.set('X-B3-Student-Pin', pin);
    } else if (user) {
      headers.set('Authorization', 'Bearer ' + await user.getIdToken());
    } else {
      throw new Error(teacherPage ? 'Sign in with your teacher Google account to use AI and audio tools.' : 'Please sign in from the Fun Torah Tools home page.');
    }
    // A 409 means another request already owns generation. Waiting and reading
    // its cached result is safe; retrying timeouts or provider failures is not.
    for (let attempt = 0; ; attempt++) {
      const response = await root.fetch(url, { ...options, headers });
      if (response.status !== 409 || attempt >= 8) return response;
      await new Promise((resolve, reject) => {
        const signal = options?.signal;
        const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Request aborted', 'AbortError')); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 4000);
        if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
      });
    }
  }
  root.B3PaidApi = { fetch: paidFetch };
})(window);
