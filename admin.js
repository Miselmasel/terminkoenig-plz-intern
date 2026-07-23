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

// ─── Dark Mode ────────────────────────────────────────────────────
function toggleTheme() {
  var isDark = document.body.getAttribute('data-theme') === 'dark';
  var next   = isDark ? 'light' : 'dark';
  document.body.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  var btn = document.getElementById('lpThemeBtn');
  if (btn) btn.textContent = next === 'dark' ? '☀️' : '🌙';
}
(function() {
  var saved = localStorage.getItem('theme') || 'light';
  document.body.setAttribute('data-theme', saved);
  document.addEventListener('DOMContentLoaded', function() {
    var btn = document.getElementById('lpThemeBtn');
    if (btn) btn.textContent = saved === 'dark' ? '☀️' : '🌙';
  });
})();

// ─── Sheets-Sync ──────────────────────────────────────────────────
async function loadSyncStatus() {
  var el = document.getElementById('syncStatusText');
  if (!el) return;
  try {
    var res  = await fetch('api/sheets_sync.php?action=status');
    var data = await res.json();
    if (data.status === 'ok') {
      var d = data.updated_at ? new Date(data.updated_at).toLocaleString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
      el.textContent = 'Letzte Sync: ' + d + (data.created ? ' (+' + data.created + ')' : '');
      el.style.color = '#27ae60';
    } else if (data.status === 'error') {
      el.textContent = 'Fehler: ' + (data.details || '?');
      el.style.color = '#e74c3c';
    } else {
      el.textContent = 'Noch nicht synchronisiert';
      el.style.color = '#888';
    }
  } catch(e) {
    el.textContent = 'Status nicht abrufbar';
    el.style.color = '#888';
  }
}

