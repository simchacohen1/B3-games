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
  function fixText(node) {
    if (has(node.nodeValue) && !skipped(node.parentNode)) node.nodeValue = swap(node.nodeValue);
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
  function fixIcons() {
    var links = document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]');
    for (var i = 0; i < links.length; i += 1) {
      if (links[i].getAttribute('data-sols') === '1') continue;
      links[i].parentNode.removeChild(links[i]);
    }
    if (!document.head || document.querySelector('link[data-sols="1"]')) return;
    var icon = document.createElement('link');
    icon.rel = 'icon';
    icon.type = 'image/svg+xml';
    icon.href = '/sols-favicon.svg';
    icon.setAttribute('data-sols', '1');
    document.head.appendChild(icon);
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
