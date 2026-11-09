import { describe, expect, it, vi } from 'vitest'
import {
  bindIpcContractAlias,
  createIpcContractInvoker,
  createIpcContractSubscriber,
  getIpcContractBinding,
} from '../../src/preload/ipc-contract-client'
import { defineInvokeContract, definePushContract } from '../../src/shared/ipc-contract'

const strictArgs = {
  parse(value: unknown): readonly [{ connectionId: string }] {
    if (!Array.isArray(value) || value.length !== 1) throw new Error('invalid arguments')
    const candidate = value[0]
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('invalid arguments')
    }
    const keys = Object.keys(candidate)
    const connectionId = (candidate as { connectionId?: unknown }).connectionId
    if (keys.length !== 1 || keys[0] !== 'connectionId' || typeof connectionId !== 'string') {
      throw new Error('invalid arguments')
    }
    return [{ connectionId }]
  },
}

const strictResult = {
  parse(value: unknown): { ready: boolean } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid result')
    const keys = Object.keys(value)
    const ready = (value as { ready?: unknown }).ready
    if (keys.length !== 1 || keys[0] !== 'ready' || typeof ready !== 'boolean') {
      throw new Error('invalid result')
    }
    return { ready }
  },
}

const contract = defineInvokeContract({
  channel: 'connection:status',
  argsSchema: strictArgs,
  resultSchema: strictResult,
  errorShape: 'ipc-error-response-v1',
  callerPolicy: 'app-window-main-frame',
  redaction: ['session'],
})

describe('preload IPC contract invoker', () => {
  it('uses the descriptor channel and validated arguments', async () => {
    const transport = { invoke: vi.fn(async () => ({ ready: true })) }
    const invoke = createIpcContractInvoker(contract, transport)

    await expect(invoke({ connectionId: 'pool-1' })).resolves.toEqual({ ready: true })
    expect(transport.invoke).toHaveBeenCalledWith(
      'connection:status',
      { connectionId: 'pool-1' },
    )
  })

  it('rejects malformed arguments before sending IPC', async () => {
    const transport = { invoke: vi.fn() }
    const leakingContract = defineInvokeContract({
      ...contract,
      argsSchema: {
        parse(value: unknown): readonly [{ connectionId: string }] {
          throw new Error(`invalid arguments: ${JSON.stringify(value)}`)
        },
      },
    })
    const invoke = createIpcContractInvoker(leakingContract, transport)

    const error = await invoke({ connectionId: 'secret-connection', extra: true } as never)
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      message: 'IPC payload does not match the channel contract',
      code: 'IPC_SCHEMA_INVALID',
    })
    expect(JSON.stringify(error)).not.toContain('secret-connection')
    expect(transport.invoke).not.toHaveBeenCalled()
  })

  it('validates successful results returned by main', async () => {
    const transport = { invoke: vi.fn(async () => ({ ready: 'yes' })) }
    const invoke = createIpcContractInvoker(contract, transport)

    await expect(invoke({ connectionId: 'pool-1' })).rejects.toMatchObject({
      message: 'IPC result does not match the channel contract',
      code: 'IPC_RESULT_INVALID',
    })
  })

  it('preserves the documented IPC error as a rejected renderer error', async () => {
    const transport = {
      invoke: vi.fn(async () => ({
        error: true as const,
        message: 'Connection unavailable',
        code: 'CONNECTION_UNAVAILABLE',
        details: { retryable: true },
      })),
    }
    const invoke = createIpcContractInvoker(contract, transport)

    await expect(invoke({ connectionId: 'pool-1' })).rejects.toMatchObject({
      message: 'Connection unavailable',
      code: 'CONNECTION_UNAVAILABLE',
      details: { retryable: true },
    })
  })

  it('subscribes by descriptor and drops malformed push payloads', () => {
    let listener: ((_event: unknown, ...args: unknown[]) => void) | undefined
    const transport = {
      on: vi.fn((_channel: string, next: typeof listener) => {
        listener = next
      }),
      removeListener: vi.fn(),
    }
    const push = definePushContract({
      channel: 'connection:notice',
      argsSchema: strictArgs,
      callerPolicy: 'main-process',
      redaction: ['session'],
    })
    const callback = vi.fn()
    const subscribe = createIpcContractSubscriber(push, transport)

    const unsubscribe = subscribe(callback)
    listener?.({}, { connectionId: 'pool-1' })
    listener?.({}, { connectionId: 'pool-1', extra: true })

    expect(transport.on).toHaveBeenCalledWith('connection:notice', expect.any(Function))
    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith({ connectionId: 'pool-1' })

    unsubscribe()
    expect(transport.removeListener).toHaveBeenCalledWith(
      'connection:notice',
      listener,
    )
  })

  it('does not disguise a renderer callback failure as a malformed push', () => {
    let listener: ((_event: unknown, ...args: unknown[]) => void) | undefined
    const transport = {
      on: vi.fn((_channel: string, next: typeof listener) => {
        listener = next
      }),
      removeListener: vi.fn(),
    }
    const push = definePushContract({
      channel: 'connection:notice',
      argsSchema: strictArgs,
      callerPolicy: 'main-process',
      redaction: ['session'],
    })
    const subscribe = createIpcContractSubscriber(push, transport)
    subscribe(() => {
      throw new Error('renderer callback failed')
    })

    expect(() => listener?.({}, { connectionId: 'pool-1' }))
      .toThrow('renderer callback failed')
  })

  it('retains each descriptor identity for preload pairing audits', () => {
    const invoke = createIpcContractInvoker(contract, { invoke: vi.fn() })
    const push = definePushContract({
      channel: 'connection:notice',
      argsSchema: strictArgs,
      callerPolicy: 'main-process',
      redaction: ['session'],
    })
    const subscribe = createIpcContractSubscriber(push, {
      on: vi.fn(),
      removeListener: vi.fn(),
    })

    expect(getIpcContractBinding(invoke)).toBe(contract)
    expect(getIpcContractBinding(subscribe)).toBe(push)
    expect(getIpcContractBinding(() => undefined)).toBeUndefined()
  })

  it('copies a descriptor binding onto a public compatibility wrapper', () => {
    const invoke = createIpcContractInvoker(contract, { invoke: vi.fn() })
    const wrapper = bindIpcContractAlias(invoke, (...args: Parameters<typeof invoke>) => (
      invoke(...args)
    ))

    expect(getIpcContractBinding(wrapper)).toBe(contract)
    expect(() => bindIpcContractAlias(() => undefined, () => undefined))
      .toThrow('IPC contract alias source is not descriptor-backed')
  })
})
