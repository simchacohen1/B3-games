/* Roster download for Teacher Tools → Students.
 * Pure helpers (no page, no network): turn the roster rows the Students page already shows into a CSV file.
 * Columns: Class, Student name, Current passcode, Access status.
 * A cell that starts with = + - @ is prefixed with an apostrophe so a spreadsheet never runs a student name as a formula.
 */
(function (root) {
  'use strict';
  var HEADER = ['Class', 'Student name', 'Current passcode', 'Access status'];

  function cell(value) {
    var text = String(value == null ? '' : value).replace(/\r?\n|\r/g, ' ').trim();
    if (/^[=+\-@\t]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  // "Enabled", "Blocked in this class" (this class only) or "Account off" (the whole account, every class).
  function accessStatus(member, profile) {
    if (profile && profile.active === false) return 'Account off';
    if (member && member.active === false) return 'Blocked in this class';
    return 'Enabled';
  }

  // rows: [{className, name, passcode, status}] -> CSV text (UTF-8 with a byte-order mark so Excel reads Hebrew names).
  function rosterCsv(rows) {
    var lines = [HEADER.map(cell).join(',')];
    (rows || []).forEach(function (r) {
      lines.push([r.className, r.name, r.passcode, r.status].map(cell).join(','));
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  function fileName(label, date) {
    var day = (date || new Date()).toISOString().slice(0, 10);
    var slug = String(label || 'roster').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'roster';
    return 'roster-' + slug + '-' + day + '.csv';
  }

  var api = { HEADER: HEADER, cell: cell, accessStatus: accessStatus, rosterCsv: rosterCsv, fileName: fileName };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.B3RosterCsv = api;
})(typeof window !== 'undefined' ? window : this);
