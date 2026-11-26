/* Adds a "History" tab to a tool's teacher page. READ ONLY: it only shows activity-history/index.html
   (the same Activity History table, filtered to this tool) inside the page. It never touches the tool's own data.
   Usage on a teacher page: <script src="../activity-history/tab.js" data-tool="chazara" defer></script>
   data-tool is one tool id from activity-history/core.js, or several separated by commas. */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script) return;
  try { if (window.self !== window.top) return; } catch (e) { return; } /* not inside previews or the History view itself */
  var tools = script.getAttribute('data-tool') || '';
  var base = new URL('index.html', script.src).href;

  function build() {
    if (document.getElementById('b3HistoryTabs')) return;
    var style = document.createElement('style');
    style.textContent =
      '#b3HistoryTabs{display:flex;gap:6px;padding:8px 12px;background:#0f172a;font:700 14px system-ui,-apple-system,"Segoe UI",sans-serif}' +
      '#b3HistoryTabs button{border:1px solid #475569;background:transparent;color:#e2e8f0;border-radius:999px;padding:6px 14px;font:inherit;cursor:pointer}' +
      '#b3HistoryTabs button[aria-selected=true]{background:#f8fafc;color:#0f172a;border-color:#f8fafc}' +
      '#b3HistoryFrame{display:none;width:100%;border:0;background:#f1f5f9;height:calc(100vh - 52px)}' +
      '@media print{#b3HistoryTabs,#b3HistoryFrame{display:none!important}}';
    document.head.appendChild(style);
    var bar = document.createElement('div');
    bar.id = 'b3HistoryTabs';
    bar.setAttribute('role', 'tablist');
    bar.innerHTML = '<button type="button" role="tab" id="b3TabPage" aria-selected="true">Dashboard</button>' +
      '<button type="button" role="tab" id="b3TabHistory" aria-selected="false">🕘 History</button>';
    var frame = document.createElement('iframe');
    frame.id = 'b3HistoryFrame';
    frame.title = 'Activity History';
    document.body.insertBefore(frame, document.body.firstChild);
    document.body.insertBefore(bar, document.body.firstChild);
    var hidden = [];

    function showHistory() {
      if (!frame.getAttribute('src')) {
        var cls = new URLSearchParams(location.search).get('class') || '';
        frame.src = base + '?embed=1&tool=' + encodeURIComponent(tools) + (cls && cls !== 'all' ? '&class=' + encodeURIComponent(cls) : '');
      }
      hidden = [];
      Array.prototype.forEach.call(document.body.children, function (n) {
        if (n === bar || n === frame || n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.tagName === 'LINK') return;
        hidden.push([n, n.style.display]);
        n.style.display = 'none';
      });
      frame.style.display = 'block';
      bar.querySelector('#b3TabPage').setAttribute('aria-selected', 'false');
      bar.querySelector('#b3TabHistory').setAttribute('aria-selected', 'true');
    }
    function showPage() {
      hidden.forEach(function (p) { p[0].style.display = p[1]; });
      hidden = [];
      frame.style.display = 'none';
      bar.querySelector('#b3TabPage').setAttribute('aria-selected', 'true');
      bar.querySelector('#b3TabHistory').setAttribute('aria-selected', 'false');
    }
    bar.querySelector('#b3TabPage').onclick = showPage;
    bar.querySelector('#b3TabHistory').onclick = showHistory;
    if (new URLSearchParams(location.search).get('tab') === 'history') showHistory();
  }
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
