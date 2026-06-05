// Shared types used across the application

export type BadgeMode = 'short' | 'threshold' | 'power'

// Socket.IO v2 types (for socket.io-client v2.0.3 used with Chzzk)
export interface SocketIOEventPacket {
  data: [string, unknown]
}

export interface SocketIOClientSocket {
  id: string
  connected: boolean
  on(event: string, listener: (data: unknown) => void): void
  on(event: 'connect', listener: () => void): void
  on(event: 'disconnect', listener: (reason: string) => void): void
  on(event: 'error', listener: (err: Error) => void): void
  on(event: 'connect_error', listener: (err: Error) => void): void
  disconnect(): void
  onevent?: (packet: SocketIOEventPacket) => void
}

export interface SocketIOConnectOptions {
  reconnection: boolean
  forceNew: boolean
  timeout: number
  transports: string[]
}
