/* Shared "back" button for pages that have no other way to return.
 * Usage: <script src="../back-nav.js" data-href="../teacher-home.html" data-label="← Teacher Home" defer></script>
 * Skipped inside iframes (teacher previews) and when printing. */
(function () {
  var script = document.currentScript;
  if (!script) return;
  try { if (window.self !== window.top) return; } catch (e) { return; }
  var href = script.getAttribute('data-href') || '../teacher-home.html';
  var label = script.getAttribute('data-label') || '← Teacher Home';
  // data-mode="inline": sit above the page's own header instead of floating over it
  var inline = script.getAttribute('data-mode') === 'inline';

  function add() {
    if (document.getElementById('b3BackNav')) return;
    var style = document.createElement('style');
    style.textContent =
      '#b3BackNav{position:fixed;top:10px;left:10px;z-index:2147483000;display:inline-flex;align-items:center;' +
      'gap:4px;padding:7px 13px;border-radius:999px;background:rgba(255,255,255,.94);color:#1e3a8a;' +
      'font:700 14px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;text-decoration:none;' +
      'border:1px solid rgba(30,58,138,.25);box-shadow:0 2px 8px rgba(0,0,0,.15)}' +
      '#b3BackNav:hover,#b3BackNav:focus-visible{background:#1e3a8a;color:#fff;outline:none}' +
      '#b3BackNavBar{display:block;padding:10px 10px 0;margin:0;background:transparent}' +
      '#b3BackNavBar #b3BackNav{position:static}' +
      '@media print{#b3BackNavBar{display:none!important}}' +
      '@media print{#b3BackNav{display:none!important}}';
    document.head.appendChild(style);
    var a = document.createElement('a');
    a.id = 'b3BackNav';
    a.href = href;
    a.textContent = label;
    a.setAttribute('aria-label', label.replace(/^[←⬅️\s]+/, 'Back to '));
    if (inline) {
      var bar = document.createElement('div');
      bar.id = 'b3BackNavBar';
      bar.appendChild(a);
      document.body.insertBefore(bar, document.body.firstChild);
    } else {
      document.body.appendChild(a);
    }
  }
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
})();
