import type { SocketIOClientSocket } from '@/lib/types'

declare module 'socket.io-client' {
  export default function io(url: string, opts?: Record<string, unknown>): SocketIOClientSocket
}