async function triggerManualSync() {
  var btn = document.getElementById('syncBtn');
  var el  = document.getElementById('syncStatusText');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  if (el)  { el.textContent = 'Synchronisiere…'; el.style.color = '#e67e22'; }
  try {
    var res  = await fetch('api/sheets_sync.php', { method: 'POST' });
    var data = await res.json();
    if (data.ok) {
      if (el) { el.textContent = '✓ Sync abgeschlossen (' + (data.created||0) + ' neu, ' + (data.updated||0) + ' aktualisiert)'; el.style.color = '#27ae60'; }
      await loadPlzStatus();
      if (typeof refreshAll === 'function') refreshAll();
      await loadContacts();
    } else {
      if (el) { el.textContent = 'Fehler: ' + (data.error || '?'); el.style.color = '#e74c3c'; }
    }
  } catch(e) {
    if (el) { el.textContent = 'Netzwerkfehler'; el.style.color = '#e74c3c'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻'; }
    setTimeout(loadSyncStatus, 3000);
  }
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
      var bm = document.getElementById('lpBackupMgmt');
      if (bm) { bm.style.display = ''; loadBackups(); }
      var im = document.getElementById('lpPlzImport');
      if (im) { im.style.display = ''; }
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
    if (typeof refreshAll === 'function') refreshAll();
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

function toggleBelegtLayer() {
  window.hideBelegt = !window.hideBelegt;
  var btn = document.getElementById('belegtToggleBtn');
  if (btn) {
    btn.textContent = window.hideBelegt ? 'Belegt: ein' : 'Belegt: aus';
    btn.className   = window.hideBelegt ? 'bb' : 'bk';
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
        var freigBtn = e.status === 'belegt'
          ? '<button onclick="freigeben(\'' + e.plz3 + '\',' + e.contact_id + ')" style="background:#27ae60;border:none;color:#fff;cursor:pointer;font-size:9px;padding:1px 5px;border-radius:2px;white-space:nowrap;" title="PLZ freigeben">Freigeben</button>'
          : '';
        return '<div style="display:flex;align-items:center;justify-content:space-between;gap:4px;padding:2px 0;font-size:11px;">' +
          '<span><span style="color:' + cl + '">' + ic + '</span> ' + esc(e.suchbegriff || '—') + datum + '</span>' +
          '<span style="display:flex;gap:3px;align-items:center;">' +
            freigBtn +
            '<button onclick="deleteAssignment(\'' + e.plz3 + '\',' + e.contact_id + ')" style="background:none;border:none;color:#e74c3c;cursor:pointer;font-size:11px;padding:0 2px;" title="Entfernen">✕</button>' +
          '</span>' +
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

async function deleteContact(id, name) {
  if (!confirm('Kontakt "' + name + '" wirklich löschen?\n(Alle PLZ-Zuweisungen werden ebenfalls entfernt.)')) return;

  // Sofort aus lokalem Zustand entfernen und UI aktualisieren
  allContacts = allContacts.filter(function(c) { return String(c.id) !== String(id); });
  if (window.plzStatusData) {
    Object.keys(window.plzStatusData).forEach(function(plz3) {
      window.plzStatusData[plz3] = window.plzStatusData[plz3].filter(function(e) {
        return String(e.contact_id) !== String(id);
      });
      if (!window.plzStatusData[plz3].length) delete window.plzStatusData[plz3];
    });
  }
  if (String(_highlightedContactId) === String(id)) clearContactPLZ();
  renderContactList(allContacts);
  populateAllContactDropdowns();
  updateStatusCount();
  if (typeof refreshAll === 'function') refreshAll();

  // Server-Löschung im Hintergrund
  try {
    var res  = await fetch('api/contacts.php?id=' + id, { method: 'DELETE' });
    var data = await res.json();
    if (!data.ok) {
      alert(data.error || 'Löschen auf dem Server fehlgeschlagen – Liste wird neu geladen.');
      loadContacts(); loadPlzStatus();
    }
  } catch(e) {
    console.warn('Kontakt löschen fehlgeschlagen:', e);
    loadContacts(); loadPlzStatus();
  }
}

async function freigeben(plz3, contactId) {
  try {
    await fetch('api/plz_status.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plz3: plz3, status: 'frei', contact_id: contactId })
    });
    await loadPlzStatus();
    if (typeof refreshLayer === 'function') refreshLayer(plz3);
    if (selectedPlz3 === plz3) window.onPlzAdminClick(plz3);
  } catch(e) { console.warn('Freigeben fehlgeschlagen:', e); }
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
  var sorted = allContacts.slice().sort(function(a, b) {
    return (a.suchbegriff || '').localeCompare(b.suchbegriff || '', 'de', {sensitivity: 'base'});
  });
  ['lpAssignContact', 'importContact'].forEach(function(id) {
    var sel = document.getElementById(id);
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = '<option value="">— Kontakt wählen —</option>';
    sorted.forEach(function(c) {
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
    var isInt = c.kontakt_typ === 'interessent';
    var el = document.createElement('div');
    el.className = 'wunsch-opt';
    el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.gap = '5px';
    var badge = document.createElement('span');
    badge.textContent = isInt ? 'I' : 'K';
    badge.style.cssText = 'flex-shrink:0;background:' + (isInt ? '#e67e22' : '#27ae60') +
      ';color:#fff;border-radius:2px;padding:1px 4px;font-size:9px;font-weight:bold;';
    var txt = document.createElement('span');
    txt.textContent = label;
    el.appendChild(badge); el.appendChild(txt);
    el.dataset.id    = c.id;
    el.dataset.label = label;
    el.dataset.typ   = c.kontakt_typ || 'kunde';
    el.addEventListener('mousedown', function(e) {
      e.preventDefault();
      selectWunschContact(this.dataset.id, this.dataset.label, this.dataset.typ);
    });
    dd.appendChild(el);
  });
  dd.style.display = '';
}

function selectWunschContact(id, label, typ) {
  document.getElementById('lpWunschContactId').value = id;
  document.getElementById('lpWunschSearch').value    = label;
  document.getElementById('lpWunschDropdown').style.display = 'none';
  var statusSel = document.getElementById('lpWunschStatus');
  if (statusSel) {
    if (typ === 'interessent') {
      statusSel.value    = 'wunsch';
      statusSel.disabled = true;
    } else {
      statusSel.disabled = false;
    }
  }
}

document.addEventListener('click', function(e) {
  var dd = document.getElementById('lpWunschDropdown');
  var inp = document.getElementById('lpWunschSearch');
  if (dd && inp && !inp.contains(e.target) && !dd.contains(e.target)) {
    dd.style.display = 'none';
  }
});

function openQuickKunde() {
  var f = document.getElementById('quickKundeForm');
  if (f && f.style.display !== 'none' && f.style.display !== '') { closeQuickKunde(); return; }
  document.getElementById('qkNachname').value    = '';
  document.getElementById('qkVorname').value     = '';
  document.getElementById('qkKundennummer').value = '';
  document.getElementById('qkMsg').textContent   = '';
  f.style.display = 'block';
  document.getElementById('qkNachname').focus();
}

function closeQuickKunde() {
  document.getElementById('quickKundeForm').style.display = 'none';
}

function openQuickInteressent() {
  var f = document.getElementById('quickInteressentForm');
  if (!f) return;
  if (f.style.display !== 'none' && f.style.display !== '') { closeQuickInteressent(); return; }
  document.getElementById('qiNachname').value = '';
  document.getElementById('qiVorname').value  = '';
  document.getElementById('qiMsg').textContent = '';
  f.style.display = 'block';
  document.getElementById('qiNachname').focus();
}

function closeQuickInteressent() {
  var f = document.getElementById('quickInteressentForm');
  if (f) f.style.display = 'none';
}

async function saveQuickInteressent() {
  var nachname = document.getElementById('qiNachname').value.trim();
  var vorname  = document.getElementById('qiVorname').value.trim();
  var msg      = document.getElementById('qiMsg');

  if (!nachname || !vorname) {
    msg.style.color = '#e67e22';
    msg.textContent = 'Nachname und Vorname erforderlich.';
    return;
  }

  var suchbegriff = nachname + '_' + vorname;
  try {
    var res  = await fetch('api/contacts.php', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ suchbegriff: suchbegriff, typ: 'bbm', kontakt_typ: 'interessent' })
    });
    var data = await res.json();
    if (data.id) {
      msg.style.color = '#27ae60';
      msg.textContent = '✓ ' + suchbegriff + ' angelegt.';
      await loadContacts();
      setTimeout(closeQuickInteressent, 1200);
    } else {
      msg.style.color = '#e67e22';
      msg.textContent = data.error || 'Fehler beim Anlegen.';
    }
  } catch(e) {
    msg.style.color = '#e67e22';
    msg.textContent = 'Server nicht erreichbar.';
  }
}

var _convertId = null;

function openConvertModal(id) {
  var c = allContacts.find(function(x) { return x.id == id; });
  if (!c) return;
  _convertId = id;
  document.getElementById('convertLabel').textContent = c.suchbegriff || '—';
  document.getElementById('convertKdnr').value  = c.kundennummer || '';
  document.getElementById('convertVtrnr').value = c.vertragsnummer || '';
  document.getElementById('convertErr').style.display = 'none';
  document.getElementById('convertModal').style.display = 'flex';
  document.getElementById('convertKdnr').focus();
}

function closeConvertModal() {
  document.getElementById('convertModal').style.display = 'none';
  _convertId = null;
}

async function executeConvert() {
  var kdnr  = document.getElementById('convertKdnr').value.trim();
  var vtrnr = document.getElementById('convertVtrnr').value.trim();
  var err   = document.getElementById('convertErr');
  if (!kdnr) {
    err.textContent = 'Kundennummer ist erforderlich.';
    err.style.display = '';
    return;
  }
  var c = allContacts.find(function(x) { return x.id == _convertId; });
  if (!c) { closeConvertModal(); return; }
  var idToConvert = _convertId;
  closeConvertModal();
  try {
    var res = await fetch('api/contacts.php?id=' + idToConvert, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        suchbegriff:  c.suchbegriff,
        kundennummer: kdnr,
        vertragsnummer: vtrnr,
        typ:          c.typ || 'bbm',
        bl_wert:      c.bl_wert,
        notizen:      c.notizen || '',
        kontakt_typ:  'kunde'
      })
    });
    var data = await res.json();
    if (data.ok) { await loadContacts(); }
    else { alert(data.error || 'Umwandlung fehlgeschlagen.'); }
  } catch(e) { alert('Server nicht erreichbar.'); }
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
      body: JSON.stringify({ suchbegriff: suchbegriff, kundennummer: kdnr, typ: 'bbm', kontakt_typ: 'kunde' })
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

var TYPE_DEFS = {
  'BSV':  { label:'BSV',  color:'#27ae60', tc:'#fff', premium:false },
  'RS':   { label:'RS',   color:'#2980b9', tc:'#fff', premium:false },
  'RSV':  { label:'RSV',  color:'#2980b9', tc:'#fff', premium:false },
  'BHV':  { label:'BHV',  color:'#c9a800', tc:'#fff', premium:false },
  'KFZ':  { label:'KFZ',  color:'#7f8c8d', tc:'#fff', premium:false },
  'BKV':  { label:'bKV',  color:'#8e44ad', tc:'#fff', premium:true  },
  'SACH': { label:'Sach', color:'#8e44ad', tc:'#fff', premium:true  },
  'FLOT': { label:'Flot', color:'#8e44ad', tc:'#fff', premium:true  },
  'SONST':{ label:'Sonst',color:'#8e44ad', tc:'#fff', premium:true  },
};
var BRANCH_DEFS = {
  'BBM': { label:'BBM', color:'#1e8449', tc:'#fff' },
  'LS':  { label:'LS',  color:'#e67e22', tc:'#fff' },
  'RC':  { label:'RC',  color:'#2471a3', tc:'#fff' },
  'BL':  { label:'BL',  color:'#c9a800', tc:'#fff' },
};

