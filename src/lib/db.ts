import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

function getDbPath(): string {
  const dbPath = process.env.DATABASE_URL || './data/app.db'
  if (path.isAbsolute(dbPath)) return dbPath
  return path.join(process.cwd(), dbPath)
}

export function getDb(): Database.Database {
  const dbPath = getDbPath()
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

function columnExists(
  db: Database.Database,
  table: string,
  column: string
): boolean {
  const result = db
    .prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`)
    .get(table, column)
  return !!result
}

// True when dj_classes still has the legacy single-column UNIQUE(user_id),
// which blocks storing more than one button per user.
function djClassesNeedsRebuild(db: Database.Database): boolean {
  const indexes = db
    .prepare(
      `SELECT name FROM pragma_index_list('dj_classes') WHERE "unique" = 1`
    )
    .all() as { name: string }[]
  for (const idx of indexes) {
    const cols = db
      .prepare(`SELECT name FROM pragma_index_info(?)`)
      .all(idx.name) as { name: string }[]
    if (cols.length === 1 && cols[0].name === 'user_id') return true
  }
  return false
}

function runMigrations(db: Database.Database): void {
  // Migration 1: Add Chzzk token columns to channels table (2024-06-06)
  if (!columnExists(db, 'channels', 'chzzk_access_token_encrypted')) {
    db.exec(`ALTER TABLE channels ADD COLUMN chzzk_access_token_encrypted TEXT`)
    console.log('[DB Migration] Added chzzk_access_token_encrypted to channels')
  }
  if (!columnExists(db, 'channels', 'chzzk_refresh_token_encrypted')) {
    db.exec(
      `ALTER TABLE channels ADD COLUMN chzzk_refresh_token_encrypted TEXT`
    )
    console.log(
      '[DB Migration] Added chzzk_refresh_token_encrypted to channels'
    )
  }
  if (!columnExists(db, 'channels', 'token_expires_at')) {
    db.exec(`ALTER TABLE channels ADD COLUMN token_expires_at DATETIME`)
    console.log('[DB Migration] Added token_expires_at to channels')
  }

  // Migration 2: Add dj_power_conversion to dj_classes (2024-06-06)
  if (!columnExists(db, 'dj_classes', 'dj_power_conversion')) {
    db.exec(`ALTER TABLE dj_classes ADD COLUMN dj_power_conversion REAL`)
    console.log('[DB Migration] Added dj_power_conversion to dj_classes')
  }

  // Migration 3: badge_mode removed (2026-06-06)
  // Badge mode is now set via widget URL query parameter (?mode=short|threshold|power)

  // Migration 4: allow multiple buttons per user (2026-06-08).
  // Rebuild dj_classes to drop the legacy column-level UNIQUE(user_id),
  // which SQLite cannot remove in place.
  if (djClassesNeedsRebuild(db)) {
    const rebuild = db.transaction(() => {
      db.exec('ALTER TABLE dj_classes RENAME TO dj_classes_legacy')
      db.exec(`
        CREATE TABLE dj_classes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id),
          button INTEGER NOT NULL CHECK (button IN (4, 5, 6, 8)),
          dj_class TEXT NOT NULL,
          dj_power_sum REAL,
          max_dj_power REAL,
          dj_power_conversion REAL,
          synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, button)
        )
      `)
      db.exec(`
        INSERT INTO dj_classes
          (id, user_id, button, dj_class, dj_power_sum, max_dj_power, dj_power_conversion, synced_at)
        SELECT
          id, user_id, button, dj_class, dj_power_sum, max_dj_power, dj_power_conversion, synced_at
        FROM dj_classes_legacy
      `)
      db.exec('DROP TABLE dj_classes_legacy')
    })
    rebuild()
    console.log('[DB Migration] Rebuilt dj_classes for multi-button support')
  }

  // Migration 5: viewer's preferred button (2026-06-08).
  if (!columnExists(db, 'users', 'preferred_button')) {
    db.exec(`ALTER TABLE users ADD COLUMN preferred_button INTEGER`)
    console.log('[DB Migration] Added preferred_button to users')
  }
}

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chzzk_id TEXT UNIQUE NOT NULL,
      chzzk_nickname TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
      chzzk_channel_id TEXT UNIQUE NOT NULL,
      chzzk_access_token_encrypted TEXT,
      chzzk_refresh_token_encrypted TEXT,
      token_expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS varchive_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
      token_encrypted TEXT NOT NULL,
      varchive_nickname TEXT NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS dj_classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      button INTEGER NOT NULL CHECK (button IN (4, 5, 6, 8)),
      dj_class TEXT NOT NULL,
      dj_power_sum REAL,
      max_dj_power REAL,
      dj_power_conversion REAL,
      synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, button)
    );

    CREATE INDEX IF NOT EXISTS idx_users_chzzk_id ON users(chzzk_id);
    CREATE INDEX IF NOT EXISTS idx_users_chzzk_nickname ON users(chzzk_nickname);
    CREATE INDEX IF NOT EXISTS idx_channels_chzzk_channel_id ON channels(chzzk_channel_id);

    CREATE TRIGGER IF NOT EXISTS trg_varchive_tokens_updated_at
    AFTER UPDATE ON varchive_tokens
    BEGIN
      UPDATE varchive_tokens SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
  `)

  runMigrations(db)
}

export function initDb(): Database.Database {
  const db = getDb()
  initSchema(db)
  return db
}
