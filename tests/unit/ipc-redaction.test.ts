import { describe, expect, it } from 'vitest'
import {
  IPC_REDACTED_VALUE,
  createIpcRedactionContext,
} from '../../src/main/ipc/ipc-redaction'

describe('IPC redaction context', () => {
  it('redacts nested credential fields without mutating the payload', () => {
    const payload = [{
      username: 'root',
      echoedValue: 'pool-password',
      password: 'pool-password',
      nested: {
        sessionId: 'OpaqueRef:session-secret',
        notificationToken: 'notification-secret',
      },
    }]

    const context = createIpcRedactionContext(payload)

    expect(context.payload).toEqual([{
      username: 'root',
      echoedValue: IPC_REDACTED_VALUE,
      password: IPC_REDACTED_VALUE,
      nested: {
        sessionId: IPC_REDACTED_VALUE,
        notificationToken: IPC_REDACTED_VALUE,
      },
    }])
    expect(payload[0].password).toBe('pool-password')
  })

  it('removes payload secrets from nested error messages and details', () => {
    const context = createIpcRedactionContext([{
      password: 'pool-password',
      session_id: 'OpaqueRef:session-secret',
    }])

    expect(context.redact({
      message: 'Login with pool-password failed for OpaqueRef:session-secret',
      details: ['pool-password', { reason: 'OpaqueRef:session-secret expired' }],
    })).toEqual({
      message: `Login with ${IPC_REDACTED_VALUE} failed for ${IPC_REDACTED_VALUE}`,
      details: [IPC_REDACTED_VALUE, { reason: `${IPC_REDACTED_VALUE} expired` }],
    })
  })

  it('handles circular payloads without throwing or exposing a secret', () => {
    const payload: Record<string, unknown> = { credential: 'cycle-secret' }
    payload.self = payload

    const context = createIpcRedactionContext(payload)

    expect(context.payload).toEqual({
      credential: IPC_REDACTED_VALUE,
      self: '[Circular]',
    })
    expect(JSON.stringify(context.redact({ message: 'cycle-secret leaked' })))
      .not.toContain('cycle-secret')
  })

  it('redacts exact pass and passphrase fields without matching innocent suffixes', () => {
    const context = createIpcRedactionContext({
      auth: {
        pass: 'short-secret',
        passphrase: 'long-secret',
      },
      bypass: 'allowed',
      compass: 'north',
    })

    expect(context.payload).toEqual({
      auth: {
        pass: IPC_REDACTED_VALUE,
        passphrase: IPC_REDACTED_VALUE,
      },
      bypass: 'allowed',
      compass: 'north',
    })
  })

  it('redacts overlapping secrets longest-first in the diagnostic payload', () => {
    const context = createIpcRedactionContext({
      password: 'abc',
      sessionToken: 'abcdef',
      echoedValue: 'abcdef',
    })

    expect(context.payload).toEqual({
      password: IPC_REDACTED_VALUE,
      sessionToken: IPC_REDACTED_VALUE,
      echoedValue: IPC_REDACTED_VALUE,
    })
  })
})
