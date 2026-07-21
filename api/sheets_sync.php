<?php
require_once __DIR__ . '/db.php';

$method = $_SERVER['REQUEST_METHOD'];

// Spalte partial hinzufügen falls nicht vorhanden
try { getDB()->exec("ALTER TABLE plz_assignments ADD COLUMN IF NOT EXISTS partial TINYINT(1) NOT NULL DEFAULT 0"); } catch (Exception $e) {}

// Settings-Tabelle anlegen falls nicht vorhanden
try {
    getDB()->exec("CREATE TABLE IF NOT EXISTS settings (
        `key` VARCHAR(64) NOT NULL,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (`key`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
} catch (Exception $e) {}

// Status-Abfrage
if ($method === 'GET' && ($_GET['action'] ?? '') === 'status') {
    requireLogin();
    $row = getDB()->query("SELECT value, updated_at FROM settings WHERE `key` = 'last_sheets_sync'")->fetch();
    if ($row) {
        $info = json_decode($row['value'], true);
        $info['updated_at'] = $row['updated_at'];
        jsonOut($info);
    }
    jsonOut(['status' => 'never', 'updated_at' => null]);
}

// Authentifizierung
$isCron   = $method === 'GET' && isset($_GET['cron_secret']) && $_GET['cron_secret'] === (defined('CRON_SECRET') ? CRON_SECRET : '');
$isManual = $method === 'POST';
if ($isManual) requireLogin();
if (!$isCron && !$isManual) jsonOut(['error' => 'Nicht autorisiert'], 403);

// Hilfsfunktionen
function setLastSync($db, $status, $details = '', $counts = []) {
    $val = json_encode(array_merge(['status' => $status, 'details' => $details], $counts));
    $db->prepare("INSERT INTO settings (`key`, value) VALUES ('last_sheets_sync', ?)
                  ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()")
       ->execute([$val]);
}

function normalizePlz3($plz_raw) {
    $raw   = preg_replace('/[^0-9\-]/', '', $plz_raw);
    $parts = explode('-', $raw);
    $start = $parts[0] ?? '';
    $end   = $parts[1] ?? $start;
    if (strlen($start) < 3 || strlen($end) < 3) return [];
    $p3s = intval(substr($start, 0, 3));
    $p3e = intval(substr($end,   0, 3));
    $result = [];
    for ($p = $p3s; $p <= $p3e; $p++) {
        $result[] = str_pad($p, 3, '0', STR_PAD_LEFT);
    }
    return array_unique($result);
}

function ensureContact($db, $suchbegriff, &$cache) {
    if (isset($cache[$suchbegriff])) return $cache[$suchbegriff];
    $stmt = $db->prepare('SELECT id FROM contacts WHERE suchbegriff = ?');
    $stmt->execute([$suchbegriff]);
    $row = $stmt->fetch();
    if ($row) { $cache[$suchbegriff] = $row['id']; return $row['id']; }

    $parts  = explode('_', $suchbegriff);
    $typ    = 'bbm';
    $blWert = null;
    foreach ($parts as $p) {
        if (preg_match('/^BL(\d+)$/i', $p, $m)) { $typ = 'bl'; $blWert = intval($m[1]); break; }
    }
    $db->prepare('INSERT INTO contacts (suchbegriff, kontakt_typ, typ, bl_wert, gesehen) VALUES (?, "kunde", ?, ?, 0)')
       ->execute([$suchbegriff, $typ, $blWert]);
    $id = $db->lastInsertId();
    $cache[$suchbegriff] = $id;
    return $id;
}

function parseGermanDate($datum) {
    $s = trim((string)$datum);
    if (!$s) return null;
    // dd.MM.yyyy oder d.M.yyyy
    if (preg_match('/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/', $s, $m))
        return sprintf('%04d-%02d-%02d', $m[3], $m[2], $m[1]);
    // yyyy-MM-dd (ISO)
    if (preg_match('/^(\d{4})-(\d{2})-(\d{2})/', $s, $m))
        return "$m[1]-$m[2]-$m[3]";
    // dd/MM/yyyy
    if (preg_match('/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/', $s, $m))
        return sprintf('%04d-%02d-%02d', $m[3], $m[2], $m[1]);
    return null;
}

// Duplikate automatisch zusammenführen (gleicher Nachname_Vorname-Basis)
function autoMergeDuplicates($db) {
    $contacts = $db->query('SELECT id, suchbegriff FROM contacts ORDER BY id ASC')->fetchAll();
    $groups   = [];
    foreach ($contacts as $c) {
        $parts = explode('_', $c['suchbegriff']);
        $key   = strtolower(implode('_', array_slice($parts, 0, 2)));
        if (!$key) continue;
        if (!isset($groups[$key])) $groups[$key] = [];
        $groups[$key][] = $c['id'];
    }
    $merged = 0;
    foreach ($groups as $ids) {
        if (count($ids) < 2) continue;
        $primaryId = $ids[0];
        $mergeIds  = array_slice($ids, 1);
        $ph = implode(',', array_fill(0, count($mergeIds), '?'));
        // Konflikte (gleiche PLZ beim primary) vorher löschen
        $db->prepare("DELETE pa FROM plz_assignments pa
                      JOIN plz_assignments pa2 ON pa.plz3 = pa2.plz3 AND pa2.contact_id = ?
                      WHERE pa.contact_id IN ($ph)")
           ->execute(array_merge([$primaryId], $mergeIds));
        // Rest auf primary umschreiben
        $db->prepare("UPDATE plz_assignments SET contact_id = ? WHERE contact_id IN ($ph)")
           ->execute(array_merge([$primaryId], $mergeIds));
        // Doppelte löschen
        $db->prepare("DELETE FROM contacts WHERE id IN ($ph)")
           ->execute($mergeIds);
        $merged += count($mergeIds);
    }
    return $merged;
}

// Google Apps Script abrufen
$scriptUrl = defined('SHEETS_SCRIPT_URL') ? SHEETS_SCRIPT_URL : '';
$apiKey    = defined('SHEETS_API_KEY')    ? SHEETS_API_KEY    : '';
if (!$scriptUrl) {
    setLastSync(getDB(), 'error', 'SHEETS_SCRIPT_URL nicht konfiguriert');
    jsonOut(['error' => 'SHEETS_SCRIPT_URL fehlt in config.php'], 500);
}

$url = $scriptUrl . (strpos($scriptUrl, '?') !== false ? '&' : '?') . 'key=' . urlencode($apiKey);
$ctx = stream_context_create(['http' => ['timeout' => 45, 'follow_location' => true, 'ignore_errors' => true]]);
$raw = @file_get_contents($url, false, $ctx);

if ($raw === false) {
    setLastSync(getDB(), 'error', 'Google Apps Script nicht erreichbar');
    jsonOut(['error' => 'Google Sheets nicht erreichbar'], 503);
}

$sheetsData = json_decode($raw, true);
if (!is_array($sheetsData) || !isset($sheetsData['rows'])) {
    setLastSync(getDB(), 'error', 'Ungültige Antwort: ' . substr($raw, 0, 200));
    jsonOut(['error' => 'Ungültige Sheets-Antwort'], 500);
}

// Sync ausführen
$db      = getDB();
$cache   = [];
$created = 0; $updated = 0; $skipped = 0;

$db->beginTransaction();
try {
    // PLZ3-Block-Statistik für Teilbelegung
    $blockStats   = $sheetsData['block_stats'] ?? [];
    $seenPairs    = []; // [plz3 => [contactId => true]] – was Sheets zurückgibt
    $seenContacts = []; // [contactId => true] – alle Kontakte die im Sheet vorkommen
    $deleted      = 0;

    foreach ($sheetsData['rows'] as $row) {
        $plz3list = normalizePlz3($row['plz_raw'] ?? '');
        if (empty($plz3list)) { $skipped++; continue; }

        foreach (($row['assignments'] ?? []) as $a) {
            $suchbegriff = trim($a['kunde'] ?? '');
            if (!$suchbegriff) continue;

            $status    = in_array($a['status'] ?? '', ['belegt','reserviert','wunsch']) ? $a['status'] : 'wunsch';
            $contactId = ensureContact($db, $suchbegriff, $cache);
            $datum     = parseGermanDate($a['datum'] ?? '');

            $seenContacts[$contactId] = true;

            foreach ($plz3list as $plz3) {
                if (!isset($seenPairs[$plz3])) $seenPairs[$plz3] = [];
                $seenPairs[$plz3][$contactId] = true;

                // Teilbelegung: 3 Stufen je nach Abdeckungsgrad
                $stats = $blockStats[$plz3] ?? null;
                if (!$stats || $stats['total'] <= 0) {
                    $partial = 0;
                } else {
                    $belegt = isset($stats['belegt']) ? $stats['belegt'] : $stats['assigned'];
                    $pct    = $belegt / $stats['total'] * 100;
                    if ($pct >= 100)     $partial = 0;
                    elseif ($pct >= 66)  $partial = 3;
                    elseif ($pct >= 33)  $partial = 2;
                    else                 $partial = 1;
                }
                // Prüfen ob bereits vorhanden
                $check = $db->prepare('SELECT status FROM plz_assignments WHERE plz3=? AND contact_id=?');
                $check->execute([$plz3, $contactId]);
                $existing = $check->fetch();

                if ($existing) {
                    // Sheet-Status gewinnt (Farbe entfernt = Wunsch, Farbe gesetzt = Belegt)
                    $db->prepare('UPDATE plz_assignments SET status=?, partial=?, zugewiesen_am=COALESCE(?,zugewiesen_am), geaendert_am=NOW() WHERE plz3=? AND contact_id=?')
                       ->execute([$status, $partial, $datum, $plz3, $contactId]);
                    $updated++;
                } else {
                    $db->prepare('INSERT INTO plz_assignments (plz3, contact_id, status, partial, zugewiesen_am, geaendert_am) VALUES (?,?,?,?,?,NOW())')
                       ->execute([$plz3, $contactId, $status, $partial, $datum]);
                    $created++;
                }
            }
        }
    }

    // Vollständiger Orphan-Cleanup: ALLE Assignments die nicht im Sheet sind → löschen
    // (Antwort-Struktur wurde oben bereits validiert – Sheet ist die Wahrheit,
    //  auch ein leeres Sheet bedeutet: alle Zuweisungen entfernen)
    $stmt = $db->query("SELECT plz3, contact_id FROM plz_assignments");
    foreach ($stmt->fetchAll() as $r) {
        if (!isset($seenPairs[$r['plz3']][$r['contact_id']])) {
            $db->prepare('DELETE FROM plz_assignments WHERE plz3=? AND contact_id=?')
               ->execute([$r['plz3'], $r['contact_id']]);
            $deleted++;
        }
    }

    $db->commit();

    // Duplikate nach Import automatisch zusammenführen
    $merged = autoMergeDuplicates($db);

    setLastSync($db, 'ok', '', ['created' => $created, 'updated' => $updated, 'skipped' => $skipped, 'merged' => $merged, 'deleted' => $deleted]);
    jsonOut(['ok' => true, 'created' => $created, 'updated' => $updated, 'skipped' => $skipped, 'merged' => $merged, 'deleted' => $deleted]);
} catch (Exception $e) {
    $db->rollBack();
    setLastSync(getDB(), 'error', $e->getMessage());
    jsonOut(['error' => $e->getMessage()], 500);
}
