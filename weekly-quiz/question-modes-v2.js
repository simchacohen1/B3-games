/* Quiz question schema v2. Pure validation/grading; no Firebase or DOM dependencies.
 * This module is intentionally not wired into live sessions until the teacher UI,
 * student response API and server-side grading all support v2 end-to-end.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FTTQuizModes = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const MODES = Object.freeze([
    'single_select', 'multi_select', 'true_false', 'free_text',
    'essay', 'sorter', 'categorizer', 'multi_categorizer',
    'highlight_text', 'hot_spot', 'fill_gaps'
  ]);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const nonempty = x => typeof x === 'string' && !!x.trim();
  const unique = xs => new Set(xs).size === xs.length;
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const clean = x => String(x == null ? '' : x).normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
  function migrate(q) {
    if (q && !q.mode && Array.isArray(q.choices) && Number.isInteger(Number(q.correctIndex))) {
      return { ...q, schemaVersion: 2, mode: 'single_select', correctIndex: Number(q.correctIndex) };
    }
    return q;
  }
  function validate(input) {
    const q = migrate(input);
    const errors = [];
    if (!q || typeof q !== 'object' || Array.isArray(q)) return ['Question must be an object'];
    if (!MODES.includes(q.mode)) errors.push('Unknown question mode');
    if (!nonempty(q.q)) errors.push('Question text is required');
    const arr = (name, min = 1) => {
      if (!Array.isArray(q[name]) || q[name].length < min) { errors.push(name + ' is required'); return []; }
      return q[name];
    };
    const texts = (items, name) => { if (!items.every(nonempty) || !unique(items)) errors.push(name + ' must contain unique, nonempty strings'); };
    switch (q.mode) {
      case 'single_select':
      case 'multi_select': {
        const choices = arr('choices', 2); texts(choices, 'choices');
        if (q.mode === 'single_select' && (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= choices.length)) errors.push('Invalid correctIndex');
        if (q.mode === 'multi_select' && (!Array.isArray(q.correctIndices) || !q.correctIndices.length || !unique(q.correctIndices) || q.correctIndices.some(i => !Number.isInteger(i) || i < 0 || i >= choices.length))) errors.push('Invalid correctIndices');
        break;
      }
      case 'true_false':
        if (typeof q.correct !== 'boolean') errors.push('Boolean correct is required');
        break;
      case 'free_text':
        texts(arr('answers'), 'answers');
        break;
      case 'essay':
        if (!nonempty(q.rubric)) errors.push('Essay rubric is required');
        break;
      case 'sorter':
        texts(arr('items', 2), 'items');
        if (!Array.isArray(q.correctOrder) || !eq([...q.correctOrder].sort(), [...q.items || []].sort())) errors.push('correctOrder must be a permutation of items');
        break;
      case 'categorizer':
      case 'multi_categorizer': {
        const items = arr('items'); const categories = arr('categories', 2);
        texts(items, 'items'); texts(categories, 'categories');
        if (!q.key || typeof q.key !== 'object' || Array.isArray(q.key)) { errors.push('Category key required'); break; }
        for (const item of items) {
          const assigned = q.key[item];
          if (q.mode === 'categorizer' && !categories.includes(assigned)) errors.push('Invalid category for ' + item);
          if (q.mode === 'multi_categorizer' && (!Array.isArray(assigned) || !assigned.length || !unique(assigned) || assigned.some(x => !categories.includes(x)))) errors.push('Invalid categories for ' + item);
        }
        break;
      }
      case 'highlight_text': {
        if (!nonempty(q.passage)) errors.push('Passage required');
        const spans = arr('spans');
        if (spans.some(s => !s || !Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start < 0 || s.end > (q.passage || '').length || s.end <= s.start)) errors.push('Invalid highlight spans');
        const ordered = spans.slice().sort((a,b)=>a.start-b.start);
        if (ordered.some((s,i)=>i && s.start < ordered[i-1].end)) errors.push('Overlapping spans');
        break;
      }
      case 'hot_spot': {
        if (!nonempty(q.imageUrl) || !/^https:\/\//.test(q.imageUrl)) errors.push('HTTPS image URL required');
        const regions = arr('regions');
        if (regions.some(r => !r || !['rect', 'circle'].includes(r.shape) || ![r.x,r.y,r.width,r.height].every(n=>typeof n==='number' && Number.isFinite(n)) || r.x<0 || r.y<0 || r.width<=0 || r.height<=0 || r.x+r.width>1 || r.y+r.height>1)) errors.push('Regions require normalized 0..1 bounds');
        break;
      }
      case 'fill_gaps': {
        const gaps = arr('gaps');
        if (gaps.some(g=>!g || !nonempty(g.id) || !Array.isArray(g.answers) || !g.answers.length || !g.answers.every(nonempty) || (g.options && (!Array.isArray(g.options) || !g.options.every(nonempty))))) errors.push('Each gap needs ID and accepted answers');
        if (!unique(gaps.map(g=>g.id))) errors.push('Duplicate gap IDs');
        if (!nonempty(q.template) || !gaps.every(g=>q.template.includes('{{'+g.id+'}}'))) errors.push('Template must reference each gap');
        break;
      }
    }
    return errors;
  }
  function grade(input, answer) {
    const q = migrate(input);
    const problems = validate(q);
    if (problems.length) return {status:'invalid', errors:problems};
    if (q.mode === 'essay') return {status:'needs_review', score:null};
    if (answer == null) return {status:'unanswered', score:0};
    let correct = false;
    switch (q.mode) {
      case 'single_select': correct = Number.isInteger(answer.choiceIndex) && answer.choiceIndex === q.correctIndex; break;
      case 'multi_select': correct = Array.isArray(answer.indices) && unique(answer.indices) && eq([...answer.indices].sort((a,b)=>a-b), [...q.correctIndices].sort((a,b)=>a-b)); break;
      case 'true_false': correct = typeof answer.value === 'boolean' && answer.value === q.correct; break;
      case 'free_text': correct = typeof answer.text === 'string' && q.answers.some(a=>clean(a)===clean(answer.text)); break;
      case 'sorter': correct = Array.isArray(answer.order) && eq(answer.order,q.correctOrder); break;
      case 'categorizer': correct = !!answer.key && q.items.every(item=>answer.key[item]===q.key[item]); break;
      case 'multi_categorizer': correct = !!answer.key && q.items.every(item=>Array.isArray(answer.key[item]) && unique(answer.key[item]) && eq([...answer.key[item]].sort(), [...q.key[item]].sort())); break;
      case 'highlight_text': correct = Array.isArray(answer.spans) && eq([...answer.spans].sort((a,b)=>a.start-b.start), [...q.spans].sort((a,b)=>a.start-b.start)); break;
      case 'hot_spot': correct = !!answer.point && typeof answer.point.x==='number' && typeof answer.point.y==='number' && q.regions.some(r=>answer.point.x>=r.x && answer.point.x<=r.x+r.width && answer.point.y>=r.y && answer.point.y<=r.y+r.height); break;
      case 'fill_gaps': correct = !!answer.values && q.gaps.every(g=>typeof answer.values[g.id]==='string' && g.answers.some(a=>clean(a)===clean(answer.values[g.id]))); break;
    }
    return {status:correct?'correct':'incorrect', score:correct?1:0};
  }
  return Object.freeze({MODES, migrate, validate, grade});
});
