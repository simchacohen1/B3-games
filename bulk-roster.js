/*
 * Bulk roster CSV: parsing, grouping and validation (Issue #706).
 *
 * Shared by owner-admin.html (browser) and the tests (Node). Pure functions,
 * no database access. The server re-checks everything it is sent.
 *
 * New format (one row per person, classes separated by semicolons):
 *   Type,Name,Email,Passcode,Classes,Student ID
 *   Class,B2 ET Morning,,,
 *   Teacher,Rabbi Example,teacher@example.com,,B2 ET Morning; B2 ET Afternoon
 *   Student,Moshe Birk,,482731,B2 ET Morning; B2 ET Afternoon
 *
 * Older files (one row per student per class, header "class") still work:
 * rows with the same name AND the same passcode become ONE student with
 * several classes. Same name with a different passcode stays two students
 * (two children can share a name) and is reported as a warning.
 */
(function (root) {
  'use strict';
  var TYPES = ['class', 'principal', 'teacher', 'student'];
  var ORDER = { 'class': 0, principal: 1, teacher: 1, student: 2 };
  var ID = /^[A-Za-z0-9_-]{1,100}$/;
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var PASSCODE = /^[0-9]{6}$/;

  var TEMPLATE_ROWS = [
    'Type,Name,Email,Passcode,Classes,Student ID',
    'Class,B2 ET Morning,,,,',
    'Class,B2 ET Afternoon,,,,',
    'Teacher,Rabbi Example,teacher@example.com,,B2 ET Morning; B2 ET Afternoon,',
    'Principal,Mrs. Example,principal@example.com,,,',
    'Student,Moshe Example,,482731,B2 ET Morning; B2 ET Afternoon,',
    'Student,Chaim Example,,195604,B2 ET Morning,'
  ];

  // Same rule the server and sign-in use: case, spaces and punctuation ignored.
  function nameKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function classKey(s) { return String(s || '').normalize('NFKC').toLowerCase().replace(/[·�]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim(); }
  // Case, spaces and punctuation all ignored: "B6WT", "b6 wt" and "B6  W.T." are the same class name.
  function squash(s) { return String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }
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
  // Existing class names that look like a name from the file but are not the same ("B6 WT" -> "B6 WT Boys").
  function nearClasses(name, names) {
    var k = squash(name), seen = {};
    if (!k) return [];
    return (names || []).filter(function (n) {
      var c = squash(n);
      if (!c || c === k || seen[c]) return false;
      var near = (k.length >= 2 && (c.indexOf(k) === 0 || k.indexOf(c) === 0)) || (k.length >= 4 && lev(k, c) <= (k.length >= 8 ? 2 : 1));
      if (near) seen[c] = true;
      return near;
    }).sort(function (a, b) { return Math.abs(squash(a).length - k.length) - Math.abs(squash(b).length - k.length); }).slice(0, 4);
  }
  function cleanName(s) { return String(s || '').replace(/[\t\r\n]+/g, ' ').replace(/ {2,}/g, ' ').trim(); }

  function splitLine(line) {
    var fields = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
      else if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    fields.push(cur.trim());
    return fields;
  }

  function headerKey(h) {
    var k = String(h || '').toLowerCase().replace(/[^a-z]+/g, '');
    if (k === 'password') return 'passcode';
    if (k === 'class') return 'class';
    if (k === 'classes') return 'classes';
    if (k === 'studentname' || k === 'fullname') return 'name';
    if (k === 'studentid' || k === 'id' || k === 'rosterid' || k === 'externalid') return 'rosterId';
    return k;
  }

  function typeKey(v) {
    var t = String(v || '').toLowerCase().replace(/[^a-z]+/g, '');
    return t === 'classes' ? 'class' : t === 'teachers' ? 'teacher' : t === 'principals' ? 'principal' : t === 'students' ? 'student' : t;
  }

  function splitClasses(v) {
    return String(v || '').split(/[;|\n]/).map(function (s) { return cleanName(s); }).filter(Boolean);
  }

  // Returns { rows, legacyFormat, errors } where each row is
  // { row, type, name, email, passcode, classes: [names], rosterId }.
  function parse(text) {
    var lines = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').filter(function (l) { return l.trim(); });
    if (!lines.length) return { rows: [], legacyFormat: false, errors: ['The file is empty.'] };
    var header = splitLine(lines[0]).map(headerKey);
    var col = function (k) { return header.indexOf(k); };
    var errors = [];
    // No Type column: every row is a student (the usual case for a list copied from a sheet). Not an error.
    var typeAssumed = col('type') < 0 && col('name') >= 0;
    if (col('name') < 0) errors.push('The first row must be the header, with at least a Name column: Name, Passcode, Classes.');
    var hasClasses = col('classes') >= 0, hasClass = col('class') >= 0;
    var rows = lines.slice(1).map(function (line, i) {
      var f = splitLine(line);
      var get = function (k) { return col(k) >= 0 ? String(f[col(k)] || '').trim() : ''; };
      var classes = splitClasses(hasClasses ? get('classes') : get('class'));
      if (hasClasses && hasClass && get('class')) classes = classes.concat(splitClasses(get('class')));
      return {
        row: i + 2,
        type: typeAssumed ? 'student' : typeKey(get('type')),
        name: cleanName(get('name')),
        email: get('email').toLowerCase(),
        passcode: get('passcode'),
        classes: classes,
        rosterId: get('rosterId')
      };
    }).filter(function (r) { return r.type || r.name; });
    return { rows: rows, legacyFormat: !hasClasses && hasClass, errors: errors, typeAssumed: typeAssumed };
  }

  // Groups rows into one entry per class, person and student, and validates.
  // existingClassNames: names of classes that already exist on the site.
  // opts.classDecisions: { squash(name): {type:'create'} | {type:'use', name:'Existing class'} } for names not on the site yet.
  function plan(parsed, existingClassNames, opts) {
    opts = opts || {};
    var rows = parsed.rows || [];
    var errors = (parsed.errors || []).slice(), warnings = [], autoFixes = [], fixSeen = {};
    if (parsed.typeAssumed) autoFixes.push('No Type column, so every row is treated as a student.');
    var known = {}, ambiguous = {}, knownNames = [];
    (existingClassNames || []).forEach(function (n) { var k = squash(n); if (!k) return; if (known[k]) ambiguous[k] = true; known[k] = n; knownNames.push(n); });
    var fileClasses = {}, lastOrder = 0, orderWarned = false;
    rows.forEach(function (r) {
      var at = 'Row ' + r.row + ': ';
      if (TYPES.indexOf(r.type) < 0) { errors.push(at + 'Type must be Class, Principal, Teacher or Student (found "' + r.type + '").'); return; }
      if (!r.name) { errors.push(at + 'missing name.'); return; }
      if (r.name.length > 100) errors.push(at + 'name is longer than 100 characters.');
      if (ORDER[r.type] < lastOrder && !orderWarned) { warnings.push(at + 'put Classes first, then Teachers and Principals, then Students. The file is still processed in that order.'); orderWarned = true; }
      lastOrder = Math.max(lastOrder, ORDER[r.type]);
      if (r.type === 'class') {
        var k = squash(r.name);
        if (!k) errors.push(at + 'class name needs letters or numbers.');
        else if (fileClasses[k]) warnings.push(at + 'class "' + r.name + '" is listed twice (kept once).');
        else fileClasses[k] = r.name;
      }
    });
    // Several site classes with one name are not an error here: the server lists them and the owner picks one.
    var missing = {}, usedCreate = {};
    var decision = function (k) { return opts.classDecisions && opts.classDecisions[k]; };
    var fixed = function (typed, name) { if (typed !== name && !fixSeen[typed + '>' + name]) { fixSeen[typed + '>' + name] = 1; autoFixes.push('Class "' + typed + '" matched "' + name + '".'); } return name; };
    // The class name to send to the server, or '' while the owner still has to decide about a class that is not on the site.
    var resolveName = function (n) {
      var k = squash(n);
      if (!k) return '';
      if (ambiguous[k]) return n;
      if (fileClasses[k]) return fixed(n, fileClasses[k]);
      if (known[k]) return fixed(n, known[k]);
      var d = decision(k);
      if (d && d.type === 'use' && d.name && known[squash(d.name)]) return known[squash(d.name)];
      if (d && d.type === 'create') { usedCreate[k] = usedCreate[k] || n; return usedCreate[k]; }
      (missing[k] = missing[k] || { key: k, name: n, count: 0, suggestions: nearClasses(n, knownNames) }).count++;
      return '';
    };

    var classesToCreate = Object.keys(fileClasses).filter(function (k) { return !known[k]; }).map(function (k) { return fileClasses[k]; });
    var existingClassesInFile = Object.keys(fileClasses).filter(function (k) { return known[k]; }).map(function (k) { return known[k]; });

    // Staff: one entry per email; several rows add classes.
    var staff = {}, staffList = [];
    rows.filter(function (r) { return r.type === 'teacher' || r.type === 'principal'; }).forEach(function (r) {
      var at = 'Row ' + r.row + ': ';
      if (!EMAIL.test(r.email)) { errors.push(at + r.type + ' needs a valid email.'); return; }
      var cls = [];
      r.classes.forEach(function (c) { var n = resolveName(c); if (n) cls.push(n); });
      var s = staff[r.email];
      if (s) {
        if (s.role !== r.type) errors.push(at + r.email + ' is listed as both ' + s.role + ' and ' + r.type + '.');
        if (nameKey(s.name) !== nameKey(r.name)) warnings.push(at + r.email + ' is listed with two names; using "' + s.name + '".');
        cls.forEach(function (c) { if (s.classes.indexOf(c) < 0) s.classes.push(c); });
        s.rows.push(r.row);
      } else {
        s = staff[r.email] = { role: r.type, name: r.name, email: r.email, classes: [], rows: [r.row] };
        cls.forEach(function (c) { if (s.classes.indexOf(c) < 0) s.classes.push(c); });
        staffList.push(s);
      }
    });

    // Students: one entry per (Student ID) or per (name + passcode).
    var students = [], byKey = {}, byName = {};
    rows.filter(function (r) { return r.type === 'student'; }).forEach(function (r) {
      var at = 'Row ' + r.row + ': ';
      var bad = false;
      if (!PASSCODE.test(r.passcode)) { errors.push(at + 'student passcode must be exactly 6 digits.'); bad = true; }
      if (!r.classes.length) { errors.push(at + 'student needs at least one class.'); bad = true; }
      if (r.rosterId && !ID.test(r.rosterId)) { errors.push(at + 'Student ID may only use letters, numbers, - and _.'); bad = true; }
      var cls = [];
      var pending = false;
      r.classes.forEach(function (c) { var n = resolveName(c); if (n) cls.push(n); else pending = true; });
      if (bad || pending) return;
      var k = r.rosterId ? 'id:' + r.rosterId : 'np:' + nameKey(r.name) + '|' + r.passcode;
      var s = byKey[k];
      if (s) {
        if (r.rosterId && (nameKey(s.name) !== nameKey(r.name) || s.passcode !== r.passcode)) { errors.push(at + 'Student ID ' + r.rosterId + ' is used for two different students (rows ' + s.rows[0] + ' and ' + r.row + ').'); return; }
        var added = false;
        cls.forEach(function (c) { if (s.classes.indexOf(c) < 0) { s.classes.push(c); added = true; } });
        s.rows.push(r.row);
        if (!parsed.legacyFormat) warnings.push(at + r.name + ' is listed again' + (added ? '; classes were combined into one student.' : ' with the same classes (duplicate row skipped).'));
        return;
      }
      s = byKey[k] = { key: k, name: r.name, passcode: r.passcode, rosterId: r.rosterId || '', classes: [], rows: [r.row] };
      cls.forEach(function (c) { if (s.classes.indexOf(c) < 0) s.classes.push(c); });
      students.push(s);
      (byName[nameKey(r.name)] = byName[nameKey(r.name)] || []).push(s);
    });
    Object.keys(byName).forEach(function (n) {
      var g = byName[n];
      if (g.length < 2) return;
      var codes = {};
      g.forEach(function (s) { codes[s.passcode] = (codes[s.passcode] || 0) + 1; });
      if (Object.keys(codes).some(function (c) { return codes[c] > 1; }))
        errors.push(g[0].name + ': two different Student IDs have the same name and passcode, so they could not sign in. Give each child a different passcode.');
      else warnings.push(g[0].name + ' appears as ' + g.length + ' different students (different passcodes, rows ' + g.map(function (s) { return s.rows[0]; }).join(', ') + '). They will be separate accounts. If it is one child, give every row the same passcode.');
    });
    return {
      legacyFormat: !!parsed.legacyFormat,
      errors: errors, warnings: warnings,
      classesToCreate: classesToCreate.concat(Object.keys(usedCreate).filter(function (k) { return !known[k] && !fileClasses[k]; }).map(function (k) { return usedCreate[k]; })),
      existingClassesInFile: existingClassesInFile,
      autoFixes: autoFixes,
      missingClasses: Object.keys(missing).map(function (k) { return missing[k]; }),
      staff: staffList, students: students
    };
  }

  function csvCell(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function toCsv(rows) { return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n'); }

  // A deterministic batch id for one file, so re-running the same file resumes
  // the same batch instead of starting a new one.
  function batchIdFor(text) {
    var h1 = 0x811c9dc5, h2 = 0x01000193, s = String(text || '').replace(/\r\n?/g, '\n').trim();
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
    }
    return 'imp_' + ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8);
  }

  var api = { squash: squash, nearClasses: nearClasses, TEMPLATE_ROWS: TEMPLATE_ROWS, parse: parse, plan: plan, nameKey: nameKey, classKey: classKey, cleanName: cleanName, splitClasses: splitClasses, toCsv: toCsv, batchIdFor: batchIdFor, PASSCODE: PASSCODE };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FTTBulkRoster = api;
})(typeof window !== 'undefined' ? window : this);
