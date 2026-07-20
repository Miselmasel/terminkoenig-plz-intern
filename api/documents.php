<?php
require_once __DIR__ . '/db.php';
requireLogin();

$method = $_SERVER['REQUEST_METHOD'];
$id     = intval($_GET['id'] ?? 0);
$action = $_GET['action'] ?? '';

define('UPLOAD_DIR', __DIR__ . '/../uploads/');
define('MAX_FILE_SIZE', 10 * 1024 * 1024); // 10 MB
$ALLOWED_EXT = ['xls', 'xlsx', 'csv', 'pdf'];

// Download
if ($method === 'GET' && $id && $action === 'download') {
    $stmt = getDB()->prepare('SELECT * FROM contact_documents WHERE id = ?');
    $stmt->execute([$id]);
    $doc = $stmt->fetch();
    if (!$doc) { header('HTTP/1.1 404 Not Found'); exit('Nicht gefunden'); }
    $path = UPLOAD_DIR . basename($doc['filename']);
    if (!file_exists($path)) { header('HTTP/1.1 404 Not Found'); exit('Datei nicht gefunden'); }
    header('Content-Type: application/octet-stream');
    header('Content-Disposition: attachment; filename="' . rawurlencode($doc['original_name']) . '"');
    header('Content-Length: ' . filesize($path));
    header('Cache-Control: no-cache');
    readfile($path);
    exit;
}

// Liste Dokumente für einen Kontakt
if ($method === 'GET') {
    $contactId = intval($_GET['contact_id'] ?? 0);
    if (!$contactId) jsonOut(['error' => 'contact_id erforderlich'], 400);
    $stmt = getDB()->prepare(
        'SELECT id, original_name, file_size, uploaded_at
         FROM contact_documents WHERE contact_id = ? ORDER BY uploaded_at DESC'
    );
    $stmt->execute([$contactId]);
    jsonOut($stmt->fetchAll());
}

// Upload
if ($method === 'POST') {
    $contactId = intval($_POST['contact_id'] ?? 0);
    if (!$contactId) jsonOut(['error' => 'contact_id erforderlich'], 400);

    if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        $errCodes = [1=>'zu groß (php.ini)',2=>'zu groß (Formular)',3=>'unvollständig',4=>'keine Datei',6=>'kein Temp-Verz.',7=>'kein Schreibrecht'];
        $code = $_FILES['file']['error'] ?? 0;
        jsonOut(['error' => 'Upload-Fehler: ' . ($errCodes[$code] ?? 'unbekannt')], 400);
    }

    $file     = $_FILES['file'];
    $origName = basename($file['name']);
    $ext      = strtolower(pathinfo($origName, PATHINFO_EXTENSION));

    if (!in_array($ext, $ALLOWED_EXT)) {
        jsonOut(['error' => 'Dateityp nicht erlaubt. Erlaubt: ' . implode(', ', $ALLOWED_EXT)], 400);
    }
    if ($file['size'] > MAX_FILE_SIZE) {
        jsonOut(['error' => 'Datei zu groß (max. 10 MB).'], 400);
    }

    if (!is_dir(UPLOAD_DIR)) {
        mkdir(UPLOAD_DIR, 0750, true);
    }

    $newName  = bin2hex(random_bytes(16)) . '.' . $ext;
    $destPath = UPLOAD_DIR . $newName;

    if (!move_uploaded_file($file['tmp_name'], $destPath)) {
        jsonOut(['error' => 'Datei konnte nicht gespeichert werden.'], 500);
    }

    $stmt = getDB()->prepare(
        'INSERT INTO contact_documents (contact_id, filename, original_name, file_size) VALUES (?,?,?,?)'
    );
    $stmt->execute([$contactId, $newName, $origName, $file['size']]);
    jsonOut(['ok' => true, 'id' => getDB()->lastInsertId()], 201);
}

// Löschen
if ($method === 'DELETE' && $id) {
    $stmt = getDB()->prepare('SELECT filename FROM contact_documents WHERE id = ?');
    $stmt->execute([$id]);
    $doc = $stmt->fetch();
    if (!$doc) jsonOut(['error' => 'Nicht gefunden'], 404);

    $path = UPLOAD_DIR . basename($doc['filename']);
    if (file_exists($path)) @unlink($path);

    getDB()->prepare('DELETE FROM contact_documents WHERE id = ?')->execute([$id]);
    jsonOut(['ok' => true]);
}

jsonOut(['error' => 'Ungültige Anfrage'], 400);
