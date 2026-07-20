'use strict';

window.plzStatusData = {};
window.statusMode    = false;
var allContacts      = [];
var selectedPlz3     = null;
var currentContactId = null;

// localStorage-Fallback wenn PHP-Server nicht verfügbar (lokales Testen)
var localMode = false;
var localContacts = JSON.parse(localStorage.getItem('tk_contacts') || '[]');
var localNextId   = parseInt(localStorage.getItem('tk_next_id')   || '1');

function saveLocalContacts() {
  localStorage.setItem('tk_contacts', JSON.stringify(localContacts));
  localStorage.setItem('tk_next_id',  String(localNextId));
}

// ─── Login ────────────────────────────────────────────────────────
async function checkLogin() {
  try {
    var res  = await fetch('api/auth.php?action=me');
    var data = await res.json();
    if (!data.ok) { location.href = 'login.html'; return; }
    window.currentUserRole = data.role;
    var el = document.getElementById('lpUserName');
    if (el) el.textContent = data.name || data.email;
    if (data.role === 'admin') {
      var um = document.getElementById('lpUserMgmt');
      if (um) { um.style.display = ''; loadUsers(); }
    }
  } catch(e) { location.href = 'login.html'; }
}

async function doLogout() {
  try { await fetch('api/auth.php?action=logout'); } catch(e) {}
  location.href = 'login.html';
}

function openChangePassword() {
  var m = document.getElementById('changePwModal');
  document.getElementById('cpOld').value  = '';
  document.getElementById('cpNew').value  = '';
  document.getElementById('cpNew2').value = '';
  document.getElementById('changePwErr').style.display = 'none';
  document.getElementById('changePwOk').style.display  = 'none';
  document.getElementById('cpSaveBtn').disabled = false;
  m.style.display = 'flex';
  document.getElementById('cpOld').focus();
}

function closeChangePassword() {
  document.getElementById('changePwModal').style.display = 'none';
}

async function doChangePassword() {
  var old  = document.getElementById('cpOld').value;
  var nw   = document.getElementById('cpNew').value;
  var nw2  = document.getElementById('cpNew2').value;
  var errEl = document.getElementById('changePwErr');
  var okEl  = document.getElementById('changePwOk');
  var btn   = document.getElementById('cpSaveBtn');

  errEl.style.display = 'none';
  okEl.style.display  = 'none';

  if (!old) { errEl.textContent = 'Bitte aktuelles Passwort eingeben.'; errEl.style.display = ''; return; }
  if (nw.length < 8) { errEl.textContent = 'Neues Passwort muss mindestens 8 Zeichen lang sein.'; errEl.style.display = ''; return; }
  if (nw !== nw2) { errEl.textContent = 'Die neuen Passwörter stimmen nicht überein.'; errEl.style.display = ''; return; }

  btn.disabled = true; btn.textContent = 'Bitte warten…';
  try {
    var res  = await fetch('api/auth.php?action=change-password', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({old_password: old, new_password: nw})
    });
    var data = await res.json();
    if (data.ok) {
      okEl.style.display = '';
      document.getElementById('cpOld').value  = '';
      document.getElementById('cpNew').value  = '';
      document.getElementById('cpNew2').value = '';
      setTimeout(closeChangePassword, 1800);
    } else {
      errEl.textContent = data.error || 'Fehler beim Ändern des Passworts.';
      errEl.style.display = '';
    }
  } catch(e) {
    errEl.textContent = 'Server nicht erreichbar.';
    errEl.style.display = '';
  }
  btn.disabled = false; btn.textContent = 'Speichern';
}

// ─── Panel-Toggles ────────────────────────────────────────────────
function toggleLP() {
  var col = document.body.classList.toggle('lp-col');
  document.getElementById('lpToggleBtn').textContent = col ? '▶' : '◀';
  setTimeout(function() { if (typeof map !== 'undefined') map.invalidateSize(); }, 260);
}

function toggleSB() {
  var col = document.body.classList.toggle('sb-col');
  document.getElementById('sbToggleBtn').textContent = col ? '◀' : '▶';
  setTimeout(function() { if (typeof map !== 'undefined') map.invalidateSize(); }, 260);
}

// ─── PLZ-Status laden (gruppiert nach PLZ als Array) ─────────────
async function loadPlzStatus() {
  try {
    var res  = await fetch('api/plz_status.php');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    window.plzStatusData = {};
    data.forEach(function(d) {
      if (!window.plzStatusData[d.plz3]) window.plzStatusData[d.plz3] = [];
      window.plzStatusData[d.plz3].push(d);
    });
    updateStatusCount();
    if (window.statusMode && typeof refreshAll === 'function') refreshAll();
  } catch(e) { console.warn('PLZ-Status nicht geladen:', e); }
}

function updateStatusCount() {
  var keys = Object.keys(window.plzStatusData);
  var b = keys.filter(function(k) { return window.plzStatusData[k].some(function(e) { return e.status === 'belegt'; }); }).length;
  var r = keys.filter(function(k) { return window.plzStatusData[k].some(function(e) { return e.status === 'reserviert'; }); }).length;
  var w = keys.filter(function(k) { return window.plzStatusData[k].some(function(e) { return e.status === 'wunsch'; }); }).length;
  var el = document.getElementById('lpStatusCount');
  if (el) el.textContent = b + ' belegt · ' + r + ' reserviert · ' + w + ' Wunsch';
}

function toggleStatusMode() {
  window.statusMode = !window.statusMode;
  var btn = document.getElementById('statusToggleBtn');
  if (btn) {
    btn.textContent = window.statusMode ? 'Wünsche: ein' : 'Wünsche: aus';
    btn.className   = window.statusMode ? 'bb' : 'bk';
    btn.style.cssText = 'width:auto;margin:0;padding:3px 8px;font-size:11px;';
  }
  if (typeof refreshAll === 'function') refreshAll();
}

// ─── Auswahl-Zähler (für Wunsch-Panel) ──────────────────────────
window.updateSelCount = function() {
  var cnt = Object.keys(window.getAdminSel ? window.getAdminSel() : {}).length;
  var el = document.getElementById('lpSelCount');
  if (el) el.textContent = cnt;
  var btn = document.getElementById('lpWunschBtn');
  if (btn) btn.textContent = cnt ? 'Auswahl zuweisen (' + cnt + ')' : 'Auswahl zuweisen';
  // Einzelgebiet-Panel schließen sobald mehrere PLZs ausgewählt sind
  if (cnt > 1) closeAssignPanel();
};

