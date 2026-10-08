-- Initial schema. Mirrors the Django models minus Django-only auth columns
-- (password, last_login, is_staff, is_superuser, groups): login is Chzzk OAuth
-- only and there is no admin. Timestamps are unix seconds (UTC) so SQL
-- comparisons are plain integer comparisons.

-- +goose Up
CREATE TABLE users (
    id               INTEGER PRIMARY KEY,
    chzzk_id         TEXT    NOT NULL UNIQUE,  -- Chzzk channel id of the person
    chzzk_nickname   TEXT    NOT NULL,
    preferred_button INTEGER CHECK (preferred_button IN (4, 5, 6, 8)),  -- NULL = auto
    created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);
-- Badge lookup falls back to the nickname when a chat has no sender channel id.
CREATE INDEX users_chzzk_nickname_idx ON users (chzzk_nickname);

-- Streamer side: encrypted Chzzk OAuth tokens (AES-256-GCM, common/crypto.py format).
CREATE TABLE channels (
    id                      INTEGER PRIMARY KEY,
    user_id                 INTEGER NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    chzzk_channel_id        TEXT    NOT NULL UNIQUE,
    access_token_encrypted  TEXT,
    refresh_token_encrypted TEXT,
    token_expires_at        INTEGER,
    created_at              INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Viewer side: verified V-ARCHIVE link. Token-less — the 조회토큰 is used once
-- at link time and never stored (Django table name: varchive_tokens).
CREATE TABLE varchive_links (
    id                INTEGER PRIMARY KEY,
    user_id           INTEGER NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    varchive_nickname TEXT    NOT NULL,
    varchive_user_no  INTEGER,  -- immutable V-ARCHIVE id; NULL for pre-Plan-7 rows
    is_active         BOOLEAN NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE dj_classes (
    id                  INTEGER PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    button              INTEGER NOT NULL CHECK (button IN (4, 5, 6, 8)),
    dj_class            TEXT    NOT NULL,
    dj_power_sum        REAL,
    max_dj_power        REAL,
    dj_power_conversion REAL,
    synced_at           INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (user_id, button)
);

-- alexedwards/scs sqlite3store layout (expiry is a julianday REAL).
CREATE TABLE sessions (
    token  TEXT PRIMARY KEY,
    data   BLOB NOT NULL,
    expiry REAL NOT NULL
);
CREATE INDEX sessions_expiry_idx ON sessions (expiry);

-- +goose Down
DROP TABLE sessions;
DROP TABLE dj_classes;
DROP TABLE varchive_links;
DROP TABLE channels;
DROP TABLE users;
