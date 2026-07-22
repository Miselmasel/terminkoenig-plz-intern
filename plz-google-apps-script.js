// Terminkonig PLZ-Listen - Google Apps Script
// setupSheets()       -> Tabs + Header anlegen (einmalig)
// fixPlzLeadingZero() -> 4-stellige PLZ mit fuehrender Null ergaenzen
// fillPlzBlocks()     -> Spalte B mit PLZ3-Bloecken + Farbe fuellen
// exportJson()        -> import-plz-data.json fuer Admin-Panel erzeugen

var PLZ_GEBIET = 0;

// ----------------------------------------------------------------
// 1. EINMALIG: Tabs und Header anlegen
// ----------------------------------------------------------------
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.rename('Terminkonig PLZ-Listen ' + PLZ_GEBIET + 'xxxx');

  var tabNames = [];
  var start = PLZ_GEBIET === 0 ? 1 : PLZ_GEBIET * 10;
  var end   = PLZ_GEBIET === 0 ? 9 : PLZ_GEBIET * 10 + 9;
  for (var n = start; n <= end; n++) {
    tabNames.push(n < 10 ? '0' + n : '' + n);
  }

  var existing = ss.getSheets();
  existing[0].setName(tabNames[0]);
  for (var i = 1; i < tabNames.length; i++) {
    if (!ss.getSheetByName(tabNames[i])) {
      ss.insertSheet(tabNames[i]);
    }
  }

  var allSheets = ss.getSheets();
  for (var j = 0; j < allSheets.length; j++) {
    if (tabNames.indexOf(allSheets[j].getName()) === -1) {
      if (ss.getSheets().length > 1) {
        ss.deleteSheet(allSheets[j]);
      }
    }
  }

  var maxPairs = 20;
  for (var t = 0; t < tabNames.length; t++) {
    var ws = ss.getSheetByName(tabNames[t]);
    if (!ws) continue;

    ws.getRange(1, 1).setValue('PLZ-Gebiet: ' + tabNames[t] + 'xxx');
    ws.getRange(1, 1).setFontWeight('bold');

    var headers = ['Ampel', 'Block', 'PLZ', 'Ort'];
    for (var p = 0; p < maxPairs; p++) {
      headers.push('Datum ' + (p + 1));
      headers.push('Kunde ' + (p + 1));
    }

    var hRange = ws.getRange(5, 1, 1, headers.length);
    hRange.setValues([headers]);
    hRange.setFontWeight('bold');
    hRange.setBackground('#d9d9d9');

    ws.setColumnWidth(1, 50);
    ws.setColumnWidth(2, 70);
    ws.setColumnWidth(3, 70);
    ws.setColumnWidth(4, 150);
    for (var c = 5; c <= headers.length; c++) {
      ws.setColumnWidth(c, (c % 2 === 1) ? 90 : 150);
    }

    ws.setFrozenRows(5);
  }

  SpreadsheetApp.getUi().alert('Fertig! Tabs angelegt: ' + tabNames.join(', '));
}


// ----------------------------------------------------------------
// 2. PLZ-Format korrigieren: 4-stellig -> 5-stellig mit fuehrender Null
// ----------------------------------------------------------------
function fixPlzLeadingZero() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var fixed = 0;

  var allSheets = ss.getSheets();
  for (var t = 0; t < allSheets.length; t++) {
    var ws = allSheets[t];
    var lastRow = ws.getLastRow();
    if (lastRow < 6) continue;

    var plzRange = ws.getRange(6, 3, lastRow - 5, 1);
    var values   = plzRange.getValues();
    plzRange.setNumberFormat('@');

    for (var r = 0; r < values.length; r++) {
      var raw = String(values[r][0] || '').trim();
      if (/^\d{4}$/.test(raw)) {
        values[r][0] = '0' + raw;
        fixed++;
      }
    }
    plzRange.setValues(values);
  }

  SpreadsheetApp.getUi().alert('Fertig! ' + fixed + ' PLZ-Eintraege korrigiert.');
}


