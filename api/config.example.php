<?php
// DIESE DATEI: config.example.php  → liegt im Git (kein echtes Passwort!)
// KOPIEREN ALS: config.php         → liegt NICHT im Git (.gitignore)

define('DB_HOST', 'localhost');
define('DB_NAME', 'DATENBANKNAME');   // all-inkl Datenbankname eintragen
define('DB_USER', 'DATENBANKUSER');   // all-inkl Datenbankbenutzer eintragen
define('DB_PASS', 'PASSWORT');        // all-inkl Datenbankpasswort eintragen

// Session-Sicherheitsschlüssel (beliebige lange zufällige Zeichenkette)
define('SESSION_SECRET', 'HIER_ZUFAELLIGEN_STRING_EINTRAGEN');

// E-Mail (Einladungen)
define('MAIL_FROM', 'noreply@plz-vertriebsplaner.de');  // Absenderadresse
define('APP_URL',   'https://verwaltung.terminkoenig.plz-vertriebsplaner.de');  // Basis-URL ohne trailing slash

// Cron-Secret für automatische Datensicherung (beliebige lange zufällige Zeichenkette)
define('CRON_SECRET', 'HIER_CRON_SECRET_EINTRAGEN');
