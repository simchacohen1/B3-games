'use strict';
// "Open for sending" rules (posuk recordings and Rashi readings).
//
// Everything is practice-only by default: a boy can always record, listen and
// mark himself, but he can only SEND a recording to the teacher when the item
// is open for him. The teacher opens items for a whole class or for one boy.
//
// Stored at b3Games/workspaces/<ws>/classes/<classId>/submissionOpen:
//   { all: true,                          // "Open all": everything is open for the class
//     items: { "p:Vayeira_18": true, ...},  // items open for the whole class
//     students: { <studentId>: { all: true, items: {...} } } }  // items open for one boy
//
// Item keys ("rules"):
//   p:<Parsha>                    a whole parsha        (parsha name without spaces, as in the posuk key)
//   p:<Parsha>_<perek>            one perek of it
//   p:<Parsha>_<perek>_<a>-<b>    posuk a to b of that perek
//   r:<sectionId>                 one Rashi section or passage (e.g. r:zayin, r:vayeira-18-1)

const RULE_RE = /^(?:p:[A-Za-z]{2,30}(?:_\d{1,3}(?:_\d{1,3}-\d{1,3})?)?|r:[A-Za-z0-9-]{1,40})$/;
const validRule = rule => typeof rule === 'string' && RULE_RE.test(rule);
const validKey = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);

function rulesOf(node){
  const out = [];
  if(!node || typeof node !== 'object') return out;
  for(const [rule, on] of Object.entries(node.items || {})) if(on === true && validRule(rule)) out.push(rule);
  return out;
}

// Does one rule cover this single posuk key ("Parsha_perek_n")?
function ruleCoversPosuk(rule, posukKey){
  if(!rule.startsWith('p:')) return false;
  const m = /^(.+)_(\d+)_(\d+)$/.exec(String(posukKey || ''));
  if(!m) return false;
  const [, parsha, perek, n] = m;
  const parts = rule.slice(2).split('_');
  if(parts[0] !== parsha) return false;
  if(parts.length === 1) return true;
  if(parts[1] !== perek) return false;
  if(parts.length === 2) return true;
  const range = /^(\d+)-(\d+)$/.exec(parts[2]);
  return !!range && Number(n) >= Number(range[1]) && Number(n) <= Number(range[2]);
}

// The class-wide rules plus this boy's own rules, and whether "Open all" is on.
function rulesFor(config, studentId){
  const own = studentId && config && config.students && config.students[studentId];
  return {
    all: !!(config && config.all === true) || !!(own && own.all === true),
    rules: [...new Set([...rulesOf(config), ...rulesOf(own)])]
  };
}

function isPosukOpen(config, studentId, posukKeys){
  const { all, rules } = rulesFor(config, studentId);
  if(all) return true;
  const keys = Array.isArray(posukKeys) ? posukKeys : [];
  if(!keys.length) return false;
  return keys.every(key => rules.some(rule => ruleCoversPosuk(rule, key)));
}

// r:<sectionId> opens one section; r:vayeira-18 opens every Vayeira 18 passage; r:vayeira opens all of them.
function ruleCoversRashi(rule, sectionId){
  if(!rule.startsWith('r:')) return false;
  const token = rule.slice(2), id = String(sectionId || '');
  return id === token || id.startsWith(token + '-');
}

function isRashiOpen(config, studentId, sectionId){
  const { all, rules } = rulesFor(config, studentId);
  return all || rules.some(rule => ruleCoversRashi(rule, sectionId));
}

// A readable name for a rule, for the teacher's list and the boys' "open now" list.
function ruleLabel(rule, rashiLabel){
  if(rule.startsWith('r:')){
    const token = rule.slice(2), named = rashiLabel && rashiLabel(token);
    if(named && named !== token) return 'Rashi · ' + named;
    const group = /^([a-z]+)-([0-9]+)$/.exec(token);
    if(group) return 'Rashi · ' + group[1][0].toUpperCase() + group[1].slice(1) + ' · Perek ' + group[2] + ' (all)';
    return 'Rashi · ' + token[0].toUpperCase() + token.slice(1) + ' (all)';
  }
  const parts = rule.slice(2).split('_');
  const name = parts[0].replace(/([a-z])([A-Z])/g, '$1 $2');
  if(parts.length === 1) return name;
  if(parts.length === 2) return `${name} · Perek ${parts[1]}`;
  const [a, b] = parts[2].split('-');
  return `${name} · Perek ${parts[1]} · Posuk ${a === b ? a : a + '–' + b}`;
}

// What a boy's page needs: is "all" on, which items are open for him, with names.
function publicStatus(config, studentId, rashiLabel){
  const { all, rules } = rulesFor(config, studentId);
  return { all, rules: rules.map(rule => ({ rule, label: ruleLabel(rule, rashiLabel) })) };
}

function checkRule(rule, isRashiSection){
  if(!validRule(rule)) return 'Choose a valid posuk or Rashi item.';
  if(rule.startsWith('p:')){
    const parts = rule.slice(2).split('_');
    if(parts[2]){
      const [a, b] = parts[2].split('-').map(Number);
      if(!(a >= 1 && b >= a && b <= 200)) return 'The posuk range is not valid.';
    }
  }else if(typeof isRashiSection === 'function' && !isRashiSection(rule.slice(2))) return 'That Rashi item does not exist.';
  return '';
}

// The database writes for one teacher action. Returns a path -> value map
// (null deletes) relative to the class node, or throws a message string.
function changesFor(body, isRashiSection, memberOf){
  const base = 'submissionOpen';
  const studentId = body.studentId == null || body.studentId === '' ? '' : String(body.studentId);
  if(studentId && (!validKey(studentId) || !memberOf(studentId))) throw 'That boy is not in this class.';
  const at = studentId ? `${base}/students/${studentId}` : base;
  if(body.op === 'open' || body.op === 'close'){
    const bad = checkRule(body.rule, isRashiSection);
    if(bad) throw bad;
    return { [`${at}/items/${body.rule}`]: body.op === 'open' ? true : null };
  }
  if(body.op === 'openAll'){
    return { [`${at}/all`]: true };
  }
  if(body.op === 'closeAll'){
    // Close all really closes everything for the class: the switch, every item, and every boy's own items.
    if(studentId) return { [`${at}/all`]: null, [`${at}/items`]: null };
    return { [base]: null };
  }
  throw 'Unknown open/close action.';
}

const api = { validRule, ruleCoversPosuk, ruleCoversRashi, rulesFor, isPosukOpen, isRashiOpen, ruleLabel, publicStatus, changesFor, checkRule, validKey };
// The same file runs in the teacher's browser (shared/submission-open-core.js is an exact copy; a test keeps them equal).
if(typeof module === 'object' && module.exports) module.exports = api;
else if(typeof self !== 'undefined') self.B3SubmissionOpenCore = api;
