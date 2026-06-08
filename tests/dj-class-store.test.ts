import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb } from '../src/lib/db'
import { persistUserDjClasses } from '../src/lib/dj-class-store'
import fs from 'fs'
import path from 'path'

const TEST_DB_PATH = './test-data/store-test.db'

function makeUser(): number {
  const db = initDb()
  db.prepare('INSERT INTO users (chzzk_id, chzzk_nickname) VALUES (?, ?)').run(
    'store_user',
    'store_nick'
  )
  const user = db
    .prepare('SELECT id FROM users WHERE chzzk_id = ?')
    .get('store_user') as { id: number }
  db.close()
  return user.id
}

function buttons(userId: number): number[] {
  const db = initDb()
  const rows = db
    .prepare('SELECT button FROM dj_classes WHERE user_id = ? ORDER BY button')
    .all(userId) as { button: number }[]
  db.close()
  return rows.map((r) => r.button)
}

describe('persistUserDjClasses', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = TEST_DB_PATH
    const dir = path.dirname(TEST_DB_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH)
  })

  afterEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH)
  })

  it('inserts one row per provided button', () => {
    const userId = makeUser()
    const db = initDb()
    persistUserDjClasses(db, userId, [
      {
        button: 4,
        djClass: 'SHOWSTOPPER II',
        djPowerSum: 1,
        maxDjPower: 2,
        djPowerConversion: 9800,
      },
      {
        button: 8,
        djClass: 'HEADLINER IV',
        djPowerSum: 1,
        maxDjPower: 2,
        djPowerConversion: 9400,
      },
    ])
    db.close()
    expect(buttons(userId)).toEqual([4, 8])
  })

  it('removes buttons no longer present and upserts the rest', () => {
    const userId = makeUser()
    let db = initDb()
    persistUserDjClasses(db, userId, [
      {
        button: 4,
        djClass: 'SHOWSTOPPER II',
        djPowerSum: 1,
        maxDjPower: 2,
        djPowerConversion: 9800,
      },
      {
        button: 8,
        djClass: 'HEADLINER IV',
        djPowerSum: 1,
        maxDjPower: 2,
        djPowerConversion: 9400,
      },
    ])
    db.close()
    db = initDb()
    persistUserDjClasses(db, userId, [
      {
        button: 5,
        djClass: 'HIGH CLASS I',
        djPowerSum: 1,
        maxDjPower: 2,
        djPowerConversion: 8400,
      },
    ])
    db.close()
    expect(buttons(userId)).toEqual([5])
  })

  it('deletes all rows when given an empty list', () => {
    const userId = makeUser()
    let db = initDb()
    persistUserDjClasses(db, userId, [
      {
        button: 4,
        djClass: 'SHOWSTOPPER II',
        djPowerSum: 1,
        maxDjPower: 2,
        djPowerConversion: 9800,
      },
    ])
    db.close()
    db = initDb()
    persistUserDjClasses(db, userId, [])
    db.close()
    expect(buttons(userId)).toEqual([])
  })
})
