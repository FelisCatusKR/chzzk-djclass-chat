import Database from 'better-sqlite3'
import path from 'path'

function getDbPath(): string {
  const dbPath = process.env.DATABASE_URL || './data/app.db'
  if (path.isAbsolute(dbPath)) return dbPath
  return path.join(process.cwd(), dbPath)
}

export function getDb(): Database.Database {
  const dbPath = getDbPath()
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  return db
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
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
      button INTEGER NOT NULL,
      dj_class TEXT NOT NULL,
      dj_power_sum REAL,
      max_dj_power REAL,
      synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_users_chzzk_id ON users(chzzk_id);
    CREATE INDEX IF NOT EXISTS idx_users_chzzk_nickname ON users(chzzk_nickname);
    CREATE INDEX IF NOT EXISTS idx_channels_chzzk_channel_id ON channels(chzzk_channel_id);
  `)
}

export function initDb(): Database.Database {
  const db = getDb()
  initSchema(db)
  return db
}
