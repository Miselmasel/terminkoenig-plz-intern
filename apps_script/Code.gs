// ===== Terminkönig PLZ-Karte – Google Apps Script (komplett) =====
// Deployte Version, Stand 21.07.2026
// Deployment: gleiche Deployment-ID beibehalten (Deployen → Verwalten → Stift → Neue Version)
// URL in api/config.php als SHEETS_SCRIPT_URL hinterlegt

var API_KEY = 'TK_Sync_2026';

// ---- Hilfsfunktionen ----

function isColored(color) {
  if (!color) return false;
  var c = color.toLowerCase().replace(/\s/g, '');
  return c !== '#ffffff' && c !== 'white' && c !== 'null' && c !== '';
}

function formatDatum(val) {
  if (!val) return '';
  if (val instanceof Date && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, 'Europe/Berlin', 'dd.MM.yyyy');
  }
  return String(val).trim();
}

function parseDatum(s) {
  if (!s) return new Date();
  var parts = String(s).split('.');
  if (parts.length === 3) {
    return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
  }
  return new Date();
}

// Block-Zelle → Liste von PLZ3 (unterstützt "013", "013xx", "013-015", Zahl 13)
function blockToPlz3List(raw) {
  var s = String(raw || '').trim();
  if (!s) return [];
  var m = s.match(/(\d+)\s*-\s*(\d+)/);
  var startS, endS;
  if (m) { startS = m[1]; endS = m[2]; }
  else {
    var d = s.replace(/[^0-9]/g, '');
    if (!d) return [];
    startS = endS = d.substring(0, 3);
  }
  while (startS.length < 3) startS = '0' + startS;
  while (endS.length < 3) endS = '0' + endS;
  var a = parseInt(startS.substring(0, 3), 10);
  var b = parseInt(endS.substring(0, 3), 10);
  var out = [];
  for (var p = a; p <= b && out.length < 100; p++) {
    out.push(('00' + p).slice(-3));
  }
  return out;
}

