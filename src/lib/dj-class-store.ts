import type Database from 'better-sqlite3'

export interface PersistDjClass {
  button: number
  djClass: string
  djPowerSum: number | null
  maxDjPower: number | null
  djPowerConversion: number | null
}

// Replace a user's stored DJ CLASS rows with `classes`: upsert each provided
// button and delete any stored button not in the new set. An empty list clears
// all of the user's rows. Runs in a single transaction.
export function persistUserDjClasses(
  db: Database.Database,
  userId: number,
  classes: PersistDjClass[]
): void {
  const upsert = db.prepare(`
    INSERT INTO dj_classes
      (user_id, button, dj_class, dj_power_sum, max_dj_power, dj_power_conversion, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, button) DO UPDATE SET
      dj_class = excluded.dj_class,
      dj_power_sum = excluded.dj_power_sum,
      max_dj_power = excluded.max_dj_power,
      dj_power_conversion = excluded.dj_power_conversion,
      synced_at = excluded.synced_at
  `)
  const deleteAll = db.prepare('DELETE FROM dj_classes WHERE user_id = ?')
  const deleteStale = db.prepare(
    `DELETE FROM dj_classes
     WHERE user_id = ? AND button NOT IN (SELECT value FROM json_each(?))`
  )

  const tx = db.transaction(() => {
    if (classes.length === 0) {
      deleteAll.run(userId)
      return
    }
    for (const c of classes) {
      upsert.run(
        userId,
        c.button,
        c.djClass,
        c.djPowerSum,
        c.maxDjPower,
        c.djPowerConversion
      )
    }
    deleteStale.run(userId, JSON.stringify(classes.map((c) => c.button)))
  })
  tx()
}
