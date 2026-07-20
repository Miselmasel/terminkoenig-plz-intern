<?php
require_once __DIR__ . '/db.php';
requireAdmin();

$method = $_SERVER['REQUEST_METHOD'];
$id     = intval($_GET['id'] ?? 0);

if ($method === 'GET') {
    $stmt = getDB()->query('SELECT id, username, name, email, role, erstellt_am, letzter_login FROM users ORDER BY name');
    jsonOut($stmt->fetchAll());
}

if ($method === 'POST') {
    $d = json_decode(file_get_contents('php://input'), true);
    if (empty($d['username']) || empty($d['password'])) {
        jsonOut(['error' => 'Benutzername und Passwort erforderlich'], 400);
    }
    $hash = password_hash($d['password'], PASSWORD_BCRYPT);
    $stmt = getDB()->prepare('INSERT INTO users (username, password_hash, name, email, role) VALUES (?,?,?,?,?)');
    $stmt->execute([
        $d['username'],
        $hash,
        $d['name']  ?? '',
        $d['email'] ?? '',
        in_array($d['role'] ?? '', ['admin','user']) ? $d['role'] : 'user',
    ]);
    jsonOut(['ok' => true, 'id' => getDB()->lastInsertId()], 201);
}

if ($method === 'PUT' && $id) {
    $d = json_decode(file_get_contents('php://input'), true);
    if (!empty($d['password'])) {
        $hash = password_hash($d['password'], PASSWORD_BCRYPT);
        $stmt = getDB()->prepare('UPDATE users SET name=?, email=?, role=?, password_hash=? WHERE id=?');
        $stmt->execute([$d['name'] ?? '', $d['email'] ?? '', $d['role'] ?? 'user', $hash, $id]);
    } else {
        $stmt = getDB()->prepare('UPDATE users SET name=?, email=?, role=? WHERE id=?');
        $stmt->execute([$d['name'] ?? '', $d['email'] ?? '', $d['role'] ?? 'user', $id]);
    }
    jsonOut(['ok' => true]);
}

if ($method === 'DELETE' && $id) {
    if ($id === intval($_SESSION['user_id'] ?? 0)) {
        jsonOut(['error' => 'Eigenen Account nicht löschbar'], 400);
    }
    getDB()->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
    jsonOut(['ok' => true]);
}

jsonOut(['error' => 'Ungültige Anfrage'], 400);
