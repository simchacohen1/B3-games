// Lightweight loader added 2026-09-17.
// The original teacher dashboard is preserved byte-for-byte in teacher-core.js.
// Enhancements are loaded after it so future changes stay isolated and reversible.
(() => {
  const load = (src, done) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => { if (done) done(); };
    s.onerror = () => console.error('Could not load', src);
    document.head.appendChild(s);
  };
  load('teacher-core.js?v=20260917-commonness-pictures', () => {
    load('teacher-enhancements.js?v=20260917-commonness-pictures');
  });
})();
