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

// ─── PLZ-Status laden ─────────────────────────────────────────────
async function loadPlzStatus() {
  try {
    var res  = await fetch('api/plz_status.php');
    var data = await res.json();
    window.plzStatusData = {};
    data.forEach(function(d) { window.plzStatusData[d.plz3] = d; });
    updateStatusCount();
    if (window.statusMode && typeof refreshAll === 'function') refreshAll();
  } catch(e) { console.warn('PLZ-Status nicht geladen:', e); }
}

function updateStatusCount() {
  var vals = Object.values(window.plzStatusData);
  var b = vals.filter(function(d) { return d.status === 'belegt'; }).length;
  var r = vals.filter(function(d) { return d.status === 'reserviert'; }).length;
  var el = document.getElementById('lpStatusCount');
  if (el) el.textContent = b + ' belegt · ' + r + ' reserviert';
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

// ─── PLZ-Zuweisung ────────────────────────────────────────────────
window.onPlzAdminClick = function(plz3) {
  selectedPlz3 = plz3;
  var el = document.getElementById('lpAssignPlz');
  if (el) el.textContent = plz3 + 'xx';

  var existing = window.plzStatusData[plz3];
  var statusSel = document.getElementById('lpAssignStatus');
  var noteSel   = document.getElementById('lpAssignNote');
  var cntSel    = document.getElementById('lpAssignContact');
  if (statusSel) statusSel.value = existing ? existing.status : 'belegt';
  if (noteSel)   noteSel.value   = existing ? (existing.notiz || '') : '';
  if (cntSel)    cntSel.value    = existing ? (existing.contact_id || '') : '';

  var msg = document.getElementById('lpAssignMsg');
  if (msg) msg.textContent = '';

  var panel = document.getElementById('lpAssignPanel');
  if (panel) panel.style.display = 'block';

  var lp = document.getElementById('lp');
  if (lp) lp.scrollTop = 0;

  if (document.body.classList.contains('lp-col')) toggleLP();
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

  if (localMode) {
    window.plzStatusData[selectedPlz3] = { plz3: selectedPlz3, status: status, contact_id: contactId, notiz: notiz };
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

// ─── Kontakte laden ───────────────────────────────────────────────
async function loadContacts() {
  if (localMode) {
    allContacts = localContacts.map(function(c) { return Object.assign({}, c); });
    renderContactList(allContacts);
    populateContactDropdown();
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
  populateContactDropdown();
}

function populateContactDropdown() {
  var sel = document.getElementById('lpAssignContact');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Kontakt wählen —</option>';
  allContacts.forEach(function(c) {
    var opt = document.createElement('option');
    opt.value = c.id;
    var label = c.suchbegriff || '—';
    if (c.kundennummer) label += ' [' + c.kundennummer + ']';
    opt.textContent = label;
    sel.appendChild(opt);
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
    var typLabel = c.typ === 'bl' ? 'BL' : 'BBM';
    var typColor = c.typ === 'bl' ? '#2980b9' : '#642d7b';
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

// ─── BL-Dropdown ein-/ausblenden ─────────────────────────────────
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
    populateContactDropdown();
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
