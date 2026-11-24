/* Owner Admin → Classes & Students: pure helpers (no page, no network).
 *
 *  - parsePastedNames(text): names pasted from a Google Sheet (one per line, tabs between cells) -> clean unique names.
 *  - matchPerson(name, people): is this name an existing student? 'match' (one clear match), 'ask' (several or close
 *    matches: the owner decides) or 'none' (a new student).
 *  - randomPasscode(): a 6-digit passcode for a student created from this page.
 *
 * Names are compared ignoring case, spaces, punctuation and word order, the same spirit as the server's same-name check.
 */
(function (root) {
  'use strict';

  function key(s) { return String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }
  function tokens(s) { return String(s || '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean); }
  function sortedKey(s) { return tokens(s).sort().join(' '); }

  function lev(a, b) {
    var prev = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      var cur = [i];
      for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }

  var HEADER_WORDS = { name: 1, names: 1, student: 1, students: 1, fullname: 1, studentname: 1, studentnames: 1 };

  // One name per line. A line copied from a sheet may have several cells (tab separated): numbers and emails are
  // ignored, up to three text cells are joined ("Moshe" + "Birk"), more than three keep only the first.
  function parsePastedNames(text) {
    var seen = {}, names = [], duplicates = 0;
    String(text || '').replace(/^﻿/, '').split(/\r?\n/).forEach(function (line) {
      var cells = line.split('\t').map(function (c) { return c.trim().replace(/^["'“”]+|["'“”]+$/g, '').trim(); })
        .filter(function (c) { return c && !/^[\d\s().-]+$/.test(c) && c.indexOf('@') < 0; });
      if (!cells.length) return;
      var name = cells.length <= 3 ? cells.join(' ') : cells[0];
      name = name.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/\s+/g, ' ').trim();
      // "Birk, Moshe" -> "Moshe Birk"
      var comma = name.split(',');
      if (comma.length === 2 && comma[0].trim() && comma[1].trim() && comma[0].trim().split(' ').length <= 3 && comma[1].trim().split(' ').length <= 3) {
        name = comma[1].trim() + ' ' + comma[0].trim();
      }
      if (!name || name.length > 100 || !key(name) || HEADER_WORDS[key(name)]) return;
      var k = key(name);
      if (seen[k]) { duplicates++; return; }
      seen[k] = true;
      names.push(name);
    });
    return { names: names, duplicates: duplicates };
  }

  // people: [{id, name}]. Returns {status, id?, candidates:[{id,name,reason}]}.
  function matchPerson(name, people) {
    var k = key(name), sk = sortedKey(name), list = people || [];
    if (!k) return { status: 'none', candidates: [] };
    var exact = list.filter(function (p) { return key(p.name) === k; });
    if (exact.length === 1) return { status: 'match', id: exact[0].id, candidates: [{ id: exact[0].id, name: exact[0].name, reason: 'same name' }] };
    if (exact.length > 1) return { status: 'ask', reason: 'two students have this name', candidates: exact.map(function (p) { return { id: p.id, name: p.name, reason: 'same name' }; }) };
    var close = [];
    list.forEach(function (p) {
      var pk = key(p.name), reason = '';
      if (sortedKey(p.name) === sk) reason = 'same words, different order';
      else if (pk && k.length >= 5 && lev(k, pk) <= (k.length >= 12 ? 2 : 1)) reason = 'spelled almost the same';
      else {
        var a = tokens(name), b = tokens(p.name), small = a.length <= b.length ? a : b, big = a.length <= b.length ? b : a;
        if (small.length >= 2 && small.every(function (t) { return big.indexOf(t) >= 0; })) reason = 'one name contains the other';
      }
      if (reason) close.push({ id: p.id, name: p.name, reason: reason, d: lev(k, pk) });
    });
    close.sort(function (x, y) { return x.d - y.d; });
    if (!close.length) return { status: 'none', candidates: [] };
    return { status: 'ask', reason: 'close to an existing student', candidates: close.slice(0, 5).map(function (c) { return { id: c.id, name: c.name, reason: c.reason }; }) };
  }

  // 6 digits, never starting with 0 (a spreadsheet would drop it).
  function randomPasscode(rand) {
    var r = rand || function (n) {
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) { var a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; }
      return Math.floor(Math.random() * n);
    };
    return String(100000 + r(900000));
  }

  // Students for the "Add student" box: names containing every typed word (any order), best matches first.
  function suggest(typed, people, limit) {
    var words = tokens(typed);
    if (!words.length) return [];
    var out = [];
    (people || []).forEach(function (p) {
      var t = tokens(p.name), starts = 0;
      var all = words.every(function (w) { var hit = t.some(function (x) { return x.indexOf(w) === 0; }); if (hit) starts++; return hit || t.some(function (x) { return x.indexOf(w) >= 0; }); });
      if (all) out.push({ p: p, score: (key(p.name) === key(typed) ? 100 : 0) + starts });
    });
    out.sort(function (a, b) { return b.score - a.score || String(a.p.name).localeCompare(String(b.p.name)); });
    return out.slice(0, limit || 8).map(function (o) { return o.p; });
  }

  var api = { key: key, parsePastedNames: parsePastedNames, matchPerson: matchPerson, randomPasscode: randomPasscode, suggest: suggest };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.B3ClassRoster = api;
})(typeof window !== 'undefined' ? window : this);
