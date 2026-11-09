/**
 * Unit tests for network.service — verifies XAPI network.*, PIF.*, VIF.* calls.
 * v5: Extended with network write operations and VIF management tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureJsonStoreDirectory, readJsonStore } from '../../src/main/persistence/json-store'

const mockCallWithSession = vi.fn()
const mockClient = { callWithSession: mockCallWithSession }
const mockGetClient = vi.fn(() => mockClient)

vi.mock('../../src/main/xapi/connection-manager', () => ({
  connectionManager: {
    getClient: mockGetClient,
    getConnectionInfo: vi.fn(() => ({ poolName: 'Test Pool', poolUuid: 'pool-uuid', epoch: 1 })),
  },
}))

interface TopologyFixture {
  networks?: Record<string, any>
  pifs?: Record<string, any>
  metrics?: Record<string, any>
  bonds?: Record<string, any>
  vlans?: Record<string, any>
  tunnels?: Record<string, any>
  pools?: Record<string, any>
  clusterHosts?: Record<string, any>
}

function mockTopologyCalls(fixture: TopologyFixture, extra?: (method: string, args: any[]) => unknown) {
  mockCallWithSession.mockImplementation(async (method: string, args: any[]) => {
    const extraResult = extra?.(method, args)
    if (extraResult !== undefined) return extraResult
    switch (method) {
      case 'network.get_all_records':
        return fixture.networks || {}
      case 'PIF.get_all_records':
        return fixture.pifs || {}
      case 'PIF_metrics.get_all_records':
        return fixture.metrics || {}
      case 'Bond.get_all_records':
        return fixture.bonds || {}
      case 'VLAN.get_all_records':
        return fixture.vlans || {}
      case 'tunnel.get_all_records':
        return fixture.tunnels || {}
      case 'pool.get_all_records':
        return fixture.pools || {}
      case 'Cluster_host.get_all_records':
        return fixture.clusterHosts || {}
      default:
        return undefined
    }
  })
}

describe('network.service', () => {
  beforeEach(() => {
    mockCallWithSession.mockReset()
    mockGetClient.mockReset()
    mockGetClient.mockReturnValue(mockClient)
  })

  // ============================================================================
  // v4: Existing methods
  // ============================================================================

  describe('getAllNetworks', () => {
    it('returns list of networks with connection metadata', async () => {
      mockTopologyCalls({
        networks: {
          'OpaqueRef:net1': {
            uuid: 'uuid-net1',
            name_label: 'Management Network',
            name_description: '',
            bridge: 'xenbr0',
            VIFs: [],
            PIFs: ['OpaqueRef:pif1'],
            MTU: 1500,
          },
          'OpaqueRef:net2': {
            uuid: 'uuid-net2',
            name_label: 'Guest Network',
            name_description: 'For VM traffic',
            bridge: 'xenbr1',
            VIFs: ['OpaqueRef:vif1'],
            PIFs: [],
            MTU: 1500,
          },
        },
        pifs: {
          'OpaqueRef:pif1': {
            uuid: 'uuid-pif1',
            device: 'eth0',
            host: 'OpaqueRef:host1',
            network: 'OpaqueRef:net1',
            IP: '192.168.1.10',
            MAC: '00:11:22:33:44:55',
            MTU: 1500,
            VLAN: -1,
            physical: true,
            metrics: 'OpaqueRef:metrics1',
          },
        },
        metrics: {
          'OpaqueRef:metrics1': { carrier: true, speed: 1000 },
        },
      })

      const { getAllNetworks } = await import('../../src/main/xapi/services/network.service')
      const networks = await getAllNetworks('conn-123')

      expect(networks).toHaveLength(2)
      const managementNetwork = networks.find((network) => network.ref === 'OpaqueRef:net1')
      expect(managementNetwork?.name_label).toBe('Management Network')
      expect(managementNetwork?.kind).toBe('external')
      expect(managementNetwork?.linkStatus).toBe('connected')
      expect(managementNetwork?.connectionId).toBe('conn-123')
      expect(managementNetwork?.poolName).toBe('Test Pool')
    })

    it('throws when connectionId is invalid', async () => {
      mockGetClient.mockReturnValueOnce(undefined)

      const { getAllNetworks } = await import('../../src/main/xapi/services/network.service')
      await expect(getAllNetworks('invalid-id')).rejects.toThrow('No connection found for connectionId: invalid-id')
    })
  })

  describe('getAllPifs', () => {
    it('returns list of PIFs with connection metadata', async () => {
      mockTopologyCalls({
        networks: {
          'OpaqueRef:net1': { uuid: 'uuid-net1', name_label: 'Pool-wide network', PIFs: ['OpaqueRef:pif1'], VIFs: [], MTU: 1500 },
        },
        pifs: {
          'OpaqueRef:pif1': {
            uuid: 'uuid-pif1',
            device: 'eth0',
            host: 'OpaqueRef:host1',
            network: 'OpaqueRef:net1',
            IP: '192.168.1.10',
            MAC: '00:11:22:33:44:55',
            MTU: 1500, // XenAPI PIF field: MTU (int, read-only)
            VLAN: -1, // XenAPI PIF field: VLAN (-1 means no VLAN tag)
            physical: true, // XenAPI PIF field: physical (bool)
            currently_attached: true, // XenAPI PIF field: currently_attached
            ip_configuration_mode: 'Static', // XenAPI PIF enum: None/DHCP/Static
            management: true, // XenAPI PIF field: management (bool)
            metrics: 'OpaqueRef:metrics1',
          },
        },
        metrics: {
          'OpaqueRef:metrics1': { carrier: true, speed: 1000, duplex: true },
        },
      })

      const { getAllPifs } = await import('../../src/main/xapi/services/network.service')
      const pifs = await getAllPifs('conn-123')

      expect(pifs).toHaveLength(1)
      expect(pifs[0].device).toBe('eth0')
      expect(pifs[0].vlan).toBe(-1)
      expect(pifs[0].carrier).toBe(true)
      expect(pifs[0].linkState).toBe('connected')
      expect(pifs[0].isPrimaryManagement).toBe(true)
      expect(pifs[0].connectionId).toBe('conn-123')
    })
  })

  describe('getPifsForHost', () => {
    it('returns host PIFs with VLAN normalized to lower-case field', async () => {
      mockTopologyCalls({
        networks: {
          'OpaqueRef:net1': { uuid: 'uuid-net1', name_label: 'VLAN 101', PIFs: ['OpaqueRef:pif1'], VIFs: [], MTU: 1500 },
          'OpaqueRef:net2': { uuid: 'uuid-net2', name_label: 'eth1', PIFs: ['OpaqueRef:pif2'], VIFs: [], MTU: 1500 },
        },
        pifs: {
          'OpaqueRef:pif1': {
            uuid: 'uuid-pif1',
            device: 'eth0',
            host: 'OpaqueRef:host1',
            network: 'OpaqueRef:net1',
            IP: '192.168.1.10',
            MAC: '00:11:22:33:44:55',
            MTU: 1500,
            VLAN: 101,
            physical: false,
          },
          'OpaqueRef:pif2': {
            uuid: 'uuid-pif2',
            device: 'eth1',
            host: 'OpaqueRef:host2',
            network: 'OpaqueRef:net2',
            IP: '192.168.1.11',
            MAC: '00:11:22:33:44:66',
            MTU: 1500,
            VLAN: -1,
            physical: true,
          },
        },
      })

      const { getPifsForHost } = await import('../../src/main/xapi/services/network.service')
      const pifs = await getPifsForHost('conn-123', 'OpaqueRef:host1')

      expect(pifs).toHaveLength(1)
      expect(pifs[0].ref).toBe('OpaqueRef:pif1')
      expect(pifs[0].vlan).toBe(101)
      expect((pifs[0] as any).VLAN).toBeUndefined()
    })
  })

  describe('createNetwork', () => {
    it('preserves a created network when readback fails and prevents a false success', async () => {
      mockCallWithSession.mockResolvedValueOnce('OpaqueRef:created').mockRejectedValue(new Error('read denied'))
      const { createNetwork } = await import('../../src/main/xapi/services/network.service')
      await expect(createNetwork('conn-123', 'Created', '')).rejects.toMatchObject({
        code: 'NETWORK_CREATED_UNCONFIRMED', details: { networkRef: 'OpaqueRef:created', nameLabel: 'Created' },
      })
      expect(mockCallWithSession.mock.calls.map(([method]) => method)).toEqual(['network.create', 'network.get_record', 'network.get_record', 'network.get_record'])
    })

    it('classifies a lost creation response without resubmitting or inventing a created reference', async () => {
      mockCallWithSession.mockRejectedValueOnce(Object.assign(new Error('connection lost'), { code: 'ECONNRESET' }))
      const { createNetwork } = await import('../../src/main/xapi/services/network.service')
      await expect(createNetwork('conn-123', 'Unknown', '')).rejects.toMatchObject({
        code: 'NETWORK_CREATE_OUTCOME_UNKNOWN', details: { outcome: 'unknown', nameLabel: 'Unknown' },
      })
      expect(mockCallWithSession).toHaveBeenCalledTimes(1)
    })

    it('keeps a server rejection retryable and rejects an invalid success reference as unknown', async () => {
      const { createNetwork } = await import('../../src/main/xapi/services/network.service')
      const denied = Object.assign(new Error('denied'), { code: 'RBAC_PERMISSION_DENIED' })
      mockCallWithSession.mockRejectedValueOnce(denied)
      await expect(createNetwork('conn-123', 'Denied', '')).rejects.toBe(denied)
      mockCallWithSession.mockResolvedValueOnce('OpaqueRef:NULL')
      await expect(createNetwork('conn-123', 'Unknown', '')).rejects.toMatchObject({ code: 'NETWORK_CREATE_OUTCOME_UNKNOWN' })
    })

    it('calls network.create with correct params', async () => {
      mockCallWithSession.mockResolvedValueOnce('OpaqueRef:new-net').mockResolvedValueOnce({ name_label: 'My Network' })

      const { createNetwork } = await import('../../src/main/xapi/services/network.service')
      const ref = await createNetwork('conn-123', 'My Network', 'A test network')

      expect(ref).toBe('OpaqueRef:new-net')
      expect(mockCallWithSession).toHaveBeenCalledWith('network.create', [
        expect.objectContaining({
          name_label: 'My Network',
          name_description: 'A test network',
          MTU: 1500,
        }),
      ])
    })
  })

  // ============================================================================
  // v5: New network management methods
  // ============================================================================

  describe('destroyNetwork', () => {
    it('destroys network when no VIFs connected', async () => {
      mockTopologyCalls({
        networks: {
          'OpaqueRef:net1': { uuid: 'uuid-net1', name_label: 'Internal', PIFs: [], VIFs: [], MTU: 1500 },
        },
      }, (method) => method === 'network.destroy' ? null : undefined)

      const { destroyNetwork } = await import('../../src/main/xapi/services/network.service')
      await destroyNetwork('conn-123', 'OpaqueRef:net1')

      expect(mockCallWithSession).toHaveBeenCalledWith('network.destroy', ['OpaqueRef:net1'])
    })

    it('throws error when network has VIFs', async () => {
      mockTopologyCalls({
        networks: {
          'OpaqueRef:net1': { uuid: 'uuid-net1', name_label: 'In use', PIFs: [], VIFs: ['OpaqueRef:vif1'], MTU: 1500 },
        },
      })

      const { destroyNetwork } = await import('../../src/main/xapi/services/network.service')
      await expect(destroyNetwork('conn-123', 'OpaqueRef:net1')).rejects.toThrow('NETWORK_IN_USE')
    })
  })

  describe('renameNetwork', () => {
    it('does not confirm a rename that reads back a different name', async () => {
      mockCallWithSession.mockResolvedValueOnce(null).mockResolvedValue({ name_label: 'Previous name' })
      const { renameNetwork } = await import('../../src/main/xapi/services/network.service')
      await expect(renameNetwork('conn-123', 'OpaqueRef:net1', 'New name')).rejects.toMatchObject({ code: 'NETWORK_RENAME_UNCONFIRMED' })
      expect(mockCallWithSession.mock.calls.map(([method]) => method)).toEqual(['network.set_name_label', 'network.get_record', 'network.get_record', 'network.get_record'])
    })

    it('calls network.set_name_label', async () => {
      mockCallWithSession.mockResolvedValueOnce(null).mockResolvedValueOnce({ name_label: 'New Network Name' })

      const { renameNetwork } = await import('../../src/main/xapi/services/network.service')
      await renameNetwork('conn-123', 'OpaqueRef:net1', 'New Network Name')

      expect(mockCallWithSession).toHaveBeenCalledWith('network.set_name_label', ['OpaqueRef:net1', 'New Network Name'])
    })
  })

  // ============================================================================
  // v5: VIF management methods
  // ============================================================================

  describe('createVif', () => {
    it('creates VIF with auto-generated MAC and plugs if VM is running', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({
          VIFs: [],
          power_state: 'Running',
        }) // VM.get_record
        .mockResolvedValueOnce(['0']) // VM.get_allowed_VIF_devices
        .mockResolvedValueOnce('OpaqueRef:new-vif') // VIF.create
        .mockResolvedValueOnce(null) // VIF.plug

      const { createVif } = await import('../../src/main/xapi/services/network.service')
      const result = await createVif('conn-123', {
        vmRef: 'OpaqueRef:vm1',
        networkRef: 'OpaqueRef:net1',
      })

      expect(result).toEqual({ vifRef: 'OpaqueRef:new-vif', plugged: true })
      expect(mockCallWithSession).toHaveBeenCalledWith('VIF.create', [
        expect.objectContaining({
          VM: 'OpaqueRef:vm1',
          network: 'OpaqueRef:net1',
          device: '0',
          MAC: '',
          MTU: 1500,
        }),
      ])
      expect(mockCallWithSession).toHaveBeenCalledWith('VIF.plug', ['OpaqueRef:new-vif'])
    })

    it('creates VIF without plugging if VM is halted', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({
          VIFs: [],
          power_state: 'Halted',
        }) // VM.get_record
        .mockResolvedValueOnce(['0']) // VM.get_allowed_VIF_devices
        .mockResolvedValueOnce('OpaqueRef:new-vif') // VIF.create

      const { createVif } = await import('../../src/main/xapi/services/network.service')
      const result = await createVif('conn-123', {
        vmRef: 'OpaqueRef:vm1',
        networkRef: 'OpaqueRef:net1',
        mac: '00:11:22:33:44:55',
        mtu: 9000,
      })

      expect(result).toEqual({ vifRef: 'OpaqueRef:new-vif', plugged: false })
      expect(mockCallWithSession).toHaveBeenCalledWith('VIF.create', [
        expect.objectContaining({
          MAC: '00:11:22:33:44:55',
          MTU: 9000,
        }),
      ])
      // VIF.plug should not be called
      expect(mockCallWithSession).not.toHaveBeenCalledWith('VIF.plug', expect.anything())
    })

    it('assigns the first XAPI-allowed device number', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({
          VIFs: ['OpaqueRef:vif0', 'OpaqueRef:vif1'],
          power_state: 'Halted',
        }) // VM.get_record
        .mockResolvedValueOnce(['3', '1']) // VM.get_allowed_VIF_devices
        .mockResolvedValueOnce('OpaqueRef:new-vif') // VIF.create

      const { createVif } = await import('../../src/main/xapi/services/network.service')
      await createVif('conn-123', {
        vmRef: 'OpaqueRef:vm1',
        networkRef: 'OpaqueRef:net1',
      })

      expect(mockCallWithSession).toHaveBeenCalledWith('VIF.create', [
        expect.objectContaining({
          device: '1',
        }),
      ])
    })

    it('reports a created VIF when hot-plug fails', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ power_state: 'Running' })
        .mockResolvedValueOnce(['0'])
        .mockResolvedValueOnce('OpaqueRef:new-vif')
        .mockRejectedValueOnce(new Error('VIF_HOTPLUG_FAILED'))
        .mockResolvedValueOnce({ currently_attached: false })

      const { createVif } = await import('../../src/main/xapi/services/network.service')
      await expect(createVif('conn-123', {
        vmRef: 'OpaqueRef:vm1', networkRef: 'OpaqueRef:net1',
      })).resolves.toEqual({
        vifRef: 'OpaqueRef:new-vif', plugged: false, warning: 'VIF_HOTPLUG_FAILED',
      })
    })
  })

  describe('destroyVif', () => {
    it('unplugs and destroys VIF when connected', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ currently_attached: true }) // VIF.get_record
        .mockResolvedValueOnce(null) // VIF.unplug
        .mockResolvedValueOnce(null) // VIF.destroy

      const { destroyVif } = await import('../../src/main/xapi/services/network.service')
      await destroyVif('conn-123', 'OpaqueRef:vif1')

      expect(mockCallWithSession).toHaveBeenCalledWith('VIF.unplug', ['OpaqueRef:vif1'])
      expect(mockCallWithSession).toHaveBeenCalledWith('VIF.destroy', ['OpaqueRef:vif1'])
    })

    it('destroys VIF directly when not connected', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ currently_attached: false }) // VIF.get_record
        .mockResolvedValueOnce(null) // VIF.destroy

      const { destroyVif } = await import('../../src/main/xapi/services/network.service')
      await destroyVif('conn-123', 'OpaqueRef:vif1')

      expect(mockCallWithSession).not.toHaveBeenCalledWith('VIF.unplug', expect.anything())
      expect(mockCallWithSession).toHaveBeenCalledWith('VIF.destroy', ['OpaqueRef:vif1'])
    })
  })

  describe('plugVif', () => {
    it('calls VIF.plug', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)

      const { plugVif } = await import('../../src/main/xapi/services/network.service')
      await plugVif('conn-123', 'OpaqueRef:vif1')

      expect(mockCallWithSession).toHaveBeenCalledWith('VIF.plug', ['OpaqueRef:vif1'])
    })
  })

  describe('unplugVif', () => {
    it('calls VIF.unplug', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)

      const { unplugVif } = await import('../../src/main/xapi/services/network.service')
      await unplugVif('conn-123', 'OpaqueRef:vif1')

      expect(mockCallWithSession).toHaveBeenCalledWith('VIF.unplug', ['OpaqueRef:vif1'])
    })
  })
})

describe('VIF write result reconciliation', () => {
  let directory: string
  const lostResponse = () => Object.assign(new Error('response lost'), { code: 'ECONNRESET', details: { kind: 'transport' } })
  beforeEach(() => {
    mockCallWithSession.mockReset()
    mockGetClient.mockReturnValue(mockClient)
    directory = mkdtempSync(join(tmpdir(), 'xenadmin-vif-test-'))
    configureJsonStoreDirectory(directory)
  })
  afterEach(() => { configureJsonStoreDirectory(null); rmSync(directory, { recursive: true, force: true }) })

  it('recovers a created VIF by its request marker and reuses the persisted receipt', async () => {
    const records: Record<string, any> = {}
    mockCallWithSession.mockImplementation(async (method: string, args: any[]) => {
      if (method === 'VM.get_record') return { uuid: 'vm-uuid', power_state: 'Halted' }
      if (method === 'VM.get_allowed_VIF_devices') return ['0', '1']
      if (method === 'VIF.create') { records['OpaqueRef:new-vif'] = { ...args[0], currently_attached: false }; throw lostResponse() }
      if (method === 'VIF.get_all_records') return records
      throw new Error(`Unexpected method ${method}`)
    })
    const { createVif } = await import('../../src/main/xapi/services/network.service')
    const params = { vmRef: 'OpaqueRef:vm', networkRef: 'OpaqueRef:net', requestId: 'request-1' }
    await expect(createVif('conn-1', params)).resolves.toMatchObject({ vifRef: 'OpaqueRef:new-vif', plugged: false })
    await expect(createVif('another-connection', params)).resolves.toMatchObject({ vifRef: 'OpaqueRef:new-vif', plugged: false })
    expect(mockCallWithSession.mock.calls.filter(([method]) => method === 'VIF.create')).toHaveLength(1)
  })

  it('retains an unreadable create and only reads it on a later request', async () => {
    let created: any
    let canRead = false
    mockCallWithSession.mockImplementation(async (method: string, args: any[]) => {
      if (method === 'VM.get_record') return { uuid: 'vm-uuid', power_state: 'Halted' }
      if (method === 'VM.get_allowed_VIF_devices') return ['0']
      if (method === 'VIF.create') { created = { ...args[0], currently_attached: false }; throw lostResponse() }
      if (method === 'VIF.get_all_records') { if (!canRead) throw lostResponse(); return { 'OpaqueRef:new-vif': created } }
      throw new Error(`Unexpected method ${method}`)
    })
    const { createVif } = await import('../../src/main/xapi/services/network.service')
    const params = { vmRef: 'OpaqueRef:vm', networkRef: 'OpaqueRef:net', requestId: 'request-2' }
    await expect(createVif('conn-1', params)).rejects.toMatchObject({ code: 'RESOURCE_RESULT_READ_FAILED' })
    canRead = true
    await expect(createVif('conn-1', params)).resolves.toMatchObject({ vifRef: 'OpaqueRef:new-vif' })
    expect(mockCallWithSession.mock.calls.filter(([method]) => method === 'VIF.create')).toHaveLength(1)
  })

  it('confirms a hot-plug whose acknowledgement was lost', async () => {
    mockCallWithSession.mockImplementation(async (method: string) => {
      if (method === 'VM.get_record') return { uuid: 'vm-uuid', power_state: 'Running' }
      if (method === 'VM.get_allowed_VIF_devices') return ['0']
      if (method === 'VIF.create') return 'OpaqueRef:new-vif'
      if (method === 'VIF.plug') throw lostResponse()
      if (method === 'VIF.get_record') return { currently_attached: true }
      throw new Error(`Unexpected method ${method}`)
    })
    const { createVif } = await import('../../src/main/xapi/services/network.service')
    await expect(createVif('conn-1', { vmRef: 'OpaqueRef:vm', networkRef: 'OpaqueRef:net' })).resolves.toEqual({ vifRef: 'OpaqueRef:new-vif', plugged: true })
  })

  it.each([false, true])('allows a fresh request after deleting a VIF while preserving its consumed request ID (receipt completed=%s)', async (completed) => {
    const { saveVifCreation } = await import('../../src/main/xapi/services/vif-creation-journal')
    saveVifCreation({ poolUuid: 'pool-uuid', vmUuid: 'vm-uuid', requestId: 'old-request', networkRef: 'OpaqueRef:old-net', device: '0', vifRef: 'OpaqueRef:old-vif',
      ...(completed ? { result: { vifRef: 'OpaqueRef:old-vif', plugged: false } } : {}) })
    mockCallWithSession.mockImplementation(async (method: string) => {
      if (method === 'VIF.get_record') return { currently_attached: false }
      if (method === 'VIF.destroy') return null
      if (method === 'VM.get_record') return { uuid: 'vm-uuid', power_state: 'Halted' }
      if (method === 'VM.get_allowed_VIF_devices') return ['0']
      if (method === 'VIF.create') return 'OpaqueRef:new-vif'
      throw new Error(`Unexpected method ${method}`)
    })
    const { createVif, destroyVif } = await import('../../src/main/xapi/services/network.service')
    await destroyVif('conn-1', 'OpaqueRef:old-vif')
    configureJsonStoreDirectory(null)
    configureJsonStoreDirectory(directory)
    await expect(createVif('reconnected', { vmRef: 'OpaqueRef:vm', networkRef: 'OpaqueRef:old-net', requestId: 'old-request' })).rejects.toMatchObject({ code: 'VIF_CREATION_REMOVED' })
    await expect(createVif('reconnected', { vmRef: 'OpaqueRef:vm', networkRef: 'OpaqueRef:new-net', requestId: 'fresh-request' })).resolves.toMatchObject({ vifRef: 'OpaqueRef:new-vif' })
    expect(mockCallWithSession.mock.calls.filter(([method]) => method === 'VIF.create')).toHaveLength(1)
  })

  it.each([false, true])('releases an externally deleted pending VIF only after HANDLE_INVALID (same network=%s)', async (sameNetwork) => {
    const { saveVifCreation } = await import('../../src/main/xapi/services/vif-creation-journal')
    saveVifCreation({ poolUuid: 'pool-uuid', vmUuid: 'vm-uuid', requestId: 'old', networkRef: 'OpaqueRef:net', device: '0', vifRef: 'OpaqueRef:removed' })
    mockCallWithSession.mockImplementation(async (method: string) => {
      if (method === 'VM.get_record') return { uuid: 'vm-uuid', power_state: 'Halted' }
      if (method === 'VIF.get_record') throw Object.assign(new Error('HANDLE_INVALID'), { code: 'HANDLE_INVALID' })
      if (method === 'VM.get_allowed_VIF_devices') return ['0']
      if (method === 'VIF.create') return 'OpaqueRef:fresh'
      throw new Error(`Unexpected method ${method}`)
    })
    const { createVif } = await import('../../src/main/xapi/services/network.service')
    await expect(createVif('conn-1', { vmRef: 'OpaqueRef:vm', networkRef: sameNetwork ? 'OpaqueRef:net' : 'OpaqueRef:other', requestId: 'new' })).resolves.toMatchObject({ vifRef: 'OpaqueRef:fresh' })
    await expect(createVif('conn-1', { vmRef: 'OpaqueRef:vm', networkRef: 'OpaqueRef:net', requestId: 'old' })).rejects.toMatchObject({ code: 'VIF_CREATION_REMOVED' })
    expect(mockCallWithSession.mock.calls.filter(([method]) => method === 'VIF.create')).toHaveLength(1)
  })

  it('does not release a pending VIF when the old record cannot be read due to a permission error', async () => {
    const { saveVifCreation } = await import('../../src/main/xapi/services/vif-creation-journal')
    saveVifCreation({ poolUuid: 'pool-uuid', vmUuid: 'vm-uuid', requestId: 'old', networkRef: 'OpaqueRef:net', device: '0', vifRef: 'OpaqueRef:pending' })
    mockCallWithSession.mockImplementation(async (method: string) => {
      if (method === 'VM.get_record') return { uuid: 'vm-uuid' }
      throw Object.assign(new Error('permission denied'), { code: 'RBAC_PERMISSION_DENIED' })
    })
    const { createVif } = await import('../../src/main/xapi/services/network.service')
    await expect(createVif('conn-1', { vmRef: 'OpaqueRef:vm', networkRef: 'OpaqueRef:other', requestId: 'new' })).rejects.toMatchObject({ code: 'RESOURCE_RESULT_READ_FAILED' })
    expect(readJsonStore<any[]>('vif-creations', [])[0].deleted).toBeUndefined()
    expect(mockCallWithSession.mock.calls.filter(([method]) => method === 'VIF.create')).toHaveLength(0)
  })

  it('never releases an unidentified lost creation merely because no matching VIF appears in a list', async () => {
    const { saveVifCreation } = await import('../../src/main/xapi/services/vif-creation-journal')
    saveVifCreation({ poolUuid: 'pool-uuid', vmUuid: 'vm-uuid', requestId: 'old', networkRef: 'OpaqueRef:net', device: '0' })
    mockCallWithSession.mockImplementation(async (method: string) => {
      if (method === 'VM.get_record') return { uuid: 'vm-uuid' }
      if (method === 'VIF.get_all_records') return {}
      throw new Error(`Unexpected method ${method}`)
    })
    const { createVif } = await import('../../src/main/xapi/services/network.service')
    await expect(createVif('conn-1', { vmRef: 'OpaqueRef:vm', networkRef: 'OpaqueRef:net', requestId: 'new' })).rejects.toMatchObject({ code: 'RESOURCE_RESULT_READ_FAILED' })
    expect(readJsonStore<any[]>('vif-creations', [])[0].deleted).toBeUndefined()
    expect(mockCallWithSession.mock.calls.filter(([method]) => method === 'VIF.create')).toHaveLength(0)
  })

  it('does not clear creation records if the management connection changes during deletion', async () => {
    const { saveVifCreation } = await import('../../src/main/xapi/services/vif-creation-journal')
    saveVifCreation({ poolUuid: 'pool-uuid', vmUuid: 'vm-uuid', requestId: 'old', networkRef: 'OpaqueRef:net', device: '0', vifRef: 'OpaqueRef:pending' })
    mockCallWithSession.mockImplementation(async (method: string) => {
      if (method === 'VIF.get_record') return { currently_attached: false }
      if (method === 'VIF.destroy') { mockGetClient.mockReturnValue({ callWithSession: vi.fn() }); return null }
      throw new Error(`Unexpected method ${method}`)
    })
    const { destroyVif } = await import('../../src/main/xapi/services/network.service')
    await expect(destroyVif('conn-1', 'OpaqueRef:pending')).rejects.toMatchObject({ code: 'RESOURCE_RESULT_READ_FAILED' })
    expect(readJsonStore<any[]>('vif-creations', [])[0].deleted).toBeUndefined()
  })

  it('does not let a late creation receipt undo a confirmed deletion', async () => {
    const { saveVifCreation, markVifCreationsDeleted } = await import('../../src/main/xapi/services/vif-creation-journal')
    const record = { poolUuid: 'pool-uuid', vmUuid: 'vm-uuid', requestId: 'old', networkRef: 'OpaqueRef:net', device: '0', vifRef: 'OpaqueRef:removed' }
    saveVifCreation(record)
    markVifCreationsDeleted('pool-uuid', 'OpaqueRef:removed')
    expect(() => saveVifCreation({ ...record, result: { vifRef: 'OpaqueRef:removed', plugged: false } })).toThrow(expect.objectContaining({ code: 'VIF_CREATION_REMOVED' }))
    expect(readJsonStore<any[]>('vif-creations', [])[0].deleted).toBe(true)
  })

  it('only closes creation records from the confirmed original pool when references overlap', async () => {
    const { saveVifCreation } = await import('../../src/main/xapi/services/vif-creation-journal')
    for (const poolUuid of ['pool-uuid', 'other-pool']) saveVifCreation({ poolUuid, vmUuid: 'vm-uuid', requestId: 'old', networkRef: 'OpaqueRef:net', device: '0', vifRef: 'OpaqueRef:same' })
    mockCallWithSession.mockImplementation(async (method: string) => {
      if (method === 'VIF.get_record') return { currently_attached: false }
      if (method === 'VIF.destroy') return null
      throw new Error(`Unexpected method ${method}`)
    })
    const { destroyVif } = await import('../../src/main/xapi/services/network.service')
    await destroyVif('conn-1', 'OpaqueRef:same')
    const rows = readJsonStore<any[]>('vif-creations', [])
    expect(rows.find((row) => row.poolUuid === 'pool-uuid').deleted).toBe(true)
    expect(rows.find((row) => row.poolUuid === 'other-pool').deleted).toBeUndefined()
  })

  it('moves the same VIF and verifies identity after a lost acknowledgement', async () => {
    const record = { uuid: 'vif-uuid', MAC: '00:11:22:33:44:55', VM: 'OpaqueRef:vm', network: 'OpaqueRef:old' }
    mockCallWithSession.mockImplementation(async (method: string) => {
      if (method === 'VIF.get_record') return { ...record }
      if (method === 'VM.get_record') return { power_state: 'Halted' }
      if (method === 'network.get_record') return { PIFs: [] }
      if (method === 'VIF.move') { record.network = 'OpaqueRef:new'; throw lostResponse() }
      throw new Error(`Unexpected method ${method}`)
    })
    const { moveVif } = await import('../../src/main/xapi/services/network.service')
    await moveVif('conn-1', 'OpaqueRef:vif', 'OpaqueRef:new')
    expect(mockCallWithSession).toHaveBeenCalledWith('VIF.move', ['OpaqueRef:vif', 'OpaqueRef:new'])
    expect(mockCallWithSession.mock.calls.some(([method]) => method === 'VIF.destroy' || method === 'VIF.create')).toBe(false)
  })
})
