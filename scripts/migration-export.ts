// One-time migration export: decrypt with the app's own crypto, emit nested JSON.
//   npx tsx scripts/migration-export.ts > /tmp/legacy.json
// The JSON contains PLAINTEXT tokens — keep it local, delete after import.
process.loadEnvFile('.env')

async function main() {
  const { default: Database } = await import('better-sqlite3')
  const { decrypt } = await import('../src/lib/crypto')
  const db = new Database('data/app.db', { readonly: true })

  const users = db.prepare('SELECT * FROM users').all() as any[]
  const out = users.map((u) => {
    const ch = db
      .prepare('SELECT * FROM channels WHERE user_id=?')
      .get(u.id) as any
    const vt = db
      .prepare('SELECT * FROM varchive_tokens WHERE user_id=?')
      .get(u.id) as any
    const djs = db
      .prepare('SELECT * FROM dj_classes WHERE user_id=?')
      .all(u.id) as any[]
    return {
      chzzk_id: u.chzzk_id,
      chzzk_nickname: u.chzzk_nickname,
      preferred_button: u.preferred_button ?? null,
      channel: ch
        ? {
            chzzk_channel_id: ch.chzzk_channel_id,
            access_token: ch.chzzk_access_token_encrypted
              ? decrypt(ch.chzzk_access_token_encrypted)
              : null,
            refresh_token: ch.chzzk_refresh_token_encrypted
              ? decrypt(ch.chzzk_refresh_token_encrypted)
              : null,
            token_expires_at: ch.token_expires_at ?? null,
          }
        : null,
      varchive_token: vt
        ? {
            token: decrypt(vt.token_encrypted),
            varchive_nickname: vt.varchive_nickname,
            is_active: !!vt.is_active,
          }
        : null,
      dj_classes: djs.map((d) => ({
        button: d.button,
        dj_class: d.dj_class,
        dj_power_sum: d.dj_power_sum,
        max_dj_power: d.max_dj_power,
        dj_power_conversion: d.dj_power_conversion,
      })),
    }
  })
  process.stdout.write(JSON.stringify(out, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
