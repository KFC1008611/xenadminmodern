import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncManager } from '../../src/renderer/src/store/syncManager.store'

const mocks = vi.hoisted(() => ({ connections: vi.fn(), data: vi.fn() }))
vi.mock('../../src/renderer/src/store/connectionManager.store', () => ({
  useConnectionManagerStore: { getState: () => ({ refreshConnections: mocks.connections }) },
}))
vi.mock('../../src/renderer/src/store/multiData.store', () => ({
  useMultiDataStore: { getState: () => ({ refreshAll: mocks.data }) },
}))

describe('sync manager lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    mocks.connections.mockReset().mockResolvedValue(undefined)
    mocks.data.mockReset().mockResolvedValue(undefined)
  })
  afterEach(async () => {
    syncManager.stop()
    await vi.advanceTimersByTimeAsync(0)
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not fetch resources or requeue after stopping an in-flight connection refresh', async () => {
    let resolve!: () => void
    mocks.connections.mockReturnValueOnce(new Promise<void>((ok) => { resolve = ok }))
    syncManager.start()
    syncManager.refreshNow()
    syncManager.stop()
    resolve()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(mocks.connections).toHaveBeenCalledTimes(1)
    expect(mocks.data).not.toHaveBeenCalled()
    expect(syncManager.getState().activeTimers).toBe(0)
  })

  it('resumes a fresh generation when restarted while an old refresh is pending', async () => {
    let resolve!: () => void
    mocks.connections.mockReturnValueOnce(new Promise<void>((ok) => { resolve = ok }))
    syncManager.start()
    syncManager.stop()
    syncManager.start()
    resolve()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(mocks.connections).toHaveBeenCalledTimes(2)
    expect(mocks.data).toHaveBeenCalledTimes(1)
    expect(syncManager.getState().state).toBe('running')
  })

  it('replaces changed snapshots while preserving previous snapshots and stable reads', async () => {
    const initial = syncManager.getState()
    syncManager.start()
    const running = syncManager.getState()
    expect(running).not.toBe(initial)
    expect(initial.state).toBe('idle')
    expect(syncManager.getState()).toBe(running)
    await vi.advanceTimersByTimeAsync(0)
    expect(syncManager.getState()).not.toBe(running)
    expect(syncManager.getState().refreshCount).toBe(running.refreshCount + 1)
  })
})
