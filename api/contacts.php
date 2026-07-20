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
         ORDER BY c.nachname, c.vorname, c.firma'
    );
    jsonOut($stmt->fetchAll());
}

if ($method === 'POST') {
    $d = json_decode(file_get_contents('php://input'), true);
    $stmt = getDB()->prepare(
        'INSERT INTO contacts (type,vorname,nachname,email,telefon,firma,kundennummer,vertragsnummer,notizen)
         VALUES (?,?,?,?,?,?,?,?,?)'
    );
    $stmt->execute([
        $d['type'] ?? 'interessent',
        $d['vorname']        ?? '',
        $d['nachname']       ?? '',
        $d['email']          ?? '',
        $d['telefon']        ?? '',
        $d['firma']          ?? '',
        $d['kundennummer']   ?? '',
        $d['vertragsnummer'] ?? '',
        $d['notizen']        ?? '',
    ]);
    jsonOut(['ok' => true, 'id' => getDB()->lastInsertId()], 201);
}

if ($method === 'PUT' && $id) {
    $d = json_decode(file_get_contents('php://input'), true);
    $stmt = getDB()->prepare(
        'UPDATE contacts SET type=?,vorname=?,nachname=?,email=?,telefon=?,firma=?,
         kundennummer=?,vertragsnummer=?,notizen=? WHERE id=?'
    );
    $stmt->execute([
        $d['type']           ?? 'interessent',
        $d['vorname']        ?? '',
        $d['nachname']       ?? '',
        $d['email']          ?? '',
        $d['telefon']        ?? '',
        $d['firma']          ?? '',
        $d['kundennummer']   ?? '',
        $d['vertragsnummer'] ?? '',
        $d['notizen']        ?? '',
        $id,
    ]);
    jsonOut(['ok' => true]);
}

if ($method === 'DELETE' && $id) {
    requireAdmin();
    getDB()->prepare('DELETE FROM contacts WHERE id = ?')->execute([$id]);
    jsonOut(['ok' => true]);
}

jsonOut(['error' => 'Ungültige Anfrage'], 400);
