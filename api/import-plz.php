<?php
require_once __DIR__ . '/db.php';
requireAdmin();

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonOut(['error' => 'POST erwartet'], 405);
}

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!$data || empty($data['contacts']) || empty($data['assignments'])) {
    jsonOut(['error' => 'Ungültiges JSON oder fehlende Felder'], 400);
}

$pdo = getDB();

$created_contacts    = 0;
$existing_contacts   = 0;
$created_assignments = 0;
$updated_assignments = 0;
$errors              = [];

// Kontakte anlegen (idempotent via suchbegriff)
$stmtFind = $pdo->prepare('SELECT id FROM contacts WHERE suchbegriff = ? LIMIT 1');
$stmtIns  = $pdo->prepare(
    'INSERT INTO contacts (suchbegriff, typ, bl_wert, notizen) VALUES (?, ?, ?, ?)'
);

$contactMap = []; // suchbegriff -> id

foreach ($data['contacts'] as $c) {
    $sg = trim($c['suchbegriff'] ?? '');
    if (!$sg) continue;

    if (isset($contactMap[$sg])) continue; // bereits in diesem Batch gesehen

    $stmtFind->execute([$sg]);
    $row = $stmtFind->fetch();

    if ($row) {
        $contactMap[$sg] = (int)$row['id'];
        $existing_contacts++;
    } else {
        try {
            $stmtIns->execute([
                $sg,
                $c['typ']     ?? 'bbm',
                isset($c['bl_wert']) && $c['bl_wert'] !== null ? (int)$c['bl_wert'] : null,
                $c['notizen'] ?? '',
            ]);
            $contactMap[$sg] = (int)$pdo->lastInsertId();
            $created_contacts++;
        } catch (PDOException $e) {
            $errors[] = "Kontakt '$sg': " . $e->getMessage();
        }
    }
}

// Zuweisungen importieren
// Status-Priorität: belegt > reserviert > wunsch > frei
$prio = ['frei' => 0, 'wunsch' => 1, 'reserviert' => 2, 'belegt' => 3];

$stmtAssFind = $pdo->prepare(
    'SELECT id, status FROM plz_assignments WHERE plz3 = ? AND contact_id = ? LIMIT 1'
);
$stmtAssIns  = $pdo->prepare(
    'INSERT INTO plz_assignments (plz3, contact_id, status, notiz) VALUES (?, ?, ?, ?)'
);
$stmtAssUpd  = $pdo->prepare(
    'UPDATE plz_assignments SET status = ?, notiz = ? WHERE id = ?'
);

foreach ($data['assignments'] as $a) {
    $plz3 = trim($a['plz3'] ?? '');
    $sg   = trim($a['suchbegriff'] ?? '');
    if (!$plz3 || !$sg) continue;

    if (!isset($contactMap[$sg])) {
        // Kontakt war nicht im JSON-Batch (sollte nicht vorkommen), trotzdem DB prüfen
        $stmtFind->execute([$sg]);
        $row = $stmtFind->fetch();
        if (!$row) { $errors[] = "Kontakt '$sg' nicht gefunden für PLZ $plz3"; continue; }
        $contactMap[$sg] = (int)$row['id'];
    }

    $contactId = $contactMap[$sg];
    $status    = $a['status'] ?? 'wunsch';
    $notiz     = $a['notiz']  ?? '';

    try {
        $stmtAssFind->execute([$plz3, $contactId]);
        $existing = $stmtAssFind->fetch();

        if ($existing) {
            // Nur hochstufen (belegt schlägt wunsch), niemals herunterstufen
            $existPrio = $prio[$existing['status']] ?? 0;
            $newPrio   = $prio[$status]             ?? 0;
            if ($newPrio > $existPrio) {
                $stmtAssUpd->execute([$status, $notiz, (int)$existing['id']]);
                $updated_assignments++;
            }
        } else {
            $stmtAssIns->execute([$plz3, $contactId, $status, $notiz]);
            $created_assignments++;
        }
    } catch (PDOException $e) {
        $errors[] = "PLZ $plz3 / '$sg': " . $e->getMessage();
    }
}

jsonOut([
    'ok'                  => true,
    'created_contacts'    => $created_contacts,
    'existing_contacts'   => $existing_contacts,
    'created_assignments' => $created_assignments,
    'updated_assignments' => $updated_assignments,
    'errors'              => $errors,
]);
