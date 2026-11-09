/**
 * Lightweight structured logger for the main process.
 * Replaces scattered console.log calls with consistent, level-filtered logging.
 *
 * Usage:
 *   import { logger } from '../logger'
 *   logger.info('vm.service', 'getAllVms() completed', { count: 42, connectionId })
 *   logger.warn('metrics', 'Downsample failed', { error: err.message })
 *   logger.error('connection', 'TLS handshake failed', err)
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
}

/** Current minimum log level — can be overridden via LOG_LEVEL env var */
const currentLevel: LogLevel = (() => {
  const env = process.env.LOG_LEVEL?.toLowerCase()
  if (env && env in LOG_LEVELS) return env as LogLevel
  // Default: info in production, debug in dev
  return process.env.NODE_ENV === 'development' ? 'debug' : 'info'
})()

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel]
}

function formatMessage(level: LogLevel, module: string, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString().slice(11, 23) // HH:mm:ss.SSS
  const prefix = `[${timestamp}] [${level.toUpperCase().padEnd(5)}] [${module}]`
  if (data !== undefined) {
    return `${prefix} ${message} ${typeof data === 'object' ? JSON.stringify(data) : data}`
  }
  return `${prefix} ${message}`
}

export interface Logger {
  debug(module: string, message: string, data?: unknown): void
  info(module: string, message: string, data?: unknown): void
  warn(module: string, message: string, data?: unknown): void
  error(module: string, message: string, error?: unknown): void
}

export interface ScopedLogger {
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, error?: unknown): void
}

export const logger: Logger = {
  debug(module: string, message: string, data?: unknown): void {
    if (shouldLog('debug')) console.log(formatMessage('debug', module, message, data))
  },

  info(module: string, message: string, data?: unknown): void {
    if (shouldLog('info')) console.log(formatMessage('info', module, message, data))
  },

  warn(module: string, message: string, data?: unknown): void {
    if (shouldLog('warn')) console.warn(formatMessage('warn', module, message, data))
  },

  error(module: string, message: string, error?: unknown): void {
    if (shouldLog('error')) {
      if (error instanceof Error) {
        console.error(formatMessage('error', module, message, { message: error.message, stack: error.stack }))
      } else {
        console.error(formatMessage('error', module, message, error))
      }
    }
  },
}

/**
 * Create a module-scoped logger that pre-fills the module name.
 * Usage: const log = createLogger('vm.service')
 *        log.info('getAllVms() completed', { count: 42 })
 */
export function createLogger(module: string): ScopedLogger {
  return {
    debug(message: string, data?: unknown) { logger.debug(module, message, data) },
    info(message: string, data?: unknown) { logger.info(module, message, data) },
    warn(message: string, data?: unknown) { logger.warn(module, message, data) },
    error(message: string, error?: unknown) { logger.error(module, message, error) },
  }
}
