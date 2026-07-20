<?php
require_once __DIR__ . '/db.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

if ($action === 'login' && $method === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);
    $username = trim($body['username'] ?? '');
    $password = $body['password'] ?? '';

    if (!$username || !$password) {
        jsonOut(['error' => 'Benutzername und Passwort erforderlich'], 400);
    }

    $stmt = getDB()->prepare('SELECT * FROM users WHERE username = ?');
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        jsonOut(['error' => 'Ungültige Anmeldedaten'], 401);
    }

    session_start();
    $_SESSION['user_id'] = $user['id'];
    $_SESSION['username'] = $user['username'];
    $_SESSION['name']     = $user['name'];
    $_SESSION['role']     = $user['role'];

    getDB()->prepare('UPDATE users SET letzter_login = NOW() WHERE id = ?')->execute([$user['id']]);

    jsonOut(['ok' => true, 'name' => $user['name'], 'role' => $user['role']]);
}

if ($action === 'logout') {
    session_start();
    session_destroy();
    jsonOut(['ok' => true]);
}

if ($action === 'me') {
    $user = requireLogin();
    jsonOut(['ok' => true, 'name' => $user['name'], 'role' => $user['role']]);
}

jsonOut(['error' => 'Unbekannte Aktion'], 400);
