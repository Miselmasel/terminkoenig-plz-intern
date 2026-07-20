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
// TEMPORÄR: Fake-Admin für lokales Testen – vor Go-Live entfernen!
async function checkLogin() {
  var el = document.getElementById('lpUserName');
  if (el) el.textContent = 'Admin (Test)';
}
/* ORIGINAL – wieder aktivieren wenn Server läuft:
async function checkLogin() {
  try {
    var res  = await fetch('api/auth.php?action=me');
    var data = await res.json();
    if (!data.ok) { location.href = 'login.html'; return; }
    var el = document.getElementById('lpUserName');
    if (el) el.textContent = data.name;
  } catch(e) { location.href = 'login.html'; }
}
*/

async function doLogout() {
  try { await fetch('api/auth.php?action=logout'); } catch(e) {}
  location.href = 'login.html';
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
    btn.textContent = window.statusMode ? 'ausblenden' : 'einblenden';
    btn.className = window.statusMode ? 'bb' : 'bk';
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
  if (btn) btn.textContent = cnt ? 'Als Wunsch markieren (' + cnt + ')' : 'Als Wunsch markieren';
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
      if (typeof refreshLayer === 'function') refreshLayer(selectedPlz3);
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
  var contactId  = document.getElementById('lpWunschContact').value;
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
      var entry = { plz3: plz3, status: 'wunsch', contact_id: parseInt(contactId), suchbegriff: suchbegriff, notiz: '' };
      if (idx >= 0) window.plzStatusData[plz3][idx] = entry;
      else window.plzStatusData[plz3].push(entry);
    });
    updateStatusCount();
    if (typeof refreshAll === 'function') refreshAll();
    msg.style.color = '#27ae60';
    msg.textContent = plzList.length + ' Gebiete als Wunsch markiert (lokal).';
    return;
  }

  try {
    var res = await fetch('api/plz_status.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plz3_list: plzList, contact_id: parseInt(contactId), status: 'wunsch' })
    });
    var result = await res.json();
    if (result.ok) {
      await loadPlzStatus();
      if (typeof refreshAll === 'function') refreshAll();
      msg.style.color = '#27ae60';
      msg.textContent = plzList.length + ' Gebiete als Wunsch markiert.';
    } else {
      msg.style.color = '#e74c3c';
      msg.textContent = result.error || 'Fehler.';
    }
  } catch(e) {
    msg.style.color = '#e74c3c';
    msg.textContent = 'Server nicht erreichbar.';
  }
}

// ─── Import (CSV / XLS) ──────────────────────────────────────────
var importedPlzList = [];

function openImportModal() {
  importedPlzList = [];
  document.getElementById('importPreview').style.display = 'none';
  document.getElementById('importPreview').innerHTML = '';
  document.getElementById('importMsg').textContent = '';
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
        var wb   = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        var text = wb.SheetNames.map(function(n) { return XLSX.utils.sheet_to_csv(wb.Sheets[n]); }).join('\n');
        importedPlzList = parsePlzFromContent(text);
        showImportPreview();
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
    if (typeof refreshAll === 'function') refreshAll();
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
      if (typeof refreshAll === 'function') refreshAll();
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
  ['lpAssignContact', 'lpWunschContact', 'importContact'].forEach(function(id) {
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

// ─── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  checkLogin();
  loadPlzStatus();
  loadContacts();
});
