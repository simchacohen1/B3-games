// The preview channel loads the verified staging config and its network guard
// before Firebase SDKs or app code. On every other host this file is a no-op.
(function () {
  'use strict';
  if (!/^fun-torah-tools-staging--homework-406-preview-[a-z0-9]+\.web\.app$/
    .test(window.location.hostname.toLowerCase())) return;
  document.write('<script data-b3-staging-guard src="/staging/firebase-config.generated.js"><\/script>');
  document.write('<script src="/staging/staging-config.js"><\/script>');
})();
