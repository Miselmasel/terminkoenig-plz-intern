<?php
require_once __DIR__ . '/db.php';

$method = $_SERVER['REQUEST_METHOD'];

// GET /api/plz_status.php         → alle belegten/reservierten PLZ (für Karte, ohne Login)
// POST /api/plz_status.php        → PLZ-Status setzen (Login erforderlich)
// DELETE /api/plz_status.php?plz3=123 → PLZ freigeben (Login erforderlich)

if ($method === 'GET') {
    // Öffentlich lesbar damit die Karte die Status-Farben laden kann
    $stmt = getDB()->query(
        'SELECT p.plz3, p.status, p.contact_id, p.notiz,
                c.vorname, c.nachname, c.firma, c.type AS contact_type
         FROM plz_assignments p
         LEFT JOIN contacts c ON c.id = p.contact_id
         WHERE p.status != \'frei\'
         ORDER BY p.plz3'
    );
    jsonOut($stmt->fetchAll());
}

if ($method === 'POST') {
    $session = requireLogin();
    $d = json_decode(file_get_contents('php://input'), true);

    $plz3      = preg_replace('/\D/', '', $d['plz3'] ?? '');
    $plz3      = substr($plz3, 0, 3);
    $status    = in_array($d['status'] ?? '', ['frei','reserviert','belegt']) ? $d['status'] : 'belegt';
    $contactId = intval($d['contact_id'] ?? 0) ?: null;
    $notiz     = $d['notiz'] ?? '';

    if (!$plz3) jsonOut(['error' => 'PLZ fehlt'], 400);

    // Eintrag erstellen oder aktualisieren
    $stmt = getDB()->prepare(
        'INSERT INTO plz_assignments (plz3, contact_id, status, notiz, geaendert_von)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           contact_id    = VALUES(contact_id),
           status        = VALUES(status),
           notiz         = VALUES(notiz),
           geaendert_am  = NOW(),
           geaendert_von = VALUES(geaendert_von)'
    );
    $stmt->execute([$plz3, $contactId, $status, $notiz, $session['user_id']]);
    jsonOut(['ok' => true]);
}

if ($method === 'DELETE') {
    requireLogin();
    $plz3 = preg_replace('/\D/', '', $_GET['plz3'] ?? '');
    if (!$plz3) jsonOut(['error' => 'PLZ fehlt'], 400);

    getDB()->prepare('DELETE FROM plz_assignments WHERE plz3 = ?')->execute([$plz3]);
    jsonOut(['ok' => true]);
}

jsonOut(['error' => 'Ungültige Anfrage'], 400);
