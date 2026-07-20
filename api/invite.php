<?php
require_once __DIR__ . '/db.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$token  = $_GET['token']  ?? '';

// ─── POST (kein action) → Admin lädt User ein ────────────────────────────
if ($method === 'POST' && !$action) {
    requireAdmin();
    $d     = json_decode(file_get_contents('php://input'), true);
    $email = strtolower(trim($d['email'] ?? ''));

    if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        jsonOut(['error' => 'Ungültige E-Mail-Adresse'], 400);
    }

    $db  = getDB();
    $chk = $db->prepare('SELECT id FROM users WHERE email = ?');
    $chk->execute([$email]);
    if ($chk->fetch()) {
        jsonOut(['error' => 'E-Mail-Adresse bereits vorhanden'], 409);
    }

    $tok = bin2hex(random_bytes(32));
    $exp = date('Y-m-d H:i:s', strtotime('+72 hours'));

    $stmt = $db->prepare(
        "INSERT INTO users (username, password_hash, name, email, role, invite_token, invite_expires)
         VALUES (?, '', '', ?, 'user', ?, ?)"
    );
    $stmt->execute([$email, $email, $tok, $exp]);

    // Einladungs-Link aufbauen
    if (defined('APP_URL')) {
        $base = rtrim(APP_URL, '/');
    } else {
        $scheme = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $base   = $scheme . '://' . $_SERVER['HTTP_HOST']
                  . rtrim(dirname(dirname($_SERVER['PHP_SELF'])), '/');
    }
    $link = $base . '/accept-invite.html?token=' . urlencode($tok);
    $from = defined('MAIL_FROM') ? MAIL_FROM : ('noreply@' . $_SERVER['HTTP_HOST']);

    $subject = '=?UTF-8?B?' . base64_encode('Einladung: Terminkönig PLZ-Verwaltung') . '?=';
    $body =
        "Hallo,\r\n\r\n" .
        "Sie wurden zur Terminkönig PLZ-Verwaltung eingeladen.\r\n\r\n" .
        "Klicken Sie auf den folgenden Link, um Ihr Passwort zu vergeben:\r\n" .
        $link . "\r\n\r\n" .
        "Dieser Link ist 72 Stunden gültig.\r\n\r\n" .
        "Mit freundlichen Grüßen\r\nTerminkönig";
    $headers =
        "From: Terminkonig <{$from}>\r\n" .
        "Content-Type: text/plain; charset=UTF-8\r\n" .
        "Content-Transfer-Encoding: 8bit";

    if (!@mail($email, $subject, $body, $headers)) {
        $db->prepare('DELETE FROM users WHERE invite_token = ?')->execute([$tok]);
        jsonOut(['error' => 'E-Mail konnte nicht gesendet werden'], 500);
    }

    jsonOut(['ok' => true]);
}

// ─── GET ?token → Token prüfen (öffentlich) ──────────────────────────────
if ($method === 'GET' && $token) {
    $db   = getDB();
    $stmt = $db->prepare(
        "SELECT id, email, invite_expires FROM users WHERE invite_token = ? AND password_hash = ''"
    );
    $stmt->execute([$token]);
    $user = $stmt->fetch();

    if (!$user || strtotime($user['invite_expires']) < time()) {
        jsonOut(['error' => 'Einladungslink ungültig oder abgelaufen'], 400);
    }

    jsonOut(['ok' => true, 'email' => $user['email']]);
}

// ─── POST ?action=set-password → Passwort setzen ─────────────────────────
if ($method === 'POST' && $action === 'set-password') {
    $d    = json_decode(file_get_contents('php://input'), true);
    $tok  = $d['token']    ?? '';
    $pass = $d['password'] ?? '';

    if (!$tok || strlen($pass) < 8) {
        jsonOut(['error' => 'Token und Passwort (min. 8 Zeichen) erforderlich'], 400);
    }

    $db   = getDB();
    $stmt = $db->prepare(
        "SELECT id, invite_expires FROM users WHERE invite_token = ? AND password_hash = ''"
    );
    $stmt->execute([$tok]);
    $user = $stmt->fetch();

    if (!$user || strtotime($user['invite_expires']) < time()) {
        jsonOut(['error' => 'Einladungslink ungültig oder abgelaufen'], 400);
    }

    $hash = password_hash($pass, PASSWORD_BCRYPT);
    $db->prepare(
        'UPDATE users SET password_hash = ?, invite_token = NULL, invite_expires = NULL WHERE id = ?'
    )->execute([$hash, $user['id']]);

    jsonOut(['ok' => true]);
}

jsonOut(['error' => 'Ungültige Anfrage'], 400);
