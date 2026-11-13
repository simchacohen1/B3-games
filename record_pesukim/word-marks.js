/* Posuk Practice word marks (Issue #749).
   On a recording card the teacher taps a Hebrew word when it was read wrong,
   and taps the small T under a word when its translation was wrong. Those two
   switches are saved as one mark per word: readWrongTransOk, readOkTransWrong
   or bothWrong (see markFor / flags below). The other ids are kept so grades
   saved earlier still display.
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
  // The two switches on a word (read wrong / translation wrong) -> the saved mark id.
  function markFor(readWrong, transWrong){
    if(readWrong && transWrong) return 'bothWrong';
    if(readWrong) return 'readWrongTransOk';
    if(transWrong) return 'readOkTransWrong';
    return '';
  }
  // The reverse: a saved mark id -> which switches are on.
  function flags(id){
    return {
      read: id === 'readWrongTransOk' || id === 'bothWrong' || id === 'incorrect',
      trans: id === 'readOkTransWrong' || id === 'bothWrong'
    };
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

  // The whole posuk for the student, right to left, with the words the teacher
  // marked shown in colour: red = read wrong, blue = translation wrong, purple =
  // both. A small tag under each marked word says which, so colour is not the
  // only signal. Returns '' when nothing was marked. If the saved Hebrew does
  // not line up with the marks (an older record), it falls back to the chips.
  function feedbackHtml(hebrewText, list){
    if(!Array.isArray(list)) return '';
    var marks = list.filter(function(x){ return x && BY_ID[x.mark]; });
    if(!marks.length) return '';
    var words = splitWords(hebrewText), byIndex = {};
    var lined = words.length && marks.every(function(x){
      byIndex[x.i] = x;
      return Number.isInteger(x.i) && x.i >= 0 && x.i < words.length && words[x.i] === x.word;
    });
    if(!lined) return '<div class="wm-chips">' + chipsHtml(marks) + '</div>';
    var reads = 0, trans = 0, other = 0;
    var body = words.map(function(w, n){
      var x = byIndex[n];
      if(!x) return '<span class="wm-fb-word">' + esc(w) + '</span>';
      var f = flags(x.mark), kind, tag;
      if(f.read && f.trans){ kind = 'both'; tag = 'Read + translation'; reads++; trans++; }
      else if(f.read){ kind = 'read'; tag = 'Read wrong'; reads++; }
      else if(f.trans){ kind = 'trans'; tag = 'Translation'; trans++; }
      else { kind = 'other'; tag = BY_ID[x.mark].short; other++; }
      return '<span class="wm-fb-word wm-fb-' + kind + '" title="' + esc(BY_ID[x.mark].label) + '">' + esc(w) +
        '<span class="wm-fb-tag" dir="ltr">' + esc(tag) + '</span></span>';
    }).join(' ');
    var parts = [];
    if(reads) parts.push(reads + ' word' + (reads === 1 ? '' : 's') + ' read wrong');
    if(trans) parts.push(trans + ' word' + (trans === 1 ? '' : 's') + ' translated wrong');
    if(other) parts.push(other + ' other mark' + (other === 1 ? '' : 's'));
    return '<div class="wm-fb"><div class="wm-fb-title">Words your teacher marked: ' + esc(parts.join(' · ')) + '</div>' +
      '<div class="wm-fb-posuk" dir="rtl" lang="he">' + body + '</div></div>';
  }

  var api = { MARKS: MARKS, feedbackHtml: feedbackHtml, byId: BY_ID, splitWords: splitWords, style: style, markFor: markFor, flags: flags, chipsHtml: chipsHtml, escapeHtml: esc };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PosukWordMarks = api;
})(typeof window !== 'undefined' ? window : this);
