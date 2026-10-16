/* Homework Portal browser helpers (shared by student.html and teacher.html). */
(function (root) {
  'use strict';
  var API = 'https://us-central1-b3-games.cloudfunctions.net/homeworkPortal';
  var TYPES = {
    shorashim: 'Shorashim practice', posuk: 'Posuk Practice', chazara: 'Chazara', workbook: 'Workbook page',
    audio: 'Audio recording', video: 'Video', other: 'Other'
  };
  var STATUS = {
    assigned: 'To do', in_progress: 'In progress', submitted: 'Handed in', approved: 'Approved ✓', returned: 'Try again'
  };
  function el(tag, text, cls) {
    var n = document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }
  async function call(body, token) {
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
  function inputFromDue(ms) {
    if (ms == null) return '';
    var d = new Date(ms), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  root.HomeworkCommon = { API: API, TYPES: TYPES, STATUS: STATUS, el: el, call: call, when: when,
    dueFromInput: dueFromInput, inputFromDue: inputFromDue };
  if (typeof module === 'object' && module.exports) module.exports = root.HomeworkCommon;
})(typeof window !== 'undefined' ? window : globalThis);
