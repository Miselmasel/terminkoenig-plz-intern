-- ============================================================
-- Terminkönig PLZ-Karte – Interne Version
-- Datenbank-Schema für MariaDB (all-inkl)
-- ============================================================

-- Benutzer (interner Login)
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(100),
  email         VARCHAR(255),
  role          ENUM('admin','user') DEFAULT 'user',
  erstellt_am   DATETIME DEFAULT CURRENT_TIMESTAMP,
  letzter_login DATETIME
);

-- Standardbenutzer: admin / admin123 (BITTE SOFORT ÄNDERN!)
INSERT INTO users (username, password_hash, name, role)
VALUES ('admin', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Administrator', 'admin');

-- Kontakte
CREATE TABLE IF NOT EXISTS contacts (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  suchbegriff    VARCHAR(200) NOT NULL,
  kundennummer   VARCHAR(100),
  vertragsnummer VARCHAR(100),
  typ            ENUM('bbm','bl') NOT NULL DEFAULT 'bbm',
  bl_wert        TINYINT,
  notizen        TEXT,
  erstellt_am    DATETIME DEFAULT CURRENT_TIMESTAMP,
  geaendert_am   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- PLZ-Zuweisungen (mehrere Kontakte pro PLZ möglich – z.B. mehrere Wünsche)
-- Eindeutigkeit gilt pro (plz3, contact_id) Paar
CREATE TABLE IF NOT EXISTS plz_assignments (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  plz3           CHAR(3)  NOT NULL,
  contact_id     INT,
  status         ENUM('frei','wunsch','reserviert','belegt') DEFAULT 'wunsch',
  notiz          TEXT,
  zugewiesen_am  DATETIME DEFAULT CURRENT_TIMESTAMP,
  geaendert_am   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  geaendert_von  INT,
  UNIQUE KEY uq_plz_contact (plz3, contact_id),
  FOREIGN KEY (contact_id)    REFERENCES contacts(id) ON DELETE CASCADE,
  FOREIGN KEY (geaendert_von) REFERENCES users(id)    ON DELETE SET NULL
);