// Layout eines Tabs erkennen: Header-Zeile ("Datum 1") + Block-Spalte
function findLayout(data) {
  var headerRow = -1, datumCol = -1, blockCol = -1;
  for (var r = 0; r < Math.min(data.length, 30) && headerRow < 0; r++) {
    for (var c = 0; c < data[r].length; c++) {
      var v = String(data[r][c] || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (v === 'datum 1') { headerRow = r; datumCol = c; break; }
    }
  }
  if (headerRow < 0) return null;

  for (var c2 = 0; c2 < datumCol; c2++) {
    var h = String(data[headerRow][c2] || '').toLowerCase();
    if (h.indexOf('block') >= 0 || h.indexOf('plz') >= 0) { blockCol = c2; break; }
  }
  if (blockCol < 0) {
    var bestCount = 0;
    for (var c3 = 0; c3 < datumCol; c3++) {
      var count = 0;
      for (var r2 = headerRow + 1; r2 < data.length; r2++) {
        if (/^\d{2,}/.test(String(data[r2][c3] || '').trim())) count++;
      }
      if (count > bestCount) { bestCount = count; blockCol = c3; }
    }
  }
  if (blockCol < 0) return null;
  return { headerRow: headerRow, blockCol: blockCol, datumCol: datumCol };
}

// ---- doGet: Sheet → Karte (alle Tabs) ----

function doGet(e) {
  var key = (e && e.parameter) ? e.parameter.key : null;
  if (key !== API_KEY) {
    return ContentService.createTextOutput(JSON.stringify({error: 'Unauthorized'}))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var sheets      = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  var rows        = [];
  var block_stats = {};
  var tabs        = [];

  for (var s = 0; s < sheets.length; s++) {
    var sheet   = sheets[s];
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 2) continue;

    var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var bgs  = sheet.getRange(1, 1, lastRow, lastCol).getBackgrounds();

    var layout = findLayout(data);
    if (!layout) continue;

    tabs.push(sheet.getName());

    for (var r = layout.headerRow + 1; r < data.length; r++) {
      var plzRaw = String(data[r][layout.blockCol] || '').trim();
      if (!plzRaw || !/\d/.test(plzRaw)) continue;

      var assignments = [], rowTotal = 0, rowBelegt = 0;

      for (var c = layout.datumCol + 1; c < data[r].length; c += 2) {
        var kunde = String(data[r][c] || '').trim();
        if (!kunde) continue;
        var colored = isColored(bgs[r][c]) || isColored(bgs[r][c - 1]);
        rowTotal++;
        if (colored) rowBelegt++;
        assignments.push({
          datum: formatDatum(data[r][c - 1]),
          kunde: kunde,
          status: colored ? 'belegt' : 'wunsch'
        });
      }

      rows.push({plz_raw: plzRaw, assignments: assignments});

      blockToPlz3List(plzRaw).forEach(function(d) {
        if (!block_stats[d]) block_stats[d] = {total: 0, belegt: 0};
        block_stats[d].total  += rowTotal;
        block_stats[d].belegt += rowBelegt;
      });
    }
  }

  return ContentService.createTextOutput(JSON.stringify({rows: rows, block_stats: block_stats, tabs: tabs}))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- doPost: Karte → Sheet (schreibt in ALLE Zeilen des Blocks) ----

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.key !== API_KEY) {
      return ContentService.createTextOutput(JSON.stringify({error: 'Unauthorized'}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var plz3   = String(body.plz3  || '').trim();
    var kunde  = String(body.kunde || '').trim();
    var status = body.status || 'wunsch';
    var datum  = String(body.datum || '').trim();

    if (!plz3 || !kunde) {
      return ContentService.createTextOutput(JSON.stringify({error: 'plz3 und kunde erforderlich'}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var BELEGT_COLOR = '#92d050';
    var WUNSCH_COLOR = '#ffffff';
    var sheets  = SpreadsheetApp.getActiveSpreadsheet().getSheets();
    var written = 0;
    var tabName = null;

    for (var s = 0; s < sheets.length; s++) {
      var sheet   = sheets[s];
      var lastRow = sheet.getLastRow();
      var lastCol = sheet.getLastColumn();
      if (lastRow < 2 || lastCol < 2) continue;

      var data   = sheet.getRange(1, 1, lastRow, lastCol).getValues();
      var layout = findLayout(data);
      if (!layout) continue;

      // ALLE Zeilen finden, deren Block die PLZ3 enthält
      var rowIdxList = [];
      for (var r = layout.headerRow + 1; r < data.length; r++) {
        if (blockToPlz3List(data[r][layout.blockCol]).indexOf(plz3) >= 0) {
          rowIdxList.push(r);
        }
      }
      if (rowIdxList.length === 0) continue;

      tabName = sheet.getName();
      var color = (status === 'belegt') ? BELEGT_COLOR : WUNSCH_COLOR;

      for (var k = 0; k < rowIdxList.length; k++) {
        var rowIdx   = rowIdxList[k];
        var sheetRow = rowIdx + 1; // data[0] = Zeile 1
        var rowVals  = data[rowIdx];

        // Vorhandenen Kunde-Eintrag in dieser Zeile suchen
        var found = -1;
        for (var c = layout.datumCol + 1; c < rowVals.length; c += 2) {
          if (String(rowVals[c] || '').trim() === kunde) { found = c; break; }
        }

        if (found >= 0) {
          sheet.getRange(sheetRow, found).setBackground(color);     // Datum
          sheet.getRange(sheetRow, found + 1).setBackground(color); // Kunde
          written++;

        } else if (status === 'belegt') {
          var done = false;
          for (var i = layout.datumCol; i < rowVals.length - 1; i += 2) {
            if (!String(rowVals[i + 1] || '').trim()) {
              sheet.getRange(sheetRow, i + 1).setValue(parseDatum(datum));
              sheet.getRange(sheetRow, i + 1).setBackground(BELEGT_COLOR);
              sheet.getRange(sheetRow, i + 2).setValue(kunde);
              sheet.getRange(sheetRow, i + 2).setBackground(BELEGT_COLOR);
              done = true;
              break;
            }
          }
          if (!done) {
            sheet.getRange(sheetRow, lastCol + 1).setValue(parseDatum(datum));
            sheet.getRange(sheetRow, lastCol + 1).setBackground(BELEGT_COLOR);
            sheet.getRange(sheetRow, lastCol + 2).setValue(kunde);
            sheet.getRange(sheetRow, lastCol + 2).setBackground(BELEGT_COLOR);
          }
          written++;
        }
      }

      break; // Block gefunden – keine weiteren Tabs nötig
    }

    if (!tabName) {
      return ContentService.createTextOutput(JSON.stringify({error: 'PLZ nicht gefunden: ' + plz3}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ok: true, tab: tabName, zeilen: written}))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({error: err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
