import { describe, expect, it, vi } from 'vitest'
import { defineInvokeContract } from '../../src/shared/ipc-contract'
import { createIpcContractHandler } from '../../src/main/ipc/ipc-contract-handler'
import { IpcOwnerValidator } from '../../src/main/ipc/ipc-owner'

function createOwner(url = 'file:///Applications/XenAdmin/index.html') {
  const mainFrame = { url }
  const webContents = {
    mainFrame,
    getURL: () => url,
    isDestroyed: () => false,
  }
  return {
    owner: { webContents, isDestroyed: () => false },
    event: { sender: webContents, senderFrame: mainFrame },
  }
}

function contractWith(argsSchema: { parse(value: unknown): readonly [{ password: string }] }) {
  return defineInvokeContract({
    channel: 'test:credential-action',
    argsSchema,
    resultSchema: {
      parse(value: unknown): { ok: true } {
        if (!value || typeof value !== 'object' || (value as { ok?: unknown }).ok !== true) {
          throw new Error('invalid result')
        }
        return { ok: true }
      },
    },
    errorShape: 'ipc-error-response-v1',
    callerPolicy: 'app-window-main-frame',
    redaction: ['credentials'],
  })
}

function strictCredentialArgs() {
  return {
    parse(value: unknown): readonly [{ password: string }] {
      if (!Array.isArray(value) || value.length !== 1) throw new Error('invalid arguments')
      const candidate = value[0]
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw new Error('invalid credential')
      }
      const keys = Object.keys(candidate)
      const password = (candidate as { password?: unknown }).password
      if (keys.length !== 1 || keys[0] !== 'password' || typeof password !== 'string') {
        throw new Error(`invalid credential ${String(password ?? '')}`)
      }
      return [{ password }]
    },
  }
}

function createLogger() {
  return {
    debug: vi.fn(),
    error: vi.fn(),
  }
}

describe('IPC contract handler', () => {
  it('rejects an untrusted sender before parsing or invoking the service', async () => {
    const parse = vi.fn(strictCredentialArgs().parse)
    const service = vi.fn()
    const logger = createLogger()
    const current = createOwner()
    const handler = createIpcContractHandler(
      contractWith({ parse }),
      service,
      { owner: new IpcOwnerValidator(current.owner as never), logger },
    )

    const unreadablePayload = new Proxy({}, {
      ownKeys() {
        throw new Error('must not inspect an untrusted payload')
      },
    })

    await expect(handler({} as never, unreadablePayload)).resolves.toMatchObject({
      error: true,
      code: 'IPC_UNTRUSTED_SENDER',
    })
    expect(logger.debug).not.toHaveBeenCalled()
    expect(parse).not.toHaveBeenCalled()
    expect(service).not.toHaveBeenCalled()
  })

  it('rejects a malformed payload before side effects and redacts diagnostics', async () => {
    const service = vi.fn()
    const logger = createLogger()
    const current = createOwner()
    const handler = createIpcContractHandler(
      contractWith(strictCredentialArgs()),
      service,
      { owner: new IpcOwnerValidator(current.owner as never), logger },
    )

    const result = await handler(current.event as never, {
      password: 'pool-password',
      unexpected: true,
    })

    expect(result).toMatchObject({ error: true, code: 'IPC_SCHEMA_INVALID' })
    expect(JSON.stringify(result)).not.toContain('pool-password')
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('pool-password')
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('pool-password')
    expect(service).not.toHaveBeenCalled()
  })

  it('validates and returns a successful service result', async () => {
    const service = vi.fn(async () => ({ ok: true as const }))
    const current = createOwner()
    const handler = createIpcContractHandler(
      contractWith(strictCredentialArgs()),
      service,
      { owner: new IpcOwnerValidator(current.owner as never), logger: createLogger() },
    )

    await expect(handler(current.event as never, { password: 'pool-password' }))
      .resolves.toEqual({ ok: true })
    expect(service).toHaveBeenCalledWith({ password: 'pool-password' })
  })

  it('redacts a service error that echoes an input secret', async () => {
    const service = vi.fn(async ({ password }: { password: string }) => {
      throw Object.assign(new Error(`Login failed for ${password}`), {
        code: 'LOGIN_FAILED',
        details: { reason: `${password} rejected` },
      })
    })
    const logger = createLogger()
    const current = createOwner()
    const handler = createIpcContractHandler(
      contractWith(strictCredentialArgs()),
      service,
      { owner: new IpcOwnerValidator(current.owner as never), logger },
    )

    const result = await handler(current.event as never, { password: 'pool-password' })

    expect(result).toMatchObject({ error: true, code: 'LOGIN_FAILED' })
    expect(JSON.stringify(result)).not.toContain('pool-password')
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('pool-password')
  })

  it('uses the descriptor redaction boundary for positional secrets', async () => {
    const sessionContract = defineInvokeContract({
      channel: 'test:session-action',
      argsSchema: {
        parse(value: unknown): readonly [string] {
          if (!Array.isArray(value) || value.length !== 1 || typeof value[0] !== 'string') {
            throw new Error('invalid session')
          }
          return [value[0]]
        },
      },
      resultSchema: {
        parse(value: unknown): true {
          if (value !== true) throw new Error('invalid result')
          return true
        },
      },
      errorShape: 'ipc-error-response-v1',
      callerPolicy: 'app-window-main-frame',
      redaction: ['session'],
    })
    const service = vi.fn(async (sessionId: string) => {
      throw Object.assign(new Error(`Expired session ${sessionId}`), {
        code: 'SESSION_INVALID',
      })
    })
    const logger = createLogger()
    const current = createOwner()
    const handler = createIpcContractHandler(
      sessionContract,
      service,
      { owner: new IpcOwnerValidator(current.owner as never), logger },
    )

    const result = await handler(current.event as never, 'OpaqueRef:session-value')

    expect(JSON.stringify(result)).not.toContain('OpaqueRef:session-value')
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('OpaqueRef:session-value')
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('OpaqueRef:session-value')
  })

  it('returns a stable error when a service result violates its descriptor', async () => {
    const service = vi.fn(async () => ({ ok: false }))
    const current = createOwner()
    const handler = createIpcContractHandler(
      contractWith(strictCredentialArgs()),
      service,
      { owner: new IpcOwnerValidator(current.owner as never), logger: createLogger() },
    )

    await expect(handler(current.event as never, { password: 'pool-password' })).resolves.toMatchObject({
      error: true,
      code: 'IPC_RESULT_INVALID',
    })
    expect(service).toHaveBeenCalledTimes(1)
  })

  it('does not redact the stable error discriminator or code', async () => {
    const current = createOwner()
    const handler = createIpcContractHandler(
      contractWith(strictCredentialArgs()),
      async () => ({ ok: false }),
      { owner: new IpcOwnerValidator(current.owner as never), logger: createLogger() },
    )

    await expect(handler(current.event as never, { password: 'IPC' })).resolves.toMatchObject({
      error: true,
      code: 'IPC_RESULT_INVALID',
    })
  })
})
