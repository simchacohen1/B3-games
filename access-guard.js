/* Compatibility entrypoint: all student pages share one access policy. */
(function () {
  "use strict";
  const loader = document.currentScript;
  const toolId = loader?.dataset?.b3ToolId;
  if (!toolId) return;
  if (Array.from(document.scripts).some(script => script !== loader &&
      new URL(script.src || location.href).pathname.endsWith("/game-gate.js"))) return;
  const gate = document.createElement("script");
  gate.src = new URL("game-gate.js?v=20261008-owner-demo", loader.src).href;
  gate.dataset.gameId = toolId;
  document.head.appendChild(gate);
})();
