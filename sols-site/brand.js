/*
 * Shluchim Online School branding for https://sols.tools.
 *
 * This file is NOT loaded by funtorahtools.com. The "Update from B3-games"
 * workflow in the sols-school-site repository copies it to /sols-brand.js and
 * adds one <script> tag for it to every page of that copy only.
 *
 * It changes what people SEE (the site name and the browser-tab icon). It does
 * not touch saved data, sign-in, storage keys or any Firebase path, so both
 * websites keep using exactly the same accounts and database.
 */
(function () {
  'use strict';
  if (window.__solsBrand) return;
  var NAME = 'Shluchim Online School';
  var OLD = /Fun Torah Tools/gi;
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  window.__solsBrand = true;
  window.SITE_BRAND = Object.freeze({ id: 'sols', name: NAME, host: 'sols.tools' });

  function swap(text) {
    return text.replace(OLD, function (found) {
      return found === found.toUpperCase() ? NAME.toUpperCase() : NAME;
    });
  }
  function has(text) { return !!text && text.toLowerCase().indexOf('fun torah tools') !== -1; }
  function skipped(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.nodeName;
    return tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA' || el.isContentEditable;
  }
  // Tab title: always says "SOLS Tools" so students can tell this site from the real school
  // site: "SOLS Tools | Shluchim Online School" on the home page, "<page name> | SOLS Tools"
  // elsewhere (page name first so narrow tabs stay distinct). Same rule as solsTitle() in
  // sols-site/build.mjs.
  function solsTitle(raw) {
    var text = String(raw || '').replace(/\s+/g, ' ').trim();
    if (/^SOLS Tools\b/i.test(text) || /\|\s*SOLS Tools$/i.test(text)) return text;
    var rest = text
      .replace(/Fun Torah Tools/gi, ' ')
      .replace(/Shluchim Online School/gi, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s|—–•:-]+|[\s|—–•:-]+$/g, '');
    var page = rest.replace(/\s*·\s*SOLS$/i, '').trim();
    return !page || page === 'Home' ? 'SOLS Tools | ' + NAME : page + ' | SOLS Tools';
  }
  function fixText(node) {
    var parent = node.parentNode;
    if (parent && parent.nodeName === 'TITLE' && parent.parentNode === document.head) {
      var next = solsTitle(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
      return;
    }
    if (has(node.nodeValue) && !skipped(parent)) node.nodeValue = swap(node.nodeValue);
  }
  function fixAttrs(el) {
    for (var i = 0; i < ATTRS.length; i += 1) {
      var value = el.getAttribute(ATTRS[i]);
      if (has(value)) el.setAttribute(ATTRS[i], swap(value));
    }
    if (el.nodeName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type || '') && has(el.value)) {
      el.value = swap(el.value);
    }
  }
  function fixTree(root) {
    if (!root) return;
    if (root.nodeType === 3) { fixText(root); return; }
    if (root.nodeType !== 1) return;
    if (skipped(root)) return;
    fixAttrs(root);
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        return skipped(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 3) fixText(node); else fixAttrs(node);
    }
  }
  // The home page shows the school emblem. An inner page keeps its own section icon
  // (/assets/favicons/*.svg) so tabs of different tools look different.
  function isHome() { return location.pathname === '/' || location.pathname === '/index.html'; }
  function ownIcon(link) {
    return !isHome() && link.rel === 'icon' && /\/assets\/favicons\//.test(link.getAttribute('href') || '');
  }
  function fixIcons() {
    var links = document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]');
    for (var i = 0; i < links.length; i += 1) {
      if (links[i].getAttribute('data-sols') === '1' || ownIcon(links[i])) continue;
      links[i].parentNode.removeChild(links[i]);
    }
    if (!document.head || document.querySelector('link[data-sols="1"]')) return;
    // The school emblem. 16 px has thickened lines so it stays readable in a tab.
    var icons = [
      { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/sols-favicon-32x32.png' },
      { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/sols-favicon-16x16.png' },
      { rel: 'apple-touch-icon', href: '/sols-apple-touch-icon.png' }
    ];
    var keepOwn = !!document.querySelector('link[rel="icon"][href*="/assets/favicons/"]') && !isHome();
    for (var j = 0; j < icons.length; j += 1) {
      if (keepOwn && icons[j].rel === 'icon') continue;
      var icon = document.createElement('link');
      icon.rel = icons[j].rel;
      if (icons[j].type) icon.type = icons[j].type;
      if (icons[j].sizes) icon.setAttribute('sizes', icons[j].sizes);
      icon.href = icons[j].href;
      icon.setAttribute('data-sols', '1');
      document.head.appendChild(icon);
    }
  }
  function fixAll() {
    fixTree(document.documentElement);
    fixIcons();
  }

  fixAll();
  new MutationObserver(function (changes) {
    var iconsChanged = false;
    for (var i = 0; i < changes.length; i += 1) {
      var change = changes[i];
      if (change.type === 'characterData') {
        fixText(change.target);
      } else if (change.type === 'attributes') {
        fixAttrs(change.target);
      } else {
        for (var j = 0; j < change.addedNodes.length; j += 1) {
          var added = change.addedNodes[j];
          fixTree(added);
          if (added.nodeName === 'LINK' && added.getAttribute('data-sols') !== '1') iconsChanged = true;
        }
      }
    }
    if (iconsChanged) fixIcons();
  }).observe(document.documentElement, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ATTRS.concat(['value'])
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fixAll);
})();