// ─── PLZ-Zuweisung (Einzel, bei Klick auf Karte) ─────────────────
window.onPlzAdminClick = function(plz3) {
  selectedPlz3 = plz3;
  var el = document.getElementById('lpAssignPlz');
  if (el) el.textContent = plz3 + 'xx';

  // Zeige bestehende Einträge für diese PLZ
  var entries = window.plzStatusData[plz3] || [];
  var first   = entries[0] || {};
  var statusSel = document.getElementById('lpAssignStatus');
  var noteSel   = document.getElementById('lpAssignNote');
  var cntSel    = document.getElementById('lpAssignContact');
  if (statusSel) statusSel.value = first.status || 'wunsch';
  if (noteSel)   noteSel.value   = first.notiz  || '';
  if (cntSel)    cntSel.value    = first.contact_id || '';

  // Vorhandene Kontakte an dieser PLZ anzeigen
  var existList = document.getElementById('lpAssignExisting');
  if (existList) {
    if (entries.length) {
      var icons  = { belegt: '●', reserviert: '◑', wunsch: '○' };
      var colors = { belegt: '#c0392b', reserviert: '#e67e22', wunsch: '#8e44ad' };
      existList.innerHTML = entries.map(function(e) {
        var ic    = icons[e.status]  || '·';
        var cl    = colors[e.status] || '#999';
        var datum = e.import_datum ? '<span style="color:#bbb;font-size:9px;margin-left:3px;">(' + esc(e.import_datum) + ')</span>' : '';
        return '<div style="display:flex;align-items:center;justify-content:space-between;gap:4px;padding:2px 0;font-size:11px;">' +
          '<span><span style="color:' + cl + '">' + ic + '</span> ' + esc(e.suchbegriff || '—') + datum + '</span>' +
          '<button onclick="deleteAssignment(\'' + e.plz3 + '\',' + e.contact_id + ')" style="background:none;border:none;color:#e74c3c;cursor:pointer;font-size:11px;padding:0 2px;" title="Entfernen">✕</button>' +
        '</div>';
      }).join('');
      existList.style.display = 'block';
    } else {
      existList.innerHTML = '';
      existList.style.display = 'none';
    }
  }

  var msg = document.getElementById('lpAssignMsg');
  if (msg) msg.textContent = '';

  var panel = document.getElementById('lpAssignPanel');
  if (panel) panel.style.display = 'block';

  var lp = document.getElementById('lp');
  if (lp) lp.scrollTop = 0;

  if (document.body.classList.contains('lp-col')) toggleLP();
  window.updateSelCount();
};

function closeAssignPanel() {
  var panel = document.getElementById('lpAssignPanel');
  if (panel) panel.style.display = 'none';
  selectedPlz3 = null;
}

async function saveAssignment() {
  if (!selectedPlz3) return;
  var status    = document.getElementById('lpAssignStatus').value;
  var contactId = document.getElementById('lpAssignContact').value || null;
  var notiz     = document.getElementById('lpAssignNote').value;
  var msg       = document.getElementById('lpAssignMsg');

  if (!contactId && status !== 'frei') {
    msg.style.color = '#e74c3c';
    msg.textContent = 'Bitte Kontakt wählen.';
    return;
  }

  if (localMode) {
    var contact   = allContacts.find(function(c) { return String(c.id) === String(contactId); });
    var sbegriff  = contact ? contact.suchbegriff : '?';
    if (!window.plzStatusData[selectedPlz3]) window.plzStatusData[selectedPlz3] = [];
    // bestehenden Eintrag dieses Kontakts ersetzen oder hinzufügen
    var idx = window.plzStatusData[selectedPlz3].findIndex(function(e) { return String(e.contact_id) === String(contactId); });
    var entry = { plz3: selectedPlz3, status: status, contact_id: parseInt(contactId), suchbegriff: sbegriff, notiz: notiz };
    if (idx >= 0) window.plzStatusData[selectedPlz3][idx] = entry;
    else window.plzStatusData[selectedPlz3].push(entry);
    if (status === 'frei') {
      window.plzStatusData[selectedPlz3] = window.plzStatusData[selectedPlz3].filter(function(e) { return e.status !== 'frei'; });
      if (!window.plzStatusData[selectedPlz3].length) delete window.plzStatusData[selectedPlz3];
    }
    updateStatusCount();
    if (typeof refreshLayer === 'function') refreshLayer(selectedPlz3);
    if (typeof refreshAll === 'function') refreshAll();
    msg.style.color = '#27ae60';
    msg.textContent = 'Gespeichert (lokal).';
    setTimeout(closeAssignPanel, 700);
    return;
  }

  try {
    var res    = await fetch('api/plz_status.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plz3: selectedPlz3, status: status, contact_id: contactId, notiz: notiz })
    });
    var result = await res.json();
    if (result.ok) {
      msg.style.color = '#27ae60';
      msg.textContent = 'Gespeichert.';
      await loadPlzStatus();
      if (typeof refreshAll === 'function') refreshAll();
      setTimeout(closeAssignPanel, 700);
    } else {
      msg.style.color = '#e74c3c';
      msg.textContent = result.error || 'Fehler beim Speichern.';
    }
  } catch(e) {
    msg.style.color = '#e74c3c';
    msg.textContent = 'Server nicht erreichbar.';
  }
}

async function deleteAssignment(plz3, contactId) {
  if (localMode) {
    if (window.plzStatusData[plz3]) {
      window.plzStatusData[plz3] = window.plzStatusData[plz3].filter(function(e) {
        return String(e.contact_id) !== String(contactId);
      });
      if (!window.plzStatusData[plz3].length) delete window.plzStatusData[plz3];
    }
    updateStatusCount();
    if (typeof refreshLayer === 'function') refreshLayer(plz3);
    // PLZ-Zuweisung neu öffnen
    if (selectedPlz3 === plz3) window.onPlzAdminClick(plz3);
    return;
  }
  try {
    await fetch('api/plz_status.php?plz3=' + plz3 + '&contact_id=' + contactId, { method: 'DELETE' });
    await loadPlzStatus();
    if (typeof refreshLayer === 'function') refreshLayer(plz3);
    if (selectedPlz3 === plz3) window.onPlzAdminClick(plz3);
  } catch(e) { console.warn('Löschen fehlgeschlagen:', e); }
}

