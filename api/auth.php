<?php
require_once __DIR__ . '/db.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

if ($action === 'login' && $method === 'POST') {
    $body  = json_decode(file_get_contents('php://input'), true);
    $login = trim($body['email'] ?? $body['username'] ?? '');
    $pass  = $body['password'] ?? '';

    if (!$login || !$pass) {
        jsonOut(['error' => 'E-Mail und Passwort erforderlich'], 400);
    }

    $db = getDB();

    // Zuerst per E-Mail suchen, dann per Username (Rückwärts-Kompatibilität für admin-Account)
    $stmt = $db->prepare("SELECT * FROM users WHERE email = ? AND password_hash != ''");
    $stmt->execute([$login]);
    $user = $stmt->fetch();

    if (!$user) {
        $stmt = $db->prepare("SELECT * FROM users WHERE username = ? AND password_hash != ''");
        $stmt->execute([$login]);
        $user = $stmt->fetch();
    }

    if (!$user || !password_verify($pass, $user['password_hash'])) {
        jsonOut(['error' => 'Ungültige Anmeldedaten'], 401);
    }

    session_start();
    $_SESSION['user_id']  = $user['id'];
    $_SESSION['username'] = $user['username'];
    $_SESSION['name']     = $user['name'];
    $_SESSION['email']    = $user['email'] ?? '';
    $_SESSION['role']     = $user['role'];

    $db->prepare('UPDATE users SET letzter_login = NOW() WHERE id = ?')->execute([$user['id']]);

    jsonOut(['ok' => true, 'name' => $user['name'], 'role' => $user['role'], 'email' => $user['email'] ?? '']);
}

if ($action === 'logout') {
    session_start();
    session_destroy();
    jsonOut(['ok' => true]);
}

if ($action === 'me') {
    $sess = requireLogin();
    jsonOut(['ok' => true, 'name' => $sess['name'], 'role' => $sess['role'], 'email' => $sess['email'] ?? '']);
}

if ($action === 'change-password' && $method === 'POST') {
    $sess = requireLogin();
    $d    = json_decode(file_get_contents('php://input'), true);
    $old  = $d['old_password'] ?? '';
    $new  = $d['new_password'] ?? '';

    if (strlen($new) < 8) {
        jsonOut(['error' => 'Neues Passwort muss mindestens 8 Zeichen lang sein'], 400);
    }

    $db   = getDB();
    $stmt = $db->prepare('SELECT password_hash FROM users WHERE id = ?');
    $stmt->execute([$sess['user_id']]);
    $row  = $stmt->fetch();

    if (!$row || !password_verify($old, $row['password_hash'])) {
        jsonOut(['error' => 'Aktuelles Passwort ist falsch'], 401);
    }

    $hash = password_hash($new, PASSWORD_BCRYPT);
    $db->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([$hash, $sess['user_id']]);
    jsonOut(['ok' => true]);
}

jsonOut(['error' => 'Unbekannte Aktion'], 400);