function parseKontaktBadges(c) {
  var parts = ((c && c.suchbegriff) || '').split('_');
  var typDef = null, branchDef = null, blWert = null;
  parts.forEach(function(p) {
    var pu = p.toUpperCase();
    if (TYPE_DEFS[pu]) typDef = TYPE_DEFS[pu];
    var blMatch = p.match(/^BL(\d+)$/i);
    if (blMatch) {
      branchDef = BRANCH_DEFS['BL'];
      blWert = blMatch[1];
    } else {
      Object.keys(BRANCH_DEFS).forEach(function(b) {
        if (pu === b || pu.startsWith(b + '(')) branchDef = BRANCH_DEFS[b];
      });
    }
  });
  if (!blWert && c && c.bl_wert && c.typ === 'bl') {
    blWert = c.bl_wert;
    if (!branchDef) branchDef = BRANCH_DEFS['BL'];
  }
  return { typDef: typDef, branchDef: branchDef, blWert: blWert };
}

function renderContactList(contacts) {
  var list = document.getElementById('lpContactList');
  if (!list) return;
  if (!contacts || !contacts.length) {
    list.innerHTML = '<div style="color:#999;font-size:11px;padding:6px 0;">Keine Kontakte vorhanden.</div>';
    return;
  }
  list.innerHTML = contacts.map(function(c) {
    var isInt   = c.kontakt_typ === 'interessent';
    var ktBg    = isInt ? '#e67e22' : '#27ae60';
    var ktLabel = isInt ? 'I' : 'K';
    var isNeu   = c.gesehen == 0 && c.kontakt_typ !== 'kunde';
    var parsed  = parseKontaktBadges(c);

    var sbParts  = (c.suchbegriff || '').split('_');
    var dispName = sbParts.slice(0, 2).join('_') || '—';

    var typBadge = '';
    if (parsed.typDef) {
      typBadge = '<span style="background:' + parsed.typDef.color + ';color:' + parsed.typDef.tc + ';border-radius:3px;padding:1px 4px;font-size:8px;font-weight:bold;white-space:nowrap;">' + esc(parsed.typDef.label) + '</span>';
    }
    var branchBadge = '';
    if (parsed.branchDef) {
      var blLabel = parsed.branchDef.label + (parsed.blWert ? ' ' + parsed.blWert : '');
      branchBadge = '<span style="background:' + parsed.branchDef.color + ';color:' + parsed.branchDef.tc + ';border-radius:3px;padding:1px 4px;font-size:8px;font-weight:bold;white-space:nowrap;">' + esc(blLabel) + '</span>';
    }

    var cnt = c.plz_count || 0;

    var editBtn = '<button onclick="event.stopPropagation();editContact(' + JSON.stringify(c.id) + ')" title="Bearbeiten" ' +
      'style="flex-shrink:0;width:auto;margin-top:0;background:#6b42a0;color:#fff;border:none;border-radius:3px;padding:1px 5px;font-size:9px;font-weight:bold;cursor:pointer;line-height:1.5;">B</button>';
    var convertBtn = isInt
      ? '<button onclick="event.stopPropagation();openConvertModal(' + c.id + ')" title="In Kunde umwandeln" ' +
        'style="flex-shrink:0;width:auto;margin-top:0;background:#27ae60;color:#fff;border:none;border-radius:3px;padding:2px 5px;font-size:10px;cursor:pointer;white-space:nowrap;line-height:1.5;">→ K</button>'
      : '';
    var delContactBtn = window.currentUserRole === 'admin'
      ? '<button onclick="event.stopPropagation();deleteContact(' + c.id + ',\'' + esc(c.suchbegriff || '') + '\')" title="Kontakt löschen" ' +
        'style="flex-shrink:0;width:auto;margin-top:0;background:none;border:none;color:#c0392b;cursor:pointer;font-size:13px;padding:0 2px;line-height:1;">✕</button>'
      : '';

    return '<div class="ct-item" onclick="highlightContactPLZ(' + JSON.stringify(c.id) + ')"' +
      (isNeu ? ' style="border-left:3px solid #e74c3c;"' : '') + '>' +
      '<span style="flex-shrink:0;width:14px;height:36px;background:' + ktBg + ';border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:bold;color:#fff;">' + ktLabel + '</span>' +
      '<div class="ct-info" style="flex:1;min-width:0;">' +
        '<div class="ct-name">' + esc(dispName) + (isNeu ? ' <span style="background:#e74c3c;color:#fff;border-radius:3px;padding:0 3px;font-size:8px;font-weight:bold;vertical-align:middle;">NEU</span>' : '') + '</div>' +
        '<div style="display:flex;gap:3px;margin-top:2px;flex-wrap:wrap;">' + typBadge + branchBadge + '</div>' +
      '</div>' +
      editBtn +
      '<span class="ct-plz-count">' + cnt + '</span>' +
      convertBtn +
      delContactBtn +
    '</div>';
  }).join('');
}

