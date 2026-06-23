/**
 * One-time legacy export for the Django cutover (Plan 9 Part B, step B1).
 *
 * Reads the Node app's SQLite DB and writes `export.json` in the exact shape the
 * Django `import_legacy` management command consumes. Run it WHILE the Node app
 * still exists (it imports the Node decrypt()), against a copy of the production DB.
 *
 *   VARCHIVE_TOKEN_KEY=<the Node key>  DATABASE_URL=/path/to/prod.db  \
 *     npx tsx scripts/export-legacy.ts
 *
 * Notes:
 *  - Channel tokens are stored aes-256-gcm-encrypted; we DECRYPT them to plaintext
 *    here so Django re-encrypts them with ITS VARCHIVE_TOKEN_KEY on import. So this
 *    script needs the *Node* key set (the Django key may differ).
 *  - The V-ARCHIVE token is token-less in Django: we export only varchive_nickname +
 *    is_active and drop token_encrypted entirely.
 */
import Database from 'better-sqlite3'
import { writeFileSync } from 'fs'

import { decrypt } from '../src/lib/crypto'

const dbPath = process.env.DATABASE_URL || './data/app.db'
const outPath = process.env.EXPORT_OUT || 'export.json'

const db = new Database(dbPath, { readonly: true, fileMustExist: true })

const dec = (v: string | null): string | null => (v ? decrypt(v) : null)

const users = db
  .prepare('SELECT id, chzzk_id, chzzk_nickname, preferred_button FROM users')
  .all() as Array<{
  id: number
  chzzk_id: string
  chzzk_nickname: string
  preferred_button: number | null
}>

const channelStmt = db.prepare(
  `SELECT chzzk_channel_id, chzzk_access_token_encrypted, chzzk_refresh_token_encrypted, token_expires_at
   FROM channels WHERE user_id = ?`
)
const varchiveStmt = db.prepare(
  'SELECT varchive_nickname, is_active FROM varchive_tokens WHERE user_id = ?'
)
const djClassStmt = db.prepare(
  `SELECT button, dj_class, dj_power_sum, max_dj_power, dj_power_conversion
   FROM dj_classes WHERE user_id = ? ORDER BY button`
)

const out = users.map((u) => {
  const ch = channelStmt.get(u.id) as
    | {
        chzzk_channel_id: string
        chzzk_access_token_encrypted: string | null
        chzzk_refresh_token_encrypted: string | null
        token_expires_at: string | null
      }
    | undefined
  const vt = varchiveStmt.get(u.id) as
    | { varchive_nickname: string; is_active: number }
    | undefined

  return {
    chzzk_id: u.chzzk_id,
    chzzk_nickname: u.chzzk_nickname,
    preferred_button: u.preferred_button ?? null,
    channel: ch
      ? {
          chzzk_channel_id: ch.chzzk_channel_id,
          access_token: dec(ch.chzzk_access_token_encrypted),
          refresh_token: dec(ch.chzzk_refresh_token_encrypted),
          token_expires_at: ch.token_expires_at ?? null,
        }
      : null,
    varchive_token: vt
      ? {
          varchive_nickname: vt.varchive_nickname,
          is_active: Boolean(vt.is_active),
        }
      : null,
    dj_classes: djClassStmt.all(u.id),
  }
})

writeFileSync(outPath, JSON.stringify(out, null, 2))
db.close()

const withChannel = out.filter((u) => u.channel).length
const withVarchive = out.filter((u) => u.varchive_token).length
console.log(
  `Exported ${out.length} users -> ${outPath} (${withChannel} channels, ${withVarchive} V-ARCHIVE links)`
)
