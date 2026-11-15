/*
 * Owner Admin "Export Everything" (Issue #724): turns one table (an array of
 * rows, each an array of cell values) into a CSV and an Excel .xlsx file with
 * the same cells. Pure functions, no network or database access; the rows come
 * from funTorahManageStudents (owner only).
 *
 * The .xlsx is written by hand (a small uncompressed ZIP of the few XML parts
 * Excel needs) so the page does not load a spreadsheet library. Every cell is
 * stored as text, so passcodes keep their leading zeros.
 *
 * Shared by owner-admin.html (browser) and the tests (Node).
 */
(function (root) {
  'use strict';

  function cellText(v) {
    // Characters XML cannot hold are dropped from both files, so they stay identical.
    return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
  }

  // ---- CSV -----------------------------------------------------------------
  function csvCell(v) {
    v = cellText(v);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  // Starts with a byte-order mark so Excel reads Hebrew and accented names correctly.
  function toCsv(rows) {
    return '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  // ---- XLSX ----------------------------------------------------------------
  function xml(v) {
    return cellText(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function colName(i) {
    var s = '';
    for (i = i + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
    return s;
  }
  function sheetXml(rows) {
    var widths = [];
    rows.forEach(function (r) { r.forEach(function (c, i) { widths[i] = Math.min(60, Math.max(widths[i] || 10, cellText(c).length + 2)); }); });
    var body = rows.map(function (r, ri) {
      return '<row r="' + (ri + 1) + '">' + r.map(function (c, ci) {
        var t = cellText(c);
        if (!t) return '';
        return '<c r="' + colName(ci) + (ri + 1) + '" t="inlineStr"' + (ri === 0 ? ' s="1"' : '') + '><is><t xml:space="preserve">' + xml(t) + '</t></is></c>';
      }).join('') + '</row>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      (widths.length ? '<cols>' + widths.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>' : '') +
      '<sheetData>' + body + '</sheetData></worksheet>';
  }
  function xlsxParts(rows, sheetName) {
    var head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    var main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    var rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    var pkg = 'http://schemas.openxmlformats.org/package/2006/relationships';
    var type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
    return [
      ['[Content_Types].xml', head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="' + type + 'sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="' + type + 'worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="' + type + 'styles+xml"/></Types>'],
      ['_rels/.rels', head + '<Relationships xmlns="' + pkg + '"><Relationship Id="rId1" Type="' + rel + '/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', head + '<workbook xmlns="' + main + '" xmlns:r="' + rel + '"><sheets><sheet name="' + xml(String(sheetName || 'Export').replace(/[\\\/?*\[\]:]/g, ' ').slice(0, 31)) + '" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', head + '<Relationships xmlns="' + pkg + '"><Relationship Id="rId1" Type="' + rel + '/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="' + rel + '/styles" Target="styles.xml"/></Relationships>'],
      // Style 0 = plain, style 1 = bold (the header row).
      ['xl/styles.xml', head + '<styleSheet xmlns="' + main + '"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>'],
      ['xl/worksheets/sheet1.xml', sheetXml(rows)]
    ];
  }

  // ---- ZIP (stored, no compression) ------------------------------------------
  var CRC = null;
  function crc32(bytes) {
    if (!CRC) {
      CRC = [];
      for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = CRC[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(files) {
    var enc = new TextEncoder(), chunks = [], central = [], offset = 0;
    var u16 = function (v) { return [v & 255, (v >>> 8) & 255]; };
    var u32 = function (v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; };
    files.forEach(function (f) {
      var name = enc.encode(f[0]), data = enc.encode(f[1]), crc = crc32(data);
      // version 2.0, UTF-8 names, stored, fixed date 1 Jan 2026
      var shared = [].concat(u16(20), u16(0x0800), u16(0), u16(0), u16(0x5C21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      var local = new Uint8Array([].concat(u32(0x04034b50), shared));
      chunks.push(local, name, data);
      central.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), shared, u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
      offset += local.length + name.length + data.length;
    });
    var centralSize = central.reduce(function (n, c) { return n + c.length; }, 0);
    var end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralSize), u32(offset), u16(0)));
    var all = chunks.concat(central, [end]), out = new Uint8Array(all.reduce(function (n, c) { return n + c.length; }, 0)), at = 0;
    all.forEach(function (c) { out.set(c, at); at += c.length; });
    return out;
  }

  // Returns the .xlsx file as a Uint8Array. The first row is the header.
  function toXlsx(rows, sheetName) { return zip(xlsxParts(rows, sheetName)); }

  var XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  var api = { toCsv: toCsv, toXlsx: toXlsx, cellText: cellText, crc32: crc32, XLSX_TYPE: XLSX_TYPE };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FTTOwnerExport = api;
})(typeof window !== 'undefined' ? window : this);