// ─── Auswahl als Wunsch markieren (Multi-PLZ) ────────────────────
async function assignWunsch() {
  var sel        = window.getAdminSel ? window.getAdminSel() : {};
  var plzList    = Object.keys(sel);
  var contactId  = document.getElementById('lpWunschContactId').value;
  var statusEl   = document.getElementById('lpWunschStatus');
  var status     = statusEl ? statusEl.value : 'wunsch';
  var msg        = document.getElementById('lpWunschMsg');

  if (!contactId) {
    msg.style.color = '#e74c3c';
    msg.textContent = 'Bitte zuerst einen Kontakt wählen.';
    return;
  }
  if (!plzList.length) {
    msg.style.color = '#e74c3c';
    msg.textContent = 'Keine Gebiete ausgewählt – bitte PLZs auf der Karte anklicken.';
    return;
  }

  var contact    = allContacts.find(function(c) { return String(c.id) === String(contactId); });
  var suchbegriff = contact ? contact.suchbegriff : '?';

  if (localMode) {
    plzList.forEach(function(plz3) {
      if (!window.plzStatusData[plz3]) window.plzStatusData[plz3] = [];
      var idx = window.plzStatusData[plz3].findIndex(function(e) { return String(e.contact_id) === String(contactId); });
      var entry = { plz3: plz3, status: status, contact_id: parseInt(contactId), suchbegriff: suchbegriff, notiz: '' };
      if (idx >= 0) window.plzStatusData[plz3][idx] = entry;
      else window.plzStatusData[plz3].push(entry);
    });
    updateStatusCount();
    aktiviereStatusUndResetSelection(status);
    msg.style.color = '#27ae60';
    msg.textContent = plzList.length + ' Gebiete als ' + status + ' markiert (lokal).';
    return;
  }

  try {
    var res = await fetch('api/plz_status.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plz3_list: plzList, contact_id: parseInt(contactId), status: status })
    });
    var result = await res.json();
    if (result.ok) {
      await loadPlzStatus();
      aktiviereStatusUndResetSelection(status);
      msg.style.color = '#27ae60';
      msg.textContent = plzList.length + ' Gebiete als ' + status + ' markiert.';
    } else {
      msg.style.color = '#e74c3c';
      msg.textContent = result.error || 'Fehler.';
    }
  } catch(e) {
    msg.style.color = '#e74c3c';
    msg.textContent = 'Server nicht erreichbar.';
  }
}

// Aktiviert Wunsch-Anzeige (statusMode) bei Wunsch-Zuweisung, löscht Karten-Auswahl
function aktiviereStatusUndResetSelection(status) {
  if (status === 'wunsch' && !window.statusMode) {
    window.statusMode = true;
    var btn = document.getElementById('statusToggleBtn');
    if (btn) {
      btn.textContent = 'Wünsche: ein';
      btn.className   = 'bb';
      btn.style.cssText = 'width:auto;margin:0;padding:3px 8px;font-size:11px;';
    }
  }
  if (typeof auswahlLoeschen === 'function') auswahlLoeschen();
  else if (typeof refreshAll === 'function') refreshAll();
}

// ─── Import (CSV / XLS) ──────────────────────────────────────────
var importedPlzList = [];
var tkImportData    = null; // Terminkönig-Vollimport-Daten

function openImportModal() {
  importedPlzList = [];
  tkImportData    = null;
  document.getElementById('importPreview').style.display = 'none';
  document.getElementById('importPreview').innerHTML = '';
  document.getElementById('importMsg').textContent = '';
  // Normalmodus: Kontakt/Status sichtbar, TK-Kundeninfo versteckt
  var tkDiv = document.getElementById('tkCustomerInfo');
  if (tkDiv) tkDiv.style.display = 'none';
  var stdDiv = document.getElementById('importStandardFields');
  if (stdDiv) stdDiv.style.display = 'block';
  var btn = document.getElementById('importDoBtn');
  if (btn) btn.textContent = 'Importieren';
  var fi = document.getElementById('importFile');
  if (fi) fi.value = '';
  document.getElementById('importModal').style.display = 'flex';
  populateAllContactDropdowns();
}

function closeImportModal() {
  document.getElementById('importModal').style.display = 'none';
  importedPlzList = [];
}

