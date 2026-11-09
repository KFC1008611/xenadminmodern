import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VmChangeEvent } from '../../src/shared/types/xapi'
import {
  setVmEventWindow,
  startVmEventWatcher,
  stopAllVmEventWatchers,
  stopVmEventWatcher,
  toVmChangeEvent,
} from '../../src/main/xapi/services/vm-event.service'

function flushPromises(): Promise<void> {
  return Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => Promise.resolve())
    .then(() => Promise.resolve())
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('vm-event.service', () => {
  afterEach(() => {
    stopAllVmEventWatchers()
    setVmEventWindow()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('normalizes VM add/mod/del events and ignores other classes', () => {
    expect(toVmChangeEvent('conn-1', {
      class: 'VM',
      operation: 'mod',
      ref: 'OpaqueRef:vm1',
      snapshot: { name_label: 'vm1' },
    })).toMatchObject({
      connectionId: 'conn-1',
      operation: 'mod',
      ref: 'OpaqueRef:vm1',
      snapshot: { name_label: 'vm1' },
    })

    expect(toVmChangeEvent('conn-1', {
      class: 'host',
      operation: 'mod',
      ref: 'OpaqueRef:host1',
    })).toBeNull()
  })

  it('discards the initial event.from batch and emits later VM changes', async () => {
    const pending = deferred<any>()
    const callWithSession = vi.fn()
      .mockResolvedValueOnce({
        token: 'token-1',
        events: [{ class: 'VM', operation: 'mod', ref: 'OpaqueRef:initial' }],
      })
      .mockResolvedValueOnce({
        token: 'token-2',
        events: [{
          class: 'VM',
          operation: 'mod',
          ref: 'OpaqueRef:vm1',
          snapshot: { name_label: 'vm1', power_state: 'Running' },
        }],
      })
      .mockReturnValue(pending.promise)

    const emit = vi.fn<(event: VmChangeEvent) => void>()
    startVmEventWatcher('conn-1', { callWithSession } as any, emit)

    await flushPromises()

    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 'conn-1',
      operation: 'mod',
      ref: 'OpaqueRef:vm1',
    }))
    expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ ref: 'OpaqueRef:initial' }))
  })

  it('does not emit late events after a watcher is stopped', async () => {
    const secondBatch = deferred<any>()
    const callWithSession = vi.fn()
      .mockResolvedValueOnce({ token: 'token-1', events: [] })
      .mockReturnValue(secondBatch.promise)

    const emit = vi.fn<(event: VmChangeEvent) => void>()
    startVmEventWatcher('conn-1', { callWithSession } as any, emit)

    await flushPromises()
    stopVmEventWatcher('conn-1')

    secondBatch.resolve({
      token: 'token-2',
      events: [{ class: 'VM', operation: 'del', ref: 'OpaqueRef:vm1' }],
    })
    await flushPromises()

    expect(emit).not.toHaveBeenCalled()
  })

  it('resets the token after EVENT_FROM_TOKEN_PARSE_FAILURE', async () => {
    vi.useFakeTimers()

    const pending = deferred<any>()
    const tokenError = Object.assign(new Error('bad token'), {
      code: 'EVENT_FROM_TOKEN_PARSE_FAILURE',
    })
    const callWithSession = vi.fn()
      .mockResolvedValueOnce({ token: 'token-1', events: [] })
      .mockRejectedValueOnce(tokenError)
      .mockResolvedValueOnce({
        token: 'token-reset',
        events: [{ class: 'VM', operation: 'mod', ref: 'OpaqueRef:discarded' }],
      })
      .mockResolvedValueOnce({
        token: 'token-live',
        events: [{ class: 'VM', operation: 'del', ref: 'OpaqueRef:vm1' }],
      })
      .mockReturnValue(pending.promise)

    const emit = vi.fn<(event: VmChangeEvent) => void>()
    startVmEventWatcher('conn-1', { callWithSession } as any, emit)

    await flushPromises()
    await vi.advanceTimersByTimeAsync(1_000)
    await flushPromises()

    expect(callWithSession).toHaveBeenNthCalledWith(3, 'event.from', [['VM'], '', 30])
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'del',
      ref: 'OpaqueRef:vm1',
    }))
  })

  it('sends only VM changes that satisfy the shared push descriptor', async () => {
    vi.useFakeTimers()
    const pending = deferred<any>()
    const callWithSession = vi.fn()
      .mockResolvedValueOnce({ token: 'token-1', events: [] })
      .mockResolvedValueOnce({
        token: 'token-2',
        events: [
          {
            class: 'VM',
            operation: 'mod',
            ref: 'OpaqueRef:vm2',
            snapshot: [],
          },
          {
            class: 'VM',
            operation: 'mod',
            ref: 'OpaqueRef:vm1',
            snapshot: { name_label: 'vm1', future_xapi_field: true },
          },
        ],
      })
      .mockReturnValue(pending.promise)
    const send = vi.fn()
    setVmEventWindow({
      isDestroyed: () => false,
      webContents: { send },
    } as never)

    startVmEventWatcher('conn-1', { callWithSession } as never)
    await flushPromises()

    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith('vm:changed', expect.objectContaining({
      connectionId: 'conn-1',
      operation: 'mod',
      ref: 'OpaqueRef:vm1',
      snapshot: { name_label: 'vm1', future_xapi_field: true },
    }))
  })

  it('routes production VM pushes through the shared sender', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/main/xapi/services/vm-event.service.ts'),
      'utf8',
    )

    expect(source).toContain('sendIpcContractPush(')
    expect(source).toContain('vmChangedContract,')
    expect(source).not.toContain('mainWindow.webContents.send(')
  })
})
