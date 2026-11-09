/**
 * Unit tests for metrics.service (v7 RRD-based collection).
 * Tests RRD-based metrics collection, VM metrics, time range queries,
 * and collection lifecycle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock connectionManager
const mockGetClient = vi.fn(() => ({ callWithSession: vi.fn() }))
const mockGetConnectionInfo = vi.fn()
vi.mock('../../src/main/xapi/connection-manager', () => ({
  connectionManager: {
    getClient: mockGetClient,
    getConnectionInfo: mockGetConnectionInfo,
    listConnections: vi.fn(() => []),
  },
}))

// Mock rrd-client.service
const mockFetchHostRrd = vi.fn()
const mockFetchVmRrd = vi.fn()
const mockFetchRrdUpdates = vi.fn()
vi.mock('../../src/main/xapi/services/rrd-client.service', () => ({
  fetchHostRrd: mockFetchHostRrd,
  fetchVmRrd: mockFetchVmRrd,
  fetchRrdUpdates: mockFetchRrdUpdates,
  RrdFetchError: class RrdFetchError extends Error {
    code: string
    constructor(code: string, _endpoint: string, message: string) {
      super(message)
      this.code = code
    }
  },
}))

// Mock rrd-uuid-cache.service
const mockGetAllHostUuids = vi.fn()
const mockGetRunningVmUuids = vi.fn()
const mockGetVmUuid = vi.fn()
const mockGetVmMemoryDynamicMax = vi.fn()
const mockInvalidateConnection = vi.fn()
vi.mock('../../src/main/xapi/services/rrd-uuid-cache.service', () => ({
  getAllHostUuids: mockGetAllHostUuids,
  getRunningVmUuids: mockGetRunningVmUuids,
  getVmUuid: mockGetVmUuid,
  getVmMemoryDynamicMax: mockGetVmMemoryDynamicMax,
  invalidateConnection: mockInvalidateConnection,
  isVmSweepNeeded: vi.fn(() => false),
}))

// Sample RRD XML responses
const SAMPLE_HOST_RRD_XML = `<?xml version="1.0"?>
<rrd>
  <ds>
    <name>cpu_avg</name>
    <type>GAUGE</type>
    <database>
      <row><t>1700000000</t><v>0.45</v></row>
    </database>
  </ds>
  <ds>
    <name>memory_free_kib</name>
    <type>GAUGE</type>
    <database>
      <row><t>1700000000</t><v>4194304</v></row>
    </database>
  </ds>
  <ds>
    <name>memory_total_kib</name>
    <type>GAUGE</type>
    <database>
      <row><t>1700000000</t><v>16777216</v></row>
    </database>
  </ds>
  <ds>
    <name>pif_eth0_rx</name>
    <type>DERIVE</type>
    <database>
      <row><t>1700000000</t><v>1250000</v></row>
    </database>
  </ds>
  <ds>
    <name>pif_eth0_tx</name>
    <type>DERIVE</type>
    <database>
      <row><t>1700000000</t><v>2500000</v></row>
    </database>
  </ds>
</rrd>`

const SAMPLE_VM_RRD_XML = `<?xml version="1.0"?>
<rrd>
  <ds>
    <name>cpu_avg</name>
    <type>GAUGE</type>
    <database>
      <row><t>1700000000</t><v>0.25</v></row>
    </database>
  </ds>
  <ds>
    <name>memory</name>
    <type>GAUGE</type>
    <database>
      <row><t>1700000000</t><v>1073741824</v></row>
    </database>
  </ds>
  <ds>
    <name>vif_0_rx</name>
    <type>DERIVE</type>
    <database>
      <row><t>1700000000</t><v>500000</v></row>
    </database>
  </ds>
  <ds>
    <name>vif_0_tx</name>
    <type>DERIVE</type>
    <database>
      <row><t>1700000000</t><v>800000</v></row>
    </database>
  </ds>
</rrd>`

describe('metrics.service (v7)', () => {
  let metricsDb: typeof import('../../src/main/xapi/services/metrics-db.service')
  let metricsService: typeof import('../../src/main/xapi/services/metrics.service')

  async function waitForFirstHostPoint(connectionId: string) {
    for (let i = 0; i < 50; i += 1) {
      const history = await metricsService.getMetricsHistory(connectionId)
      const firstPoint = history[0]?.dataPoints[0]
      if (firstPoint) {
        return firstPoint
      }
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    throw new Error('Timed out waiting for first host metrics point')
  }

  beforeEach(async () => {
    vi.resetModules()
    mockGetClient.mockReset()
    mockGetClient.mockReturnValue({ callWithSession: vi.fn() })
    mockGetConnectionInfo.mockReset()
    mockFetchHostRrd.mockReset()
    mockFetchVmRrd.mockReset()
    mockFetchRrdUpdates.mockReset()
    mockGetAllHostUuids.mockReset()
    mockGetRunningVmUuids.mockReset()
    mockGetVmUuid.mockReset()
    mockGetVmMemoryDynamicMax.mockReset()
    mockInvalidateConnection.mockReset()
    metricsDb = await import('../../src/main/xapi/services/metrics-db.service')
    metricsDb.initDatabase()
    metricsService = await import('../../src/main/xapi/services/metrics.service')
  })

  afterEach(async () => {
    metricsService.stopAllCollections()
    await metricsDb.closeDatabase()
  })

  it('clears a recovered incremental failure without allowing a full read to mask it', async () => {
    vi.useFakeTimers()
    try {
      const now = Math.floor(Date.now() / 1000)
      mockGetAllHostUuids.mockResolvedValue([{ hostRef: 'h1', hostUuid: 'host-a', hostName: 'A' }])
      mockGetRunningVmUuids.mockResolvedValue([])
      mockFetchHostRrd.mockResolvedValue(SAMPLE_HOST_RRD_XML.replaceAll('1700000000', String(now)))
      mockFetchRrdUpdates.mockRejectedValue(new Error('temporary collection failure'))
      await metricsService.startMetricsCollection('conn-1', { interval: 15_000 })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(metricsService.getCollectionError('conn-1')).toContain('temporary collection failure')
      await vi.advanceTimersByTimeAsync(5_000)
      expect(mockFetchHostRrd).toHaveBeenCalledTimes(1)
      expect(metricsService.getCollectionError('conn-1')).toContain('temporary collection failure')
      mockFetchRrdUpdates.mockResolvedValue(`<xport><meta><legend><entry>AVERAGE:host:host-a:cpu_avg</entry></legend></meta><data><row><t>${now + 20}</t><v>0.2</v></row></data></xport>`)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(metricsService.getCollectionError('conn-1')).toBeNull()
    } finally { vi.useRealTimers() }
  })

  it('keeps the full archive failure visible until that read recovers', async () => {
    vi.useFakeTimers()
    try {
      mockGetAllHostUuids.mockResolvedValue([{ hostRef: 'h1', hostUuid: 'host-a', hostName: 'A' }])
      mockFetchHostRrd.mockRejectedValue(new Error('full archive failure'))
      await metricsService.startMetricsCollection('conn-1', { interval: 60_000 })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(metricsService.getCollectionError('conn-1')).toContain('full archive failure')
    } finally { vi.useRealTimers() }
  })

  it('bootstraps oversized host archives through a bounded published window and keeps that mode for later cycles', async () => {
    vi.useFakeTimers()
    try {
      const serverTime = Date.now() - 3600_000
      const { RrdFetchError } = await import('../../src/main/xapi/services/rrd-client.service')
      mockGetAllHostUuids.mockResolvedValue([{ hostRef: 'h1', hostUuid: 'host-a', hostName: 'A' }])
      mockGetRunningVmUuids.mockResolvedValue([])
      mockFetchHostRrd.mockRejectedValue(Object.assign(new RrdFetchError('TOO_LARGE', '/host_rrd', 'too large'), { serverTime }))
      mockFetchRrdUpdates.mockResolvedValue(`<xport><meta><legend><entry>AVERAGE:host:host-a:cpu_avg</entry><entry>AVERAGE:host:other-host:cpu_avg</entry></legend></meta><data><row><t>${Math.floor(serverTime / 1000)}</t><v>0.4</v><v>0.9</v></row></data></xport>`)
      await metricsService.startMetricsCollection('conn-1', { interval: 30_000 })
      await vi.advanceTimersByTimeAsync(0)
      expect(mockFetchRrdUpdates).toHaveBeenCalledWith('conn-1', Math.floor(serverTime / 1000) - 600, true, 'host-a', expect.any(AbortSignal))
      const history = await metricsService.getMetricsHistory('conn-1')
      expect(history).toHaveLength(1)
      expect(history[0]).toMatchObject({ hostRef: 'h1', dataPoints: [expect.objectContaining({ cpuPercent: 40 })] })
      expect(metricsService.getCollectionError('conn-1')).toBeNull()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(mockFetchHostRrd).toHaveBeenCalledTimes(1)
      await metricsService.stopMetricsCollection('conn-1')
      await metricsService.startMetricsCollection('conn-1')
      await vi.advanceTimersByTimeAsync(0)
      expect(mockFetchHostRrd).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })

  it('preserves ordinary RRD failures and rejects fallback data for a different host', async () => {
    const { RrdFetchError } = await import('../../src/main/xapi/services/rrd-client.service')
    mockGetAllHostUuids.mockResolvedValue([{ hostRef: 'h1', hostUuid: 'host-a', hostName: 'A' }])
    mockFetchHostRrd.mockRejectedValueOnce(new RrdFetchError('AUTH', '/host_rrd', 'HTTP 403'))
    await metricsService.startMetricsCollection('conn-1')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockFetchRrdUpdates).not.toHaveBeenCalled()
    expect(metricsService.getCollectionError('conn-1')).toContain('HTTP 403')
    await metricsService.stopMetricsCollection('conn-1')
    mockFetchHostRrd.mockRejectedValueOnce(new RrdFetchError('TOO_LARGE', '/host_rrd', 'too large'))
    mockFetchRrdUpdates.mockResolvedValue('<xport><meta><legend><entry>AVERAGE:host:other-host:cpu_avg</entry></legend></meta><data><row><t>1700000000</t><v>0.9</v></row></data></xport>')
    await metricsService.startMetricsCollection('conn-1')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(metricsService.getCollectionError('conn-1')).toContain('no samples for the requested host')
    expect(await metricsService.getMetricsHistory('conn-1')).toEqual([])
  })

  it('collects published xport updates from each host without cross-host contamination and persists VM updates', async () => {
    vi.useFakeTimers()
    try {
      const now = Math.floor(Date.now() / 1000)
      mockGetAllHostUuids.mockResolvedValue([
        { hostRef: 'h1', hostUuid: 'host-a', hostName: 'A' },
        { hostRef: 'h2', hostUuid: 'host-b', hostName: 'B' },
      ])
      mockGetRunningVmUuids.mockResolvedValue([{ vmRef: 'v1', vmUuid: 'vm-a', vmName: 'VM', memoryDynamicMax: 2147483648 }])
      mockGetVmMemoryDynamicMax.mockResolvedValue(2147483648)
      mockFetchHostRrd.mockResolvedValue(SAMPLE_HOST_RRD_XML.replaceAll('1700000000', String(now)))
      mockFetchVmRrd.mockResolvedValue(SAMPLE_VM_RRD_XML.replaceAll('1700000000', String(now)))
      mockFetchRrdUpdates.mockImplementation(async (_id, _start, _includeHost, hostUuid) => `<xport><meta><legend>
        <entry>AVERAGE:host:${hostUuid}:cpu_avg</entry><entry>AVERAGE:vm:vm-a:cpu0</entry><entry>AVERAGE:vm:vm-a:memory</entry>
        <entry>AVERAGE:host:unknown-host:cpu_avg</entry>
        </legend></meta><data><row><t>${now + 5}</t><v>${hostUuid === 'host-a' ? 0.1 : 0.9}</v><v>0.3</v><v>1073741824</v><v>0.99</v></row></data></xport>`)
      await metricsService.startMetricsCollection('conn-1', { interval: 60_000 })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(mockFetchRrdUpdates).toHaveBeenCalledWith('conn-1', now, true, 'host-a', expect.any(AbortSignal))
      expect(mockFetchRrdUpdates).toHaveBeenCalledWith('conn-1', now, true, 'host-b', expect.any(AbortSignal))
      const ts = (now + 5) * 1000
      const point = (kind: 'host' | 'vm', ref: string) => metricsDb.getAlertMetricWindow(kind, 'conn-1', ref, ts, ts)[0]
      expect(point('host', 'h1')).toMatchObject({ cpuPercent: 10, availableMetrics: ['cpuPercent'] })
      expect(point('host', 'h2')).toMatchObject({ cpuPercent: 90 })
      expect(point('vm', 'v1')).toMatchObject({ cpuPercent: 30, memoryPercent: 50 })
      expect(point('host', 'unknown-host')).toBeUndefined()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(mockFetchRrdUpdates).toHaveBeenCalledWith('conn-1', now + 5, true, 'host-a', expect.any(AbortSignal))
      expect(mockGetVmMemoryDynamicMax).not.toHaveBeenCalled()
    } finally { metricsService.stopAllCollections(); vi.useRealTimers() }
  })
  it('discards a completed fetch after collection was stopped', async () => {
    let resolveFetch!: (xml: string) => void
    mockGetAllHostUuids.mockResolvedValue([{ hostRef: 'h1', hostUuid: 'host-a', hostName: 'A' }])
    mockGetRunningVmUuids.mockResolvedValue([])
    mockFetchHostRrd.mockImplementation(() => new Promise<string>((resolve) => { resolveFetch = resolve }))
    await metricsService.startMetricsCollection('conn-1')
    await vi.waitFor(() => expect(mockFetchHostRrd).toHaveBeenCalled())
    await metricsService.stopMetricsCollection('conn-1')
    const timestamp = Math.floor(Date.now() / 1000) * 1000
    resolveFetch(SAMPLE_HOST_RRD_XML.replaceAll('1700000000', String(timestamp / 1000)))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(await metricsService.getMetricsHistory('conn-1')).toEqual([])
    expect(metricsDb.getAlertMetricWindow('host', 'conn-1', 'h1', timestamp, timestamp)).toEqual([])
  })

  it('bounds slow VM sweeps across timer cycles and aborts without dispatching after stop', async () => {
    vi.useFakeTimers()
    let active = 0, peak = 0
    mockGetAllHostUuids.mockResolvedValue([])
    mockGetRunningVmUuids.mockResolvedValue(Array.from({ length: 500 }, (_, i) => ({ vmRef: `v${i}`, vmUuid: `uuid${i}`, vmName: `VM ${i}` })))
    mockFetchVmRrd.mockImplementation((_id, _uuid, signal: AbortSignal) => new Promise((resolve, reject) => {
      active++; peak = Math.max(peak, active)
      const cancel = () => { clearTimeout(timer); active--; reject(new Error('aborted')) }
      const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); active--; resolve(SAMPLE_VM_RRD_XML) }, 1000)
      signal.addEventListener('abort', cancel, { once: true })
    }))
    try {
      await metricsService.startMetricsCollection('conn-1')
      await vi.advanceTimersByTimeAsync(90_000)
      expect(peak).toBe(5)
      expect(mockGetRunningVmUuids).toHaveBeenCalledTimes(1)
      expect(mockFetchVmRrd).toHaveBeenCalledTimes(455)
      await metricsService.stopMetricsCollection('conn-1')
      const count = mockFetchVmRrd.mock.calls.length
      await vi.advanceTimersByTimeAsync(5000)
      expect(mockFetchVmRrd).toHaveBeenCalledTimes(count)
      expect(active).toBe(0)
      expect(mockFetchVmRrd.mock.calls.every((call) => call[2].aborted)).toBe(true)
    } finally { metricsService.stopAllCollections(); vi.clearAllTimers(); vi.useRealTimers() }
  })

  it('bootstraps successful VMs once, retries failures and discovers newly running VMs', async () => {
    vi.useFakeTimers()
    const vm = (id: string) => ({ vmRef: id, vmUuid: id, vmName: id })
    mockGetAllHostUuids.mockResolvedValue([])
    mockGetRunningVmUuids.mockResolvedValue([vm('v1'), vm('v2')])
    mockFetchVmRrd.mockResolvedValue(SAMPLE_VM_RRD_XML).mockRejectedValueOnce(new Error('temporary'))
    try {
      await metricsService.startMetricsCollection('conn-1')
      await vi.advanceTimersByTimeAsync(30_000)
      expect(mockFetchVmRrd.mock.calls.map((call) => call[1])).toEqual(['v1', 'v2', 'v1'])
      mockGetRunningVmUuids.mockResolvedValue([vm('v1'), vm('v2'), vm('v3')])
      await vi.advanceTimersByTimeAsync(30_000)
      expect(mockFetchVmRrd.mock.calls.map((call) => call[1])).toEqual(['v1', 'v2', 'v1', 'v3'])
      mockGetRunningVmUuids.mockResolvedValue([vm('v2')])
      await vi.advanceTimersByTimeAsync(30_000)
      mockGetRunningVmUuids.mockResolvedValue([vm('v1'), vm('v2')])
      await vi.advanceTimersByTimeAsync(30_000)
      expect(mockFetchVmRrd.mock.calls.map((call) => call[1])).toEqual(['v1', 'v2', 'v1', 'v3', 'v1'])
    } finally { metricsService.stopAllCollections(); vi.clearAllTimers(); vi.useRealTimers() }
  })

  it('keeps a restarted VM sweep isolated from late completion of the previous generation', async () => {
    vi.useFakeTimers()
    const pending: Array<(xml: string) => void> = []
    mockGetAllHostUuids.mockResolvedValue([])
    mockGetRunningVmUuids.mockResolvedValue(Array.from({ length: 6 }, (_, i) => ({ vmRef: `v${i}`, vmUuid: `uuid${i}`, vmName: `VM ${i}` })))
    mockFetchVmRrd.mockImplementation(() => new Promise((resolve) => { pending.push(resolve) }))
    try {
      await metricsService.startMetricsCollection('conn-1')
      await vi.advanceTimersByTimeAsync(0)
      await metricsService.stopMetricsCollection('conn-1')
      await metricsService.startMetricsCollection('conn-1')
      await vi.advanceTimersByTimeAsync(0)
      expect(pending).toHaveLength(10)
      pending.slice(0, 5).forEach((resolve) => resolve(SAMPLE_VM_RRD_XML))
      await vi.advanceTimersByTimeAsync(30_000)
      expect(pending).toHaveLength(10)
      pending.slice(5, 10).forEach((resolve) => resolve(SAMPLE_VM_RRD_XML))
      await vi.advanceTimersByTimeAsync(0)
      expect(pending).toHaveLength(11)
      pending[10](SAMPLE_VM_RRD_XML)
      await vi.advanceTimersByTimeAsync(0)
    } finally { metricsService.stopAllCollections(); vi.clearAllTimers(); vi.useRealTimers() }
  })

  it('uses one bulk metadata read for 200 incremental VMs and observes changed memory limits', async () => {
    vi.useFakeTimers()
    const now = Math.floor(Date.now() / 1000)
    let memoryDynamicMax = 2147483648
    mockGetAllHostUuids.mockResolvedValue([{ hostRef: 'h1', hostUuid: 'host-a', hostName: 'A' }])
    mockGetRunningVmUuids.mockResolvedValueOnce([]).mockImplementation(async () => Array.from({ length: 200 }, (_, i) => ({ vmRef: `v${i}`, vmUuid: `uuid${i}`, vmName: `VM ${i}`, memoryDynamicMax })))
    mockFetchHostRrd.mockResolvedValue(SAMPLE_HOST_RRD_XML.replaceAll('1700000000', String(now)))
    mockFetchRrdUpdates.mockImplementation(async () => `<xport><meta><legend>${Array.from({ length: 200 }, (_, i) => `<entry>AVERAGE:vm:uuid${i}:memory</entry>`).join('')}</legend></meta><data><row><t>${Math.floor(Date.now() / 1000)}</t>${'<v>1073741824</v>'.repeat(200)}</row></data></xport>`)
    try {
      await metricsService.startMetricsCollection('conn-1', { interval: 60_000 })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(mockGetRunningVmUuids).toHaveBeenCalledTimes(2)
      expect(mockGetVmMemoryDynamicMax).not.toHaveBeenCalled()
      expect(metricsDb.getAlertMetricWindow('vm', 'conn-1', 'v199', (now + 10) * 1000, (now + 10) * 1000)[0]).toMatchObject({ memoryPercent: 50 })
      memoryDynamicMax *= 2
      await vi.advanceTimersByTimeAsync(10_000)
      expect(mockFetchRrdUpdates).toHaveBeenCalledTimes(2)
      expect(metricsDb.getAlertMetricWindow('vm', 'conn-1', 'v199', (now + 20) * 1000, (now + 20) * 1000)[0]).toMatchObject({ memoryPercent: 25 })
    } finally { metricsService.stopAllCollections(); vi.clearAllTimers(); vi.useRealTimers() }
  })

  // ========================================================================
  // collectVmMetrics (on-demand)
  // ========================================================================

  describe('collectVmMetrics', () => {
    it('collects VM CPU and memory metrics via RRD', async () => {
      mockGetVmUuid.mockResolvedValue('vm-uuid-1')
      mockFetchVmRrd.mockResolvedValue(SAMPLE_VM_RRD_XML)
      mockGetVmMemoryDynamicMax.mockResolvedValue(2147483648) // 2 GiB

      const result = await metricsService.collectVmMetrics('conn-1', 'OpaqueRef:vm1')
      expect(result).not.toBeNull()
      expect(result!.cpuPercent).toBe(25)
      expect(result!.memoryPercent).toBe(50) // 1GB / 2GB * 100
      expect(result!.memoryUsed).toBe(1073741824)
      expect(result!.memoryTotal).toBe(2147483648)
    })

    it('throws when VM has no UUID', async () => {
      mockGetVmUuid.mockRejectedValue(new Error(`VM OpaqueRef:vm1 has no UUID`))

      await expect(metricsService.collectVmMetrics('conn-1', 'OpaqueRef:vm1'))
        .rejects.toThrow('VM OpaqueRef:vm1 has no UUID')
    })

    it('throws when RRD fetch fails', async () => {
      mockGetVmUuid.mockResolvedValue('vm-uuid-1')
      mockFetchVmRrd.mockRejectedValue(new Error('Network error'))

      await expect(metricsService.collectVmMetrics('conn-1', 'OpaqueRef:vm1'))
        .rejects.toThrow('Network error')
    })

    it('handles missing memoryDynamicMax gracefully', async () => {
      mockGetVmUuid.mockResolvedValue('vm-uuid-1')
      mockFetchVmRrd.mockResolvedValue(SAMPLE_VM_RRD_XML)
      mockGetVmMemoryDynamicMax.mockRejectedValue(new Error('Not available'))

      const result = await metricsService.collectVmMetrics('conn-1', 'OpaqueRef:vm1')
      expect(result).not.toBeNull()
      expect(result!.cpuPercent).toBe(25)
      // memoryPercent will be 0 because memoryDynamicMax is unavailable
      expect(result!.memoryPercent).toBe(0)
    })
  })

  it('serves repeated history reads from a bootstrapped VM without downloading another archive', async () => {
    vi.useFakeTimers()
    const now = Math.floor(Date.now() / 1000)
    mockGetAllHostUuids.mockResolvedValue([])
    mockGetRunningVmUuids.mockResolvedValue([{ vmRef: 'vm', vmUuid: 'uuid', vmName: 'VM', memoryDynamicMax: 2147483648 }])
    mockFetchVmRrd.mockResolvedValue(SAMPLE_VM_RRD_XML.replaceAll('1700000000', String(now)))
    try {
      await metricsService.startMetricsCollection('conn-1')
      await vi.advanceTimersByTimeAsync(0)
      for (let i = 0; i < 3; i++) expect(await metricsService.collectVmMetrics('conn-1', 'vm')).not.toBeNull()
      expect(mockFetchVmRrd).toHaveBeenCalledTimes(1)
      expect(mockGetVmUuid).not.toHaveBeenCalled()
      expect(mockGetVmMemoryDynamicMax).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('starts incremental collection for a direct VM detail route and reuses its initial archive', async () => {
    vi.useFakeTimers()
    mockGetConnectionInfo.mockReturnValue({ state: 'connected', poolUuid: 'pool', epoch: 1 })
    mockGetAllHostUuids.mockResolvedValue([])
    mockGetRunningVmUuids.mockResolvedValue([])
    mockGetVmUuid.mockResolvedValue('uuid')
    mockGetVmMemoryDynamicMax.mockResolvedValue(2147483648)
    mockFetchVmRrd.mockResolvedValue(SAMPLE_VM_RRD_XML.replaceAll('1700000000', String(Math.floor(Date.now() / 1000))))
    try {
      expect(await metricsService.collectVmMetrics('conn-1', 'vm')).not.toBeNull()
      expect(await metricsService.collectVmMetrics('conn-1', 'vm')).not.toBeNull()
      expect(mockGetRunningVmUuids).toHaveBeenCalledTimes(1)
      expect(mockFetchVmRrd).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })

  describe('VM archive freshness', () => {
    beforeEach(() => {
      mockGetConnectionInfo.mockReturnValue({ state: 'connected', poolUuid: 'pool', epoch: 1 })
      mockGetAllHostUuids.mockResolvedValue([{ hostRef: 'h1', hostUuid: 'host-a', hostName: 'A' }])
      mockGetRunningVmUuids.mockResolvedValue([{ vmRef: 'vm', vmUuid: 'uuid', vmName: 'VM', memoryDynamicMax: 2147483648 }])
      mockGetVmUuid.mockResolvedValue('uuid')
      mockGetVmMemoryDynamicMax.mockResolvedValue(2147483648)
    })

    const archiveAt = (timestamp: number, cpu = '0.25') => SAMPLE_VM_RRD_XML.replaceAll('1700000000', String(timestamp)).replace('0.25', cpu)
    const updatesAt = (timestamp: number, vmUuid = 'uuid') => `<xport><meta><legend><entry>AVERAGE:host:host-a:cpu_avg</entry><entry>AVERAGE:vm:${vmUuid}:cpu_avg</entry></legend></meta><data><row><t>${timestamp}</t><v>0.2</v><v>0.5</v></row></data></xport>`

    it('refreshes the VM archive when host bootstrap has not established incremental cursors', async () => {
      vi.useFakeTimers()
      const now = Math.floor(Date.now() / 1000)
      mockFetchHostRrd.mockRejectedValue(new Error('host RRD unavailable'))
      mockFetchVmRrd.mockResolvedValue(archiveAt(now))
      try {
        expect(await metricsService.collectVmMetrics('conn-1', 'vm')).toMatchObject({ cpuPercent: 25 })
        await vi.advanceTimersByTimeAsync(0)
        mockFetchVmRrd.mockResolvedValue(archiveAt(now + 60, '0.75'))
        await vi.advanceTimersByTimeAsync(60_000)
        expect(mockFetchRrdUpdates).not.toHaveBeenCalled()
        expect(await metricsService.collectVmMetrics('conn-1', 'vm')).toMatchObject({ cpuPercent: 75 })
        expect(metricsService.getCollectionError('conn-1')).toContain('host RRD unavailable')
      } finally { vi.useRealTimers() }
    })

    it.each(['failure', 'repeated', 'other-vm'] as const)('refreshes an expired VM archive when incremental responses are %s', async (mode) => {
      vi.useFakeTimers()
      const now = Math.floor(Date.now() / 1000)
      mockFetchHostRrd.mockResolvedValue(SAMPLE_HOST_RRD_XML.replaceAll('1700000000', String(now)))
      mockFetchVmRrd.mockResolvedValue(archiveAt(now))
      if (mode === 'failure') mockFetchRrdUpdates.mockRejectedValue(new Error('incremental unavailable'))
      else mockFetchRrdUpdates.mockImplementation(async () => updatesAt(mode === 'repeated' ? now : Math.floor(Date.now() / 1000), mode === 'other-vm' ? 'other-uuid' : 'uuid'))
      try {
        await metricsService.startMetricsCollection('conn-1')
        await vi.advanceTimersByTimeAsync(0)
        expect(await metricsService.collectVmMetrics('conn-1', 'vm')).toMatchObject({ cpuPercent: 25 })
        mockFetchVmRrd.mockResolvedValue(archiveAt(now + 30, '0.75'))
        await vi.advanceTimersByTimeAsync(30_000)
        expect(mockFetchRrdUpdates).toHaveBeenCalledTimes(3)
        expect(await metricsService.collectVmMetrics('conn-1', 'vm')).toMatchObject({ cpuPercent: 75 })
        expect(mockFetchVmRrd).toHaveBeenCalledTimes(2)
      } finally { vi.useRealTimers() }
    })

    it('keeps using advancing VM updates despite server clock skew and another host failing', async () => {
      vi.useFakeTimers()
      const serverOffset = -3600
      const serverNow = () => Math.floor(Date.now() / 1000) + serverOffset
      mockGetAllHostUuids.mockResolvedValue([
        { hostRef: 'h1', hostUuid: 'host-a', hostName: 'A' },
        { hostRef: 'h2', hostUuid: 'host-b', hostName: 'B' },
      ])
      mockFetchHostRrd.mockImplementation(async (_id, uuid) => {
        if (uuid === 'host-b') throw new Error('other host unavailable')
        return SAMPLE_HOST_RRD_XML.replaceAll('1700000000', String(serverNow()))
      })
      mockFetchVmRrd.mockResolvedValue(archiveAt(serverNow()))
      mockFetchRrdUpdates.mockImplementation(async () => updatesAt(serverNow()))
      try {
        await metricsService.startMetricsCollection('conn-1')
        await vi.advanceTimersByTimeAsync(0)
        await vi.advanceTimersByTimeAsync(90_000)
        expect(await metricsService.collectVmMetrics('conn-1', 'vm')).toMatchObject({ cpuPercent: 50 })
        expect(mockFetchVmRrd).toHaveBeenCalledTimes(1)
        expect(metricsService.getCollectionError('conn-1')).toContain('other host unavailable')
      } finally { vi.useRealTimers() }
    })

    it('does not indefinitely trust an inactive VM classification after discovery stops succeeding', async () => {
      vi.useFakeTimers()
      const now = Math.floor(Date.now() / 1000)
      mockGetAllHostUuids.mockResolvedValue([])
      mockGetRunningVmUuids.mockResolvedValue([])
      mockFetchVmRrd.mockResolvedValue(archiveAt(now))
      try {
        await metricsService.startMetricsCollection('conn-1')
        await vi.advanceTimersByTimeAsync(0)
        await metricsService.collectVmMetrics('conn-1', 'vm')
        mockGetRunningVmUuids.mockRejectedValue(new Error('VM discovery unavailable'))
        mockFetchVmRrd.mockResolvedValue(archiveAt(now + 60, '0.75'))
        await vi.advanceTimersByTimeAsync(60_000)
        expect(await metricsService.collectVmMetrics('conn-1', 'vm')).toMatchObject({ cpuPercent: 75 })
        expect(mockFetchVmRrd).toHaveBeenCalledTimes(2)
      } finally { vi.useRealTimers() }
    })

    it('retries a failed fallback and joins simultaneous fallback reads', async () => {
      vi.useFakeTimers()
      const now = Math.floor(Date.now() / 1000)
      mockFetchHostRrd.mockRejectedValue(new Error('host RRD unavailable'))
      mockFetchVmRrd.mockResolvedValue(archiveAt(now))
      try {
        await metricsService.startMetricsCollection('conn-1')
        await vi.advanceTimersByTimeAsync(0)
        await metricsService.collectVmMetrics('conn-1', 'vm')
        await vi.advanceTimersByTimeAsync(30_000)
        mockFetchVmRrd.mockRejectedValueOnce(new Error('VM archive unavailable'))
        await expect(metricsService.collectVmMetrics('conn-1', 'vm')).rejects.toThrow('VM archive unavailable')
        let finish!: (xml: string) => void
        mockFetchVmRrd.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
        const first = metricsService.collectVmMetrics('conn-1', 'vm')
        const second = metricsService.collectVmMetrics('conn-1', 'vm')
        await vi.advanceTimersByTimeAsync(0)
        expect(mockFetchVmRrd).toHaveBeenCalledTimes(3)
        finish(archiveAt(now + 30, '0.75'))
        expect(await first).toMatchObject({ cpuPercent: 75 })
        expect(await second).toEqual(await first)
      } finally { vi.useRealTimers() }
    })
  })

  describe('stopped VM archive initialization', () => {
    beforeEach(() => {
      const now = Math.floor(Date.now() / 1000)
      mockGetConnectionInfo.mockReturnValue({ state: 'connected', poolUuid: 'pool', epoch: 1 })
      mockGetAllHostUuids.mockResolvedValue([])
      // Halted VMs are excluded from both background bootstrap and VM updates.
      mockGetRunningVmUuids.mockResolvedValue([])
      mockGetVmUuid.mockResolvedValue('uuid')
      mockGetVmMemoryDynamicMax.mockResolvedValue(2147483648)
      mockFetchVmRrd.mockResolvedValue(SAMPLE_VM_RRD_XML.replaceAll('1700000000', String(now - 1800)))
      metricsDb.persistVmMetricSample({ connectionId: 'conn-1', poolUuid: 'pool', vmRef: 'vm',
        timestamp: (now - 2 * 86400) * 1000, cpuPercent: 5, memoryPercent: 10 })
    })

    it('fills history missing from old local samples and reuses the successful archive', async () => {
      vi.useFakeTimers()
      const now = Date.now()
      try {
        await metricsService.collectVmMetrics('conn-1', 'vm')
        const recent = metricsService.getVmMetricsRange('conn-1', 'vm', { startTime: now - 3600000, endTime: now })
        expect(recent).toContainEqual(expect.objectContaining({ cpuPercent: 25, memoryPercent: 50 }))
        expect(metricsDb.getAlertMetricWindow('vm', 'conn-1', 'vm', 0, now, 'pool')).toHaveLength(2)
        // Discovery keeps excluding the stopped VM; detail refreshes still reuse its archive.
        await vi.advanceTimersByTimeAsync(60_000)
        for (let i = 0; i < 3; i++) await metricsService.collectVmMetrics('conn-1', 'vm')
        expect(mockGetRunningVmUuids).toHaveBeenCalledTimes(3)
        expect(mockFetchVmRrd).toHaveBeenCalledTimes(1)
      } finally { vi.useRealTimers() }
    })

    it('retries failed and empty archives even while old cached samples remain', async () => {
      mockFetchVmRrd.mockRejectedValueOnce(new Error('archive unavailable')).mockResolvedValueOnce('<rrd></rrd>')
      await expect(metricsService.collectVmMetrics('conn-1', 'vm')).rejects.toThrow('archive unavailable')
      expect(await metricsService.collectVmMetrics('conn-1', 'vm')).toBeNull()
      expect(await metricsService.collectVmMetrics('conn-1', 'vm')).toMatchObject({ cpuPercent: 25 })
      expect(await metricsService.collectVmMetrics('conn-1', 'vm')).toMatchObject({ cpuPercent: 25 })
      expect(mockFetchVmRrd).toHaveBeenCalledTimes(3)
    })

    it.each(['identity', 'client', 'restart', 'stop-all'])('does not reuse initialization after %s changes', async (change) => {
      expect(await metricsService.collectVmMetrics('conn-1', 'vm')).toMatchObject({ cpuPercent: 25 })
      expect(await metricsService.collectVmMetrics('conn-1', 'vm')).toMatchObject({ cpuPercent: 25 })
      expect(mockFetchVmRrd).toHaveBeenCalledTimes(1)
      if (change === 'identity') mockGetConnectionInfo.mockReturnValue({ state: 'connected', poolUuid: 'pool', epoch: 2 })
      else if (change === 'client') mockGetClient.mockReturnValue({ callWithSession: vi.fn() })
      else if (change === 'restart') await metricsService.startMetricsCollection('conn-1')
      else metricsService.stopAllCollections()
      mockFetchVmRrd.mockResolvedValue(SAMPLE_VM_RRD_XML.replaceAll('1700000000', String(Math.floor(Date.now() / 1000))))
      await metricsService.collectVmMetrics('conn-1', 'vm')
      expect(mockFetchVmRrd).toHaveBeenCalledTimes(2)
      const recent = metricsService.getVmMetricsRange('conn-1', 'vm', { startTime: Date.now() - 60_000, endTime: Date.now() })
      expect(recent).toContainEqual(expect.objectContaining({ cpuPercent: 25 }))
    })
  })

  it('joins an in-flight background archive from the VM detail query', async () => {
    vi.useFakeTimers()
    let finish!: (xml: string) => void
    mockGetAllHostUuids.mockResolvedValue([])
    mockGetRunningVmUuids.mockResolvedValue([{ vmRef: 'vm', vmUuid: 'uuid', vmName: 'VM', memoryDynamicMax: 2147483648 }])
    mockFetchVmRrd.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    try {
      await metricsService.startMetricsCollection('conn-1')
      await vi.advanceTimersByTimeAsync(0)
      const reading = metricsService.collectVmMetrics('conn-1', 'vm')
      await vi.advanceTimersByTimeAsync(0)
      expect(mockFetchVmRrd).toHaveBeenCalledTimes(1)
      finish(SAMPLE_VM_RRD_XML)
      expect(await reading).toMatchObject({ cpuPercent: 25, memoryPercent: 50 })
      expect(mockFetchVmRrd).toHaveBeenCalledTimes(1)
      expect(mockGetVmMemoryDynamicMax).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('deduplicates simultaneous on-demand reads and retries a failed archive', async () => {
    let finish!: (xml: string) => void
    mockGetVmUuid.mockResolvedValue('uuid')
    mockGetVmMemoryDynamicMax.mockResolvedValue(2147483648)
    mockFetchVmRrd.mockRejectedValueOnce(new Error('temporary failure'))
    await expect(metricsService.collectVmMetrics('conn-1', 'vm')).rejects.toThrow('temporary failure')
    mockFetchVmRrd.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const first = metricsService.collectVmMetrics('conn-1', 'vm')
    const second = metricsService.collectVmMetrics('conn-1', 'vm')
    await vi.waitFor(() => expect(mockFetchVmRrd).toHaveBeenCalledTimes(2))
    finish(SAMPLE_VM_RRD_XML)
    expect(await first).toEqual(await second)
    expect(mockFetchVmRrd).toHaveBeenCalledTimes(2)
  })

  it('discards an old connection response and does not join it from the replacement connection', async () => {
    const now = Math.floor(Date.now() / 1000)
    let epoch = 1
    mockGetConnectionInfo.mockImplementation(() => ({ epoch, poolUuid: `pool-${epoch}` }))
    mockGetVmUuid.mockResolvedValue('uuid')
    mockGetVmMemoryDynamicMax.mockResolvedValue(2147483648)
    const pending: Array<(xml: string) => void> = []
    mockFetchVmRrd.mockImplementation(() => new Promise((resolve) => { pending.push(resolve) }))
    const old = metricsService.collectVmMetrics('conn-1', 'vm')
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    epoch++
    const current = metricsService.collectVmMetrics('conn-1', 'vm')
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    pending[0](SAMPLE_VM_RRD_XML.replaceAll('1700000000', String(now)))
    expect(await old).toBeNull()
    expect(metricsDb.getAlertMetricWindow('vm', 'conn-1', 'vm', 0, Date.now(), 'pool-1')).toEqual([])
    pending[1](SAMPLE_VM_RRD_XML.replaceAll('1700000000', String(now)))
    expect(await current).not.toBeNull()
    expect(metricsDb.getAlertMetricWindow('vm', 'conn-1', 'vm', 0, Date.now(), 'pool-2')).toHaveLength(1)
  })

  it('does not persist an on-demand response after collection is stopped', async () => {
    mockGetVmUuid.mockResolvedValue('uuid')
    let finish!: (xml: string) => void
    mockFetchVmRrd.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const reading = metricsService.collectVmMetrics('conn-1', 'vm')
    await vi.waitFor(() => expect(mockFetchVmRrd).toHaveBeenCalledTimes(1))
    await metricsService.stopMetricsCollection('conn-1')
    expect(mockFetchVmRrd.mock.calls[0][2].aborted).toBe(true)
    finish(SAMPLE_VM_RRD_XML)
    expect(await reading).toBeNull()
    expect(metricsDb.getAlertMetricWindow('vm', 'conn-1', 'vm', 0, Date.now())).toEqual([])
  })

  // ========================================================================
  // Time range queries (delegates to metrics-db)
  // ========================================================================

  describe('getMetricsRange', () => {
    it('returns persisted host metrics from in-memory store', () => {
      const now = Date.now()
      metricsDb.persistMetricSample({
        timestamp: now,
        cpuPercent: 60,
        memoryPercent: 45,
        connectionId: 'conn-1',
        hostRef: 'OpaqueRef:host1',
      })

      const result = metricsService.getMetricsRange('conn-1', 'OpaqueRef:host1', {
        startTime: now - 1000,
        endTime: now + 1000,
      })

      expect(result).toHaveLength(1)
      expect(result[0].cpuPercent).toBe(60)
    })
  })

  describe('getMetricsStats', () => {
    it('returns statistics for a metric type', () => {
      const now = Date.now()
      metricsDb.persistMetricSample({ timestamp: now, cpuPercent: 30, memoryPercent: 50, connectionId: 'c1', hostRef: 'h1' })
      metricsDb.persistMetricSample({ timestamp: now + 1000, cpuPercent: 70, memoryPercent: 50, connectionId: 'c1', hostRef: 'h1' })

      const stats = metricsService.getMetricsStats('c1', 'h1', 'cpu', {
        startTime: now - 1000,
        endTime: now + 2000,
      })

      expect(stats.min).toBe(30)
      expect(stats.max).toBe(70)
    })
  })

  describe('getVmMetricsRange', () => {
    it('returns persisted VM metrics from in-memory store', () => {
      const now = Date.now()
      metricsDb.persistVmMetricSample({
        timestamp: now,
        cpuPercent: 90,
        memoryPercent: 75,
        connectionId: 'conn-1',
        vmRef: 'OpaqueRef:vm1',
      })

      const result = metricsService.getVmMetricsRange('conn-1', 'OpaqueRef:vm1', {
        startTime: now - 1000,
        endTime: now + 1000,
      })

      expect(result).toHaveLength(1)
      expect(result[0].cpuPercent).toBe(90)
    })
  })

  // ========================================================================
  // Collection lifecycle
  // ========================================================================

  describe('stopMetricsCollection', () => {
    it('clears data and stops timer for a connection', async () => {
      mockGetAllHostUuids.mockResolvedValue([
        { hostRef: 'OpaqueRef:host1', hostUuid: 'host-uuid-1', hostName: 'Host 1' },
      ])
      mockFetchHostRrd.mockResolvedValue(SAMPLE_HOST_RRD_XML)
      mockGetRunningVmUuids.mockResolvedValue([])

      await metricsService.startMetricsCollection('conn-1', { interval: 100000 })

      // Wait for initial full dump
      const point = await waitForFirstHostPoint('conn-1')
      expect(point).toBeDefined()

      await metricsService.stopMetricsCollection('conn-1')

      const afterStop = await metricsService.getMetricsHistory('conn-1')
      expect(afterStop).toHaveLength(0)
    })
  })

  describe('stopAllCollections', () => {
    it('clears all timers and data without error', async () => {
      expect(() => metricsService.stopAllCollections()).not.toThrow()
    })
  })

  // ========================================================================
  // RRD-based collection
  // ========================================================================

  describe('RRD collection', () => {
    it('collects host metrics via RRD endpoints', async () => {
      mockGetAllHostUuids.mockResolvedValue([
        { hostRef: 'OpaqueRef:host1', hostUuid: 'host-uuid-1', hostName: 'Host 1' },
      ])
      mockFetchHostRrd.mockResolvedValue(SAMPLE_HOST_RRD_XML)
      mockGetRunningVmUuids.mockResolvedValue([])

      await metricsService.startMetricsCollection('conn-1', { interval: 100000 })

      const point = await waitForFirstHostPoint('conn-1')
      expect(point.cpuPercent).toBe(45)
      // memory: (16777216 - 4194304) / 16777216 * 100 = 75
      expect(point.memoryPercent).toBe(75)
      expect(point.networkRxBytes).toBe(1250000)
      expect(point.networkTxBytes).toBe(2500000)
    })

    it('continues when host UUID fetch fails', async () => {
      mockGetAllHostUuids.mockRejectedValue(new Error('UUID fetch failed'))
      mockGetRunningVmUuids.mockResolvedValue([])

      await metricsService.startMetricsCollection('conn-1', { interval: 100000 })

      // Should not throw; collection should be empty
      const history = await metricsService.getMetricsHistory('conn-1')
      expect(history).toHaveLength(0)
    })

    it('continues when individual host RRD fetch fails', async () => {
      mockGetAllHostUuids.mockResolvedValue([
        { hostRef: 'OpaqueRef:host1', hostUuid: 'host-uuid-1', hostName: 'Host 1' },
        { hostRef: 'OpaqueRef:host2', hostUuid: 'host-uuid-2', hostName: 'Host 2' },
      ])
      mockFetchHostRrd
        .mockRejectedValueOnce(new Error('RRD fetch failed'))
        .mockResolvedValueOnce(SAMPLE_HOST_RRD_XML)
      mockGetRunningVmUuids.mockResolvedValue([])

      await metricsService.startMetricsCollection('conn-1', { interval: 100000 })

      // Should eventually get data for host2
      const point = await waitForFirstHostPoint('conn-1')
      expect(point).toBeDefined()
    })
  })
})