function parsePlzFromContent(text) {
  var lines = text.split(/[\r\n]+/).filter(function(l) { return l.trim(); });
  if (!lines.length) return [];

  // Trennzeichen ermitteln
  var sep = lines[0].indexOf(';') >= 0 ? ';' : ',';

  // Header-Zeile analysieren
  var headers = lines[0].split(sep).map(function(h) {
    return h.trim().replace(/^["']|["']$/g, '').toLowerCase();
  });

  // Terminkönig-CSV: Spalte "PLZ-Bereich" (z.B. "261xx") bevorzugt, sonst "PLZ" (5-stellig)
  var plzBereichIdx = -1, plzIdx = -1;
  headers.forEach(function(h, i) {
    if (h.indexOf('plz-bereich') >= 0 || h.indexOf('plzbereich') >= 0) plzBereichIdx = i;
    else if (h === 'plz') plzIdx = i;
  });

  var result = {};

  if (plzBereichIdx >= 0 || plzIdx >= 0) {
    // Strukturiertes CSV mit erkannten Spalten — nur diese Spalte auswerten
    for (var i = 1; i < lines.length; i++) {
      var cols = lines[i].split(sep).map(function(c) { return c.trim().replace(/^["']|["']$/g, ''); });
      var raw = plzBereichIdx >= 0 ? (cols[plzBereichIdx] || '') : (cols[plzIdx] || '');
      var digits = raw.replace(/\D/g, '');
      if (digits.length >= 3) {
        var p3 = digits.substring(0, 3);
        if (p3 !== '000') result[p3] = true;
      }
    }
  } else {
    // Fallback: nur kurze Token (3–5 Ziffern) auswerten – verhindert falsche Treffer bei
    // Einwohner-/Betriebe-Spalten (5+ Stellen werden ignoriert)
    lines.forEach(function(line) {
      line.split(/[,;|\t\s]+/).forEach(function(token) {
        var d = token.replace(/\D/g, '');
        if (d.length >= 3 && d.length <= 5) {
          var p3 = d.substring(0, 3);
          if (p3 !== '000') result[p3] = true;
        }
      });
    });
  }

  return Object.keys(result).sort();
}

function previewImport() {
  var file = document.getElementById('importFile').files[0];
  if (!file) return;
  var ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'xlsx' || ext === 'xls') {
    if (typeof XLSX === 'undefined') {
      showImportPreviewError('SheetJS nicht geladen – bitte als CSV speichern und erneut importieren.');
      return;
    }
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellStyles: true });
        // Terminkönig-Format erkennen: A2 = "Kunde:"
        var ws0  = wb.Sheets[wb.SheetNames[0]];
        var a2   = ws0['A2'] ? (ws0['A2'].v || '').toString().trim() : '';
        if (a2 === 'Kunde:') {
          tkImportData = parseTkXls(ws0);
          showTkImportPreview(tkImportData);
        } else {
          tkImportData = null;
          var text = wb.SheetNames.map(function(n) { return XLSX.utils.sheet_to_csv(wb.Sheets[n]); }).join('\n');
          importedPlzList = parsePlzFromContent(text);
          showImportPreview();
        }
      } catch(err) {
        showImportPreviewError('Datei konnte nicht gelesen werden: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    var reader = new FileReader();
    reader.onload = function(e) {
      importedPlzList = parsePlzFromContent(e.target.result);
      showImportPreview();
    };
    reader.readAsText(file, 'UTF-8');
  }
}

function showImportPreview() {
  var preview = document.getElementById('importPreview');
  preview.style.display = 'block';
  if (!importedPlzList.length) {
    preview.innerHTML = '<span style="color:#e74c3c;">Keine PLZ-Codes gefunden.</span>';
    return;
  }
  var sample = importedPlzList.slice(0, 30).map(function(p) { return p + 'xx'; }).join(', ');
  var more   = importedPlzList.length > 30 ? ' …' : '';
  preview.innerHTML = '<strong>' + importedPlzList.length + ' PLZ-Gebiete erkannt:</strong><br><span style="color:#555;">' + esc(sample) + more + '</span>';
}

function showImportPreviewError(msg) {
  var preview = document.getElementById('importPreview');
  preview.style.display = 'block';
  preview.innerHTML = '<span style="color:#e74c3c;">' + esc(msg) + '</span>';
}

// ─── Terminkönig XLS Vollimport ──────────────────────────────────
function getCellVal(ws, col, row) {
  var cell = ws[XLSX.utils.encode_cell({r: row - 1, c: col - 1})];
  return cell ? (cell.v !== undefined ? cell.v.toString().trim() : '') : '';
}

function parseTkXls(ws) {
  // Kundendaten aus Kopfzeilen
  var suchbegriff    = getCellVal(ws, 2, 2); // B2
  var kundennummer   = getCellVal(ws, 5, 2); // E2
  var vertragsnummer = getCellVal(ws, 4, 3); // D3
  var typRaw         = getCellVal(ws, 8, 3); // H3 (BBM oder BL)
  var typ            = typRaw.toLowerCase() === 'bl' ? 'bl' : 'bbm';
  var eigenePlz      = getCellVal(ws, 2, 4); // B4

  var wunschSet = {};
  var belegtList = [];

  var range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (var r = 6; r <= range.e.r; r++) { // ab Zeile 7 (0-basiert: 6)
    // Spalte A (0): Wunsch-PLZ (Umkreis-Vorschläge)
    var cellA = ws[XLSX.utils.encode_cell({r: r, c: 0})];
    if (cellA && /^\d{5}$/.test((cellA.v || '').toString())) {
      wunschSet[cellA.v.toString().substring(0, 3)] = true;
    }

    // Spalte F (5): PLZ mit Datum in Spalte J (9) → belegt, sonst wunsch
    var cellF = ws[XLSX.utils.encode_cell({r: r, c: 5})];
    if (cellF && /^\d{5}$/.test((cellF.v || '').toString())) {
      var plz3F = cellF.v.toString().substring(0, 3);
      var cellJ = ws[XLSX.utils.encode_cell({r: r, c: 9})];
      var datum = cellJ ? (cellJ.w || cellJ.v || '').toString().trim() : '';
      if (datum) {
        // Hat Datum → belegt (Datum normalisieren: TT.MM.JJJJ)
        belegtList.push({ plz3: plz3F, datum: datum });
        delete wunschSet[plz3F]; // belegt hat Vorrang vor wunsch
      } else {
        if (!wunschSet[plz3F]) wunschSet[plz3F] = true;
      }
    }
  }

  // Belegt-PLZ3s aus wunschSet entfernen (Duplikat-Schutz)
  belegtList.forEach(function(b) { delete wunschSet[b.plz3]; });

  return {
    suchbegriff:    suchbegriff,
    kundennummer:   kundennummer,
    vertragsnummer: vertragsnummer,
    typ:            typ,
    eigenePlz:      eigenePlz,
    wunschPlz:      Object.keys(wunschSet).sort(),
    belegtList:     belegtList // [{plz3, datum}]
  };
}

function showTkImportPreview(d) {
  // Standard-Felder verstecken, TK-Info zeigen
  var stdDiv = document.getElementById('importStandardFields');
  if (stdDiv) stdDiv.style.display = 'none';
  var tkDiv = document.getElementById('tkCustomerInfo');
  if (tkDiv) {
    tkDiv.style.display = 'block';
    tkDiv.innerHTML =
      '<div style="background:#eef6ee;border:1px solid #7bc87b;border-radius:4px;padding:8px;margin-bottom:8px;">' +
        '<strong style="color:#276727;">Terminkönig-Format erkannt</strong>' +
      '</div>' +
      '<table style="width:100%;font-size:12px;border-collapse:collapse;">' +
        '<tr><td style="color:#888;padding:2px 6px 2px 0;white-space:nowrap;">Suchbegriff</td><td><strong>' + esc(d.suchbegriff) + '</strong></td></tr>' +
        '<tr><td style="color:#888;padding:2px 6px 2px 0;">Kd.Nr.</td><td>' + esc(d.kundennummer) + '</td></tr>' +
        '<tr><td style="color:#888;padding:2px 6px 2px 0;">Vertrag</td><td>' + esc(d.vertragsnummer) + '</td></tr>' +
        '<tr><td style="color:#888;padding:2px 6px 2px 0;">Typ</td><td>' + d.typ.toUpperCase() + '</td></tr>' +
        (d.eigenePlz ? '<tr><td style="color:#888;padding:2px 6px 2px 0;">Eigene PLZ</td><td>' + esc(d.eigenePlz) + '</td></tr>' : '') +
      '</table>';
  }

  var preview = document.getElementById('importPreview');
  preview.style.display = 'block';
  var belegtDatum = d.belegtList.length ? (' (Datum: ' + esc(d.belegtList[0].datum || '—') + ')') : '';
  preview.innerHTML =
    '<strong>' + d.wunschPlz.length + '</strong> PLZ als <span style="color:#8e44ad;">Wunsch</span><br>' +
    '<strong>' + d.belegtList.length + '</strong> PLZ als <span style="color:#c0392b;">Belegt</span>' + belegtDatum;

  var btn = document.getElementById('importDoBtn');
  if (btn) btn.textContent = 'Kunden anlegen & importieren';
}

// Kern-Logik für TK-Kunden-Import (Modal und Sidebar teilen sich diese Funktion)
async function performTkImport(d, msgEl, onSuccess) {
  if (!d || (!d.wunschPlz.length && !d.belegtList.length)) {
    msgEl.style.color = '#e74c3c';
    msgEl.textContent = 'Keine PLZ-Daten gefunden.';
    return;
  }

  var contactId;

  if (localMode) {
    var existing = (localContacts || []).find(function(c) {
      return c.kundennummer === d.kundennummer || c.suchbegriff === d.suchbegriff;
    });
    if (existing) {
      contactId = existing.id;
    } else {
      contactId = localNextId++;
      var nc = { id: contactId, suchbegriff: d.suchbegriff, kundennummer: d.kundennummer,
                 vertragsnummer: d.vertragsnummer, typ: d.typ, bl_wert: null, notizen: '', plz_count: 0 };
      localContacts.push(nc);
      saveLocalContacts();
      allContacts = localContacts.slice();
      populateAllContactDropdowns();
    }
    var sb = d.suchbegriff;
    d.wunschPlz.forEach(function(plz3) {
      if (!window.plzStatusData[plz3]) window.plzStatusData[plz3] = [];
      var idx = window.plzStatusData[plz3].findIndex(function(e) { return String(e.contact_id) === String(contactId); });
      var entry = { plz3: plz3, status: 'wunsch', contact_id: contactId, suchbegriff: sb, notiz: '' };
      if (idx >= 0) window.plzStatusData[plz3][idx] = entry; else window.plzStatusData[plz3].push(entry);
    });
    d.belegtList.forEach(function(b) {
      if (!window.plzStatusData[b.plz3]) window.plzStatusData[b.plz3] = [];
      var idx = window.plzStatusData[b.plz3].findIndex(function(e) { return String(e.contact_id) === String(contactId); });
      var entry = { plz3: b.plz3, status: 'belegt', contact_id: contactId, suchbegriff: sb, import_datum: b.datum, notiz: '' };
      if (idx >= 0) window.plzStatusData[b.plz3][idx] = entry; else window.plzStatusData[b.plz3].push(entry);
    });
    updateStatusCount();
    aktiviereStatusUndResetSelection('wunsch');
    msgEl.style.color = '#27ae60';
    msgEl.textContent = 'Importiert (lokal): ' + d.wunschPlz.length + ' Wunsch, ' + d.belegtList.length + ' Belegt.';
    if (onSuccess) setTimeout(onSuccess, 1400);
    return;
  }

  try {
    msgEl.style.color = '#888';
    msgEl.textContent = 'Kontakt wird angelegt…';
    var cRes = await fetch('api/contacts.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suchbegriff: d.suchbegriff, kundennummer: d.kundennummer,
                             vertragsnummer: d.vertragsnummer, typ: d.typ })
    });
    var cData = await cRes.json();
    if (!cData.id) throw new Error(cData.error || 'Kontakt konnte nicht angelegt werden');
    contactId = cData.id;
    await loadContacts();
    if (d.wunschPlz.length) {
      msgEl.textContent = 'PLZ (Wunsch) werden zugewiesen…';
      await fetch('api/plz_status.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plz3_list: d.wunschPlz, contact_id: contactId, status: 'wunsch' })
      });
    }
    if (d.belegtList.length) {
      msgEl.textContent = 'PLZ (Belegt) werden zugewiesen…';
      await fetch('api/plz_status.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plz3_list: d.belegtList.map(function(b) { return b.plz3; }),
                               contact_id: contactId, status: 'belegt', notiz: d.belegtList[0].datum || '' })
      });
    }
    await loadPlzStatus();
    aktiviereStatusUndResetSelection('wunsch');
    msgEl.style.color = '#27ae60';
    msgEl.textContent = 'Importiert: ' + d.wunschPlz.length + ' Wunsch, ' + d.belegtList.length + ' Belegt.';
    if (onSuccess) setTimeout(onSuccess, 1400);
  } catch(e) {
    msgEl.style.color = '#e74c3c';
    msgEl.textContent = 'Fehler: ' + e.message;
  }
}

