'use strict';
/*
 * teacher-dock-left.js — Fun Torah Tools Class Pointer
 * Makes the full-screen teacher toolbar smaller, and adds a "Dock left" toggle
 * that snaps it into a slim icon rail on the left edge. The lesson shifts right
 * so nothing is covered. The teacher's choice is remembered (default: docked).
 *
 * Install: in classroom.html, add AFTER teacher-toolbar.js and lesson-fullscreen.js:
 *   <script src="teacher-dock-left.js?v=20261013-dockleft1"></script>
 */
(function () {
  var RAIL = 56;               // rail width in px
  var KEY = 'ftt.teacherDockLeft';

  var css = `
/* Compact floating toolbar (full screen) */
#stage .teacher-dock.floating{max-width:150px;padding:6px;gap:4px;font-size:12px}
#stage .teacher-dock.floating .tb-btn{padding:5px 8px;font-size:12px;min-height:28px}
#stage .teacher-dock.floating .tb-swatches button{width:18px;height:18px}
#stage .teacher-dock:not(.floating) #tbDockLeft{display:none}

/* Docked-left rail */
#stage .teacher-dock.floating.dock-left{inset:0 auto 0 0!important;transform:none!important;width:${RAIL}px!important;max-width:${RAIL}px;max-height:none;height:100%;border-radius:0 12px 12px 0;padding:6px 4px;gap:4px;overflow:visible;scrollbar-width:none;flex-wrap:nowrap}
#stage .teacher-dock.floating.dock-left::-webkit-scrollbar{display:none}
#stage .teacher-dock.floating.dock-left .tb-text{display:none}
#stage .teacher-dock.floating.dock-left > .tb-group{flex-direction:column;align-items:center;gap:2px;padding:3px 0;flex-wrap:nowrap}
#stage .teacher-dock.floating.dock-left .tb-btn{width:44px;min-width:0;height:36px;padding:0;justify-content:center;font-size:17px}
#stage .teacher-dock.floating.dock-left .tb-caret{height:16px;font-size:11px}
#stage .teacher-dock.floating.dock-left .tb-swatches{display:grid!important;grid-template-columns:repeat(2,18px);gap:4px;justify-content:center}
#stage .teacher-dock.floating.dock-left .tb-swatches button{width:18px;height:18px;padding:0}
#stage .teacher-dock.floating.dock-left .tb-move-handle{display:none}
#stage .teacher-dock.floating.dock-left .tb-menu{left:100%!important;right:auto!important;top:0;margin-left:6px}
#stage .teacher-dock.floating.dock-left #tbFullscreen{font-size:0}
#stage .teacher-dock.floating.dock-left #tbFullscreen::before{content:"\\2922";font-size:17px}

/* Shift the lesson so the rail doesn't cover it */
#stage.tb-docked-left > #lesson,
#stage.tb-docked-left > #pdfView,
#stage.tb-docked-left > #focusLayer,
#stage.tb-docked-left > #pointerLayer,
#stage.tb-docked-left > #boardsView{left:${RAIL}px!important;width:calc(100% - ${RAIL}px)!important}
#stage.tb-docked-left > #pdfNav{left:${RAIL + 12}px!important}
`;

  function getPref() {
    try { var v = localStorage.getItem(KEY); return v === null ? true : v === '1'; }
    catch (e) { return true; }
  }
  function setPref(on) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {} }

  function init() {
    var dock = document.getElementById('teacherDock');
    var stage = document.getElementById('stage');
    if (!dock || !stage) return false;

    if (!document.getElementById('ftt-dock-left-css')) {
      var s = document.createElement('style');
      s.id = 'ftt-dock-left-css';
      s.textContent = css;
      document.head.appendChild(s);
    }

    var btn = document.getElementById('tbDockLeft');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'tbDockLeft';
      btn.type = 'button';
      btn.className = 'tb-btn tb-dock-toggle';
      dock.insertBefore(btn, dock.children[1] || null);
      btn.addEventListener('click', function () {
        setPref(!getPref());
        apply();
      });
    }

    function apply() {
      var on = getPref() && dock.classList.contains('floating');
      dock.classList.toggle('dock-left', on);
      stage.classList.toggle('tb-docked-left', on);
      btn.innerHTML = getPref() ? '⇥' : '⇤<span class="tb-text"> Dock left</span>';
      btn.title = getPref() ? 'Undock toolbar (float)' : 'Dock toolbar to the left edge';
      btn.setAttribute('aria-pressed', getPref() ? 'true' : 'false');
      // let the PDF / pointer layers re-measure after the shift
      setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 50);
    }

    // Re-apply whenever the toolbar switches between floating (full screen) and normal
    var last = dock.classList.contains('floating');
    new MutationObserver(function () {
      var now = dock.classList.contains('floating');
      if (now !== last) { last = now; apply(); }
    }).observe(dock, { attributes: true, attributeFilter: ['class'] });

    apply();
    return true;
  }

  function boot(tries) {
    if (init() || tries > 40) return;
    setTimeout(function () { boot(tries + 1); }, 250);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { boot(0); });
  } else { boot(0); }
})();
