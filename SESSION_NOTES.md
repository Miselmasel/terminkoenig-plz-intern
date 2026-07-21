# Session-Notizen – Stand 21.07.2026 (Feierabend)

## Was heute erledigt wurde

### Bidirektionaler Sheet-Sync – KOMPLETT FUNKTIONSFÄHIG (End-to-End getestet)
- **Sheet → Karte**: `api/sheets_sync.php` liest über Apps Script `doGet` ALLE Tabs (01–09)
  des Google Sheets. 635 Zeilen, 55 Blöcke (010–096), 138 Assignments.
- **Karte → Sheet**: PLZ belegen/freigeben in der Karte ruft `notifySheet()` in
  `api/plz_status.php` auf → Apps Script `doPost` schreibt Datum+Kunde (grün `#92d050`)
  in **ALLE Zeilen des Blocks** (z.B. 013xx = 5 Zeilen = 5 Einträge).
- **Rekursives Löschen**: Einträge, die im Sheet fehlen (Farbe entfernt, Zeile gelöscht,
  Kontakt komplett entfernt), werden beim Sync aus der DB gelöscht. Das Sheet ist die
  alleinige Wahrheit – ein leeres Sheet leert die komplette Karte!

### Behobene Bugs
1. **"Nicht eingeloggt"-Fehler**: UTF-8 BOM in `plz_status.php` zerstörte session_start().
   → BOM entfernt. WICHTIG: Uploads immer binär (`UseBinary=$true`), BOM-Check vor Upload!
2. **Dropdown-Sortierung**: `populateAllContactDropdowns()` in `admin.js` sortiert jetzt
   case-insensitiv mit deutschem Locale (`localeCompare(..., 'de', {sensitivity:'base'})`).
3. **Zeilenversatz beim Schreiben ins Sheet**: Apps Script sucht die Zeile jetzt über den
   Block-Wert selbst (Auto-Layout-Erkennung), nicht über feste Indizes.
4. **Nur Tab 01 wurde gelesen**: Apps Script iteriert jetzt über alle Tabs.

### Apps Script
- Aktuelle deployte Version liegt in **`apps_script/Code.gs`** (im Repo).
- Änderungen dort immer per: Editor → Code ersetzen → Speichern →
  Deployen → Deployment verwalten → Stift → Neue Version → Deployen
  (NIE neues Deployment erstellen, sonst ändert sich die URL!)
- Layout-Erkennung automatisch: sucht Header-Zelle "Datum 1" und Block-Spalte
  (Überschrift "Block"/"PLZ" oder Spalte mit den meisten Ziffern-Werten).

## Sheet-Struktur (erkannt)
- 9 Tabs: "01" bis "09"
- Spalte A = "Ampel" (NICHT Block!), Block-Spalte wird automatisch erkannt
- Je Block mehrere Zeilen (eine je PLZ5-Bereich), Block-Wert z.B. "013xx"
- Datenpaare: Datum 1/Kunde 1 … Datum 20/Kunde 20
- Farbe `#92d050` (grün) = belegt, weiß = Wunsch

## Aktueller Datenstand
- DB: 138 Assignments (90 belegt, 48 Wunsch) über 54 Blöcke + Testeintrag
- **Testeintrag aktiv**: Testi_Testmann (Kontakt-ID 232) auf 013 belegt –
  steht in Karte UND in allen 5 Sheet-Zeilen des 013er-Blocks.
  Zum Aufräumen: im Sheet die 5 Einträge löschen + Sync, oder in Karte freigeben.

## Workflow-Regeln (WICHTIG)
- **IMMER erst vom KAS-Server downloaden, dann editieren, dann binär hochladen.**
  Lokale Dateien können veraltet sein. FTP: `ftp://w011b9f1.kasserver.com/verwaltung/`
- BOM-Check bei jedem Download/Upload (PHP-Dateien dürfen KEIN BOM haben)
- Zugangsdaten: in `api/config.php` auf dem Server (nicht im Git)
- Live: https://verwaltung.terminkoenig.plz-vertriebsplaner.de/

## Offene Punkte / Ideen für morgen
- Duplikat-Merge prüfen: `autoMergeDuplicates()` führt Kontakte mit gleichem
  Vorname_Nachname zusammen (z.B. Meyer_Robert_BSV_LS + Meyer_Robert_BSV_BBM wurden
  gemerged). Falls LS/BBM getrennte Kontakte sein sollen → Merge-Logik anpassen.
- Testeintrag Testi_Testmann (013) aufräumen, wenn Tests abgeschlossen.
- `api/tmp_reset.php` und Debug-Dateien auf dem Server ggf. löschen (Sicherheit).
