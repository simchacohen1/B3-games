/*
 * sols.tools is the only address the site runs on. If a page is ever opened on the
 * old funtorahtools.com address, send the browser to the same path on sols.tools.
 * Runs before the page does anything else. It does nothing on sols.tools, on staging
 * or on localhost. The permanent (301) redirect itself is a Cloudflare rule; this is
 * the fallback for any request that reaches the old host's GitHub Pages copy.
 */
(function () {
  var host = String(location.hostname || '').toLowerCase();
  if (host !== 'funtorahtools.com' && host !== 'www.funtorahtools.com') return;
  location.replace('https://sols.tools' + location.pathname + location.search + location.hash);
})();
