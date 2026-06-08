import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { syncDjClasses } from '../src/worker/sync-djclass'
import { getDb } from '../src/lib/db'
import { encrypt } from '../src/lib/crypto'
import fs from 'fs'
import path from 'path'

const TEST_DB_PATH = './test-data/worker-test.db'

// Mock global fetch
global.fetch = vi.fn()

describe('Daily DJ CLASS Sync Worker', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear()
    process.env.DATABASE_URL = TEST_DB_PATH
    process.env.VARCHIVE_TOKEN_KEY = 'test-key-32-chars-long!!!'

    const dir = path.dirname(TEST_DB_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH)

    // Initialize schema
    const db = getDb()
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chzzk_id TEXT UNIQUE NOT NULL,
        chzzk_nickname TEXT NOT NULL,
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
        button INTEGER NOT NULL CHECK (button IN (4, 5, 6, 8)),
        dj_class TEXT NOT NULL,
        dj_power_sum REAL,
        max_dj_power REAL,
        dj_power_conversion REAL,
        synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `)
    db.close()
  })

  afterEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH)
  })

  it('should sync DJ CLASS for active tokens and upsert into db', async () => {
    const mockFetch = vi.mocked(fetch)

    // Insert test user and token
    const db = getDb()
    db.prepare(
      'INSERT INTO users (chzzk_id, chzzk_nickname) VALUES (?, ?)'
    ).run('chzzk_1', 'StreamerOne')
    const user = db
      .prepare('SELECT id FROM users WHERE chzzk_id = ?')
      .get('chzzk_1') as { id: number }
    db.prepare(
      'INSERT INTO varchive_tokens (user_id, token_encrypted, varchive_nickname) VALUES (?, ?, ?)'
    ).run(user.id, encrypt('varc_token_1'), 'VarchiveUser')
    db.close()

    // Mock V-ARCHIVE API responses
    // lookupUser
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        userNo: 123,
        nickname: 'VarchiveUser',
      }),
    } as Response)

    // getDjClass calls (4, 5, 6, 8)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        djClass: 'HIGH CLASS II',
        djPowerSum: 7000,
        djPowerConversion: 8385.9,
        maxDjPower: 9190,
      }),
    } as Response)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        djClass: 'HIGH CLASS I',
        djPowerSum: 5000,
        djPowerConversion: 5500,
        maxDjPower: 6000,
      }),
    } as Response)
    mockFetch.mockRejectedValueOnce(new Error('Not found'))
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        djClass: 'HIGH CLASS I',
        djPowerSum: 8000,
        djPowerConversion: 6000,
        maxDjPower: 7000,
      }),
    } as Response)

    const result = await syncDjClasses()

    expect(result.success).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.errors).toEqual([])

    // Verify DB state
    const db2 = getDb()
    const djRow = db2
      .prepare('SELECT * FROM dj_classes WHERE user_id = ?')
      .get(user.id) as
      | {
          button: number
          dj_class: string
          dj_power_conversion: number
        }
      | undefined
    db2.close()

    expect(djRow).toBeDefined()
    expect(djRow!.button).toBe(8) // 8B wins: HIGH CLASS I beats HIGH CLASS II (I > II); 8B beats 5B by button preference
    expect(djRow!.dj_class).toBe('HIGH CLASS I')
    expect(djRow!.dj_power_conversion).toBe(6000)
  })

  it('should update V-ARCHIVE nickname if changed', async () => {
    const mockFetch = vi.mocked(fetch)

    const db = getDb()
    db.prepare(
      'INSERT INTO users (chzzk_id, chzzk_nickname) VALUES (?, ?)'
    ).run('chzzk_2', 'StreamerTwo')
    const user = db
      .prepare('SELECT id FROM users WHERE chzzk_id = ?')
      .get('chzzk_2') as { id: number }
    db.prepare(
      'INSERT INTO varchive_tokens (user_id, token_encrypted, varchive_nickname) VALUES (?, ?, ?)'
    ).run(user.id, encrypt('varc_token_2'), 'OldNickname')
    db.close()

    // lookupUser returns different nickname
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        userNo: 456,
        nickname: 'NewNickname',
      }),
    } as Response)

    // getDjClass calls
    mockFetch.mockRejectedValueOnce(new Error('Not found'))
    mockFetch.mockRejectedValueOnce(new Error('Not found'))
    mockFetch.mockRejectedValueOnce(new Error('Not found'))
    mockFetch.mockRejectedValueOnce(new Error('Not found'))

    const result = await syncDjClasses()
    expect(result.success).toBe(1)

    // Verify nickname updated
    const db2 = getDb()
    const tokenRow = db2
      .prepare(
        'SELECT varchive_nickname FROM varchive_tokens WHERE user_id = ?'
      )
      .get(user.id) as { varchive_nickname: string } | undefined
    db2.close()

    expect(tokenRow!.varchive_nickname).toBe('NewNickname')
  })

  it('should delete existing DJ CLASS row when no data is found', async () => {
    const mockFetch = vi.mocked(fetch)

    const db = getDb()
    db.prepare(
      'INSERT INTO users (chzzk_id, chzzk_nickname) VALUES (?, ?)'
    ).run('chzzk_3', 'StreamerThree')
    const user = db
      .prepare('SELECT id FROM users WHERE chzzk_id = ?')
      .get('chzzk_3') as { id: number }
    db.prepare(
      'INSERT INTO varchive_tokens (user_id, token_encrypted, varchive_nickname) VALUES (?, ?, ?)'
    ).run(user.id, encrypt('varc_token_3'), 'NoDataUser')
    db.prepare(
      'INSERT INTO dj_classes (user_id, button, dj_class, dj_power_sum, max_dj_power, dj_power_conversion) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(user.id, 4, 'BEGINNER', 0, 0, 0)
    db.close()

    // lookupUser succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        userNo: 789,
        nickname: 'NoDataUser',
      }),
    } as Response)

    // All buttons fail → no DJ CLASS data
    mockFetch.mockRejectedValueOnce(new Error('Not found'))
    mockFetch.mockRejectedValueOnce(new Error('Not found'))
    mockFetch.mockRejectedValueOnce(new Error('Not found'))
    mockFetch.mockRejectedValueOnce(new Error('Not found'))

    const result = await syncDjClasses()
    expect(result.success).toBe(1)

    // Verify DJ CLASS row deleted
    const db2 = getDb()
    const djRow = db2
      .prepare('SELECT * FROM dj_classes WHERE user_id = ?')
      .get(user.id)
    db2.close()

    expect(djRow).toBeUndefined()
  })

  it('should skip users with invalid tokens and continue batch', async () => {
    const mockFetch = vi.mocked(fetch)

    const db = getDb()
    db.prepare(
      'INSERT INTO users (chzzk_id, chzzk_nickname) VALUES (?, ?)'
    ).run('chzzk_4', 'StreamerFour')
    db.prepare(
      'INSERT INTO users (chzzk_id, chzzk_nickname) VALUES (?, ?)'
    ).run('chzzk_5', 'StreamerFive')
    const user1 = db
      .prepare('SELECT id FROM users WHERE chzzk_id = ?')
      .get('chzzk_4') as { id: number }
    const user2 = db
      .prepare('SELECT id FROM users WHERE chzzk_id = ?')
      .get('chzzk_5') as { id: number }
    db.prepare(
      'INSERT INTO varchive_tokens (user_id, token_encrypted, varchive_nickname) VALUES (?, ?, ?)'
    ).run(user1.id, encrypt('bad_token'), 'BadUser')
    db.prepare(
      'INSERT INTO varchive_tokens (user_id, token_encrypted, varchive_nickname) VALUES (?, ?, ?)'
    ).run(user2.id, encrypt('good_token'), 'GoodUser')
    db.close()

    // First lookupUser fails (invalid token)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false }),
    } as Response)

    // Second lookupUser succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, userNo: 999, nickname: 'GoodUser' }),
    } as Response)

    // getDjClass for second user
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        djClass: 'SHOWSTOPPER I',
        djPowerSum: 8000,
        djPowerConversion: 9850,
        maxDjPower: 9900,
      }),
    } as Response)
    mockFetch.mockRejectedValueOnce(new Error('Not found'))
    mockFetch.mockRejectedValueOnce(new Error('Not found'))
    mockFetch.mockRejectedValueOnce(new Error('Not found'))

    const result = await syncDjClasses()

    expect(result.success).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.errors.some((e) => e.includes('Invalid token'))).toBe(true)

    // Verify second user has DJ CLASS data
    const db2 = getDb()
    const djRow = db2
      .prepare('SELECT * FROM dj_classes WHERE user_id = ?')
      .get(user2.id) as { dj_class: string } | undefined
    db2.close()

    expect(djRow).toBeDefined()
    expect(djRow!.dj_class).toBe('SHOWSTOPPER I')
  })

  it('should return zero results when no active tokens exist', async () => {
    const result = await syncDjClasses()
    expect(result.success).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.errors).toEqual([])
  })
})
