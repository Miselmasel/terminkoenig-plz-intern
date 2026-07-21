<?php
// EINMALIG-SKRIPT: Alle Kontakte + PLZ-Zuweisungen loeschen
// DANACH SOFORT LOESCHEN!
require_once __DIR__ . '/db.php';
requireAdmin();

$pdo = getDB();
$pdo->exec('SET FOREIGN_KEY_CHECKS=0');
$pdo->exec('TRUNCATE TABLE plz_assignments');
$pdo->exec('TRUNCATE TABLE contacts');
$pdo->exec('SET FOREIGN_KEY_CHECKS=1');

jsonOut(['ok' => true, 'msg' => 'Alle Kontakte und PLZ-Zuweisungen geloescht.']);
