import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, initSchema, getDb } from '../src/lib/db'
import fs from 'fs'
import path from 'path'

const TEST_DB_PATH = './test-data/test.db'

describe('Database', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = TEST_DB_PATH
    const dir = path.dirname(TEST_DB_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH)
  })

  afterEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH)
  })

  it('should initialize schema correctly', () => {
    const db = initDb()
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[]
    const tableNames = tables.map((t) => t.name)
    expect(tableNames).toContain('users')
    expect(tableNames).toContain('channels')
    expect(tableNames).toContain('varchive_tokens')
    expect(tableNames).toContain('dj_classes')
    db.close()
  })

  it('should create expected indexes', () => {
    const db = initDb()
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index'")
      .all() as { name: string }[]
    const indexNames = indexes.map((i) => i.name)
    expect(indexNames).toContain('idx_users_chzzk_id')
    expect(indexNames).toContain('idx_users_chzzk_nickname')
    expect(indexNames).toContain('idx_channels_chzzk_channel_id')
    db.close()
  })

  it('should be idempotent', () => {
    const db = initDb()
    expect(() => initSchema(db)).not.toThrow()
    db.close()
  })

  it('should enforce foreign keys', () => {
    const db = initDb()
    const fkEnabled = db.pragma('foreign_keys') as [{ foreign_keys: number }]
    expect(fkEnabled[0].foreign_keys).toBe(1)
    db.close()
  })

  it('should enforce button CHECK constraint', () => {
    const db = initDb()
    // Insert a valid user first
    const userStmt = db.prepare(
      'INSERT INTO users (chzzk_id, chzzk_nickname) VALUES (?, ?)'
    )
    userStmt.run('test_user', 'test_nick')
    const user = db
      .prepare('SELECT id FROM users WHERE chzzk_id = ?')
      .get('test_user') as { id: number }

    // Valid button should succeed
    const validStmt = db.prepare(
      'INSERT INTO dj_classes (user_id, button, dj_class) VALUES (?, ?, ?)'
    )
    expect(() => validStmt.run(user.id, 6, 'TEST CLASS')).not.toThrow()

    // Invalid button should fail
    const invalidStmt = db.prepare(
      'INSERT INTO dj_classes (user_id, button, dj_class) VALUES (?, ?, ?)'
    )
    expect(() => invalidStmt.run(user.id, 99, 'INVALID')).toThrow()

    db.close()
  })

  it('allows multiple buttons per user', () => {
    const db = initDb()
    db.prepare(
      'INSERT INTO users (chzzk_id, chzzk_nickname) VALUES (?, ?)'
    ).run('multi_user', 'multi_nick')
    const user = db
      .prepare('SELECT id FROM users WHERE chzzk_id = ?')
      .get('multi_user') as { id: number }

    const ins = db.prepare(
      'INSERT INTO dj_classes (user_id, button, dj_class) VALUES (?, ?, ?)'
    )
    expect(() => ins.run(user.id, 4, 'SHOWSTOPPER II')).not.toThrow()
    expect(() => ins.run(user.id, 8, 'HEADLINER IV')).not.toThrow()

    const rows = db
      .prepare('SELECT button FROM dj_classes WHERE user_id = ?')
      .all(user.id) as { button: number }[]
    expect(rows.length).toBe(2)
    db.close()
  })

  it('rejects a duplicate (user_id, button) pair', () => {
    const db = initDb()
    db.prepare(
      'INSERT INTO users (chzzk_id, chzzk_nickname) VALUES (?, ?)'
    ).run('dup_user', 'dup_nick')
    const user = db
      .prepare('SELECT id FROM users WHERE chzzk_id = ?')
      .get('dup_user') as { id: number }
    const ins = db.prepare(
      'INSERT INTO dj_classes (user_id, button, dj_class) VALUES (?, ?, ?)'
    )
    ins.run(user.id, 4, 'SHOWSTOPPER II')
    expect(() => ins.run(user.id, 4, 'HEADLINER IV')).toThrow()
    db.close()
  })

  it('adds the preferred_button column to users', () => {
    const db = initDb()
    const cols = db
      .prepare('SELECT name FROM pragma_table_info(?)')
      .all('users') as { name: string }[]
    expect(cols.map((c) => c.name)).toContain('preferred_button')
    db.close()
  })

  it('migrates a legacy single-row dj_classes table to multi-button', () => {
    // Build the OLD-shape table (user_id UNIQUE) with one row, then run initSchema.
    const legacy = getDb()
    legacy.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chzzk_id TEXT UNIQUE NOT NULL,
        chzzk_nickname TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE dj_classes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
        button INTEGER NOT NULL CHECK (button IN (4, 5, 6, 8)),
        dj_class TEXT NOT NULL,
        dj_power_sum REAL,
        max_dj_power REAL,
        dj_power_conversion REAL,
        synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `)
    legacy
      .prepare('INSERT INTO users (chzzk_id, chzzk_nickname) VALUES (?, ?)')
      .run('legacy_user', 'legacy_nick')
    const user = legacy
      .prepare('SELECT id FROM users WHERE chzzk_id = ?')
      .get('legacy_user') as { id: number }
    legacy
      .prepare(
        'INSERT INTO dj_classes (user_id, button, dj_class) VALUES (?, ?, ?)'
      )
      .run(user.id, 4, 'SHOWSTOPPER II')
    legacy.close()

    // Re-open through initDb so migrations run.
    const db = initDb()
    const preserved = db
      .prepare(
        'SELECT dj_class FROM dj_classes WHERE user_id = ? AND button = 4'
      )
      .get(user.id) as { dj_class: string } | undefined
    expect(preserved?.dj_class).toBe('SHOWSTOPPER II')
    expect(() =>
      db
        .prepare(
          'INSERT INTO dj_classes (user_id, button, dj_class) VALUES (?, ?, ?)'
        )
        .run(user.id, 8, 'HEADLINER IV')
    ).not.toThrow()
    db.close()
  })
})
