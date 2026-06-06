import { createServer } from 'http'
import next from 'next'
import type { UrlWithParsedQuery } from 'url'
import { WebSocketServer } from 'ws'
import { addWidget, removeWidget } from './src/lib/chat-proxy'

const dev = process.env.NODE_ENV !== 'production'
const hostname = '0.0.0.0'
const port = parseInt(process.env.PORT || '3000', 10)

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`)
      const parsedUrl = {
        pathname: url.pathname,
        search: url.search,
        query: Object.fromEntries(url.searchParams),
      } as UrlWithParsedQuery
      await handle(req, res, parsedUrl)
    } catch (err) {
      console.error('Error handling request:', err)
      res.statusCode = 500
      res.end('Internal server error')
    }
  })

  const wss = new WebSocketServer({ server, path: '/ws/chat' })

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`)
    const channelId = url.searchParams.get('channelId')

    if (!channelId) {
      ws.close(1008, 'Missing channelId')
      return
    }

    console.log(`[WS] Widget connected for channel ${channelId}`)
    addWidget(channelId, ws)

    ws.on('close', () => {
      console.log(`[WS] Widget disconnected from ${channelId}`)
      removeWidget(channelId, ws)
    })

    ws.on('error', (err) => {
      console.error(`[WS] Error for ${channelId}:`, err)
    })
  })

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`)
  })

  // Graceful shutdown
  const gracefulShutdown = (signal: string) => {
    console.log(`> ${signal} received. Shutting down gracefully...`)
    wss.close(() => {
      console.log('> WebSocket server closed')
    })
    server.close(() => {
      console.log('> HTTP server closed')
      process.exit(0)
    })
    // Close existing connections to prevent hanging
    if ('closeAllConnections' in server) {
      ;(server as { closeAllConnections(): void }).closeAllConnections()
    }
    // Force exit after 10s if still hanging
    setTimeout(() => {
      console.error('> Forced shutdown after timeout')
      process.exit(1)
    }, 10000)
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
  process.on('SIGINT', () => gracefulShutdown('SIGINT'))
})