function editContact(id) {
  var c = allContacts.find(function(x) { return x.id === id || String(x.id) === String(id); });
  if (c) { highlightContactPLZ(id); openContactForm(c); }
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

var _highlightedContactId = null;
var _ownPlzMarker = null;

function showOwnPlzMarker(contactId) {
  if (_ownPlzMarker) { try { map.removeLayer(_ownPlzMarker); } catch(e){} _ownPlzMarker = null; }
  var c = (allContacts || []).find(function(x) { return String(x.id) === String(contactId); });
  if (!c || !c.eigene_plz) return;
  var plz3 = String(c.eigene_plz).replace(/\D/g, '').substring(0, 3);
  if (plz3.length < 3) return;
  var pts = window.centroids && window.centroids[plz3];
  if (!pts || !pts.length) return;
  _ownPlzMarker = L.marker(pts[0], {
    icon: L.divIcon({
      className: '',
      html: '<div style="width:16px;height:16px;border-radius:50%;background:#e74c3c;border:3px solid #fff;box-shadow:0 0 8px rgba(0,0,0,.55);"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    }),
    interactive: true,
    zIndexOffset: 1000
  }).addTo(map);
  _ownPlzMarker.bindTooltip('Eigene PLZ: ' + c.eigene_plz + ' (' + esc(c.suchbegriff) + ')', { sticky: true });
}

function highlightContactPLZ(contactId) {
  if (String(_highlightedContactId) === String(contactId)) {
    clearContactPLZ();
    return;
  }
  _highlightedContactId = contactId;
  selContact = {};
  var data = window.plzStatusData || {};
  Object.keys(data).forEach(function(plz3) {
    var entries = data[plz3];
    if (Array.isArray(entries) && entries.some(function(e) { return String(e.contact_id) === String(contactId); })) {
      selContact[plz3] = true;
    }
  });
  // Auto-fill Zuweisen search with selected contact
  var c = (allContacts || []).find(function(x) { return String(x.id) === String(contactId); });
  if (c) {
    var label = c.suchbegriff || '';
    if (c.kundennummer) label += ' [' + c.kundennummer + ']';
    var wid = document.getElementById('lpWunschContactId');
    var ws  = document.getElementById('lpWunschSearch');
    if (wid) wid.value = contactId;
    if (ws)  ws.value  = label;
  }
  showOwnPlzMarker(contactId);
  if (typeof refreshAll === 'function') refreshAll();
}

function clearContactPLZ() {
  _highlightedContactId = null;
  selContact = {};
  if (_ownPlzMarker) { try { map.removeLayer(_ownPlzMarker); } catch(e){} _ownPlzMarker = null; }
  if (typeof refreshAll === 'function') refreshAll();
}

function selectContact(id) {
  editContact(id);
}

// ─── Duplikate erkennen & zusammenführen ────────────────────────
function detectDuplicates() {
  var groups = {};
  (allContacts || []).forEach(function(c) {
    var parts = (c.suchbegriff || '').split('_');
    var key   = parts.slice(0, 2).join('_').toLowerCase();
    if (!key) return;
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);
  });
  var dupGroups = Object.values(groups).filter(function(g) { return g.length > 1; });

  var modal = document.getElementById('mergeModal');
  var list  = document.getElementById('mergeGroupsList');
  var msg   = document.getElementById('mergeMsg');
  if (!modal || !list) return;

  msg.textContent = '';

  if (dupGroups.length === 0) {
    list.innerHTML = '<p style="color:#27ae60;font-size:12px;">Keine Duplikate gefunden.</p>';
  } else {
    list.innerHTML = dupGroups.map(function(g, gi) {
      var rows = g.map(function(c, i) {
        var parsed = parseKontaktBadges(c);
        var typB   = parsed.typDef
          ? '<span style="background:' + parsed.typDef.color + ';color:' + parsed.typDef.tc + ';border-radius:3px;padding:1px 4px;font-size:8px;font-weight:bold;">' + esc(parsed.typDef.label) + '</span>'
          : '';
        var brB = parsed.branchDef
          ? '<span style="background:' + parsed.branchDef.color + ';color:' + parsed.branchDef.tc + ';border-radius:3px;padding:1px 4px;font-size:8px;font-weight:bold;">' + esc(parsed.branchDef.label + (parsed.blWert ? ' ' + parsed.blWert : '')) + '</span>'
          : '';
        var star = i === 0 ? ' <span style="color:#e67e22;font-size:9px;font-weight:bold;">(Haupt)</span>' : '';
        return '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid #eee;">' +
          '<span style="flex:1;font-size:11px;">' + esc(c.suchbegriff || '—') + star + '</span>' +
          '<span style="display:flex;gap:3px;">' + typB + brB + '</span>' +
          '<span style="font-size:10px;color:#888;">' + (c.plz_count || 0) + ' PLZ</span>' +
        '</div>';
      }).join('');
      var idStr = g.map(function(c) { return c.id; }).join(',');
      return '<div style="margin-bottom:14px;border:1px solid #ddd;border-radius:4px;padding:10px;">' +
        '<div style="font-size:11px;font-weight:bold;margin-bottom:6px;color:#642d7b;">' +
          esc(g[0].suchbegriff.split('_').slice(0,2).join('_')) +
        '</div>' +
        rows +
        '<button onclick="mergeGroup(\'' + idStr + '\',this)" ' +
          'style="margin-top:8px;width:auto;background:#e67e22;color:#fff;border:none;border-radius:3px;padding:4px 12px;font-size:11px;cursor:pointer;">Zusammenführen</button>' +
      '</div>';
    }).join('');
  }

  modal.style.display = 'flex';
}

function closeMergeModal() {
  var modal = document.getElementById('mergeModal');
  if (modal) modal.style.display = 'none';
}

async function mergeGroup(idStr, btn) {
  var ids = idStr.split(',').map(Number).filter(Boolean);
  if (ids.length < 2) return;
  var primaryId = ids[0];
  var mergeIds  = ids.slice(1);
  var msg = document.getElementById('mergeMsg');
  if (btn) btn.disabled = true;
  try {
    var res  = await fetch('api/contacts.php?action=merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primary_id: primaryId, merge_ids: mergeIds })
    });
    var data = await res.json();
    if (data.ok) {
      if (btn) btn.closest('div[style*="margin-bottom:14px"]').innerHTML =
        '<p style="color:#27ae60;font-size:11px;margin:0;">✓ Zusammengeführt</p>';
      await loadContacts();
      if (msg) msg.textContent = 'Zusammengeführt.';
    } else {
      if (msg) msg.textContent = data.error || 'Fehler beim Zusammenführen.';
      if (btn) btn.disabled = false;
    }
  } catch(e) {
    if (msg) msg.textContent = 'Netzwerkfehler: ' + e.message;
    if (btn) btn.disabled = false;
  }
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
  document.getElementById('cmEigenePlz').value      = contact ? (contact.eigene_plz     || '') : '';
  document.getElementById('cmNotizen').value        = contact ? (contact.notizen        || '') : '';

  var typ = contact ? (contact.typ || 'bbm') : 'bbm';
  document.getElementById('cmTypBBM').checked = (typ === 'bbm');
  document.getElementById('cmTypBL').checked  = (typ === 'bl');

  var blWert = contact ? (contact.bl_wert || 30) : 30;
  document.getElementById('cmBlWert').value = String(blWert);

  updateBlDropdown();
  document.getElementById('cmMsg').textContent = '';

  var plzExportSection = document.getElementById('cmPlzExportSection');
  if (plzExportSection) {
    if (contact && contact.id) {
      plzExportSection.style.display = '';
      var link = document.getElementById('cmPlzExportLink');
      if (link) {
        link.href = '#';
        link.onclick = (function(cid) { return function(e) { e.preventDefault(); downloadPlzXls(cid); }; })(contact.id);
      }
    } else {
      plzExportSection.style.display = 'none';
    }
  }

  var slSection = document.getElementById('cmShortlinkSection');
  if (slSection) {
    if (contact && contact.id) {
      slSection.style.display = '';
      var slBtn = document.getElementById('cmShortlinkBtn');
      if (slBtn) { slBtn.textContent = 'Link generieren'; slBtn.disabled = false; }
      var slResult = document.getElementById('cmShortlinkResult');
      if (slResult) slResult.style.display = 'none';
    } else {
      slSection.style.display = 'none';
    }
  }

  var docsSection = document.getElementById('cmDocsSection');
  if (docsSection) {
    var cmDocFile = document.getElementById('cmDocFile');
    var cmDocMsg  = document.getElementById('cmDocMsg');
    var cmDocList = document.getElementById('cmDocList');
    if (cmDocFile) cmDocFile.value = '';
    if (cmDocMsg)  cmDocMsg.textContent = '';
    if (cmDocList) cmDocList.innerHTML = '';
    if (contact && contact.id) {
      docsSection.style.display = '';
      loadContactDocuments(contact.id);
    } else {
      docsSection.style.display = 'none';
    }
  }

  document.getElementById('contactModal').style.display = 'flex';
  setTimeout(function() { document.getElementById('cmSuchbegriff').focus(); }, 50);
}

function closeContactForm() {
  document.getElementById('contactModal').style.display = 'none';
  currentContactId = null;
  clearContactPLZ();
}

async function generateShortlink() {
  var contact = currentContactId !== null
    ? allContacts.find(function(c) { return String(c.id) === String(currentContactId); })
    : null;
  if (!contact) return;

  var btn = document.getElementById('cmShortlinkBtn');
  var resultEl = document.getElementById('cmShortlinkResult');
  var urlEl = document.getElementById('cmShortlinkUrl');
  if (btn) { btn.disabled = true; btn.textContent = 'Wird generiert…'; }

  var gebiete = [];
  if (window.plzStatusData) {
    Object.keys(window.plzStatusData).forEach(function(plz3) {
      var entries = window.plzStatusData[plz3];
      if (Array.isArray(entries) && entries.some(function(e) {
        return String(e.contact_id) === String(contact.id);
      })) {
        gebiete.push(plz3);
      }
    });
  }

  var parts = (contact.suchbegriff || '').trim().split(/\s+/);
  var payload = {
    typ: contact.kundennummer ? 'kunde' : 'interessent',
    vorname: parts[0] || '',
    nachname: parts.slice(1).join(' ') || '',
    kundennummer: contact.kundennummer || '',
    vertragsnummer: contact.vertragsnummer || '',
    eigenePlz: contact.eigene_plz || '',
    gebiete: gebiete
  };

  try {
    var resp = await fetch('https://terminkoenig.plz-vertriebsplaner.de/link.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var data = await resp.json();
    if (!data.ok) throw new Error(data.error || 'Fehler');
    var url = 'https://terminkoenig.plz-vertriebsplaner.de/?c=' + data.token;
    if (urlEl) urlEl.textContent = url;
    if (resultEl) resultEl.style.display = '';
    if (btn) { btn.textContent = 'Neu generieren'; btn.disabled = false; }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function() {
        if (btn) btn.textContent = 'In Zwischenablage ✓';
        setTimeout(function() { if (btn) btn.textContent = 'Neu generieren'; }, 2000);
      }).catch(function() {});
    }
  } catch(e) {
    if (btn) { btn.textContent = 'Link generieren'; btn.disabled = false; }
    alert('Fehler beim Generieren: ' + e.message);
  }
}