async function doTkImport() {
  await performTkImport(tkImportData, document.getElementById('importMsg'), closeImportModal);
}

// ─── Kunden-Import Sidebar (TK-Format XLS) ───────────────────────
var kiImportData = null;

function kiPreview() {
  var file    = document.getElementById('kiFile').files[0];
  var box     = document.getElementById('kiPreviewBox');
  var btn     = document.getElementById('kiImportBtn');
  var msg     = document.getElementById('kiMsg');
  kiImportData        = null;
  box.style.display   = 'none';
  btn.style.display   = 'none';
  msg.textContent     = '';
  if (!file) return;
  if (typeof XLSX === 'undefined') {
    msg.style.color = '#c0392b';
    msg.textContent = 'SheetJS nicht geladen – Seite neu laden.';
    return;
  }
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var wb  = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      var ws0 = wb.Sheets[wb.SheetNames[0]];
      var a2  = ws0['A2'] ? (ws0['A2'].v || '').toString().trim() : '';
      if (a2 !== 'Kunde:') {
        msg.style.color = '#c0392b';
        msg.textContent = 'Kein Terminkönig-Format erkannt (A2 ≠ „Kunde:").';
        return;
      }
      kiImportData = parseTkXls(ws0);
      var d = kiImportData;
      box.style.display = 'block';
      box.innerHTML =
        '<strong>' + esc(d.suchbegriff || '—') + '</strong>' +
        (d.kundennummer ? ' <span style="color:#888;font-size:10px;">Kd. ' + esc(d.kundennummer) + '</span>' : '') +
        (d.vertragsnummer ? ' <span style="color:#888;font-size:10px;">· Vtr. ' + esc(d.vertragsnummer) + '</span>' : '') +
        '<br>' +
        '<span style="color:#8e44ad;">' + d.wunschPlz.length + ' Wunsch</span>' +
        ' &nbsp;·&nbsp; ' +
        '<span style="color:#c0392b;">' + d.belegtList.length + ' Belegt</span>';
      btn.style.display = '';
    } catch(err) {
      msg.style.color = '#c0392b';
      msg.textContent = 'Datei konnte nicht gelesen werden.';
    }
  };
  reader.readAsArrayBuffer(file);
}

