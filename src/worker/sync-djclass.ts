import { getSharedDb } from '../lib/db'
import { decrypt } from '../lib/crypto'
import { lookupUser, getAllDjClasses } from '../lib/varchive'
import { persistUserDjClasses } from '../lib/dj-class-store'
import { invalidateAllUserCaches } from '../lib/cache'

export async function syncDjClasses(): Promise<{
  success: number
  failed: number
  errors: string[]
}> {
  // Shared singleton connection — reused across cron runs, never closed here.
  const db = getSharedDb()
  let success = 0
  let failed = 0
  const errors: string[] = []

  const tokens = db
    .prepare(
      `
      SELECT vt.id, vt.user_id, vt.token_encrypted, vt.varchive_nickname
      FROM varchive_tokens vt
      WHERE vt.is_active = true
    `
    )
    .all() as Array<{
    id: number
    user_id: number
    token_encrypted: string
    varchive_nickname: string
  }>

  for (const token of tokens) {
    try {
      // Decrypt token and validate
      const decryptedToken = decrypt(token.token_encrypted)
      const userInfo = await lookupUser(decryptedToken)

      if (!userInfo.success) {
        failed++
        errors.push(`User ${token.user_id}: Invalid token`)
        continue
      }

      // Update nickname if changed
      if (userInfo.nickname !== token.varchive_nickname) {
        db.prepare(
          'UPDATE varchive_tokens SET varchive_nickname = ? WHERE id = ?'
        ).run(userInfo.nickname, token.id)
      }

      // Fetch all buttons that have a record and persist them.
      const all = await getAllDjClasses(userInfo.nickname)
      persistUserDjClasses(
        db,
        token.user_id,
        all.map((c) => ({
          button: c.button,
          djClass: c.djClass,
          djPowerSum: c.djPowerSum,
          maxDjPower: c.maxDjPower,
          djPowerConversion: c.djPowerConversion,
        }))
      )
      success++

      // Invalidate cache so widgets show updated data immediately
      const userRow = db
        .prepare('SELECT chzzk_id, chzzk_nickname FROM users WHERE id = ?')
        .get(token.user_id) as
        | { chzzk_id: string; chzzk_nickname: string }
        | undefined
      if (userRow) {
        invalidateAllUserCaches(userRow.chzzk_id, userRow.chzzk_nickname)
      }
    } catch (error) {
      failed++
      errors.push(
        `User ${token.user_id}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  return { success, failed, errors }
}
