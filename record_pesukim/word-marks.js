/* Posuk Practice word marks (Issue #749).
   The teacher taps Hebrew words on a recording card to mark what went wrong.
   A word with no mark is correct. The ids here must match WORD_MARKS in
   backend/functions/posuk-review-core.cjs (the server rejects any other id). */
(function(root){
  'use strict';
  var MARKS = [
    { id:'incorrect',        label:'Incorrect',                           short:'Incorrect',         color:'#c62828', bg:'#fde3e0' },
    { id:'readOkTransWrong', label:'Correct reading, wrong translation',  short:'Wrong translation', color:'#1557b0', bg:'#dfeafc' },
    { id:'readWrongTransOk', label:'Wrong reading, correct translation',  short:'Wrong reading',     color:'#b45309', bg:'#fdeacc' },
    { id:'bothWrong',        label:'Wrong reading and translation',       short:'Reading + translation wrong', color:'#7b1fa2', bg:'#f0dff7' },
    { id:'skipped',          label:'Missing word (skipped)',              short:'Skipped',           color:'#4a5560', bg:'#e3e6ea' },
    { id:'review',           label:'Needs review',                        short:'Needs review',      color:'#00695c', bg:'#d6f0ec' }
  ];
  var BY_ID = {};
  MARKS.forEach(function(m){ BY_ID[m.id] = m; });

  function esc(v){
    return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  // Same split the server uses, so a word's position means the same thing everywhere.
  function splitWords(text){
    return String(text || '').trim().split(/\s+/).filter(Boolean);
  }
  function style(id){
    var m = BY_ID[id];
    return m ? 'color:' + m.color + ';background:' + m.bg + ';border-color:' + m.color + ';' : '';
  }
  function legendHtml(){
    return '<div class="wm-legend">' + MARKS.map(function(m){
      return '<span class="wm-legend-item"><span class="wm-swatch" style="background:' + m.color + '"></span>' + esc(m.label) + '</span>';
    }).join('') + '</div>';
  }
  // Saved marks ([{i, word, mark}]) as small coloured chips, for lists and reports.
  function chipsHtml(list){
    if(!Array.isArray(list)) return '';
    return list.filter(function(x){ return x && BY_ID[x.mark]; }).map(function(x){
      var m = BY_ID[x.mark];
      return '<span class="wm-chip" style="' + style(x.mark) + '" title="' + esc(m.label) + '">' +
        '<span class="wm-chip-word" dir="rtl">' + esc(x.word) + '</span><span class="wm-chip-kind">' + esc(m.short) + '</span></span>';
    }).join('');
  }

  var api = { MARKS: MARKS, byId: BY_ID, splitWords: splitWords, style: style, legendHtml: legendHtml, chipsHtml: chipsHtml, escapeHtml: esc };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PosukWordMarks = api;
})(typeof window !== 'undefined' ? window : this);