async function kiImport() {
  var btn = document.getElementById('kiImportBtn');
  var msg = document.getElementById('kiMsg');
  btn.disabled = true;
  await performTkImport(kiImportData, msg, function() {
    kiImportData = null;
    document.getElementById('kiFile').value  = '';
    document.getElementById('kiPreviewBox').style.display = 'none';
    btn.style.display = 'none';
    btn.disabled      = false;
  });
  btn.disabled = false;
}

async function doImport() {
  var contactId = document.getElementById('importContact').value;
  var status    = document.getElementById('importStatus').value;
  var msg       = document.getElementById('importMsg');

  if (!contactId) {
    msg.style.color = '#e74c3c'; msg.textContent = 'Bitte Kontakt wählen.';
    return;
  }
  if (!importedPlzList.length) {
    msg.style.color = '#e74c3c'; msg.textContent = 'Bitte zuerst eine Datei auswählen.';
    return;
  }

  var contact    = allContacts.find(function(c) { return String(c.id) === String(contactId); });
  var suchbegriff = contact ? contact.suchbegriff : '?';

  if (localMode) {
    importedPlzList.forEach(function(plz3) {
      if (!window.plzStatusData[plz3]) window.plzStatusData[plz3] = [];
      var idx = window.plzStatusData[plz3].findIndex(function(e) { return String(e.contact_id) === String(contactId); });
      var entry = { plz3: plz3, status: status, contact_id: parseInt(contactId), suchbegriff: suchbegriff, notiz: '' };
      if (idx >= 0) window.plzStatusData[plz3][idx] = entry;
      else window.plzStatusData[plz3].push(entry);
    });
    updateStatusCount();
    aktiviereStatusUndResetSelection(status);
    msg.style.color = '#27ae60';
    msg.textContent = importedPlzList.length + ' Gebiete importiert (lokal).';
    setTimeout(closeImportModal, 1200);
    return;
  }

  try {
    var res = await fetch('api/plz_status.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plz3_list: importedPlzList, contact_id: parseInt(contactId), status: status })
    });
    var result = await res.json();
    if (result.ok) {
      await loadPlzStatus();
      aktiviereStatusUndResetSelection(status);
      msg.style.color = '#27ae60';
      msg.textContent = importedPlzList.length + ' Gebiete importiert.';
      setTimeout(closeImportModal, 1200);
    } else {
      msg.style.color = '#e74c3c';
      msg.textContent = result.error || 'Fehler.';
    }
  } catch(e) {
    msg.style.color = '#e74c3c';
    msg.textContent = 'Server nicht erreichbar.';
  }
}

// ─── Kontakte laden ───────────────────────────────────────────────
async function loadContacts() {
  if (localMode) {
    allContacts = localContacts.map(function(c) { return Object.assign({}, c); });
    renderContactList(allContacts);
    populateAllContactDropdowns();
    return;
  }
  try {
    var res = await fetch('api/contacts.php');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    if (!Array.isArray(data)) throw new Error('Keine Array-Antwort');
    allContacts = data;
    localMode = false;
  } catch(e) {
    console.warn('PHP-Server nicht erreichbar – nutze localStorage:', e);
    localMode = true;
    allContacts = localContacts.map(function(c) { return Object.assign({}, c); });
    var hint = document.getElementById('lpLocalHint');
    if (hint) hint.style.display = 'block';
  }
  renderContactList(allContacts);
  populateAllContactDropdowns();
}

function populateAllContactDropdowns() {
  ['lpAssignContact', 'importContact'].forEach(function(id) {
    var sel = document.getElementById(id);
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = '<option value="">— Kontakt wählen —</option>';
    allContacts.forEach(function(c) {
      var opt = document.createElement('option');
      opt.value = c.id;
      var label = c.suchbegriff || '—';
      if (c.kundennummer) label += ' [' + c.kundennummer + ']';
      opt.textContent = label;
      sel.appendChild(opt);
    });
    if (cur) sel.value = cur;
  });
  // Wunsch-Suchfeld: bei Neuladen Auswahl zurücksetzen
  var wid = document.getElementById('lpWunschContactId');
  var ws  = document.getElementById('lpWunschSearch');
  if (wid && ws) { wid.value = ''; ws.value = ''; }
}

function filterWunschSearch(input) {
  var q  = input.value.trim().toLowerCase();
  var dd = document.getElementById('lpWunschDropdown');
  if (!dd) return;
  var wid = document.getElementById('lpWunschContactId');
  if (wid && !q) wid.value = '';

  var matches = q
    ? allContacts.filter(function(c) {
        return (c.suchbegriff || '').toLowerCase().indexOf(q) !== -1 ||
               (c.kundennummer || '').toLowerCase().indexOf(q) !== -1;
      })
    : allContacts.slice(0, 30);

  if (!matches.length) { dd.style.display = 'none'; return; }

  dd.innerHTML = '';
  matches.forEach(function(c) {
    var label = c.suchbegriff || '—';
    if (c.kundennummer) label += ' [' + c.kundennummer + ']';
    var el = document.createElement('div');
    el.className = 'wunsch-opt';
    el.textContent = label;
    el.dataset.id  = c.id;
    el.dataset.label = label;
    el.addEventListener('mousedown', function(e) {
      e.preventDefault();
      selectWunschContact(this.dataset.id, this.dataset.label);
    });
    dd.appendChild(el);
  });
  dd.style.display = '';
}

