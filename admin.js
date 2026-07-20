'use strict';

window.plzStatusData = {};
window.statusMode    = false;
var allContacts      = [];
var selectedPlz3     = null;
var currentContactId = null;

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

  // Linkes Panel öffnen wenn zugeklappt
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
  try {
    var res = await fetch('api/contacts.php');
    allContacts = await res.json();
    renderContactList(allContacts);
    populateContactDropdown();
  } catch(e) { console.warn('Kontakte nicht geladen:', e); }
}

function populateContactDropdown() {
  var sel = document.getElementById('lpAssignContact');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Kontakt wählen —</option>';
  allContacts.forEach(function(c) {
    var opt  = document.createElement('option');
    opt.value = c.id;
    var name = c.type === 'kunde'
      ? ((c.nachname || '') + (c.vorname ? ', ' + c.vorname : '') + (c.kundennummer ? ' [' + c.kundennummer + ']' : ''))
      : (c.firma || ((c.vorname || '') + ' ' + (c.nachname || '')).trim());
    opt.textContent = (c.type === 'kunde' ? 'K: ' : 'I: ') + (name.trim() || '—');
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
    var isK  = c.type === 'kunde';
    var name = isK
      ? (((c.nachname || '') + (c.vorname ? ', ' + c.vorname : '')).trim() || c.firma || '—')
      : (c.firma || ((c.vorname || '') + ' ' + (c.nachname || '')).trim() || '—');
    var sub  = isK
      ? (c.kundennummer ? 'Kd. ' + c.kundennummer : (c.email || ''))
      : (c.email || c.telefon || '');
    var cnt  = c.plz_count || 0;
    return '<div class="ct-item" onclick="selectContact(' + c.id + ')">' +
      '<span class="ct-badge ' + (isK ? 'ct-k' : 'ct-i') + '">' + (isK ? 'K' : 'I') + '</span>' +
      '<div class="ct-info">' +
        '<div class="ct-name">' + esc(name) + '</div>' +
        (sub ? '<div class="ct-sub">' + esc(sub) + '</div>' : '') +
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
    return [c.vorname, c.nachname, c.firma, c.email, c.kundennummer, c.vertragsnummer, c.telefon]
      .join(' ').toLowerCase().indexOf(q) >= 0;
  }));
}

function selectContact(id) {
  var c = allContacts.find(function(x) { return x.id === id; });
  if (c) openContactForm(c);
}

// ─── Kontakt-Formular ─────────────────────────────────────────────
function openContactForm(contact) {
  currentContactId = contact ? contact.id : null;
  document.getElementById('cmTitle').textContent = contact ? 'Kontakt bearbeiten' : 'Neuer Kontakt';
  switchCmTab(contact ? contact.type : 'interessent');
  document.getElementById('cmVorname').value        = contact ? (contact.vorname        || '') : '';
  document.getElementById('cmNachname').value       = contact ? (contact.nachname       || '') : '';
  document.getElementById('cmEmail').value          = contact ? (contact.email          || '') : '';
  document.getElementById('cmTelefon').value        = contact ? (contact.telefon        || '') : '';
  document.getElementById('cmFirma').value          = contact ? (contact.firma          || '') : '';
  document.getElementById('cmKundennummer').value   = contact ? (contact.kundennummer   || '') : '';
  document.getElementById('cmVertragsnummer').value = contact ? (contact.vertragsnummer || '') : '';
  document.getElementById('cmNotizen').value        = contact ? (contact.notizen        || '') : '';
  document.getElementById('cmMsg').textContent      = '';
  document.getElementById('contactModal').style.display = 'flex';
}

function closeContactForm() {
  document.getElementById('contactModal').style.display = 'none';
  currentContactId = null;
}

function switchCmTab(type) {
  document.getElementById('cmTabInt').classList.toggle('fm-tab-active',   type === 'interessent');
  document.getElementById('cmTabKunde').classList.toggle('fm-tab-active', type === 'kunde');
  document.getElementById('cmFieldsKunde').style.display = type === 'kunde' ? 'flex' : 'none';
  document.getElementById('cmType').value = type;
}

async function saveContact() {
  var d = {
    type:           document.getElementById('cmType').value,
    vorname:        document.getElementById('cmVorname').value.trim(),
    nachname:       document.getElementById('cmNachname').value.trim(),
    email:          document.getElementById('cmEmail').value.trim(),
    telefon:        document.getElementById('cmTelefon').value.trim(),
    firma:          document.getElementById('cmFirma').value.trim(),
    kundennummer:   document.getElementById('cmKundennummer').value.trim(),
    vertragsnummer: document.getElementById('cmVertragsnummer').value.trim(),
    notizen:        document.getElementById('cmNotizen').value.trim(),
  };
  var msg = document.getElementById('cmMsg');
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
