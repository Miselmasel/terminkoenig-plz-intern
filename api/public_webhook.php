<?php
// Öffentlicher Webhook – wird von der PLZ-Karte (terminkoenig.plz-vertriebsplaner.de)
// aufgerufen, wenn ein Formular abgeschickt wird.
// Legt Interessent/Kunde an und trägt PLZ-Wünsche in die Verwaltung ein.
// Kein Session-Login nötig; geschützt durch WEBHOOK_KEY.
define('WEBHOOK_KEY', 'tk_public_2026wh');

require_once __DIR__ . '/db.php';

// CORS – nur von der öffentlichen Terminkönig-Karte erlauben
$allowedOrigins = [
    'https://terminkoenig.plz-vertriebsplaner.de',
    'https://www.terminkoenig.plz-vertriebsplaner.de',
    'https://terminkoenig-plz-suche.vercel.app',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { jsonOut(['error' => 'Nur POST'], 405); }

// Key-Prüfung
if (($_GET['key'] ?? '') !== WEBHOOK_KEY) { jsonOut(['error' => 'Unauthorized'], 401); }

$d = json_decode(file_get_contents('php://input'), true);
if (!is_array($d)) { jsonOut(['error' => 'Ungültige JSON-Daten'], 400); }

$sender  = $d['senderBlock'] ?? [];
$plzList = $d['plzList']     ?? [];
$type    = $sender['type']   ?? 'interessent';

$db = getDB();

if ($type === 'interessent') {
    $vorname  = trim($sender['vorname']  ?? '');
    $nachname = trim($sender['nachname'] ?? '');
    $email    = trim($sender['email']    ?? '');
    $telefon  = trim($sender['telefon']  ?? '');
    if (!$vorname || !$nachname) { jsonOut(['error' => 'Vor- und Nachname erforderlich'], 400); }

    $suchbegriff = $nachname . '_' . $vorname;
    $notizen = implode("\n", array_filter(["E-Mail: $email", $telefon ? "Tel: $telefon" : '']));

    // Duplikat-Prüfung anhand Suchbegriff
    $stmt = $db->prepare('SELECT id FROM contacts WHERE suchbegriff = ?');
    $stmt->execute([$suchbegriff]);
    $existing = $stmt->fetch();

    if ($existing) {
        $contactId = $existing['id'];
        $created   = false;
        // Neue Anfrage als Notiz anhängen
        $anfrageNotiz = date('d.m.Y') . ' – Neue Anfrage von öffentlicher Karte'
            . ($email   ? "\nE-Mail: $email"   : '')
            . ($telefon ? "\nTel: $telefon"     : '');
        $db->prepare("UPDATE contacts SET notizen = CONCAT(IFNULL(notizen,''), CASE WHEN notizen IS NULL OR notizen = '' THEN '' ELSE '\n---\n' END, ?) WHERE id = ?")
           ->execute([$anfrageNotiz, $contactId]);
    } else {
        $db->prepare('INSERT INTO contacts (suchbegriff, kontakt_typ, typ, notizen) VALUES (?,?,?,?)')
           ->execute([$suchbegriff, 'interessent', 'bbm', $notizen]);
        $contactId = $db->lastInsertId();
        $created   = true;
    }
} else {
    // Kunde – per Kundennummer suchen
    $kdnr  = trim($sender['kundennummer']   ?? '');
    $vtrnr = trim($sender['vertragsnummer'] ?? '');
    if (!$kdnr) { jsonOut(['error' => 'Kundennummer erforderlich'], 400); }

    $stmt = $db->prepare('SELECT id FROM contacts WHERE kundennummer = ?');
    $stmt->execute([$kdnr]);
    $existing = $stmt->fetch();

    if ($existing) {
        $contactId = $existing['id'];
        $created   = false;
        // Neue Anfrage als Notiz anhängen
        $anfrageNotiz = date('d.m.Y') . ' – Neue Anfrage von öffentlicher Karte'
            . "\nVertrag: $vtrnr";
        $db->prepare("UPDATE contacts SET notizen = CONCAT(IFNULL(notizen,''), CASE WHEN notizen IS NULL OR notizen = '' THEN '' ELSE '\n---\n' END, ?) WHERE id = ?")
           ->execute([$anfrageNotiz, $contactId]);
    } else {
        $suchbegriff = '_Kd_' . $kdnr;
        $db->prepare('INSERT INTO contacts (suchbegriff, kundennummer, vertragsnummer, kontakt_typ, typ) VALUES (?,?,?,?,?)')
           ->execute([$suchbegriff, $kdnr, $vtrnr, 'kunde', 'bbm']);
        $contactId = $db->lastInsertId();
        $created   = true;
    }
}

// PLZ-Wünsche eintragen (upsert – vorhandene Einträge werden nur auf wunsch gesetzt wenn noch kein belegt/reserviert)
$assigned = 0;
if (!empty($plzList)) {
    $stmt = $db->prepare(
        'INSERT INTO plz_assignments (plz3, contact_id, status, notiz, geaendert_von)
         VALUES (?, ?, \'wunsch\', \'\', \'öffentliche Karte\')
         ON DUPLICATE KEY UPDATE
           status       = IF(status = \'wunsch\', \'wunsch\', status),
           geaendert_am = NOW()'
    );
    foreach ($plzList as $raw) {
        $plz3 = substr(preg_replace('/\D/', '', (string)$raw), 0, 3);
        if (strlen($plz3) === 3 && $plz3 !== '000') {
            $stmt->execute([$plz3, $contactId]);
            $assigned++;
        }
    }
}

jsonOut(['ok' => true, 'contact_id' => $contactId, 'created' => $created, 'plz_assigned' => $assigned]);
