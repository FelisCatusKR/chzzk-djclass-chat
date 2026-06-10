import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getSharedDb, closeSharedDb } from '../src/lib/db'
import fs from 'fs'
import path from 'path'

const TEST_DB_PATH = './test-data/shared.db'

describe('getSharedDb', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = TEST_DB_PATH
    const dir = path.dirname(TEST_DB_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH)
  })

  afterEach(() => {
    closeSharedDb()
    for (const suffix of ['', '-wal', '-shm']) {
      const p = TEST_DB_PATH + suffix
      if (fs.existsSync(p)) fs.unlinkSync(p)
    }
  })

  it('returns the same open instance across calls', () => {
    const a = getSharedDb()
    const b = getSharedDb()
    expect(a).toBe(b)
    expect(a.open).toBe(true)
  })

  it('initializes the schema once', () => {
    const db = getSharedDb()
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[]
    ).map((t) => t.name)
    expect(tables).toContain('users')
    expect(tables).toContain('dj_classes')
  })

  it('closeSharedDb resets the singleton to a fresh open instance', () => {
    const first = getSharedDb()
    closeSharedDb()
    expect(first.open).toBe(false)
    const second = getSharedDb()
    expect(second).not.toBe(first)
    expect(second.open).toBe(true)
  })
})