// ----------------------------------------------------------------
// 3. Spalte B mit PLZ3-Bloecken und abwechselnder Farbe fuellen
// ----------------------------------------------------------------
function fillPlzBlocks() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var filled = 0;

  var COLOR_A = '#ffffff';  // weiss
  var COLOR_B = '#cccccc';  // grau

  var allSheets = ss.getSheets();
  for (var t = 0; t < allSheets.length; t++) {
    var ws = allSheets[t];
    var lastRow = ws.getLastRow();
    if (lastRow < 6) continue;

    var plzVals   = ws.getRange(6, 3, lastRow - 5, 1).getValues();
    var blockVals = ws.getRange(6, 2, lastRow - 5, 1).getValues();

    var currentPlz3 = '';
    var blockIndex  = 0;
    var rowColors   = [];

    for (var r = 0; r < plzVals.length; r++) {
      var raw = String(plzVals[r][0] || '').trim();

      if (raw.length >= 5) {
        var plz3 = raw.substring(0, 3);
        if (plz3 !== currentPlz3) {
          blockVals[r][0] = plz3 + 'xx';
          currentPlz3 = plz3;
          blockIndex++;
          filled++;
        } else {
          blockVals[r][0] = '';
        }
      }

      rowColors.push((blockIndex % 2 === 1) ? COLOR_A : COLOR_B);
    }

    ws.getRange(6, 2, lastRow - 5, 1).setValues(blockVals);

    // Farbe nur auf Spalte B
    var colorGrid = rowColors.map(function(c) { return [c]; });
    ws.getRange(6, 2, lastRow - 5, 1).setBackgrounds(colorGrid);
  }

  SpreadsheetApp.getUi().alert('Fertig! ' + filled + ' Bloecke eingefaerbt.');
}


// ----------------------------------------------------------------
// 4. HILFSFUNKTIONEN
// ----------------------------------------------------------------
function isColored(hex) {
  return hex && hex !== '#ffffff' && hex !== '#000000';
}

function toPLZ5(raw) {
  var s = String(raw || '').trim();
  if (/^\d{4}$/.test(s)) { s = '0' + s; }
  if (/^(\d{5})-\d{5}/.test(s)) { s = s.substring(0, 5); }
  if (/^\d{5}$/.test(s)) { return s; }
  return null;
}

function formatDate(d) {
  return ('0' + d.getDate()).slice(-2) + '.' +
         ('0' + (d.getMonth() + 1)).slice(-2) + '.' +
         d.getFullYear();
}


// ----------------------------------------------------------------
// 5. JSON EXPORTIEREN
// ----------------------------------------------------------------
function exportJson() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var contacts     = {};
  var assignments  = [];
  var skippedColor = 0;
  var skippedPlz   = 0;
  var skippedPairs = 0;

  var allSheets = ss.getSheets();

  for (var t = 0; t < allSheets.length; t++) {
    var ws = allSheets[t];

    var lastRow = ws.getLastRow();
    var lastCol = ws.getLastColumn();
    if (lastRow < 6 || lastCol < 5) continue;

    var headerVals    = ws.getRange(5, 1, 1, lastCol).getValues()[0];
    var firstDatumIdx = 4;
    for (var h = 4; h < headerVals.length; h++) {
      if (String(headerVals[h]).toLowerCase().indexOf('datum') !== -1) {
        firstDatumIdx = h;
        break;
      }
    }

    var dataRange   = ws.getRange(6, 1, lastRow - 5, lastCol);
    var values      = dataRange.getValues();
    var backgrounds = dataRange.getBackgrounds();

    var currentCity = '';

    for (var r = 0; r < values.length; r++) {
      var row = values[r];
      // Farbe auf Kundename-Zellen pruefen (gruen=BSV, blau=RSV, orange=LS)
      // Spalte A ignorieren - relevante Farbe sitzt auf Spalte F, H, J usw.
      var nurWunsch = true;
      for (var ci2 = firstDatumIdx + 1; ci2 < row.length; ci2 += 2) {
        if (ci2 < backgrounds[r].length && isColored(backgrounds[r][ci2])) {
          nurWunsch = false;
          break;
        }
      }

      // Leere Zeilen (weder Farbe noch Inhalt) komplett überspringen
      var plzCheck = String(row[2] || '').trim();
      if (nurWunsch && !plzCheck) { skippedColor++; continue; }

      // Ort aus Spalte D tracken
      var ortText = String(row[3] || '').trim();
      if (ortText) { currentCity = ortText; }

      var plz5 = toPLZ5(row[2]);
      if (!plz5) {
        skippedPlz++;
        continue;
      }
      var plz3     = plz5.substring(0, 3);
      var plzLabel = currentCity ? (plz5 + ' ' + currentCity) : plz5;

      var pairs = [];
      for (var ci = firstDatumIdx; ci + 1 < row.length; ci += 2) {
        var datumVal = row[ci];
        var kundeVal = String(row[ci + 1] || '').trim();
        if (!kundeVal) continue;

        var dt = null;
        if (datumVal instanceof Date && !isNaN(datumVal.getTime())) {
          dt = datumVal;
        } else if (typeof datumVal === 'string') {
          var parts = datumVal.match(/(\d{2})\.(\d{2})\.(\d{4})/);
          if (parts) {
            dt = new Date(parseInt(parts[3]), parseInt(parts[2]) - 1, parseInt(parts[1]));
          }
        }

        if (dt) {
          pairs.push({ datum: dt, kunde: kundeVal });
        }
      }

      if (pairs.length === 0) {
        skippedPairs++;
        continue;
      }

      pairs.sort(function(a, b) {
        return b.datum.getTime() - a.datum.getTime();
      });

      for (var pi = 0; pi < pairs.length; pi++) {
        var sg     = pairs[pi].kunde;
        // Ohne Farbe = immer Wunsch; mit Farbe = neuestes belegt, ältere wunsch
        var status = (nurWunsch || pi > 0) ? 'wunsch' : 'belegt';
        var dStr   = formatDate(pairs[pi].datum);

        var cTyp    = 'bbm';
        var cBlWert = null;
        var blMatch = sg.match(/_BL(\d+)/i);
        if (blMatch) {
          cTyp    = 'bl';
          cBlWert = parseInt(blMatch[1]);
        }

        if (!contacts[sg]) {
          contacts[sg] = {
            suchbegriff: sg,
            typ:         cTyp,
            bl_wert:     cBlWert,
            notizen:     'PLZ-Import | ' + sg
          };
        }

        assignments.push({
          plz3:        plz3,
          plz5:        plz5,
          suchbegriff: sg,
          status:      status,
          datum:       dStr,
          notiz:       plzLabel + ' | ' + dStr
        });
      }
    }
  }

  var contactList = [];
  for (var key in contacts) {
    if (contacts.hasOwnProperty(key)) {
      contactList.push(contacts[key]);
    }
  }

  var result = {
    meta: {
      erstellt:        Utilities.formatDate(new Date(), 'Europe/Berlin', 'dd.MM.yyyy HH:mm'),
      kontakte:        contactList.length,
      zuweisungen:     assignments.length,
      ignor_farbe:     skippedColor,
      ignor_plz:       skippedPlz,
      ignor_leer:      skippedPairs
    },
    contacts:    contactList,
    assignments: assignments
  };

  var json = JSON.stringify(result, null, 2);
  var blob = Utilities.newBlob(json, 'application/json', 'import-plz-data.json');
  var file = DriveApp.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  var msg = 'JSON erstellt!\n\n' +
            'Kontakte:      ' + result.meta.kontakte    + '\n' +
            'Zuweisungen:   ' + result.meta.zuweisungen + '\n' +
            'Ignor. Farbe:  ' + result.meta.ignor_farbe + '\n' +
            'Ignor. PLZ:    ' + result.meta.ignor_plz   + '\n' +
            'Ignor. leer:   ' + result.meta.ignor_leer  + '\n\n' +
            'Download:\nhttps://drive.google.com/uc?export=download&id=' + file.getId();

  SpreadsheetApp.getUi().alert(msg);
}


