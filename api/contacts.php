<?php
require_once __DIR__ . '/db.php';
requireLogin();

$method = $_SERVER['REQUEST_METHOD'];
$id     = intval($_GET['id'] ?? 0);

// GET /api/contacts.php           → alle Kontakte
// GET /api/contacts.php?id=5      → ein Kontakt mit PLZ-Liste
// POST /api/contacts.php          → neuen Kontakt anlegen
// PUT /api/contacts.php?id=5      → Kontakt bearbeiten
// DELETE /api/contacts.php?id=5   → Kontakt löschen

if ($method === 'GET') {
    if ($id) {
        $stmt = getDB()->prepare('SELECT * FROM contacts WHERE id = ?');
        $stmt->execute([$id]);
        $contact = $stmt->fetch();
        if (!$contact) jsonOut(['error' => 'Nicht gefunden'], 404);

        $stmt2 = getDB()->prepare('SELECT plz3, status, notiz FROM plz_assignments WHERE contact_id = ? ORDER BY plz3');
        $stmt2->execute([$id]);
        $contact['plz_list'] = $stmt2->fetchAll();
        jsonOut($contact);
    }

    $stmt = getDB()->query(
        'SELECT c.*, COUNT(p.id) AS plz_count
         FROM contacts c
         LEFT JOIN plz_assignments p ON p.contact_id = c.id
         GROUP BY c.id
         ORDER BY c.gesehen ASC, c.suchbegriff'
    );
    jsonOut($stmt->fetchAll());
}

if ($method === 'POST' && ($_GET['action'] ?? '') === '') {
    $d = json_decode(file_get_contents('php://input'), true);
    if (empty($d['suchbegriff'])) {
        jsonOut(['error' => 'Suchbegriff ist erforderlich'], 400);
    }
    $typ        = in_array($d['typ'] ?? '', ['bbm','bl']) ? $d['typ'] : 'bbm';
    $blWert     = ($typ === 'bl' && isset($d['bl_wert'])) ? intval($d['bl_wert']) : null;
    $kontaktTyp = in_array($d['kontakt_typ'] ?? '', ['interessent','kunde']) ? $d['kontakt_typ'] : 'kunde';

    $stmt = getDB()->prepare(
        'INSERT INTO contacts (suchbegriff,kundennummer,vertragsnummer,kontakt_typ,typ,bl_wert,notizen)
         VALUES (?,?,?,?,?,?,?)'
    );
    $stmt->execute([
        trim($d['suchbegriff']),
        $d['kundennummer']   ?? '',
        $d['vertragsnummer'] ?? '',
        $kontaktTyp,
        $typ,
        $blWert,
        $d['notizen'] ?? '',
    ]);
    jsonOut(['ok' => true, 'id' => getDB()->lastInsertId()], 201);
}

if ($method === 'PUT' && $id) {
    $d = json_decode(file_get_contents('php://input'), true);
    if (empty($d['suchbegriff'])) {
        jsonOut(['error' => 'Suchbegriff ist erforderlich'], 400);
    }
    $typ        = in_array($d['typ'] ?? '', ['bbm','bl']) ? $d['typ'] : 'bbm';
    $blWert     = ($typ === 'bl' && isset($d['bl_wert'])) ? intval($d['bl_wert']) : null;
    $kontaktTyp = in_array($d['kontakt_typ'] ?? '', ['interessent','kunde']) ? $d['kontakt_typ'] : 'kunde';

    $stmt = getDB()->prepare(
        'UPDATE contacts SET suchbegriff=?,kundennummer=?,vertragsnummer=?,kontakt_typ=?,typ=?,bl_wert=?,notizen=?
         WHERE id=?'
    );
    $stmt->execute([
        trim($d['suchbegriff']),
        $d['kundennummer']   ?? '',
        $d['vertragsnummer'] ?? '',
        $kontaktTyp,
        $typ,
        $blWert,
        $d['notizen'] ?? '',
        $id,
    ]);
    jsonOut(['ok' => true]);
}

if ($method === 'PATCH' && $id) {
    $d = json_decode(file_get_contents('php://input'), true);
    if (isset($d['gesehen'])) {
        getDB()->prepare('UPDATE contacts SET gesehen = ? WHERE id = ?')
               ->execute([intval($d['gesehen']), $id]);
    }
    jsonOut(['ok' => true]);
}

if ($method === 'DELETE' && $id) {
    requireAdmin();
    getDB()->prepare('DELETE FROM contacts WHERE id = ?')->execute([$id]);
    jsonOut(['ok' => true]);
}

// POST /api/contacts.php?action=merge  → Duplikate zusammenführen
if ($method === 'POST' && ($_GET['action'] ?? '') === 'merge') {
    $d          = json_decode(file_get_contents('php://input'), true);
    $primaryId  = intval($d['primary_id'] ?? 0);
    $mergeIds   = array_filter(array_map('intval', $d['merge_ids'] ?? []));

    if (!$primaryId || empty($mergeIds)) {
        jsonOut(['error' => 'primary_id und merge_ids erforderlich'], 400);
    }

    $db = getDB();
    $ph = implode(',', array_fill(0, count($mergeIds), '?'));

    // Konflikte entfernen: Assignments aus merge-Kontakten die primary schon hat
    $db->prepare("DELETE pa FROM plz_assignments pa
                  JOIN plz_assignments pa2 ON pa.plz3 = pa2.plz3 AND pa2.contact_id = ?
                  WHERE pa.contact_id IN ($ph)")
       ->execute(array_merge([$primaryId], $mergeIds));

    // Rest auf primary umschreiben
    $db->prepare("UPDATE plz_assignments SET contact_id = ? WHERE contact_id IN ($ph)")
       ->execute(array_merge([$primaryId], $mergeIds));

    // Zusammengeführte Kontakte löschen
    $db->prepare("DELETE FROM contacts WHERE id IN ($ph)")
       ->execute($mergeIds);

    jsonOut(['ok' => true]);
}

jsonOut(['error' => 'Ungültige Anfrage'], 400);
