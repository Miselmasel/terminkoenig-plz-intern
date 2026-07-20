# Terminkönig PLZ-Karte – Interne Verwaltungsversion

## Projektziel
Interne Erweiterung der öffentlichen PLZ-Karte. Zweck: PLZ-Gebiete (3-stellig) mit
Interessenten und Kunden verknüpfen und den Gebietsstatus (frei / reserviert / belegt)
auf der Karte sichtbar machen.

## Repositories
| Version   | Repo                                              | Sichtbarkeit |
|-----------|---------------------------------------------------|--------------|
| Öffentlich | https://github.com/Miselmasel/Terminkoenig-PLZ-Suche | öffentlich |
| Intern     | https://github.com/Miselmasel/terminkoenig-plz-intern | privat    |

## Live-URLs
- Öffentlich: https://terminkoenig.plz-vertriebsplaner.de/ (Vercel)
- Intern (geplant): https://intern.plz-vertriebsplaner.de/ (all-inkl)

## Tech Stack
| Schicht    | Technologie                          |
|------------|--------------------------------------|
| Frontend   | HTML + CSS + Leaflet.js + Turf.js    |
| Backend    | PHP (kein Node.js – all-inkl Hosting)|
| Datenbank  | MariaDB (all-inkl)                   |
| Hosting    | all-inkl.com Shared Hosting          |
| Code-Sync  | Git / GitHub (privates Repo)         |

## Dateistruktur
```
/
├── index.html          ← Karte (von öffentlicher Version übernommen, erweitert)
├── script.js           ← Kartenlogik (PLZ-Status aus DB laden)
├── style.css           ← Styles
├── login.html          ← Login-Seite (intern)
├── favicon.png
├── terminkoenig_logo.png
├── .htaccess           ← Sicherheit (config.php schützen, kein Directory-Listing)
├── .gitignore          ← api/config.php und .env ausgeschlossen
├── CLAUDE.md           ← Diese Datei (Projektwissen für Claude)
├── api/
│   ├── config.php         ← DB-Zugangsdaten (NICHT im Git, in .gitignore)
│   ├── config.example.php ← Vorlage für config.php (im Git)
│   ├── db.php             ← DB-Verbindung + Hilfsfunktionen
│   ├── auth.php           ← Login/Logout/Session (?action=login|logout|me)
│   ├── contacts.php       ← Kontakte CRUD (GET/POST/PUT/DELETE)
│   ├── plz_status.php     ← PLZ-Status lesen/schreiben (GET öffentlich, POST/DELETE Login)
│   ├── users.php          ← Benutzerverwaltung (nur Admin)
│   └── send-email.js      ← Original E-Mail-Funktion (Vercel, nicht aktiv auf all-inkl)
└── db/
    └── schema.sql          ← Datenbank-Schema (einmalig in all-inkl importieren)
```

## Datenbank-Schema (Überblick)
- **users**: Interne Benutzer mit Login, Rolle (admin/user)
- **contacts**: Interessenten & Kunden (Vorname, Nachname, Firma, Email, Tel, Kundennr., Vertragsnr.)
- **plz_assignments**: Verknüpfung PLZ3 ↔ Kontakt mit Status (frei/reserviert/belegt)

## API-Endpunkte
| Endpunkt              | Methode | Auth     | Funktion                        |
|-----------------------|---------|----------|---------------------------------|
| api/auth.php?action=login  | POST | nein | Login                      |
| api/auth.php?action=logout | GET  | nein | Logout                     |
| api/auth.php?action=me     | GET  | ja   | Session prüfen             |
| api/contacts.php      | GET     | ja       | Alle Kontakte               |
| api/contacts.php?id=X | GET    | ja       | Ein Kontakt + PLZ-Liste     |
| api/contacts.php      | POST    | ja       | Kontakt anlegen             |
| api/contacts.php?id=X | PUT    | ja       | Kontakt bearbeiten          |
| api/contacts.php?id=X | DELETE | admin    | Kontakt löschen             |
| api/plz_status.php    | GET     | nein     | Alle belegten PLZ (für Karte)|
| api/plz_status.php    | POST    | ja       | PLZ-Status setzen           |
| api/plz_status.php?plz3=X | DELETE | ja  | PLZ freigeben               |
| api/users.php         | GET/POST/PUT/DELETE | admin | Benutzer verwalten |

## Setup auf all-inkl (Checkliste)
1. [ ] Subdomain `intern.plz-vertriebsplaner.de` in all-inkl anlegen
2. [ ] Dateien per FTP/Git auf den Server laden
3. [ ] `api/config.php` aus `api/config.example.php` kopieren und DB-Daten eintragen
4. [ ] `db/schema.sql` in phpMyAdmin importieren
5. [ ] Standard-Admin-Passwort ändern (Login: admin / Passwort: admin123)
6. [ ] E-Mail-Funktion: send-email.js durch PHP-Version ersetzen (noch offen)

## Multi-PC Workflow
- **Code-Änderungen**: `git pull` vor Arbeitsbeginn, `git push` nach Abschluss
- **DB-Zugangsdaten**: `api/config.php` einmalig auf jedem PC aus `config.example.php` erstellen
- **CLAUDE.md**: Liegt im Git → Claude hat auf jedem PC automatisch den Projektkontext

## Offene Punkte
- [ ] index.html: Login-Weiterleitung + PLZ-Status aus DB laden (Karte einfärben)
- [ ] Admin-Panel: Kontaktverwaltung UI
- [ ] E-Mail-Funktion auf PHP umstellen (Ersatz für send-email.js / Nodemailer)
- [ ] FTP-Zugangsdaten für all-inkl besorgen
- [ ] Subdomain bei all-inkl anlegen
