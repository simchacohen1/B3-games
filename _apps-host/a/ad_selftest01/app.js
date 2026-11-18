// Runs inside the sandboxed viewer. Each check tries something forbidden; "blocked" is the good answer.
(function () {
  'use strict';
  var results = [];
  function check(label, forbidden) {
    var outcome;
    try { outcome = forbidden(); } catch (e) { outcome = 'blocked'; }
    Promise.resolve(outcome).then(function (v) { add(label, v === 'blocked' ? 'blocked' : 'ALLOWED'); }, function () { add(label, 'blocked'); });
  }
  function add(label, status) {
    results.push({ label: label, status: status });
    var tr = document.createElement('tr');
    var a = document.createElement('td'), b = document.createElement('td');
    a.textContent = label; b.textContent = status; tr.append(a, b);
    document.getElementById('rows').appendChild(tr);
    var bad = results.some(function (r) { return r.status !== 'blocked'; });
    var v = document.getElementById('verdict');
    v.textContent = bad ? 'NOT isolated' : 'Isolated (' + results.length + ' checks blocked)';
    v.className = bad ? 'bad' : 'ok';
    window.__selftest = results;
  }
  check('read the SOLS page that contains me', function () { void parent.document.title; return 'ALLOWED'; });
  check('use browser storage (localStorage)', function () { localStorage.setItem('x', '1'); return 'ALLOWED'; });
  check('use cookies', function () { document.cookie = 'x=1'; return document.cookie ? 'ALLOWED' : 'blocked'; });
  check('send the whole page to another site (fetch)', function () { return fetch('https://example.com/', { mode: 'no-cors' }).then(function () { return 'ALLOWED'; }, function () { return 'blocked'; }); });
  check('navigate the SOLS page away (top)', function () { top.location.href = 'https://example.com/'; return 'ALLOWED'; });
  check('open a pop-up window', function () { var w = window.open('https://example.com/'); return w ? 'ALLOWED' : 'blocked'; });
  check('claim to be a normal web origin', function () { return window.origin === 'null' ? 'blocked' : 'ALLOWED'; });
  check('load a script from another site', function () {
    return new Promise(function (resolve) {
      var s = document.createElement('script'); s.src = 'https://example.com/x.js';
      s.onload = function () { resolve('ALLOWED'); }; s.onerror = function () { resolve('blocked'); };
      document.head.appendChild(s);
    });
  });
})();