// ----------------------------------------------------------------
// DEBUG
// ----------------------------------------------------------------
function debugRow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ws = ss.getSheets()[0];
  var lastCol = ws.getLastColumn();

  var bg  = ws.getRange(6, 1, 5, 1).getBackgrounds();
  var val = ws.getRange(6, 1, 5, Math.min(lastCol, 8)).getValues();

  var out = 'lastRow=' + ws.getLastRow() + ', lastCol=' + lastCol + '\n\n';
  for (var i = 0; i < 5; i++) {
    out += 'Z' + (i + 6) + ' Farbe=' + bg[i][0] + '\n';
    out += '  A=' + val[i][0] + ' | B=' + val[i][1] + ' | C=' + val[i][2] + ' | D=' + val[i][3] + '\n';
    out += '  E=' + val[i][4] + ' | F=' + val[i][5] + '\n\n';
  }
  SpreadsheetApp.getUi().alert(out);
}

function debugPLZ() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var out = '';

  var allSheets = ss.getSheets();
  for (var t = 0; t < allSheets.length; t++) {
    var ws = allSheets[t];
    var lastRow = ws.getLastRow();
    if (lastRow < 6) { out += ws.getName() + ': leer\n'; continue; }

    var bgs  = ws.getRange(6, 1, lastRow - 5, 1).getBackgrounds();
    var plzs = ws.getRange(6, 3, lastRow - 5, 1).getValues();

    var ok = 0, fail = 0, samples = [];
    for (var r = 0; r < plzs.length; r++) {
      if (!isColored(bgs[r][0])) continue;
      var raw = String(plzs[r][0] || '').trim();
      var s = raw;
      if (/^\d{4}$/.test(s)) s = '0' + s;
      if (/^(\d{5})-\d{5}/.test(s)) s = s.substring(0, 5);
      if (/^\d{5}$/.test(s)) {
        ok++;
      } else {
        fail++;
        if (samples.length < 3) samples.push('"' + raw + '"');
      }
    }
    out += ws.getName() + ': OK=' + ok + ' FAIL=' + fail;
    if (samples.length) out += '  [z.B.: ' + samples.join(', ') + ']';
    out += '\n';
  }
  SpreadsheetApp.getUi().alert(out);
}
