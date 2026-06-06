export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

export function resolveLevel(nodeEnv: string | undefined): LogLevel {
  return nodeEnv === 'production' ? 'info' : 'debug'
}

export function isLevelEnabled(level: LogLevel, current: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[current]
}

const current = resolveLevel(process.env.NODE_ENV)

export const logger = {
  debug: (...args: unknown[]) => {
    if (isLevelEnabled('debug', current)) console.log(...args)
  },
  info: (...args: unknown[]) => {
    if (isLevelEnabled('info', current)) console.log(...args)
  },
  warn: (...args: unknown[]) => {
    if (isLevelEnabled('warn', current)) console.warn(...args)
  },
  error: (...args: unknown[]) => {
    if (isLevelEnabled('error', current)) console.error(...args)
  },
}