function copyShortlink() {
  var urlEl = document.getElementById('cmShortlinkUrl');
  if (!urlEl || !urlEl.textContent) return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(urlEl.textContent).then(function() {
      urlEl.style.background = '#d5f5e3';
      setTimeout(function() { urlEl.style.background = '#f5edfb'; }, 1200);
    }).catch(function() {});
  }
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
    eigene_plz:     document.getElementById('cmEigenePlz').value.trim(),
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
        'style="flex-shrink:0;width:auto;background:#c0392b;color:#fff;border:none;border-radius:3px;' +
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

var _deleteUserId    = null;
var _deleteUserMath  = 0;

function deleteUserConfirm(id) {
  var u     = allUsers.find(function(x) { return x.id == id; });
  var label = u ? (u.name || u.email || u.username) : '—';
  _deleteUserId = id;

  var a = Math.floor(Math.random() * 8) + 2;
  var b = Math.floor(Math.random() * 8) + 2;
  _deleteUserMath = a + b;

  document.getElementById('delConfirmLabel').textContent = label;
  document.getElementById('delConfirmMath').textContent  = a + ' + ' + b + ' =';
  document.getElementById('delConfirmInput').value       = '';
  document.getElementById('delConfirmErr').style.display = 'none';
  document.getElementById('delConfirmModal').style.display = 'flex';
  document.getElementById('delConfirmInput').focus();
}

function closeDeleteConfirm() {
  document.getElementById('delConfirmModal').style.display = 'none';
  _deleteUserId = null;
}

