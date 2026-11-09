import { describe, expect, it, vi } from 'vitest'
import { createIpcBridgeApi } from '../../src/preload/ipc-bridge'
import { createIpcContractInvoker, createIpcContractSubscriber } from '../../src/preload/ipc-contract-client'
import { createIpcContractHandler } from '../../src/main/ipc/ipc-contract-handler'
import { createRendererApi } from '../../src/shared/ipc-bridge'
import { defineInvokeContract, definePushContract } from '../../src/shared/ipc-contract'
import { srListContract } from '../../src/shared/ipc-contracts/storage'

const contract = defineInvokeContract({
  channel: 'test:create',
  argsSchema: { parse: (value: unknown) => value as [string] },
  resultSchema: { parse: (value: unknown) => value as string },
  errorShape: 'ipc-error-response-v1', callerPolicy: 'app-window-main-frame', redaction: ['none'],
})

describe('complete IPC error boundary', () => {
  it('identifies a rejected SR field without disclosing the raw object', async () => {
    const handler = createIpcContractHandler(srListContract, () => [{ ref: 'OpaqueRef:sr', uuid: 'fixture', name_label: 'Private SR name', type: 'nfs', physical_size: -2 } as never],
      { owner: { assertCurrent: () => undefined }, logger: { debug: vi.fn(), error: vi.fn() } })
    const response = await handler({} as never, 'pool-a')
    expect(response).toMatchObject({ code: 'IPC_RESULT_INVALID', details: { channel: srListContract.channel, field: 'SR physical size', recordIndex: 0 } })
    expect(JSON.stringify(response)).not.toContain('Private SR name')
  })
  it.each(['VM_CREATE_OUTCOME_UNKNOWN', 'VM_CREATED_START_INCOMPLETE', 'SR_CREATE_PARTIAL'])('preserves %s and the object identity through both boundaries', async (code) => {
    const details = { vmRef: 'OpaqueRef:vm', srRef: 'OpaqueRef:sr', outcome: 'unknown' }
    const handler = createIpcContractHandler(contract, () => {
      throw Object.assign(new Error('对象已保留'), { code, details })
    }, { owner: { assertCurrent: () => undefined }, logger: { debug: vi.fn(), error: vi.fn() } })
    const invoke = createIpcContractInvoker(contract, { invoke: async (...args) => handler({} as never, ...args.slice(1)) })
    const bridge = createIpcBridgeApi({ create: invoke })
    const renderer = createRendererApi<{ create: typeof invoke }>({ create: async (id) => structuredClone(await bridge.create(id)) })
    const error = await renderer.create('pool-a').catch((failure) => failure)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ message: '对象已保留', code, details })
  })

  it('keeps success, void and push subscription semantics', async () => {
    const success = createIpcContractInvoker(contract, { invoke: async () => 'OpaqueRef:vm' })
    const push = definePushContract({ channel: 'test:push', argsSchema: { parse: (args: unknown) => args as [string] }, callerPolicy: 'main-process', redaction: ['none'] })
    let listener!: (_event: unknown, ...args: unknown[]) => void
    const removeListener = vi.fn()
    const subscribe = createIpcContractSubscriber(push, { on: (_channel, callback) => { listener = callback }, removeListener })
    const api = createRendererApi<{ success: typeof success; subscribe: typeof subscribe }>(createIpcBridgeApi({ success, subscribe }))
    await expect(api.success('pool')).resolves.toBe('OpaqueRef:vm')
    const callback = vi.fn()
    const stop = api.subscribe(callback)
    listener(null, 'event')
    expect(callback).toHaveBeenCalledWith('event')
    stop()
    expect(removeListener).toHaveBeenCalledOnce()
  })
})
