import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, initSchema } from '../src/lib/db'
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
})
