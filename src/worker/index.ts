import cron from 'node-cron'
import { syncDjClasses } from './sync-djclass'

// Validate environment
if (!process.env.VARCHIVE_TOKEN_KEY) {
  console.error('VARCHIVE_TOKEN_KEY is required')
  process.exit(1)
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

console.log('Worker started. Scheduling daily DJ CLASS sync at 03:00 KST.')

// Run at 03:00 KST every day (18:00 UTC)
cron.schedule('0 18 * * *', async () => {
  console.log(`[${new Date().toISOString()}] Starting DJ CLASS sync...`)
  const result = await syncDjClasses()
  console.log(`[${new Date().toISOString()}] Sync complete: ${result.success} success, ${result.failed} failed`)
  if (result.errors.length > 0) {
    console.log('Errors:', result.errors)
  }
})

// Keep process alive
process.stdin.resume()

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Worker shutting down...')
  process.exit(0)
})
