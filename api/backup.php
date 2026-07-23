<?php
require_once __DIR__ . '/db.php';

define('APP_VERSION', '0.09 beta');
define('BACKUP_DIR',  __DIR__ . '/../backups/');
define('MAX_BACKUPS', 30);

// Cron-Zugriff via Secret-Parameter, sonst Admin-Session
$isCron  = defined('CRON_SECRET') && ($_GET['cron_secret'] ?? '') === CRON_SECRET && CRON_SECRET !== '';
$isAdmin = false;

if (!$isCron) {
    session_start();
    $isAdmin = !empty($_SESSION['user_id']) && ($_SESSION['role'] ?? '') === 'admin';
    if (!$isAdmin) {
        jsonOut(['error' => 'Kein Zugriff'], 401);
    }
}

if (!is_dir(BACKUP_DIR)) {
    mkdir(BACKUP_DIR, 0755, true);
}

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list':    doList();                                                     break;
    case 'create':  doCreate();                                                   break;
    case 'restore':
        if (!$isAdmin) jsonOut(['error' => 'Nur Admins dürfen wiederherstellen'], 403);
        doRestore();
        break;
    default:
        jsonOut(['error' => 'Unbekannte Aktion'], 400);
}

// ── Hilfsfunktionen ────────────────────────────────────────────────────────

function makeLabel(): string {
    return APP_VERSION . ' - ' . date('d.m.Y') . ' - ' . date('H:i') . 'h';
}

function makeFilename(): string {
    $v = preg_replace('/[^a-z0-9\.]/i', '-', APP_VERSION);
    return 'backup_' . date('Ymd_Hi') . '_v' . $v . '.json';
}

function getBackupFiles(): array {
    $files = glob(BACKUP_DIR . 'backup_*.json');
    if (!$files) return [];
    usort($files, fn($a, $b) => filemtime($b) - filemtime($a));
    return $files;
}

function pruneOld(): void {
    $files = getBackupFiles();
    while (count($files) > MAX_BACKUPS) {
        @unlink(array_pop($files));
    }
}

// ── Aktionen ───────────────────────────────────────────────────────────────

function doList(): void {
    $out = [];
    foreach (getBackupFiles() as $f) {
        $raw  = file_get_contents($f);
        $meta = json_decode($raw, true)['meta'] ?? [];
        $out[] = [
            'file'  => basename($f),
            'label' => $meta['label']   ?? basename($f),
            'size'  => filesize($f),
        ];
    }
    jsonOut($out);
}

function doCreate(): void {
    $pdo    = getDB();
    $tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
    $dump   = [];

    foreach ($tables as $table) {
        $create = $pdo->query("SHOW CREATE TABLE `$table`")->fetch(PDO::FETCH_NUM);
        $rows   = $pdo->query("SELECT * FROM `$table`")->fetchAll(PDO::FETCH_ASSOC);
        $dump[$table] = [
            'create' => $create[1],
            'rows'   => $rows,
        ];
    }

    $label    = makeLabel();
    $filename = makeFilename();
    $payload  = json_encode([
        'meta'   => ['version' => APP_VERSION, 'label' => $label, 'created' => date('c')],
        'tables' => $dump,
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

    file_put_contents(BACKUP_DIR . $filename, $payload);
    pruneOld();
    jsonOut(['ok' => true, 'file' => $filename, 'label' => $label]);
}

function doRestore(): void {
    $filename = $_POST['file'] ?? '';
    if (!preg_match('/^backup_\d{8}_\d{4}_v[\w\.-]+\.json$/', $filename)) {
        jsonOut(['error' => 'Ungültiger Dateiname'], 400);
    }
    $filepath = BACKUP_DIR . $filename;
    if (!file_exists($filepath)) {
        jsonOut(['error' => 'Sicherung nicht gefunden'], 404);
    }

    $data   = json_decode(file_get_contents($filepath), true);
    $tables = $data['tables'] ?? [];
    $pdo    = getDB();

    $pdo->exec('SET FOREIGN_KEY_CHECKS=0');
    foreach ($tables as $table => $info) {
        $pdo->exec("DROP TABLE IF EXISTS `$table`");
        $pdo->exec($info['create']);
        if (!empty($info['rows'])) {
            $cols  = array_keys($info['rows'][0]);
            $ph    = '(' . implode(', ', array_fill(0, count($cols), '?')) . ')';
            $stmt  = $pdo->prepare(
                'INSERT INTO `' . $table . '` (`' . implode('`, `', $cols) . '`) VALUES ' . $ph
            );
            foreach ($info['rows'] as $row) {
                $stmt->execute(array_values($row));
            }
        }
    }
    $pdo->exec('SET FOREIGN_KEY_CHECKS=1');

    jsonOut(['ok' => true]);
}
