/* Teacher add-ons: the viewer page (step 2).
 * Shows one add-on inside our site: our top bar with a Back button, and the add-on in a sandboxed frame from the separate
 * add-ons address. The add-on can never send the student to another website: the frame has no top navigation and no pop-ups,
 * and its files are served with a policy that blocks outside connections. This page never builds an address from the link:
 * the host comes from the site's own setting and must be on the list in teacher-addons-core.js.
 * Step 4 reads the add-on's name, icon and whether it is switched off from the database; for now the name and icon come
 * from the link and are shown as plain text only. */
(function () {
  'use strict';
  var core = window.B3TeacherAddons;
  var params = new URLSearchParams(location.search);
  var $ = function (id) { return document.getElementById(id); };

  function message(text) {
    var box = $('msg');
    box.textContent = text;
    box.hidden = false;
  }

  function back() {
    // Back to where the student came from on our own site; otherwise the home page.
    var ref = '';
    try { ref = new URL(document.referrer).origin; } catch (e) { ref = ''; }
    if (ref === location.origin && history.length > 1) history.back();
    else location.href = 'index.html';
  }
  $('back').addEventListener('click', back);

  if (!core) { message('This page could not start. Please go back and try again.'); return; }

  var name = core.cleanText(params.get('name') || '', core.LIMITS.nameMax) || 'Add-on';
  var icon = core.cleanText(params.get('icon') || '', core.LIMITS.iconMax);
  $('title').textContent = name;
  $('icon').textContent = icon;
  document.title = name + ' · add-on';

  var host = window.B3_ADDON_HOST || 'https://apps.sols.tools';
  var url = core.viewerFrameUrl(host, params.get('addon') || '');
  if (!url) { message('This add-on could not be opened. Please go back and choose it again.'); return; }

  var frame = document.createElement('iframe');
  // The sandbox is set first. No allow-same-origin, no allow-top-navigation, no allow-popups.
  frame.setAttribute('sandbox', core.SANDBOX);
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('allow', '');
  frame.setAttribute('title', name);
  frame.src = url;
  $('stage').appendChild(frame);
})();
