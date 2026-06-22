// THROWAWAY spike helper — prints a fresh Chzzk access token by reusing the
// app's own crypto + refresh logic. Run in YOUR terminal (keeps the token out
// of any shared transcript):
//
//   npx tsx get-token.ts [chzzkChannelId]
//
// Diagnostics go to stderr; the token is the only stdout line, so you can do:
//   export CHZZK_ACCESS_TOKEN=$(npx tsx get-token.ts <id> 2>/dev/null)
//
// Delete this file when done:  rm get-token.ts
process.loadEnvFile('.env')

async function main() {
  const { default: Database } = await import('better-sqlite3')
  const { decrypt } = await import('./src/lib/crypto')
  const { refreshAccessToken } = await import('./src/lib/chzzk')

  const want = process.argv[2]
  const db = new Database('data/app.db', { readonly: true })
  const rows = db
    .prepare(
      `SELECT chzzk_channel_id AS id,
              chzzk_access_token_encrypted AS acc,
              chzzk_refresh_token_encrypted AS ref,
              token_expires_at AS exp
       FROM channels`
    )
    .all() as Array<{ id: string; acc: string; ref: string; exp: string }>

  if (rows.length === 0) {
    console.error('No channels in data/app.db — log into the app first.')
    process.exit(1)
  }
  console.error('Channels:', rows.map((r) => r.id).join(', '))

  const row = want ? rows.find((r) => r.id === want) : rows[0]
  if (!row) {
    console.error(`Channel "${want}" not found.`)
    process.exit(1)
  }
  console.error(`Using channel ${row.id} (token_expires_at ${row.exp})`)

  let token = decrypt(row.acc)
  if (new Date(row.exp) < new Date()) {
    console.error('Access token expired — refreshing via Chzzk…')
    const refreshed = await refreshAccessToken(decrypt(row.ref))
    token = refreshed.accessToken
    console.error('Refreshed OK (note: this rotates the stored refresh token).')
  }

  console.error('\n=== access token (next line) ===')
  console.log(token)
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : e)
  process.exit(1)
})