async function executeDeleteUser() {
  var val = parseInt(document.getElementById('delConfirmInput').value, 10);
  var err = document.getElementById('delConfirmErr');
  if (val !== _deleteUserMath) {
    err.textContent    = 'Falsch – bitte nochmal rechnen.';
    err.style.display  = '';
    document.getElementById('delConfirmInput').value = '';
    document.getElementById('delConfirmInput').focus();
    return;
  }
  var idToDelete = _deleteUserId;
  closeDeleteConfirm();
  try {
    var res  = await fetch('api/users.php?id=' + idToDelete, { method: 'DELETE' });
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

// ─── Dokumente ────────────────────────────────────────────────────
async function loadContactDocuments(contactId) {
  var list = document.getElementById('cmDocList');
  if (!list) return;
  list.innerHTML = '<span style="color:#aaa;font-size:10px;">Lädt…</span>';
  try {
    var res  = await fetch('api/documents.php?contact_id=' + contactId);
    var docs = await res.json();
    if (!Array.isArray(docs) || !docs.length) {
      list.innerHTML = '<span style="color:#bbb;font-size:10px;">Keine Dokumente vorhanden.</span>';
      return;
    }
    list.innerHTML = docs.map(function(d) {
      var kb      = Math.ceil(d.file_size / 1024);
      var sizeStr = kb >= 1024 ? (Math.round(kb / 102.4) / 10) + ' MB' : kb + ' KB';
      return '<div style="display:flex;align-items:center;gap:4px;padding:3px 0;border-bottom:1px solid #f0e8f8;">' +
        '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;" title="' + esc(d.original_name) + '">' + esc(d.original_name) + '</span>' +
        '<span style="color:#aaa;font-size:10px;white-space:nowrap;flex-shrink:0;">' + esc(sizeStr) + '</span>' +
        '<a href="api/documents.php?id=' + d.id + '&action=download" target="_blank" ' +
          'style="color:#642d7b;font-size:10px;white-space:nowrap;text-decoration:none;background:#ede0f7;padding:2px 6px;border-radius:2px;flex-shrink:0;" title="Herunterladen">&#x2B07;</a>' +
        '<button onclick="deleteDocument(' + d.id + ')" title="Löschen" ' +
          'style="background:none;border:none;color:#c0392b;cursor:pointer;font-size:13px;padding:0 2px;width:auto;flex-shrink:0;line-height:1;">&#x2715;</button>' +
      '</div>';
    }).join('');
  } catch(e) {
    list.innerHTML = '<span style="color:#e74c3c;font-size:10px;">Fehler beim Laden.</span>';
  }
}

async function uploadContactDocument() {
  var fileInput = document.getElementById('cmDocFile');
  var msg       = document.getElementById('cmDocMsg');
  if (!fileInput || !fileInput.files.length) {
    msg.style.color = '#e74c3c'; msg.textContent = 'Bitte Datei auswählen.'; return;
  }
  if (!currentContactId) return;
  var fd = new FormData();
  fd.append('contact_id', currentContactId);
  fd.append('file', fileInput.files[0]);
  msg.style.color = '#888'; msg.textContent = 'Wird hochgeladen…';
  try {
    var res  = await fetch('api/documents.php', { method: 'POST', body: fd });
    var data = await res.json();
    if (data.ok) {
      msg.style.color = '#27ae60'; msg.textContent = '&#x2713; Hochgeladen.';
      fileInput.value = '';
      await loadContactDocuments(currentContactId);
      setTimeout(function() { if (msg) msg.textContent = ''; }, 2500);
    } else {
      msg.style.color = '#e74c3c'; msg.textContent = data.error || 'Upload fehlgeschlagen.';
    }
  } catch(e) {
    msg.style.color = '#e74c3c'; msg.textContent = 'Server nicht erreichbar.';
  }
}

async function deleteDocument(id) {
  if (!confirm('Dokument löschen?')) return;
  try {
    await fetch('api/documents.php?id=' + id, { method: 'DELETE' });
    if (currentContactId) await loadContactDocuments(currentContactId);
  } catch(e) { console.warn('Dokument löschen fehlgeschlagen:', e); }
}

// ─── Datensicherung ───────────────────────────────────────────────
async function loadBackups() {
  var list = document.getElementById('lpBackupList');
  if (!list) return;
  try {
    var res  = await fetch('api/backup.php?action=list');
    var data = await res.json();
    if (!Array.isArray(data) || !data.length) {
      list.innerHTML = '<div style="color:#aaa;font-size:10px;">Keine Sicherungen vorhanden</div>';
      return;
    }
    list.innerHTML = data.map(function(b) {
      var kb = (b.size / 1024).toFixed(1);
      return '<div style="border:1px solid #e4d4ec;border-radius:4px;padding:6px 8px;margin-bottom:5px;background:#fff;">' +
        '<div style="font-size:10px;color:#642d7b;font-weight:bold;margin-bottom:2px;">' + b.label + '</div>' +
        '<div style="font-size:9px;color:#bbb;margin-bottom:5px;">' + kb + ' KB</div>' +
        '<button class="br" onclick="restoreBackup(\'' + b.file.replace(/'/g, '') + '\',\'' + b.label.replace(/'/g, '') + '\')" ' +
        'style="width:100%;margin:0;padding:3px;font-size:10px;">&#x21BA; Wiederherstellen</button>' +
        '</div>';
    }).join('');
  } catch(e) {
    list.innerHTML = '<div style="color:#e74c3c;font-size:10px;">Fehler beim Laden der Sicherungen</div>';
  }
}

async function createBackup() {
  var btn = document.getElementById('lpBackupBtn');
  var msg = document.getElementById('lpBackupMsg');
  if (btn) btn.disabled = true;
  msg.style.color   = '#642d7b';
  msg.textContent   = 'Sicherung wird erstellt…';
  try {
    var res  = await fetch('api/backup.php?action=create', { method: 'POST' });
    var data = await res.json();
    if (data.ok) {
      msg.style.color = '#27ae60';
      msg.textContent = '✓ ' + (data.label || 'Gesichert');
      await loadBackups();
    } else {
      msg.style.color = '#e74c3c';
      msg.textContent = data.error || 'Fehler beim Sichern';
    }
  } catch(e) {
    msg.style.color = '#e74c3c';
    msg.textContent = 'Server nicht erreichbar';
  }
  if (btn) btn.disabled = false;
}

async function restoreBackup(file, label) {
  if (!confirm('Datenbestand wiederherstellen?\n\n' + label + '\n\nAlle aktuellen Daten werden durch diese Sicherung ersetzt. Fortfahren?')) return;
  var msg = document.getElementById('lpBackupMsg');
  msg.style.color = '#642d7b';
  msg.textContent = 'Wiederherstellung läuft…';
  try {
    var fd = new FormData();
    fd.append('file', file);
    var res  = await fetch('api/backup.php?action=restore', { method: 'POST', body: fd });
    var data = await res.json();
    if (data.ok) {
      msg.style.color = '#27ae60';
      msg.textContent = '✓ Datenbestand wiederhergestellt';
      await loadBackups();
      await loadContacts();
      if (typeof loadPlzStatus === 'function') loadPlzStatus();
    } else {
      msg.style.color = '#e74c3c';
      msg.textContent = data.error || 'Fehler bei der Wiederherstellung';
    }
  } catch(e) {
    msg.style.color = '#e74c3c';
    msg.textContent = 'Server nicht erreichbar';
  }
}

async function getOsrmDistance(fromLat, fromLon, toLat, toLon) {
  try {
    var url = 'https://router.project-osrm.org/route/v1/driving/' +
      fromLon.toFixed(6) + ',' + fromLat.toFixed(6) + ';' +
      toLon.toFixed(6)  + ',' + toLat.toFixed(6)  +
      '?overview=false&steps=false';
    var res = await fetch(url);
    if (!res.ok) return null;
    var data = await res.json();
    if (data.code === 'Ok' && data.routes && data.routes[0]) {
      return Math.round(data.routes[0].distance / 100) / 10; // m → km, 1 Stelle
    }
  } catch(e) { /* noop */ }
  return null;
}

// ─── PLZ-Liste als XLS herunterladen (clientseitig) ──────────────
async function downloadPlzXls(contactId) {
  var c = (allContacts || []).find(function(x) { return String(x.id) === String(contactId); });
  if (!c) { alert('Kontakt nicht gefunden'); return; }
  if (!plzDB) {
    alert('PLZ-Datenbank noch nicht geladen – bitte kurz warten und erneut versuchen.');
    return;
  }

  var statusData = window.plzStatusData || {};
  var plz3List = Object.keys(statusData).filter(function(plz3) {
    return Array.isArray(statusData[plz3]) && statusData[plz3].some(function(e) {
      return String(e.contact_id) === String(contactId);
    });
  }).sort();

  var eigenePlz = (c.eigene_plz || '').replace(/\D/g, '').substring(0, 5);
  var epRef = null;
  if (eigenePlz) {
    var ep = plzDB.find(function(e) { return e.plz === eigenePlz; });
    if (ep) epRef = { lat: parseFloat(ep.lat), lon: parseFloat(ep.lon) };
  }

  // Blockfarben (kräftig, zyklisch)
  var BLOCK_COLORS = [
    '#fff176', // gelb
    '#f48fb1', // rosa
    '#90caf9', // blau
    '#a5d6a7', // grün
    '#ce93d8', // lila
    '#ffcc80', // orange
    '#80deea', // türkis
    '#ef9a9a', // rot/lachs
  ];
  var plz3ColorMap = {};
  plz3List.forEach(function(p, i) { plz3ColorMap[p] = BLOCK_COLORS[i % BLOCK_COLORS.length]; });

  // Alle 5-stelligen PLZ je Block aufbauen
  var allEntries = [];
  plz3List.forEach(function(plz3) {
    var col = plz3ColorMap[plz3];
    plzDB
      .filter(function(e) { return e.plz.substring(0, 3) === plz3; })
      .sort(function(a, b) { return a.plz.localeCompare(b.plz); })
      .forEach(function(e) {
        var lat = parseFloat(e.lat), lon = parseFloat(e.lon);
        allEntries.push({
          plz3: plz3, plz5: e.plz, ort: e.ort || '',
          lat: lat, lon: lon, col: col,
          dist: epRef ? haversine(epRef.lat, epRef.lon, lat, lon) : null,
          fahrt: null
        });
      });
  });

  // Fortschrittsanzeige + OSRM sequenziell
  var exportLink = document.getElementById('cmPlzExportLink');
  var origText = exportLink ? exportLink.textContent : '↓ PLZ-Liste als XLS';
  function setProgress(txt) { if (exportLink) exportLink.textContent = txt; }

  if (epRef && allEntries.length) {
    for (var ri = 0; ri < allEntries.length; ri++) {
      setProgress('⏳ Fahrstrecken… ' + (ri + 1) + '/' + allEntries.length);
      var en = allEntries[ri];
      en.fahrt = await getOsrmDistance(epRef.lat, epRef.lon, en.lat, en.lon);
      await new Promise(function(r) { setTimeout(r, 50); });
    }
  }
  if (exportLink) exportLink.textContent = origText;

  // Links: nach Entfernung; rechts: nach PLZ (bereits sortiert)
  var leftRows  = allEntries.slice().sort(function(a, b) {
    return (a.dist !== null ? a.dist : 999999) - (b.dist !== null ? b.dist : 999999);
  });
  var rightRows = allEntries.slice();
  var n = allEntries.length;

  function xlsEsc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function kmFmt(d) { return (d !== null && d !== undefined) ? d.toFixed(1) + ' km' : ''; }

  var kdnrPart = (c.kundennummer   || '').trim();
  var vtrnr    = (c.vertragsnummer || '').trim();
  // Umkreis aus aktuellem UI-Select
  var mrsEl    = document.getElementById('mrs');
  var umkreisVal = mrsEl ? (mrsEl.options[mrsEl.selectedIndex] ? mrsEl.options[mrsEl.selectedIndex].text : '') : '';
  // Anzeigename: erste 2 Underscore-Segmente, Underscores → Leerzeichen (wie Panel-Anzeige)
  var sbParts  = (c.suchbegriff || '').split('_');
  var dispName = sbParts.slice(0, 2).join(' ') || c.suchbegriff || 'Kontakt';

  // Gesamtbreite: A=leer | B=Gebiet | C=PLZ | D=Ort | E=Entf | F=Fahrt | G=leer | H=Gebiet | I=PLZ | J=Ort | K=Entf | L=Fahrt | M=Dat | N=Thema | O=Dat | P=Thema | Q=Dat | R=Thema | S=Dat | T=Thema
  var COLS = 20;

  var css =
    'body{font-family:Arial,sans-serif;font-size:10pt;}' +
    'table{border-collapse:collapse;}' +
    'td{font-family:Arial,sans-serif;font-size:10pt;padding:3px 7px;border:1px solid #c0c0c0;white-space:nowrap;}' +
    '.nb{border:none;background:none;}' +
    '.lbl{font-weight:bold;font-size:11pt;background:#eaecf2;border:1px solid #b0b4c0;}' +
    '.val{font-size:11pt;border:1px solid #c0c0c0;}' +
    '.hdrL{font-weight:bold;background:#d4e6f1;text-align:center;border:1px solid #90b4c8;}' +
    '.hdrR{font-weight:bold;background:#d5e8d4;text-align:center;border:1px solid #90b8a0;}' +
    '.hdrI{font-weight:bold;background:#fff0b3;text-align:center;border:1px solid #c8b040;}' +
    '.plz{font-family:Consolas,monospace;}' +
    '.num{text-align:right;}' +
    '.inp{background:#fff9e0;}';

  var html =
    '<html xmlns:o="urn:schemas-microsoft-com:office:office"' +
    ' xmlns:x="urn:schemas-microsoft-com:office:excel"' +
    ' xmlns="http://www.w3.org/TR/REC-html40">' +
    '<head><meta http-equiv="Content-Type" content="text/html; charset=utf-8">' +
    '<style>' + css + '</style></head><body><table>';

  function emptyRow(cols) {
    return '<tr><td class="nb" colspan="' + cols + '" style="height:5px;"></td></tr>';
  }

  // 3 leere Zeilen oben
  html += emptyRow(COLS) + emptyRow(COLS) + emptyRow(COLS);

  // Kopfzeilen
  html +=
    '<tr>' +
      '<td class="nb"></td>' +
      '<td class="lbl" colspan="2">Kunde:</td>' +
      '<td class="val" colspan="4">' + xlsEsc(dispName) + '</td>' +
      '<td class="nb"></td>' +
      '<td class="lbl" colspan="2">Kd.Nr:</td>' +
      '<td class="val" x:str colspan="3">' + xlsEsc(kdnrPart) + '</td>' +
      '<td class="nb" colspan="7"></td>' +
    '</tr><tr>' +
      '<td class="nb"></td>' +
      '<td class="lbl" colspan="2">Vertragsnr.:</td>' +
      '<td class="val" x:str colspan="2">' + xlsEsc(vtrnr) + '</td>' +
      '<td class="lbl" colspan="2">Eigene PLZ:</td>' +
      '<td class="nb"></td>' +
      '<td class="val" x:str colspan="2">' + xlsEsc(eigenePlz || '—') + '</td>' +
      '<td class="lbl" colspan="2">Umkreis:</td>' +
      '<td class="inp" colspan="2">' + xlsEsc(umkreisVal) + '</td>' +
      '<td class="nb" colspan="6"></td>' +
    '</tr><tr>' +
      '<td class="nb"></td>' +
      '<td class="lbl" colspan="2">PLZ-Gebiete (3-stlg.):</td>' +
      '<td class="val">' + plz3List.length + '</td>' +
      '<td class="lbl" colspan="2">PLZ gesamt:</td>' +
      '<td class="val">' + n + '</td>' +
      '<td class="nb" colspan="13"></td>' +
    '</tr>' +
    emptyRow(COLS);

  // Spaltenüberschriften
  // A=leer | B=Gebiet | C=PLZ | D=Ort | E=Entf(km) | F=Fahrt(km) | G=leer | H=Gebiet | I=PLZ | J=Ort | K=Entf | L=Fahrt | M-T = 4×Datum+Thema
  // Sortierhinweis direkt im Kopf – keine Extra-Zeile, damit Excel-Filter funktioniert
  html +=
    '<tr>' +
      '<td class="nb"></td>' +
      '<td class="hdrL">Gebiet (↑ Entf.)</td>' +
      '<td class="hdrL">PLZ</td>' +
      '<td class="hdrL">Ort</td>' +
      '<td class="hdrL">Entfernung</td>' +
      '<td class="hdrL">Fahrtstrecke</td>' +
      '<td class="nb"></td>' +
      '<td class="hdrR">Gebiet (↑ PLZ)</td>' +
      '<td class="hdrR">PLZ</td>' +
      '<td class="hdrR">Ort</td>' +
      '<td class="hdrR">Entfernung</td>' +
      '<td class="hdrR">Fahrtstrecke</td>' +
      '<td class="hdrI" style="min-width:90px;">Datum</td>' +
      '<td class="hdrI" style="min-width:160px;">Thema</td>' +
      '<td class="hdrI" style="min-width:90px;">Datum</td>' +
      '<td class="hdrI" style="min-width:160px;">Thema</td>' +
      '<td class="hdrI" style="min-width:90px;">Datum</td>' +
      '<td class="hdrI" style="min-width:160px;">Thema</td>' +
      '<td class="hdrI" style="min-width:90px;">Datum</td>' +
      '<td class="hdrI" style="min-width:160px;">Thema</td>' +
    '</tr>';

  // Datenzeilen
  for (var i = 0; i < n; i++) {
    var l = leftRows[i];
    var r = rightRows[i];
    html += '<tr>';
    // A leer
    html += '<td class="nb"></td>';
    // Links B–F
    html +=
      '<td class="plz" x:str style="background:' + l.col + ';font-weight:bold;">' + xlsEsc(l.plz3) + 'xx</td>' +
      '<td class="plz" x:str style="background:' + l.col + ';">' + xlsEsc(l.plz5) + '</td>' +
      '<td style="background:' + l.col + ';">' + xlsEsc(l.ort) + '</td>' +
      '<td class="num" style="background:' + l.col + ';">' + kmFmt(l.dist) + '</td>' +
      '<td class="num" style="background:' + l.col + ';">' + kmFmt(l.fahrt) + '</td>';
    // G leer
    html += '<td class="nb"></td>';
    // Rechts H–L
    html +=
      '<td class="plz" x:str style="background:' + r.col + ';font-weight:bold;">' + xlsEsc(r.plz3) + 'xx</td>' +
      '<td class="plz" x:str style="background:' + r.col + ';">' + xlsEsc(r.plz5) + '</td>' +
      '<td style="background:' + r.col + ';">' + xlsEsc(r.ort) + '</td>' +
      '<td class="num" style="background:' + r.col + ';">' + kmFmt(r.dist) + '</td>' +
      '<td class="num" style="background:' + r.col + ';">' + kmFmt(r.fahrt) + '</td>';
    // 4× Datum + Thema
    for (var d = 0; d < 4; d++) {
      html += '<td class="inp" style="min-width:90px;"></td><td class="inp" style="min-width:160px;"></td>';
    }
    html += '</tr>';
  }

  html += '</table></body></html>';

  var safeName = sbParts.slice(0, 2).join('_').replace(/[^a-zA-Z0-9_\-äöüÄÖÜß]/g, '_') || 'Kontakt';
  var safeKdnr = kdnrPart ? kdnrPart.replace(/[^a-zA-Z0-9_\-]/g, '_') : 'xxx';
  var filename  = safeName + '_' + safeKdnr + '.xls';

  var blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a);
  a.click();
  setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// ─── PLZ-Import ───────────────────────────────────────────────────
async function startPlzImport() {
  var btn  = document.getElementById('lpImportBtn');
  var msg  = document.getElementById('lpImportMsg');
  var res  = document.getElementById('lpImportResult');
  var file = document.getElementById('lpImportFile').files[0];

  if (!file) { msg.style.color = '#e74c3c'; msg.textContent = 'Keine Datei gewählt.'; return; }

  msg.style.color = '#642d7b';
  msg.textContent = 'Datei wird gelesen…';
  res.innerHTML   = '';
  btn.disabled    = true;

  var text;
  try { text = await file.text(); }
  catch(e) { msg.textContent = 'Fehler beim Lesen: ' + e.message; btn.disabled = false; return; }

  var json;
  try { json = JSON.parse(text); }
  catch(e) { msg.style.color = '#e74c3c'; msg.textContent = 'Ungültiges JSON: ' + e.message; btn.disabled = false; return; }

  if (!json.contacts || !json.assignments) {
    msg.style.color = '#e74c3c';
    msg.textContent = 'JSON fehlt contacts oder assignments.';
    btn.disabled = false;
    return;
  }

  msg.textContent = 'Sende ' + json.contacts.length + ' Kontakte, ' + json.assignments.length + ' Zuweisungen…';

  try {
    var r    = await fetch('api/import-plz.php', { method: 'POST', headers: {'Content-Type':'application/json'}, body: text });
    var data = await r.json();

    if (data.ok) {
      msg.style.color = '#27ae60';
      msg.textContent = '✓ Import abgeschlossen';
      res.innerHTML =
        '<div style="margin-top:4px;line-height:1.8;">' +
        '<b>Kontakte neu:</b> '     + data.created_contacts    + '<br>' +
        '<b>Kontakte vorhanden:</b> ' + data.existing_contacts  + '<br>' +
        '<b>Zuweisungen neu:</b> '  + data.created_assignments + '<br>' +
        '<b>Zuweisungen upd.:</b> ' + data.updated_assignments + '<br>' +
        (data.errors && data.errors.length ?
          '<span style="color:#e74c3c"><b>Fehler:</b> ' + data.errors.length + '<br>' +
          data.errors.slice(0,5).map(function(e){return '• '+e;}).join('<br>') + '</span>' : '') +
        '</div>';
      await loadContacts();
      if (typeof loadPlzStatus === 'function') loadPlzStatus();
    } else {
      msg.style.color = '#e74c3c';
      msg.textContent = data.error || 'Fehler beim Import';
    }
  } catch(e) {
    msg.style.color = '#e74c3c';
    msg.textContent = 'Netzwerkfehler: ' + e.message;
  }

  btn.disabled = false;
}

// ─── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  checkLogin();
  loadPlzStatus();
  loadContacts();
  loadSyncStatus();
  setInterval(loadSyncStatus, 3600000);
});
