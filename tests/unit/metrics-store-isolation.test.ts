import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMetricsStore } from '../../src/renderer/src/store/metrics.store'
import type { HostMetricsHistory, MetricDataPoint } from '../../src/shared/types/xapi'

const hostRef = 'OpaqueRef:shared-host'
const api = { startCollection: vi.fn(), getHistory: vi.fn(), stopCollection: vi.fn(), getCollectionError: vi.fn().mockResolvedValue(null) }
const point = (timestamp: number, cpuPercent: number, memoryPercent = cpuPercent): MetricDataPoint => ({ timestamp, cpuPercent, memoryPercent })
const snapshot = (...dataPoints: MetricDataPoint[]): HostMetricsHistory[] => [{ hostRef, hostName: 'Host', dataPoints }]
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  api.stopCollection.mockResolvedValue(undefined)
  Object.assign(globalThis, { window: { xapi: { metrics: api }, clearInterval: vi.fn(), setInterval: vi.fn().mockReturnValue(7) } })
  useMetricsStore.getState().stopCollection()
  useMetricsStore.setState({ history: new Map(), config: { interval: 30000, maxDataPoints: 120 }, collectionIntervalIds: new Map(), collecting: false })
})

describe('realtime host metrics scope', () => {
  it('shows a collection startup failure and stops the inactive polling timer', async () => {
    api.startCollection.mockRejectedValueOnce(new Error('无法启动：连接已断开'))
    useMetricsStore.getState().startCollection('A')
    await vi.waitFor(() => expect(useMetricsStore.getState().collectionErrors.A).toBe('无法启动：连接已断开'))
    expect(useMetricsStore.getState().collecting).toBe(false)
    expect(window.clearInterval).toHaveBeenCalledWith(7)
    expect(api.getHistory).not.toHaveBeenCalled()
  })

  it('ignores a late startup rejection after the pool collection was stopped', async () => {
    let reject!: (error: Error) => void
    api.startCollection.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
    useMetricsStore.getState().startCollection('A')
    useMetricsStore.getState().stopCollection('A')
    reject(new Error('late start error'))
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(useMetricsStore.getState().collectionErrors.A).toBeUndefined()
    expect(useMetricsStore.getState().collecting).toBe(false)
  })

  it('keeps identical host references isolated by resource pool', async () => {
    api.getHistory.mockImplementation(async (connectionId: string) => snapshot(point(1, connectionId === 'A' ? 12 : 78)))

    await Promise.all([useMetricsStore.getState().refreshHistory('A'), useMetricsStore.getState().refreshHistory('B')])

    const state = useMetricsStore.getState()
    expect(state.getLatestCpu('A', hostRef)).toBe(12)
    expect(state.getLatestMemory('B', hostRef)).toBe(78)
    expect(state.getAllHostRefs('A')).toEqual([hostRef])
    expect(state.getHostData('B', hostRef)).toEqual([point(1, 78)])
  })

  it('replaces full polling snapshots without duplicate samples and removes only the missing pool data', async () => {
    api.getHistory.mockResolvedValueOnce(snapshot(point(1, 10))).mockResolvedValueOnce(snapshot(point(1, 80)))
    await useMetricsStore.getState().refreshHistory('A')
    await useMetricsStore.getState().refreshHistory('B')
    api.getHistory.mockResolvedValueOnce(snapshot(point(2, 20), point(1, 10), point(2, 21)))
    await useMetricsStore.getState().refreshHistory('A')
    expect(useMetricsStore.getState().getHostData('A', hostRef)).toEqual([point(1, 10), point(2, 21)])
    api.getHistory.mockResolvedValueOnce([])
    await useMetricsStore.getState().refreshHistory('A')
    expect(useMetricsStore.getState().getHostData('A', hostRef)).toEqual([])
    expect(useMetricsStore.getState().getLatestCpu('B', hostRef)).toBe(80)
  })

  it('ignores an older request that resolves after a newer snapshot', async () => {
    const older = deferred<HostMetricsHistory[]>()
    api.getHistory.mockReturnValueOnce(older.promise).mockResolvedValueOnce(snapshot(point(2, 20)))
    const firstRead = useMetricsStore.getState().refreshHistory('A')
    await useMetricsStore.getState().refreshHistory('A')
    older.resolve(snapshot(point(1, 10)))
    await firstRead
    expect(useMetricsStore.getState().getHostData('A', hostRef)).toEqual([point(2, 20)])
  })

  it('clears only the stopped resource pool and rejects its late response', async () => {
    api.getHistory.mockResolvedValueOnce(snapshot(point(1, 80)))
    await useMetricsStore.getState().refreshHistory('B')
    const pending = deferred<HostMetricsHistory[]>()
    api.getHistory.mockReturnValueOnce(pending.promise)
    const refresh = useMetricsStore.getState().refreshHistory('A')
    useMetricsStore.getState().stopCollection('A')
    pending.resolve(snapshot(point(1, 12)))
    await refresh
    expect(useMetricsStore.getState().getHostData('A', hostRef)).toEqual([])
    expect(useMetricsStore.getState().getLatestCpu('B', hostRef)).toBe(80)
    expect(api.stopCollection).toHaveBeenCalledWith('A')
  })

  it('stopping all collection invalidates pending reads even without an active polling timer', async () => {
    const pending = deferred<HostMetricsHistory[]>()
    api.getHistory.mockReturnValueOnce(pending.promise)
    const refresh = useMetricsStore.getState().refreshHistory('A')
    useMetricsStore.getState().stopCollection()
    pending.resolve(snapshot(point(1, 12)))
    await refresh
    expect(useMetricsStore.getState().history.size).toBe(0)
  })

  it('distinguishes a measured zero from an unavailable observation', async () => {
    api.getHistory.mockResolvedValueOnce(snapshot({ ...point(1, 0), availableMetrics: ['cpuPercent'] }))
    await useMetricsStore.getState().refreshHistory('A')
    expect(useMetricsStore.getState().getLatestCpu('A', hostRef)).toBe(0)
    expect(useMetricsStore.getState().getLatestMemory('A', hostRef)).toBeNull()
    expect(useMetricsStore.getState().getLatestCpu('B', hostRef)).toBeNull()
  })
})
