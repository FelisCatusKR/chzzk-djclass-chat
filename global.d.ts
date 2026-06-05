declare module 'socket.io-client' {
  import type { SocketIOClientSocket } from './src/lib/types'
  export default function io(url: string, opts?: Record<string, unknown>): SocketIOClientSocket
}
