import { createLogger, type ScopedLogger } from '../../../src/main/logger'

const log: ScopedLogger = createLogger('ConnectionManager')

log.info('connected', { connectionId: 'connection-1' })
log.warn('connection became stale')
