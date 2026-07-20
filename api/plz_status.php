<?php
require_once __DIR__ . '/db.php';

$method = $_SERVER['REQUEST_METHOD'];

// GET  /api/plz_status.php                 → alle aktiven PLZ mit Kontaktname (ohne Login)
// POST /api/plz_status.php                 → PLZ-Status setzen – einzeln oder als Liste (Login)
// DELETE /api/plz_status.php?plz3=X[&contact_id=Y] → PLZ-Eintrag löschen (Login)

if ($method === 'GET') {
    $stmt = getDB()->query(
        'SELECT p.plz3, p.status, p.contact_id, p.notiz, c.suchbegriff,
                DATE_FORMAT(p.zugewiesen_am, \'%d.%m.%Y\') AS import_datum
         FROM plz_assignments p
         LEFT JOIN contacts c ON c.id = p.contact_id
         WHERE p.status != \'frei\'
         ORDER BY p.plz3, p.status DESC'
    );
    jsonOut($stmt->fetchAll());
}

if ($method === 'POST') {
    $session = requireLogin();
    $d = json_decode(file_get_contents('php://input'), true);

    $allowed = ['frei','wunsch','reserviert','belegt'];
    $status    = in_array($d['status'] ?? '', $allowed) ? $d['status'] : 'wunsch';
    $contactId = intval($d['contact_id'] ?? 0) ?: null;
    $notiz     = $d['notiz'] ?? '';
    $userId    = $session['user_id'] ?? null;

    // Batch-Modus: plz3_list ist ein Array von PLZ3-Strings
    $plzList = [];
    if (!empty($d['plz3_list']) && is_array($d['plz3_list'])) {
        foreach ($d['plz3_list'] as $raw) {
            $p = substr(preg_replace('/\D/', '', $raw), 0, 3);
            if ($p) $plzList[] = $p;
        }
    } elseif (!empty($d['plz3'])) {
        $p = substr(preg_replace('/\D/', '', $d['plz3']), 0, 3);
        if ($p) $plzList[] = $p;
    }

    if (!$plzList) jsonOut(['error' => 'PLZ fehlt'], 400);

    $stmt = getDB()->prepare(
        'INSERT INTO plz_assignments (plz3, contact_id, status, notiz, geaendert_von)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           status        = VALUES(status),
           notiz         = VALUES(notiz),
           geaendert_am  = NOW(),
           geaendert_von = VALUES(geaendert_von)'
    );

    $db = getDB();
    $db->beginTransaction();
    try {
        foreach ($plzList as $plz3) {
            $stmt->execute([$plz3, $contactId, $status, $notiz, $userId]);
        }
        $db->commit();
    } catch (Exception $e) {
        $db->rollBack();
        jsonOut(['error' => 'Datenbankfehler: ' . $e->getMessage()], 500);
    }

    jsonOut(['ok' => true, 'count' => count($plzList)]);
}

if ($method === 'DELETE') {
    requireLogin();
    $plz3      = substr(preg_replace('/\D/', '', $_GET['plz3'] ?? ''), 0, 3);
    $contactId = intval($_GET['contact_id'] ?? 0) ?: null;

    if (!$plz3) jsonOut(['error' => 'PLZ fehlt'], 400);

    if ($contactId) {
        // Nur den Eintrag dieses Kontakts löschen
        getDB()->prepare('DELETE FROM plz_assignments WHERE plz3 = ? AND contact_id = ?')
               ->execute([$plz3, $contactId]);
    } else {
        // Alle Einträge für diese PLZ löschen
        getDB()->prepare('DELETE FROM plz_assignments WHERE plz3 = ?')->execute([$plz3]);
    }
    jsonOut(['ok' => true]);
}

jsonOut(['error' => 'Ungültige Anfrage'], 400);
