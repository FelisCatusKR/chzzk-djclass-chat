import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, getDb } from '../src/lib/db'
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
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    const tableNames = tables.map(t => t.name)
    expect(tableNames).toContain('users')
    expect(tableNames).toContain('channels')
    expect(tableNames).toContain('varchive_tokens')
    expect(tableNames).toContain('dj_classes')
    db.close()
  })
})
