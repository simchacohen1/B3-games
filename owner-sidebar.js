/* Owner-only admin sidebar for Teacher Home.
 *
 * The owner lands on their own Teacher Home after signing in. This sidebar holds
 * every admin tool. A tool opens in a panel on the same page (same tab, same
 * Google sign-in), so the owner never leaves teacher view and never signs in a
 * second time. "Teacher Home" in the sidebar closes the panel.
 *
 * It is only a menu. It is mounted for the verified owner only and never for any
 * other account; what each tool may do is still decided by the database rules and
 * the Firebase functions, not by this file.
 */
(function (root) {
  'use strict';
  const BASE_ITEMS = [
    { id: 'owner-admin', icon: '🛠️', title: 'Owner Admin', href: 'owner-admin.html' },
    { id: 'tool-access', icon: '🧮', title: 'Tool access overview', href: 'owner-admin.html#tool-access-overview/' },
    { id: 'class-access', icon: '🔐', title: 'Class Access', href: 'admin.html?tab=access&embed=1' },
    { id: 'student-tools', icon: '🎛️', title: 'Student tool access', href: 'admin.html?tab=students&embed=1' },
    { id: 'class-locks', icon: '🔒', title: 'Class locks', href: 'class-locks/index.html' }
  ];

  // The admin-only tools from the shared registry (the same list the old owner home used).
  function registryItems(R, classId) {
    if (!R || !Array.isArray(R.teacherTools)) return [];
    return R.teacherTools
      .filter(t => t.audiences && t.audiences.indexOf('admin') >= 0 && t.audiences.indexOf('teacher') < 0 && !t.special && t.href)
      .map(t => ({
        id: t.id, icon: t.icon || '•', title: t.title, newTab: !!t.newTab,
        href: classId && R.withClass ? R.withClass(t.href, classId) : t.href
      }));
  }

  function items(R, classId) {
    const seen = new Set(), out = [];
    BASE_ITEMS.concat(registryItems(R, classId)).forEach(item => { if (!seen.has(item.id)) { seen.add(item.id); out.push(item); } });
    return out;
  }

  const CSS = '' +
    'body.b3-owner-sidebar{padding-left:236px}' +
    '#b3OwnerSidebar{position:fixed;left:0;top:0;bottom:0;width:224px;z-index:9990;background:#1e293b;color:#e2e8f0;overflow-y:auto;padding:14px 0;font:700 14px/1.3 system-ui,sans-serif;box-shadow:2px 0 14px rgba(0,0,0,.2)}' +
    '#b3OwnerSidebar h2{margin:4px 16px 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8}' +
    '#b3OwnerSidebar button{display:block;width:100%;text-align:left;border:0;border-left:3px solid transparent;background:transparent;color:#cbd5e1;padding:10px 16px;font:inherit;cursor:pointer}' +
    '#b3OwnerSidebar button:hover{background:#2d3f55;color:#fff}' +
    '#b3OwnerSidebar button.on{background:#2d3f55;color:#fff;border-left-color:#3b82f6}' +
    '#b3OwnerSidebar button:focus-visible{outline:3px solid #60a5fa;outline-offset:-3px}' +
    '#b3OwnerPane{position:fixed;left:224px;right:0;top:0;bottom:0;z-index:9980;background:#fff;display:none;flex-direction:column}' +
    '#b3OwnerPane.open{display:flex}' +
    '#b3OwnerPane iframe{flex:1;border:0;width:100%;background:#fff}' +
    '@media(max-width:760px){body.b3-owner-sidebar{padding-left:0;padding-top:48px}#b3OwnerSidebar{position:fixed;right:0;bottom:auto;width:auto;height:48px;display:flex;overflow-x:auto;padding:0;align-items:center}' +
    '#b3OwnerSidebar h2{display:none}#b3OwnerSidebar button{width:auto;white-space:nowrap;border-left:0;border-bottom:3px solid transparent;padding:14px 12px}#b3OwnerSidebar button.on{border-bottom-color:#3b82f6}#b3OwnerPane{left:0;top:48px}}';

  function mount(opts) {
    const doc = root.document;
    if (!doc || !doc.body || doc.getElementById('b3OwnerSidebar')) return;
    const view = root.B3OwnerTeacherView;
    // Owner only: the verified owner email, nobody else.
    if (!view || !view.isOwnerUser(opts && opts.user)) return;

    const style = doc.createElement('style');
    style.id = 'b3OwnerSidebarStyle';
    style.textContent = CSS;
    doc.head.appendChild(style);

    const nav = doc.createElement('nav');
    nav.id = 'b3OwnerSidebar';
    nav.setAttribute('aria-label', 'Admin tools');
    const pane = doc.createElement('div');
    pane.id = 'b3OwnerPane';
    const frame = doc.createElement('iframe');
    frame.title = 'Admin tool';
    pane.appendChild(frame);

    const buttons = [];
    function select(btn) { buttons.forEach(b => b.classList.toggle('on', b === btn)); }
    function home() { pane.classList.remove('open'); frame.removeAttribute('src'); select(buttons[0]); }

    function add(label, onclick) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.onclick = () => onclick(b);
      nav.appendChild(b);
      buttons.push(b);
      return b;
    }
    const homeBtn = add('🏠 Teacher Home', home);
    const heading = doc.createElement('h2');
    heading.textContent = 'Admin tools';
    nav.appendChild(heading);
    items(opts.registry, opts.classId).forEach(item => {
      add(item.icon + ' ' + item.title, btn => {
        if (item.newTab) { root.open(item.href, '_blank', 'noopener'); return; }
        frame.src = item.href;
        pane.classList.add('open');
        select(btn);
      });
    });

    doc.body.classList.add('b3-owner-sidebar');
    doc.body.append(nav, pane);
    select(homeBtn);
  }

  function unmount() {
    const doc = root.document;
    if (!doc) return;
    ['b3OwnerSidebar', 'b3OwnerPane', 'b3OwnerSidebarStyle'].forEach(id => { const el = doc.getElementById(id); if (el) el.remove(); });
    if (doc.body) doc.body.classList.remove('b3-owner-sidebar');
  }

  const api = { items, registryItems, mount, unmount, BASE_ITEMS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.B3OwnerSidebar = api;
})(typeof window === 'undefined' ? globalThis : window);
