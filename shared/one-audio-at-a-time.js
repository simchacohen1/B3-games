/* One recording plays at a time.
   On a marking screen there are many recordings. Starting one pauses whichever other one is playing.
   Covers recordings played with the browser's own player controls AND ones started by script (new Audio()). */
(function (root) {
  'use strict';
  if (!root || !root.HTMLMediaElement || root.__oneAudioAtATime) return;
  root.__oneAudioAtATime = true;
  const playing = new Set();

  function pauseOthers(except) {
    playing.forEach(el => {
      if (el !== except) { try { el.pause(); } catch (_) { /* already gone */ } }
    });
  }
  function forget(event) { playing.delete(event.target); }

  // Browser player controls and autoplay: the media events fire on the element, so listen while they pass the document.
  root.document.addEventListener('play', event => {
    const el = event.target;
    if (!(el instanceof root.HTMLMediaElement)) return;
    pauseOthers(el);
    playing.add(el);
  }, true);
  root.document.addEventListener('pause', forget, true);
  root.document.addEventListener('ended', forget, true);

  // Players that are not in the page (new Audio().play()) never reach the document, so catch the script call too.
  const nativePlay = root.HTMLMediaElement.prototype.play;
  root.HTMLMediaElement.prototype.play = function () {
    pauseOthers(this);
    playing.add(this);
    const result = nativePlay.apply(this, arguments);
    if (result && typeof result.catch === 'function') result.catch(() => playing.delete(this));
    return result;
  };
  // A player detached without ever pausing must not be kept (or paused) forever.
  root.addEventListener('pagehide', () => playing.clear());
})(typeof self !== 'undefined' ? self : this);
