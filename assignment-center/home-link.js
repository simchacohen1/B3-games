/* Adds "My Homework" to the student home bar, only for a signed-in student whose
 * class has Homework switched on (b3Games/workspaces/<ws>/classes/<id>/toolGrants/homework).
 * Shows a small count of homework still to do. Does nothing for guests, teachers
 * or classes without Homework, and never blocks the rest of the page. */
(function () {
  'use strict';
  var host = location.hostname.toLowerCase();
  var projectId = window.B3_FIREBASE_CONFIG && window.B3_FIREBASE_CONFIG.projectId;
  if (host !== 'fun-torah-tools-staging.web.app' || projectId !== 'fun-torah-tools-staging') return;
  var API = 'https://us-central1-fun-torah-tools-staging.cloudfunctions.net/homeworkPortal';
  var bar = document.getElementById('studentBar');
  if (!bar) return;
  var done = '';
  function ss(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } }
  async function check() {
    var id = ss('b3Games_studentId'), cls = ss('b3Games_studentClass'), pin = ss('b3Games_classPin');
    if (bar.classList.contains('hidden') || !id || !cls || !pin || sessionStorage.getItem('b3Games_guest')) return;
    var key = id + '|' + cls;
    if (done === key) return;
    done = key;
    var old = document.getElementById('homeworkStudentLink');
    if (old) old.remove();
    try {
      var ws = (window.B3_APP_CONTEXT && window.B3_APP_CONTEXT.workspaceId) || 'b3-2026';
      var on = (await firebase.database().ref('b3Games/workspaces/' + ws + '/classes/' + cls + '/toolGrants/homework').once('value')).val();
      if (on !== true) return;
      var a = document.createElement('a');
      a.id = 'homeworkStudentLink';
      a.href = 'assignment-center/student.html';
      a.style.cssText = 'padding:10px 14px;border-radius:8px;background:#0f766e;color:white;font-weight:700;text-decoration:none';
      a.textContent = '📚 My Homework';
      bar.appendChild(a);
      var res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'studentList', studentId: id, studentName: ss('b3Games_studentName'), pin: pin, classId: cls }) });
      var data = await res.json().catch(function () { return {}; });
      if (res.ok && data.openCount > 0) a.textContent = '📚 My Homework (' + data.openCount + ')';
    } catch (e) { /* the link stays; the homework page shows any error */ }
  }
  new MutationObserver(check).observe(bar, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('load', check);
})();
