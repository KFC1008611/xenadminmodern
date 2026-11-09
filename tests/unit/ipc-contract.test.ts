import { describe, expect, it } from 'vitest'
import {
  createIpcContractInventory,
  defineInvokeContract,
  definePushContract,
} from '../../src/shared/ipc-contract'

const strictLookupArgs = {
  parse(value: unknown): readonly [{ connectionId: string }] {
    if (!Array.isArray(value) || value.length !== 1) throw new Error('invalid lookup arguments')
    const [candidate] = value
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('invalid lookup arguments')
    }
    const keys = Object.keys(candidate)
    if (keys.length !== 1 || keys[0] !== 'connectionId') {
      throw new Error('unknown lookup argument')
    }
    const connectionId = (candidate as { connectionId?: unknown }).connectionId
    if (typeof connectionId !== 'string' || connectionId.length === 0) {
      throw new Error('invalid connectionId')
    }
    return [{ connectionId }]
  },
}

const lookupResult = {
  parse(value: unknown): { connected: boolean } {
    if (!value || typeof value !== 'object' || typeof (value as { connected?: unknown }).connected !== 'boolean') {
      throw new Error('invalid lookup result')
    }
    return { connected: (value as { connected: boolean }).connected }
  },
}

const notificationArgs = {
  parse(value: unknown): readonly [{ message: string }] {
    if (!Array.isArray(value) || value.length !== 1) throw new Error('invalid notification')
    const message = (value[0] as { message?: unknown } | undefined)?.message
    if (typeof message !== 'string') throw new Error('invalid notification')
    return [{ message }]
  },
}

describe('IPC contract descriptors', () => {
  it.each(['', '   '])('rejects an empty channel identity', (channel) => {
    expect(() => defineInvokeContract({
      channel,
      argsSchema: strictLookupArgs,
      resultSchema: lookupResult,
      errorShape: 'ipc-error-response-v1',
      callerPolicy: 'app-window-main-frame',
      redaction: ['none'],
    })).toThrow('IPC channel must be a non-empty string')
  })

  it('rejects none combined with a sensitive redaction category', () => {
    expect(() => defineInvokeContract({
      channel: 'connection:lookup',
      argsSchema: strictLookupArgs,
      resultSchema: lookupResult,
      errorShape: 'ipc-error-response-v1',
      callerPolicy: 'app-window-main-frame',
      redaction: ['none', 'session'],
    })).toThrow('IPC redaction category "none" must be exclusive')

    expect(() => definePushContract({
      channel: 'event:notice',
      argsSchema: notificationArgs,
      callerPolicy: 'main-process',
      redaction: ['none', 'session'],
    })).toThrow('IPC redaction category "none" must be exclusive')
  })

  it('defines an invoke contract with one direction and executable runtime schemas', () => {
    const contract = defineInvokeContract({
      channel: 'connection:lookup',
      argsSchema: strictLookupArgs,
      resultSchema: lookupResult,
      errorShape: 'ipc-error-response-v1',
      callerPolicy: 'app-window-main-frame',
      redaction: ['session'],
    })

    expect(contract).toMatchObject({
      channel: 'connection:lookup',
      direction: 'invoke',
      errorShape: 'ipc-error-response-v1',
      callerPolicy: 'app-window-main-frame',
      redaction: ['session'],
    })
    expect(contract.argsSchema.parse([{ connectionId: 'pool-1' }]))
      .toEqual([{ connectionId: 'pool-1' }])
    expect(() => contract.argsSchema.parse([{ connectionId: 'pool-1', extra: true }]))
      .toThrow('unknown lookup argument')
    expect(contract.resultSchema.parse({ connected: true })).toEqual({ connected: true })
  })

  it('defines a push contract without an invoke result or error response', () => {
    const contract = definePushContract({
      channel: 'event:notice',
      argsSchema: notificationArgs,
      callerPolicy: 'main-process',
      redaction: ['none'],
    })

    expect(contract).toMatchObject({
      channel: 'event:notice',
      direction: 'push',
      resultSchema: null,
      errorShape: null,
      callerPolicy: 'main-process',
      redaction: ['none'],
    })
    expect(contract.argsSchema.parse([{ message: 'ready' }])).toEqual([{ message: 'ready' }])
  })

  it('takes an immutable snapshot of descriptor identity and redaction', () => {
    const redaction: Array<'none' | 'session'> = ['none']
    const contract = defineInvokeContract({
      channel: 'connection:lookup',
      argsSchema: strictLookupArgs,
      resultSchema: lookupResult,
      errorShape: 'ipc-error-response-v1',
      callerPolicy: 'app-window-main-frame',
      redaction,
    })

    redaction.push('session')

    expect(contract.redaction).toEqual(['none'])
    expect(Object.isFrozen(contract)).toBe(true)
    expect(Object.isFrozen(contract.redaction)).toBe(true)
    expect(() => {
      (contract as unknown as { channel: string }).channel = 'tampered'
    }).toThrow(TypeError)
    expect(() => {
      (contract.redaction as unknown as string[]).push('session')
    }).toThrow(TypeError)
    expect(contract.channel).toBe('connection:lookup')
    expect(contract.redaction).toEqual(['none'])
  })
})

describe('IPC contract inventory', () => {
  const invoke = defineInvokeContract({
    channel: 'connection:lookup',
    argsSchema: strictLookupArgs,
    resultSchema: lookupResult,
    errorShape: 'ipc-error-response-v1',
    callerPolicy: 'app-window-main-frame',
    redaction: ['session'],
  })
  const push = definePushContract({
    channel: 'event:notice',
    argsSchema: notificationArgs,
    callerPolicy: 'main-process',
    redaction: ['none'],
  })

  it('enumerates only shared contract descriptors', () => {
    const inventory = createIpcContractInventory({
      contracts: [invoke, push],
    })

    expect(inventory).toEqual({ contracts: [invoke, push] })
  })

  it('takes an immutable snapshot of the descriptor inventory', () => {
    const contracts = [invoke]
    const inventory = createIpcContractInventory({ contracts })

    contracts.push(push)

    expect(inventory.contracts).toEqual([invoke])
    expect(Object.isFrozen(inventory)).toBe(true)
    expect(Object.isFrozen(inventory.contracts)).toBe(true)
    expect(() => {
      (inventory.contracts as unknown as typeof contracts).push(push)
    }).toThrow(TypeError)
  })

  it('rejects a duplicate channel in one direction', () => {
    expect(() => createIpcContractInventory({
      contracts: [invoke, invoke],
    })).toThrow('Duplicate IPC channel: connection:lookup')
  })

  it('rejects one channel declared in both directions', () => {
    const conflictingPush = definePushContract({
      channel: 'connection:lookup',
      argsSchema: notificationArgs,
      callerPolicy: 'main-process',
      redaction: ['none'],
    })

    expect(() => createIpcContractInventory({
      contracts: [invoke, conflictingPush],
    })).toThrow('IPC channel has multiple directions: connection:lookup')
  })
})