function selectWunschContact(id, label) {
  document.getElementById('lpWunschContactId').value = id;
  document.getElementById('lpWunschSearch').value    = label;
  document.getElementById('lpWunschDropdown').style.display = 'none';
}

document.addEventListener('click', function(e) {
  var dd = document.getElementById('lpWunschDropdown');
  var inp = document.getElementById('lpWunschSearch');
  if (dd && inp && !inp.contains(e.target) && !dd.contains(e.target)) {
    dd.style.display = 'none';
  }
});

function openQuickKunde() {
  document.getElementById('qkNachname').value    = '';
  document.getElementById('qkVorname').value     = '';
  document.getElementById('qkKundennummer').value = '';
  document.getElementById('qkMsg').textContent   = '';
  document.getElementById('quickKundeForm').style.display = '';
  document.getElementById('qkNachname').focus();
}

function closeQuickKunde() {
  document.getElementById('quickKundeForm').style.display = 'none';
}

async function saveQuickKunde() {
  var nachname = document.getElementById('qkNachname').value.trim();
  var vorname  = document.getElementById('qkVorname').value.trim();
  var kdnr     = document.getElementById('qkKundennummer').value.trim();
  var msg      = document.getElementById('qkMsg');

  if (!nachname || !vorname || !kdnr) {
    msg.style.color = '#e74c3c';
    msg.textContent = 'Alle Felder erforderlich.';
    return;
  }

  var suchbegriff = nachname + '_' + vorname + '_' + kdnr;
  try {
    var res  = await fetch('api/contacts.php', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ suchbegriff: suchbegriff, kundennummer: kdnr, typ: 'bbm' })
    });
    var data = await res.json();
    if (data.id) {
      msg.style.color = '#27ae60';
      msg.textContent = '✓ ' + suchbegriff + ' angelegt.';
      await loadContacts();
      setTimeout(closeQuickKunde, 1200);
    } else {
      msg.style.color = '#e74c3c';
      msg.textContent = data.error || 'Fehler beim Anlegen.';
    }
  } catch(e) {
    msg.style.color = '#e74c3c';
    msg.textContent = 'Server nicht erreichbar.';
  }
}

function renderContactList(contacts) {
  var list = document.getElementById('lpContactList');
  if (!list) return;
  if (!contacts || !contacts.length) {
    list.innerHTML = '<div style="color:#999;font-size:11px;padding:6px 0;">Keine Kontakte vorhanden.</div>';
    return;
  }
  list.innerHTML = contacts.map(function(c) {
    var typColor = c.typ === 'bl' ? '#2980b9' : '#642d7b';
    var typLabel = c.typ === 'bl' ? 'BL' : 'BBM';
    var sub = [];
    if (c.kundennummer)   sub.push('Kd. ' + c.kundennummer);
    if (c.vertragsnummer) sub.push('Vtr. ' + c.vertragsnummer);
    if (c.typ === 'bl' && c.bl_wert) sub.push('BL ' + c.bl_wert);
    var cnt = c.plz_count || 0;
    return '<div class="ct-item" onclick="selectContact(' + JSON.stringify(c.id) + ')">' +
      '<span class="ct-badge" style="background:' + typColor + ';flex-shrink:0;width:28px;height:20px;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:bold;color:#fff;">' + typLabel + '</span>' +
      '<div class="ct-info" style="flex:1;min-width:0;">' +
        '<div class="ct-name">' + esc(c.suchbegriff || '—') + '</div>' +
        (sub.length ? '<div class="ct-sub">' + esc(sub.join(' · ')) + '</div>' : '') +
      '</div>' +
      '<span class="ct-plz-count">' + cnt + '</span>' +
    '</div>';
  }).join('');
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function filterContacts() {
  var q = (document.getElementById('lpSearch').value || '').toLowerCase();
  if (!q) { renderContactList(allContacts); return; }
  renderContactList(allContacts.filter(function(c) {
    return [c.suchbegriff, c.kundennummer, c.vertragsnummer, c.notizen]
      .join(' ').toLowerCase().indexOf(q) >= 0;
  }));
}

function selectContact(id) {
  var c = allContacts.find(function(x) { return x.id === id || String(x.id) === String(id); });
  if (c) openContactForm(c);
}

// ─── BL-Dropdown ─────────────────────────────────────────────────
function updateBlDropdown() {
  var blSelected = document.getElementById('cmTypBL').checked;
  var group = document.getElementById('cmBlWertGroup');
  if (group) group.style.display = blSelected ? 'block' : 'none';
}

// ─── Kontakt-Formular ─────────────────────────────────────────────
function openContactForm(contact) {
  currentContactId = contact ? contact.id : null;
  document.getElementById('cmTitle').textContent = contact ? 'Kontakt bearbeiten' : 'Neuer Kontakt';

  document.getElementById('cmSuchbegriff').value    = contact ? (contact.suchbegriff    || '') : '';
  document.getElementById('cmKundennummer').value   = contact ? (contact.kundennummer   || '') : '';
  document.getElementById('cmVertragsnummer').value = contact ? (contact.vertragsnummer || '') : '';
  document.getElementById('cmNotizen').value        = contact ? (contact.notizen        || '') : '';

  var typ = contact ? (contact.typ || 'bbm') : 'bbm';
  document.getElementById('cmTypBBM').checked = (typ === 'bbm');
  document.getElementById('cmTypBL').checked  = (typ === 'bl');

  var blWert = contact ? (contact.bl_wert || 30) : 30;
  document.getElementById('cmBlWert').value = String(blWert);

  updateBlDropdown();
  document.getElementById('cmMsg').textContent = '';
  document.getElementById('contactModal').style.display = 'flex';
  setTimeout(function() { document.getElementById('cmSuchbegriff').focus(); }, 50);
}

function closeContactForm() {
  document.getElementById('contactModal').style.display = 'none';
  currentContactId = null;
}

async function saveContact() {
  var suchbegriff = document.getElementById('cmSuchbegriff').value.trim();
  if (!suchbegriff) {
    document.getElementById('cmMsg').style.color = '#e74c3c';
    document.getElementById('cmMsg').textContent = 'Suchbegriff ist erforderlich.';
    document.getElementById('cmSuchbegriff').focus();
    return;
  }

  var typ    = document.getElementById('cmTypBL').checked ? 'bl' : 'bbm';
  var blWert = typ === 'bl' ? parseInt(document.getElementById('cmBlWert').value) : null;

  var d = {
    suchbegriff:    suchbegriff,
    kundennummer:   document.getElementById('cmKundennummer').value.trim(),
    vertragsnummer: document.getElementById('cmVertragsnummer').value.trim(),
    typ:            typ,
    bl_wert:        blWert,
    notizen:        document.getElementById('cmNotizen').value.trim(),
  };

  var msg = document.getElementById('cmMsg');

  if (localMode) {
    if (currentContactId !== null) {
      var idx = localContacts.findIndex(function(c) { return String(c.id) === String(currentContactId); });
      if (idx >= 0) Object.assign(localContacts[idx], d);
    } else {
      d.id = localNextId++;
      d.plz_count = 0;
      localContacts.push(d);
    }
    saveLocalContacts();
    allContacts = localContacts.map(function(c) { return Object.assign({}, c); });
    renderContactList(allContacts);
    populateAllContactDropdowns();
    msg.style.color = '#27ae60';
    msg.textContent = 'Gespeichert (lokal).';
    setTimeout(closeContactForm, 600);
    return;
  }

  try {
    var url    = currentContactId ? 'api/contacts.php?id=' + currentContactId : 'api/contacts.php';
    var method = currentContactId ? 'PUT' : 'POST';
    var res    = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(d)
    });
    var result = await res.json();
    if (result.ok) {
      msg.style.color = '#27ae60';
      msg.textContent = 'Gespeichert.';
      await loadContacts();
      setTimeout(closeContactForm, 600);
    } else {
      msg.style.color = '#e74c3c';
      msg.textContent = result.error || 'Fehler.';
    }
  } catch(e) {
    msg.style.color = '#e74c3c';
    msg.textContent = 'Server nicht erreichbar.';
  }
}

