import { initDb } from '../lib/db'
import { decrypt } from '../lib/crypto'
import { lookupUser, getHighestDjClass } from '../lib/varchive'

export async function syncDjClasses(): Promise<{
  success: number
  failed: number
  errors: string[]
}> {
  const db = initDb()
  let success = 0
  let failed = 0
  const errors: string[] = []

  try {
    const tokens = db.prepare(`
      SELECT vt.id, vt.user_id, vt.token_encrypted, vt.varchive_nickname
      FROM varchive_tokens vt
      WHERE vt.is_active = true
    `).all() as Array<{
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
          db.prepare('UPDATE varchive_tokens SET varchive_nickname = ? WHERE id = ?')
            .run(userInfo.nickname, token.id)
        }

        // Fetch highest DJ CLASS
        const djClassData = await getHighestDjClass(userInfo.nickname)

        if (djClassData) {
          db.prepare(`
            INSERT INTO dj_classes (user_id, button, dj_class, dj_power_sum, max_dj_power, synced_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET
              button = excluded.button,
              dj_class = excluded.dj_class,
              dj_power_sum = excluded.dj_power_sum,
              max_dj_power = excluded.max_dj_power,
              synced_at = excluded.synced_at
          `).run(
            token.user_id,
            djClassData.djPowerSum,
            djClassData.djClass,
            djClassData.djPowerSum,
            djClassData.maxDjPower
          )
          success++
        } else {
          // No DJ CLASS found → delete existing row so widget shows BEGINNER
          db.prepare('DELETE FROM dj_classes WHERE user_id = ?').run(token.user_id)
          success++
        }
      } catch (error) {
        failed++
        errors.push(`User ${token.user_id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } finally {
    db.close()
  }

  return { success, failed, errors }
}
