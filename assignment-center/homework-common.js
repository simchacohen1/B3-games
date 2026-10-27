/* Homework Portal browser helpers (shared by student.html and teacher.html). */
(function (root) {
  'use strict';
  var STAGING_PROJECT = 'fun-torah-tools-staging';
  var STAGING_HOST = 'fun-torah-tools-staging.web.app';
  var STAGING_PREVIEW_HOST = /^fun-torah-tools-staging--homework-406-preview-[a-z0-9]+\.web\.app$/;
  var projectId = root.B3_FIREBASE_CONFIG && root.B3_FIREBASE_CONFIG.projectId;
  var host = root.location && root.location.hostname ? root.location.hostname.toLowerCase() : '';
  var localPreview = /^(localhost|127\.0\.0\.1)$/.test(host) &&
    root.location.search.indexOf('local-staging=1') !== -1;
  var isStagingRuntime = projectId === STAGING_PROJECT &&
    (host === STAGING_HOST || STAGING_PREVIEW_HOST.test(host) || localPreview);
  var API = isStagingRuntime
    ? (localPreview && /^http:\/\/(localhost|127\.0\.0\.1):5001\//.test(root.B3_HOMEWORK_API_URL || '')
      ? root.B3_HOMEWORK_API_URL
      : 'https://us-central1-' + STAGING_PROJECT + '.cloudfunctions.net/homeworkPortal')
    : '';
  var TYPES = {
    shorashim: 'Shorashim practice', weeklyQuiz: 'Weekly Quiz', rashiLetters: 'Rashi Letters',
    posuk: 'Posuk Practice', chazara: 'Chazara', workbook: 'Workbook page',
    audio: 'Audio recording', video: 'Video', other: 'Other'
  };
  var STATUS = {
    assigned: 'Not started', in_progress: 'In progress', submitted: 'Submitted', approved: 'Completed ✓', returned: 'Try again'
  };
  var ACTIVITY_URLS = {
    shorashim: '../shorashim/index.html', weeklyQuiz: '../weekly-quiz/index.html',
    rashiLetters: '../rashi-letters/student.html', chazara: '../chazara/index.html',
    posuk: '../record_pesukim/student.html'
  };
  function el(tag, text, cls) {
    var n = document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }
  async function call(body, token) {
    if (!API) throw new Error('This assignment preview is locked to the isolated staging site.');
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    var res;
    try { res = await fetch(API, { method: 'POST', headers: headers, body: JSON.stringify(body) }); }
    catch (e) { throw new Error('No internet connection. Your work is kept on this page; try again.'); }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw Object.assign(new Error(data.error || ('Error ' + res.status)), { status: res.status });
    return data;
  }
  function when(ms) {
    if (ms == null) return '';
    return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  // Due dates are end of the chosen day, local time.
  function dueFromInput(v) { return v ? new Date(v + 'T23:59:59').getTime() : null; }
  function assignedFromInput(v) { return v ? new Date(v + 'T00:00:00').getTime() : null; }
  function inputFromDue(ms) {
    if (ms == null) return '';
    var d = new Date(ms), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function activityUrl(type) {
    var path = ACTIVITY_URLS[type];
    return path ? new URL(path, root.location.href).href : '';
  }
  root.HomeworkCommon = { API: API, TYPES: TYPES, STATUS: STATUS, ACTIVITY_URLS: ACTIVITY_URLS,
    isStagingRuntime: function () { return isStagingRuntime; }, activityUrl: activityUrl, el: el, call: call, when: when,
    dueFromInput: dueFromInput, assignedFromInput: assignedFromInput, inputFromDue: inputFromDue };
  if (typeof module === 'object' && module.exports) module.exports = root.HomeworkCommon;
})(typeof window !== 'undefined' ? window : globalThis);
