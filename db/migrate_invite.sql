-- Migration: Einladungs-Token zur users-Tabelle hinzufügen
-- Einmalig in phpMyAdmin ausführen (wenn DB bereits existiert)

ALTER TABLE users
  MODIFY COLUMN password_hash  VARCHAR(255) NOT NULL DEFAULT '',
  ADD    COLUMN invite_token   VARCHAR(64)  NULL DEFAULT NULL AFTER email,
  ADD    COLUMN invite_expires DATETIME     NULL DEFAULT NULL AFTER invite_token;
