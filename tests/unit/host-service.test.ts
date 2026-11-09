/**
 * Unit tests for host.service — verifies XAPI host.* and host_metrics.* calls.
 * v5: Extended with maintenance mode and evacuation tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCallWithSession = vi.fn()
const mockGetClient = vi.fn(() => ({
  callWithSession: mockCallWithSession,
}))

vi.mock('../../src/main/xapi/connection-manager', () => ({
  connectionManager: {
    getClient: mockGetClient,
    getConnectionInfo: vi.fn(() => ({ poolName: 'Test Pool' })),
  },
}))

describe('host.service', () => {
  beforeEach(() => {
    mockCallWithSession.mockReset()
    mockGetClient.mockReset()
    mockGetClient.mockImplementation(() => ({
      callWithSession: mockCallWithSession,
    }))
  })

  // ============================================================================
  // v4: Existing methods
  // ============================================================================

  describe('getAllHosts', () => {
    it('returns records with ref and connection metadata', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        'OpaqueRef:host1': {
          name_label: 'xcp-host-1',
          address: '192.168.1.10',
          enabled: true,
          resident_VMs: [],
          cpu_info: { cpu_count: '4' },
          software_version: { product_version: '8.3.0' },
        },
      })

      const { getAllHosts } = await import('../../src/main/xapi/services/host.service')
      const hosts = await getAllHosts('conn-123')

      expect(hosts).toHaveLength(1)
      expect(hosts[0].ref).toBe('OpaqueRef:host1')
      expect(hosts[0].name_label).toBe('xcp-host-1')
      expect(hosts[0].enabled).toBe(true)
      expect(hosts[0].connectionId).toBe('conn-123')
      expect(hosts[0].poolName).toBe('Test Pool')
    })

    it('throws when connectionId is invalid', async () => {
      mockGetClient.mockReturnValueOnce(undefined)

      const { getAllHosts } = await import('../../src/main/xapi/services/host.service')
      await expect(getAllHosts('invalid-id')).rejects.toThrow('No connection found for connectionId: invalid-id')
    })

    it('reads each hosts current RRD sources in KiB and returns byte capacities', async () => {
      mockCallWithSession.mockImplementation(async (method, args) => {
        if (method === 'host.get_all_records') return { h1: { metrics: 'legacy' }, h2: { metrics: 'other' } }
        if (method === 'host.query_data_source') return args[1] === 'memory_total_kib' ? '67108864' : args[0] === 'h1' ? '16777216' : '0'
        throw new Error(`Unexpected ${method}`)
      })
      const { getAllHosts } = await import('../../src/main/xapi/services/host.service')
      expect(await getAllHosts('pool')).toMatchObject([
        { ref: 'h1', memory_total: 64 * 1024 ** 3, memory_free: 16 * 1024 ** 3, memoryReadError: undefined },
        { ref: 'h2', memory_total: 64 * 1024 ** 3, memory_free: 0, memoryReadError: undefined },
      ])
      expect(mockCallWithSession).toHaveBeenCalledTimes(5)
    })

    it('keeps host basics and actual errors when a memory source cannot be read', async () => {
      mockCallWithSession.mockImplementation(async (method, args) => {
        if (method === 'host.get_all_records') return { host: { name_label: 'Host', memory_total: 123, memory_free: 99 } }
        if (args[1] === 'memory_total_kib') return 1024
        throw new Error('HOST_OFFLINE')
      })
      const { getAllHosts } = await import('../../src/main/xapi/services/host.service')
      expect(await getAllHosts('pool')).toMatchObject([{ name_label: 'Host', memory_total: 1024 ** 2, memory_free: undefined, memoryReadError: 'HOST_OFFLINE' }])
    })

    it.each([null, '', 'NaN', -1, Infinity])('does not turn invalid memory %s into zero capacity', async (value) => {
      mockCallWithSession.mockImplementation(async (method) => method === 'host.get_all_records' ? { host: {} } : value)
      const { getAllHosts } = await import('../../src/main/xapi/services/host.service')
      const [host] = await getAllHosts('pool')
      expect(host.memory_total).toBeUndefined()
      expect(host.memory_free).toBeUndefined()
      expect(host.memoryReadError).toContain('未返回有效容量')
    })

    it('rejects a free-memory value above the measured total', async () => {
      mockCallWithSession.mockImplementation(async (method, args) => method === 'host.get_all_records' ? { host: {} } : args[1] === 'memory_total_kib' ? 1 : 2)
      const { getAllHosts } = await import('../../src/main/xapi/services/host.service')
      expect(await getAllHosts('pool')).toMatchObject([{ memory_total: 1024, memory_free: undefined, memoryReadError: '可用内存超过总容量' }])
    })
  })

  describe('enableHost', () => {
    it('calls host.enable with the correct ref', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)
      const { enableHost } = await import('../../src/main/xapi/services/host.service')
      await enableHost('conn-123', 'OpaqueRef:host1')
      expect(mockCallWithSession).toHaveBeenCalledWith('host.enable', ['OpaqueRef:host1'])
    })
  })

  describe('disableHost', () => {
    it('calls host.disable', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)
      const { disableHost } = await import('../../src/main/xapi/services/host.service')
      await disableHost('conn-123', 'OpaqueRef:host1')
      expect(mockCallWithSession).toHaveBeenCalledWith('host.disable', ['OpaqueRef:host1'])
    })
  })

  describe('rebootHost', () => {
    it('calls host.reboot', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)
      const { rebootHost } = await import('../../src/main/xapi/services/host.service')
      await rebootHost('conn-123', 'OpaqueRef:host1')
      expect(mockCallWithSession).toHaveBeenCalledWith('host.reboot', ['OpaqueRef:host1'])
    })
  })

  describe('shutdownHost', () => {
    it('calls host.shutdown', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)
      const { shutdownHost } = await import('../../src/main/xapi/services/host.service')
      await shutdownHost('conn-123', 'OpaqueRef:host1')
      expect(mockCallWithSession).toHaveBeenCalledWith('host.shutdown', ['OpaqueRef:host1'])
    })
  })

  // ============================================================================
  // v5: New maintenance mode methods
  // ============================================================================

})

describe('verified maintenance workflow', () => {
  let enabled: boolean, residents: string[], config: Record<string, string>, taskStatus: string
  beforeEach(() => {
    enabled = true; residents = ['OpaqueRef:vm', 'OpaqueRef:dom0']; config = {}; taskStatus = 'success'
    mockCallWithSession.mockReset()
    mockGetClient.mockReturnValue({ callWithSession: mockCallWithSession })
    mockCallWithSession.mockImplementation(async (method, args) => {
      switch (method) {
        case 'host.get_record': return { enabled, resident_VMs: [...residents], other_config: { ...config } }
        case 'VM.get_record': return { is_control_domain: args[0] === 'OpaqueRef:dom0', power_state: 'Paused' }
        case 'host.disable': enabled = false; return
        case 'host.enable': enabled = true; return
        case 'Async.host.evacuate': return 'OpaqueRef:task'
        case 'task.get_record': if (taskStatus === 'success') residents = ['OpaqueRef:dom0']; return { status: taskStatus, error_info: ['VM_BAD_POWER_STATE'] }
        case 'host.add_to_other_config': config[args[1]] = args[2]; return
        case 'host.remove_from_other_config': delete config[args[1]]; return
        default: throw new Error(`Unexpected RPC ${method}`)
      }
    })
  })
  it('does not label a disabled host as maintenance without a verified marker', async () => {
    enabled = false
    const { getMaintenanceStatus } = await import('../../src/main/xapi/services/host.service')
    expect(await getMaintenanceStatus('c', 'OpaqueRef:h')).toMatchObject({ state: 'disabled', runningVms: 1, residentVms: ['OpaqueRef:vm'] })
    residents = ['OpaqueRef:dom0']
    expect((await getMaintenanceStatus('c', 'OpaqueRef:h')).state).toBe('disabled')
  })
  it('disables scheduling before evacuation and confirms residency before marking maintenance', async () => {
    const { enterMaintenanceMode, getMaintenanceStatus } = await import('../../src/main/xapi/services/host.service')
    expect(await enterMaintenanceMode('c', 'OpaqueRef:h')).toEqual({ success: true, migratedVms: ['OpaqueRef:vm'], failedVms: [] })
    const methods = mockCallWithSession.mock.calls.map(([method]) => method)
    expect(methods.indexOf('host.disable')).toBeLessThan(methods.indexOf('Async.host.evacuate'))
    expect(methods.indexOf('task.get_record')).toBeLessThan(methods.indexOf('host.add_to_other_config'))
    expect((await getMaintenanceStatus('c', 'OpaqueRef:h')).state).toBe('maintenance')
  })
  it('handles an empty host without submitting an evacuation task', async () => {
    residents = ['OpaqueRef:dom0']
    const { enterMaintenanceMode } = await import('../../src/main/xapi/services/host.service')
    expect(await enterMaintenanceMode('c', 'OpaqueRef:h')).toMatchObject({ success: true, migratedVms: [] })
    expect(mockCallWithSession).not.toHaveBeenCalledWith('Async.host.evacuate', expect.anything())
  })
  it('keeps the host disabled after a task failure and never blindly falls back to VM migration', async () => {
    taskStatus = 'failure'
    const { enterMaintenanceMode } = await import('../../src/main/xapi/services/host.service')
    await expect(enterMaintenanceMode('c', 'OpaqueRef:h')).rejects.toMatchObject({ code: 'TASK_FAILED' })
    expect(enabled).toBe(false)
    expect(config).toEqual({})
    expect(mockCallWithSession.mock.calls.some(([method]) => method === 'VM.pool_migrate' || method === 'host.enable')).toBe(false)
  })
  it('does not submit evacuation after disabling fails', async () => {
    const original = mockCallWithSession.getMockImplementation()!
    mockCallWithSession.mockImplementation((method, args) => method === 'host.disable' ? Promise.reject(new Error('SESSION_INVALID')) : original(method, args))
    const { evacuateHost } = await import('../../src/main/xapi/services/host.service')
    await expect(evacuateHost('c', 'OpaqueRef:h')).rejects.toThrow('SESSION_INVALID')
    expect(mockCallWithSession).not.toHaveBeenCalledWith('Async.host.evacuate', expect.anything())
  })
  it('returns unconfirmed when task state cannot be read', async () => {
    const original = mockCallWithSession.getMockImplementation()!
    mockCallWithSession.mockImplementation((method, args) => method === 'task.get_record' ? Promise.reject(new Error('ETIMEDOUT')) : original(method, args))
    const { evacuateHost } = await import('../../src/main/xapi/services/host.service')
    await expect(evacuateHost('c', 'OpaqueRef:h')).rejects.toMatchObject({ code: 'TASK_OUTCOME_UNKNOWN', details: { taskRef: 'OpaqueRef:task' } })
    expect(mockCallWithSession.mock.calls.filter(([method]) => method === 'Async.host.evacuate')).toHaveLength(1)
  })
  it('does not declare success when the server task succeeds but a VM remains resident', async () => {
    const original = mockCallWithSession.getMockImplementation()!
    mockCallWithSession.mockImplementation((method, args) => method === 'task.get_record' ? Promise.resolve({ status: 'success' }) : original(method, args))
    const { enterMaintenanceMode } = await import('../../src/main/xapi/services/host.service')
    expect(await enterMaintenanceMode('c', 'OpaqueRef:h')).toMatchObject({ success: false, failedVms: [{ vmRef: 'OpaqueRef:vm' }] })
    expect(config).toEqual({})
  })
  it('propagates unreadable VM records rather than declaring zero workloads', async () => {
    const original = mockCallWithSession.getMockImplementation()!
    mockCallWithSession.mockImplementation((method, args) => method === 'VM.get_record' ? Promise.reject(new Error('SESSION_INVALID')) : original(method, args))
    const { getMaintenanceStatus } = await import('../../src/main/xapi/services/host.service')
    await expect(getMaintenanceStatus('c', 'OpaqueRef:h')).rejects.toThrow('SESSION_INVALID')
  })
  it('enables and verifies the host before clearing the maintenance marker', async () => {
    enabled = false; config = { 'xenadmin-modern:maintenance': 'true' }; residents = []
    const { exitMaintenanceMode } = await import('../../src/main/xapi/services/host.service')
    await exitMaintenanceMode('c', 'OpaqueRef:h')
    expect(enabled).toBe(true); expect(config).toEqual({})
  })
})