// ─── Benutzerverwaltung ───────────────────────────────────────────
var allUsers = [];

async function loadUsers() {
  try {
    var res = await fetch('api/users.php');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    allUsers = await res.json();
    renderUserList();
  } catch(e) {
    var list = document.getElementById('lpUserList');
    if (list) list.innerHTML = '<div style="color:#aaa;font-size:10px;padding:4px 0;">Server nicht erreichbar.</div>';
  }
}

function renderUserList() {
  var list = document.getElementById('lpUserList');
  if (!list) return;
  if (!allUsers.length) {
    list.innerHTML = '<div style="color:#aaa;font-size:10px;padding:4px 0;">Keine Benutzer vorhanden.</div>';
    return;
  }
  list.innerHTML = allUsers.map(function(u) {
    var pending    = u.invite_pending == 1;
    var statusHtml = pending
      ? '<div style="color:#e67e22;font-size:10px;">⏳ Einladung ausstehend</div>'
      : '<div style="color:#27ae60;font-size:10px;">✓ Aktiv</div>';
    var adminBadge = u.role === 'admin'
      ? '<span style="background:#642d7b;color:#fff;border-radius:2px;padding:1px 4px;font-size:9px;margin-left:4px;">Admin</span>'
      : '';
    var delBtn = u.role !== 'admin'
      ? '<button onclick="deleteUserConfirm(' + u.id + ')" title="Löschen" ' +
        'style="flex-shrink:0;background:#c0392b;color:#fff;border:none;border-radius:3px;' +
        'padding:2px 7px;font-size:11px;cursor:pointer;line-height:1.5;">✕</button>'
      : '';
    return '<div style="border-bottom:1px solid #e4d4ec;padding:5px 0;display:flex;align-items:center;gap:6px;">' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:11px;font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
          esc(u.name || u.email) + adminBadge +
        '</div>' +
        (u.name ? '<div style="color:#888;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(u.email) + '</div>' : '') +
        statusHtml +
      '</div>' +
      delBtn +
    '</div>';
  }).join('');
}

function openInviteUser() {
  var form  = document.getElementById('lpInviteForm');
  var email = document.getElementById('lpInviteEmail');
  var msg   = document.getElementById('lpInviteMsg');
  if (!form) return;
  form.style.display  = '';
  email.value         = '';
  msg.textContent     = '';
  msg.style.color     = '#642d7b';
  email.focus();
}

function closeInviteUser() {
  var form = document.getElementById('lpInviteForm');
  if (form) form.style.display = 'none';
}

async function sendInvite() {
  var emailEl = document.getElementById('lpInviteEmail');
  var msg     = document.getElementById('lpInviteMsg');
  var email   = emailEl ? emailEl.value.trim() : '';
  if (!email) { msg.textContent = 'Bitte E-Mail-Adresse eingeben.'; return; }
  msg.style.color = '#888';
  msg.textContent = 'Einladung wird gesendet…';
  try {
    var res  = await fetch('api/invite.php', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email: email }),
    });
    var data = await res.json();
    if (data.ok) {
      msg.style.color = '#27ae60';
      msg.textContent = 'Einladung gesendet!';
      emailEl.value   = '';
      loadUsers();
      setTimeout(closeInviteUser, 2000);
    } else {
      msg.style.color = '#c0392b';
      msg.textContent = data.error || 'Fehler beim Senden.';
    }
  } catch(e) {
    msg.style.color = '#c0392b';
    msg.textContent = 'Server nicht erreichbar.';
  }
}

async function deleteUserConfirm(id) {
  var u     = allUsers.find(function(x) { return x.id == id; });
  var label = u ? (u.name || u.email) : 'diesen Benutzer';
  if (!confirm('Benutzer "' + label + '" wirklich löschen?')) return;
  try {
    var res  = await fetch('api/users.php?id=' + id, { method: 'DELETE' });
    var data = await res.json();
    if (data.ok) {
      loadUsers();
    } else {
      alert(data.error || 'Löschen fehlgeschlagen.');
    }
  } catch(e) {
    alert('Server nicht erreichbar.');
  }
}

// ─── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  checkLogin();
  loadPlzStatus();
  loadContacts();
});
