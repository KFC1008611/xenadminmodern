/**
 * Unit tests for network.service extended features — VLAN, Bond, Tunnel, PIF IP, VIF QoS.
 * Reference: https://xapi-project.github.io/xen-api/ (network, PIF, VIF, Bond, VLAN, tunnel classes)
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

interface TopologyFixture {
  networks?: Record<string, any>
  pifs?: Record<string, any>
  metrics?: Record<string, any>
  bonds?: Record<string, any>
  vlans?: Record<string, any>
  tunnels?: Record<string, any>
  pools?: Record<string, any>
  clusterHosts?: Record<string, any>
  hosts?: string[]
}

function mockTopologyCalls(fixture: TopologyFixture, extra?: (method: string, args: any[]) => unknown) {
  mockCallWithSession.mockImplementation(async (method: string, args: any[]) => {
    const extraResult = extra?.(method, args)
    if (extraResult !== undefined) return extraResult
    switch (method) {
      case 'host.get_all':
        return fixture.hosts || [...new Set(Object.values(fixture.pifs || {}).map((pif) => pif.host))]
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

function bondTopology(): TopologyFixture {
  return {
    networks: {
      'OpaqueRef:net-eth0': { uuid: 'net-eth0', name_label: 'eth0', PIFs: ['OpaqueRef:pif-h1-eth0'], VIFs: [], MTU: 1500 },
      'OpaqueRef:net-eth1': { uuid: 'net-eth1', name_label: 'eth1', PIFs: ['OpaqueRef:pif-h1-eth1'], VIFs: [], MTU: 1500 },
      'OpaqueRef:bond-net': { uuid: 'bond-net', name_label: 'Bond eth0+eth1', PIFs: ['OpaqueRef:pif-bond-master'], VIFs: [], MTU: 1500 },
    },
    pifs: {
      'OpaqueRef:pif-h1-eth0': { uuid: 'pif-h1-eth0', device: 'eth0', host: 'OpaqueRef:host1', network: 'OpaqueRef:net-eth0', IP: '', MAC: '00:11:22:33:44:01', MTU: 1500, VLAN: -1, physical: true, management: false, ip_configuration_mode: 'None' },
      'OpaqueRef:pif-h1-eth1': { uuid: 'pif-h1-eth1', device: 'eth1', host: 'OpaqueRef:host1', network: 'OpaqueRef:net-eth1', IP: '', MAC: '00:11:22:33:44:02', MTU: 1500, VLAN: -1, physical: true, management: false, ip_configuration_mode: 'None' },
      'OpaqueRef:pif-bond-master': { uuid: 'pif-bond-master', device: 'bond0', host: 'OpaqueRef:host1', network: 'OpaqueRef:bond-net', IP: '', MAC: '00:11:22:33:44:03', MTU: 1500, VLAN: -1, physical: true, management: false, ip_configuration_mode: 'None', bond_master_of: ['OpaqueRef:bond1'] },
      'OpaqueRef:pif-bond-eth0': { uuid: 'pif-bond-eth0', device: 'eth0', host: 'OpaqueRef:host1', network: 'OpaqueRef:net-eth0', IP: '', MAC: '00:11:22:33:44:04', MTU: 1500, VLAN: -1, physical: true, management: false, ip_configuration_mode: 'None', bond_slave_of: 'OpaqueRef:bond1' },
      'OpaqueRef:pif-bond-eth1': { uuid: 'pif-bond-eth1', device: 'eth1', host: 'OpaqueRef:host1', network: 'OpaqueRef:net-eth1', IP: '', MAC: '00:11:22:33:44:05', MTU: 1500, VLAN: -1, physical: true, management: false, ip_configuration_mode: 'None', bond_slave_of: 'OpaqueRef:bond1' },
    },
    bonds: {
      'OpaqueRef:bond1': {
        uuid: 'uuid-bond1',
        master: 'OpaqueRef:pif-bond-master',
        slaves: ['OpaqueRef:pif-bond-eth0', 'OpaqueRef:pif-bond-eth1'],
        mode: 'active-backup',
        properties: {},
        links_up: 2,
      },
    },
    pools: {
      'OpaqueRef:pool1': { master: 'OpaqueRef:host1', ha_enabled: false },
    },
    clusterHosts: {},
  }
}

function vlanTopology(): TopologyFixture {
  return {
    networks: {
      'OpaqueRef:net1': { uuid: 'net1', name_label: 'eth0', PIFs: ['OpaqueRef:pif1'], VIFs: [], MTU: 1500 },
      'OpaqueRef:net-vlan100': { uuid: 'net-vlan100', name_label: 'VLAN 100', PIFs: ['OpaqueRef:pif-vlan100'], VIFs: [], MTU: 1500 },
    },
    pifs: {
      'OpaqueRef:pif1': { uuid: 'pif1', device: 'eth0', host: 'OpaqueRef:host1', network: 'OpaqueRef:net1', IP: '', MAC: '00:11:22:33:44:55', MTU: 1500, VLAN: -1, physical: true, management: false, ip_configuration_mode: 'None' },
      'OpaqueRef:pif-vlan100': { uuid: 'pif-vlan100', device: 'eth0', host: 'OpaqueRef:host1', network: 'OpaqueRef:net-vlan100', IP: '', MAC: '00:11:22:33:44:56', MTU: 1500, VLAN: 100, physical: false, management: false, ip_configuration_mode: 'None', VLAN_master_of: 'OpaqueRef:vlan1' },
    },
    vlans: {
      'OpaqueRef:vlan1': {
        uuid: 'uuid-vlan1',
        tag: 100,
        tagged_PIF: 'OpaqueRef:pif1',
        untagged_PIF: 'OpaqueRef:pif-vlan100',
      },
    },
    pools: {
      'OpaqueRef:pool1': { master: 'OpaqueRef:host1', ha_enabled: false },
    },
    clusterHosts: {},
  }
}

describe('network.service v9 extended', () => {
  beforeEach(() => {
    mockCallWithSession.mockReset()
    mockGetClient.mockReset()
    mockGetClient.mockImplementation(() => ({
      callWithSession: mockCallWithSession,
    }))
  })

  // ============================================================================
  // Bond management
  // ============================================================================

  describe('getAllBonds', () => {
    it('returns list of bonds with connection metadata', async () => {
      mockTopologyCalls(bondTopology())

      const { getAllBonds } = await import('../../src/main/xapi/services/network.service')
      const bonds = await getAllBonds('conn-123')

      expect(bonds).toHaveLength(1)
      expect(bonds[0].mode).toBe('active-backup')
      expect(bonds[0].devices).toEqual(['eth0', 'eth1'])
      expect(bonds[0].connectionId).toBe('conn-123')
      expect(bonds[0].poolName).toBe('Test Pool')
    })
  })

  describe('createBond', () => {
    it('creates a bond with default active-backup mode', async () => {
      mockTopologyCalls({
        ...bondTopology(),
        bonds: {},
      }, (method) => {
        if (method === 'network.create') return 'OpaqueRef:new-bond-net'
        if (method === 'Bond.create') return 'OpaqueRef:new-bond'
        return undefined
      })

      const { createBond } = await import('../../src/main/xapi/services/network.service')
      const ref = await createBond('conn-123', {
        pifRefs: ['OpaqueRef:pif-h1-eth0', 'OpaqueRef:pif-h1-eth1'],
      })

      expect(ref).toEqual(['OpaqueRef:new-bond'])
      expect(mockCallWithSession).not.toHaveBeenCalledWith('PIF.get_record', expect.anything())
      expect(mockCallWithSession).toHaveBeenCalledWith('network.create', [
        expect.objectContaining({
          tags: ['bond'],
        }),
      ])
      expect(mockCallWithSession).toHaveBeenCalledWith('Bond.create', [
        'OpaqueRef:new-bond-net',
        ['OpaqueRef:pif-h1-eth0', 'OpaqueRef:pif-h1-eth1'],
        '',
        'active-backup',
        {},
      ])
    })

    it('creates a bond with LACP mode', async () => {
      mockTopologyCalls({
        ...bondTopology(),
        bonds: {},
        networks: {
          ...bondTopology().networks,
          'OpaqueRef:net2': { uuid: 'net2', name_label: 'Bond target', PIFs: [], VIFs: [], MTU: 1500 },
        },
        pifs: {
          ...bondTopology().pifs,
          'OpaqueRef:pif-h1-eth2': { uuid: 'pif-h1-eth2', device: 'eth2', host: 'OpaqueRef:host1', network: 'OpaqueRef:net2', IP: '', MAC: '00:11:22:33:44:06', MTU: 1500, VLAN: -1, physical: true, management: false, ip_configuration_mode: 'None' },
        },
      }, (method) => method === 'Bond.create' ? 'OpaqueRef:lacp-bond' : undefined)

      const { createBond } = await import('../../src/main/xapi/services/network.service')
      const ref = await createBond('conn-123', {
        pifRefs: ['OpaqueRef:pif-h1-eth0', 'OpaqueRef:pif-h1-eth1', 'OpaqueRef:pif-h1-eth2'],
        networkRef: 'OpaqueRef:net2',
        mode: 'lacp',
      })

      expect(ref).toEqual(['OpaqueRef:lacp-bond'])
      expect(mockCallWithSession).not.toHaveBeenCalledWith('PIF.get_record', expect.anything())
      expect(mockCallWithSession).toHaveBeenCalledWith('Bond.create', [
        'OpaqueRef:net2',
        ['OpaqueRef:pif-h1-eth0', 'OpaqueRef:pif-h1-eth1', 'OpaqueRef:pif-h1-eth2'],
        '',
        'lacp',
        {},
      ])
    })

    it('throws error when fewer than 2 PIFs provided', async () => {
      const { createBond } = await import('../../src/main/xapi/services/network.service')
      await expect(createBond('conn-123', {
        pifRefs: ['OpaqueRef:pif1'],
      })).rejects.toThrow('BOND_REQUIRES_TWO_PIFS')
    })
  })

  describe('destroyBond', () => {
    it('preserves a different bond network using the same devices on another host', async () => {
      const fixture = bondTopology()
      fixture.pifs!['OpaqueRef:other-master'] = { device: 'bond0', host: 'host2', network: 'other-network', bond_master_of: ['other-bond'] }
      fixture.pifs!['OpaqueRef:other-eth0'] = { device: 'eth0', host: 'host2', network: 'other-member0' }
      fixture.pifs!['OpaqueRef:other-eth1'] = { device: 'eth1', host: 'host2', network: 'other-member1' }
      fixture.bonds!['other-bond'] = { master: 'OpaqueRef:other-master', slaves: ['OpaqueRef:other-eth0', 'OpaqueRef:other-eth1'] }
      mockTopologyCalls(fixture)
      const { destroyBond } = await import('../../src/main/xapi/services/network.service')
      await destroyBond('conn-123', 'OpaqueRef:bond1')
      expect(mockCallWithSession.mock.calls.filter(([method]) => method === 'Bond.destroy')).toEqual([
        ['Bond.destroy', ['OpaqueRef:bond1']],
      ])
    })

    it('calls Bond.destroy', async () => {
      mockTopologyCalls(bondTopology(), (method) => {
        if (method === 'Bond.destroy') return null
        if (method === 'network.destroy') return null
        return undefined
      })

      const { destroyBond } = await import('../../src/main/xapi/services/network.service')
      await destroyBond('conn-123', 'OpaqueRef:bond1')

      expect(mockCallWithSession).toHaveBeenCalledWith('Bond.destroy', ['OpaqueRef:bond1'])
    })
  })

  describe('getBondRecord', () => {
    it('returns bond record with connection metadata', async () => {
      mockTopologyCalls({
        ...bondTopology(),
        bonds: {
          'OpaqueRef:bond1': {
            uuid: 'uuid-bond1',
            master: 'OpaqueRef:pif-bond-master',
            slaves: ['OpaqueRef:pif-bond-eth0', 'OpaqueRef:pif-bond-eth1'],
            mode: 'balance-slb',
            properties: {},
            links_up: 1,
          },
        },
      })

      const { getBondRecord } = await import('../../src/main/xapi/services/network.service')
      const bond = await getBondRecord('conn-123', 'OpaqueRef:bond1')

      expect(bond.ref).toBe('OpaqueRef:bond1')
      expect(bond.mode).toBe('balance-slb')
      expect(bond.connectionId).toBe('conn-123')
    })
  })

  // ============================================================================
  // VLAN management
  // ============================================================================

  describe('getAllVlans', () => {
    it('returns list of VLANs with connection metadata', async () => {
      mockTopologyCalls(vlanTopology())

      const { getAllVlans } = await import('../../src/main/xapi/services/network.service')
      const vlans = await getAllVlans('conn-123')

      expect(vlans).toHaveLength(1)
      expect(vlans[0].tag).toBe(100)
      expect(vlans[0].taggedDevice).toBe('eth0')
      expect(vlans[0].network).toBe('OpaqueRef:net-vlan100')
      expect(vlans[0].connectionId).toBe('conn-123')
    })
  })

  describe('createVlan', () => {
    it('creates VLAN with existing network', async () => {
      mockTopologyCalls({
        ...vlanTopology(),
        vlans: {},
        pifs: {
          'OpaqueRef:pif1': vlanTopology().pifs!['OpaqueRef:pif1'],
        },
      }, (method) => method === 'pool.create_VLAN_from_PIF' ? ['OpaqueRef:vlan-pif1'] : undefined)

      const { createVlan } = await import('../../src/main/xapi/services/network.service')
      const ref = await createVlan('conn-123', {
        taggedPifRef: 'OpaqueRef:pif1',
        vlanTag: 100,
        networkRef: 'OpaqueRef:net1',
      })

      expect(ref).toEqual(['OpaqueRef:vlan-pif1'])
      expect(mockCallWithSession).toHaveBeenCalledWith('pool.create_VLAN_from_PIF', [
        'OpaqueRef:pif1',
        'OpaqueRef:net1',
        100,
      ])
      expect(mockCallWithSession).not.toHaveBeenCalledWith('VLAN.create', expect.anything())
    })

    it('creates VLAN with new network when not provided', async () => {
      mockTopologyCalls({
        ...vlanTopology(),
        vlans: {},
        pifs: {
          'OpaqueRef:pif1': vlanTopology().pifs!['OpaqueRef:pif1'],
        },
      }, (method) => {
        if (method === 'network.create') return 'OpaqueRef:new-net'
        if (method === 'pool.create_VLAN_from_PIF') return ['OpaqueRef:vlan-pif200']
        return undefined
      })

      const { createVlan } = await import('../../src/main/xapi/services/network.service')
      const ref = await createVlan('conn-123', {
        taggedPifRef: 'OpaqueRef:pif1',
        vlanTag: 200,
        nameLabel: 'VLAN 200 Network',
        nameDescription: 'VLAN 200 traffic',
      })

      expect(ref).toEqual(['OpaqueRef:vlan-pif200'])
      expect(mockCallWithSession).toHaveBeenCalledWith('network.create', [
        expect.objectContaining({
          name_label: 'VLAN 200 Network',
          MTU: 1500,
          tags: ['vlan:200'],
        }),
      ])
      expect(mockCallWithSession).toHaveBeenCalledWith('pool.create_VLAN_from_PIF', [
        'OpaqueRef:pif1',
        'OpaqueRef:new-net',
        200,
      ])
    })

    it('preserves created network for reconciliation when VLAN creation fails', async () => {
      const createError = new Error('INVALID_ARGUMENT')
      mockTopologyCalls({
        ...vlanTopology(),
        vlans: {},
        pifs: {
          'OpaqueRef:pif1': vlanTopology().pifs!['OpaqueRef:pif1'],
        },
      }, (method) => {
        if (method === 'network.create') return 'OpaqueRef:new-net'
        if (method === 'pool.create_VLAN_from_PIF') throw createError
        if (method === 'network.destroy') return null
        return undefined
      })

      const { createVlan } = await import('../../src/main/xapi/services/network.service')
      await expect(createVlan('conn-123', {
        taggedPifRef: 'OpaqueRef:pif1',
        vlanTag: 300,
        nameLabel: 'VLAN 300 Network',
      })).rejects.toMatchObject({ code: 'VLAN_CREATE_INCOMPLETE', details: { networkRef: 'OpaqueRef:new-net' } })

      expect(mockCallWithSession).not.toHaveBeenCalledWith('network.destroy', ['OpaqueRef:new-net'])
    })

    it('throws error for invalid VLAN tag', async () => {
      const { createVlan } = await import('../../src/main/xapi/services/network.service')
      await expect(createVlan('conn-123', {
        taggedPifRef: 'OpaqueRef:pif1',
        vlanTag: -1,
      })).rejects.toThrow('VLAN_TAG_INVALID')

      await expect(createVlan('conn-123', {
        taggedPifRef: 'OpaqueRef:pif1',
        vlanTag: 5000,
      })).rejects.toThrow('VLAN_TAG_INVALID')
    })

    it('allows VLAN tag 0 per XAPI range', async () => {
      mockTopologyCalls({
        ...vlanTopology(),
        vlans: {},
        pifs: {
          'OpaqueRef:pif1': vlanTopology().pifs!['OpaqueRef:pif1'],
        },
      }, (method) => method === 'pool.create_VLAN_from_PIF' ? ['OpaqueRef:vlan-pif0'] : undefined)

      const { createVlan } = await import('../../src/main/xapi/services/network.service')
      await expect(createVlan('conn-123', {
        taggedPifRef: 'OpaqueRef:pif1',
        vlanTag: 0,
        networkRef: 'OpaqueRef:net1',
      })).resolves.toEqual(['OpaqueRef:vlan-pif0'])
    })

    it('rejects duplicate VLAN tag on the same device before calling XAPI', async () => {
      mockTopologyCalls(vlanTopology())

      const { createVlan } = await import('../../src/main/xapi/services/network.service')
      await expect(createVlan('conn-123', {
        taggedPifRef: 'OpaqueRef:pif1',
        vlanTag: 100,
        networkRef: 'OpaqueRef:net1',
      })).rejects.toThrow('VLAN_TAG_IN_USE')
      expect(mockCallWithSession).not.toHaveBeenCalledWith('pool.create_VLAN_from_PIF', expect.anything())
    })
  })

  describe('destroyVlan', () => {
    it('calls VLAN.destroy', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)

      const { destroyVlan } = await import('../../src/main/xapi/services/network.service')
      await destroyVlan('conn-123', 'OpaqueRef:vlan1')

      expect(mockCallWithSession).toHaveBeenCalledWith('VLAN.destroy', ['OpaqueRef:vlan1'])
    })
  })

  // ============================================================================
  // Tunnel management
  // ============================================================================

  describe('getAllTunnels', () => {
    it('returns list of tunnels with connection metadata', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        'OpaqueRef:tunnel1': {
          uuid: 'uuid-tunnel1',
          access_PIF: 'OpaqueRef:pif1',
          transport_PIF: 'OpaqueRef:pif2',
        },
      })

      const { getAllTunnels } = await import('../../src/main/xapi/services/network.service')
      const tunnels = await getAllTunnels('conn-123')

      expect(tunnels).toHaveLength(1)
      expect(tunnels[0].access_PIF).toBe('OpaqueRef:pif1')
      expect(tunnels[0].connectionId).toBe('conn-123')
    })
  })

  describe('createTunnel', () => {
    it('calls tunnel.create with correct params', async () => {
      mockCallWithSession.mockResolvedValueOnce('OpaqueRef:new-tunnel')

      const { createTunnel } = await import('../../src/main/xapi/services/network.service')
      const ref = await createTunnel('conn-123', 'OpaqueRef:pif1', 'OpaqueRef:net1')

      expect(ref).toBe('OpaqueRef:new-tunnel')
      expect(mockCallWithSession).toHaveBeenCalledWith('tunnel.create', [
        'OpaqueRef:pif1',
        'OpaqueRef:net1',
      ])
    })
  })

  describe('destroyTunnel', () => {
    it('calls tunnel.destroy', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)

      const { destroyTunnel } = await import('../../src/main/xapi/services/network.service')
      await destroyTunnel('conn-123', 'OpaqueRef:tunnel1')

      expect(mockCallWithSession).toHaveBeenCalledWith('tunnel.destroy', ['OpaqueRef:tunnel1'])
    })
  })

  // ============================================================================
  // PIF IP reconfiguration
  // ============================================================================

  describe('reconfigurePifIp', () => {
    it('configures static IP', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)

      const { reconfigurePifIp } = await import('../../src/main/xapi/services/network.service')
      await reconfigurePifIp('conn-123', 'OpaqueRef:pif1', {
        mode: 'Static',
        ip: '192.168.1.100',
        netmask: '255.255.255.0',
        gateway: '192.168.1.1',
        dns: '8.8.8.8',
      })

      expect(mockCallWithSession).toHaveBeenCalledWith('PIF.reconfigure_ip', [
        'OpaqueRef:pif1',
        'Static',
        '192.168.1.100',
        '255.255.255.0',
        '192.168.1.1',
        '8.8.8.8',
      ])
    })

    it('configures DHCP', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)

      const { reconfigurePifIp } = await import('../../src/main/xapi/services/network.service')
      await reconfigurePifIp('conn-123', 'OpaqueRef:pif1', { mode: 'DHCP' })

      expect(mockCallWithSession).toHaveBeenCalledWith('PIF.reconfigure_ip', [
        'OpaqueRef:pif1', 'DHCP', '', '', '', '',
      ])
    })

    it('configures None mode', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)

      const { reconfigurePifIp } = await import('../../src/main/xapi/services/network.service')
      await reconfigurePifIp('conn-123', 'OpaqueRef:pif1', { mode: 'None' })

      expect(mockCallWithSession).toHaveBeenCalledWith('PIF.reconfigure_ip', [
        'OpaqueRef:pif1', 'None', '', '', '', '',
      ])
    })

    it('throws error when static IP missing required fields', async () => {
      const { reconfigurePifIp } = await import('../../src/main/xapi/services/network.service')
      await expect(reconfigurePifIp('conn-123', 'OpaqueRef:pif1', {
        mode: 'Static',
        ip: '',
        netmask: '255.255.255.0',
      })).rejects.toThrow('PIF_IP_CONFIG_INVALID')
    })
  })

  describe('scanPifs', () => {
    it('calls PIF.scan for host', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)

      const { scanPifs } = await import('../../src/main/xapi/services/network.service')
      await scanPifs('conn-123', 'OpaqueRef:host1')

      expect(mockCallWithSession).toHaveBeenCalledWith('PIF.scan', ['OpaqueRef:host1'])
    })
  })

  describe('getPifsForHost', () => {
    it('filters PIFs by host ref', async () => {
      mockTopologyCalls({
        networks: {
          'OpaqueRef:net1': { uuid: 'net1', name_label: 'eth0', PIFs: ['OpaqueRef:pif1'], VIFs: [], MTU: 1500 },
          'OpaqueRef:net2': { uuid: 'net2', name_label: 'eth1', PIFs: ['OpaqueRef:pif2'], VIFs: [], MTU: 1500 },
          'OpaqueRef:net3': { uuid: 'net3', name_label: 'eth2', PIFs: ['OpaqueRef:pif3'], VIFs: [], MTU: 9000 },
        },
        pifs: {
          'OpaqueRef:pif1': { device: 'eth0', host: 'OpaqueRef:host1', network: 'OpaqueRef:net1', IP: '10.0.0.1', MAC: 'AA:BB:CC:DD:EE:FF', MTU: 1500, VLAN: -1, physical: true, uuid: 'u1', currently_attached: true, ip_configuration_mode: 'DHCP', management: false },
          'OpaqueRef:pif2': { device: 'eth1', host: 'OpaqueRef:host2', network: 'OpaqueRef:net2', IP: '10.0.0.2', MAC: '11:22:33:44:55:66', MTU: 1500, VLAN: -1, physical: true, uuid: 'u2', currently_attached: true, ip_configuration_mode: 'DHCP', management: false },
          'OpaqueRef:pif3': { device: 'eth2', host: 'OpaqueRef:host1', network: 'OpaqueRef:net3', IP: '10.0.0.3', MAC: 'AA:BB:CC:DD:EE:00', MTU: 9000, VLAN: -1, physical: true, uuid: 'u3', currently_attached: true, ip_configuration_mode: 'Static', management: false },
        },
      })

      const { getPifsForHost } = await import('../../src/main/xapi/services/network.service')
      const pifs = await getPifsForHost('conn-123', 'OpaqueRef:host1')

      expect(pifs).toHaveLength(2)
      expect(pifs.every(p => p.host === 'OpaqueRef:host1')).toBe(true)
    })
  })

  // ============================================================================
  // VIF QoS
  // ============================================================================

  describe('setVifQos', () => {
    it('sets QoS algorithm type and params', async () => {
      mockCallWithSession
        .mockResolvedValueOnce(null) // VIF.set_qos_algorithm_type
        .mockResolvedValueOnce(null) // VIF.add_to_qos_algorithm_params (kbits)

      const { setVifQos } = await import('../../src/main/xapi/services/network.service')
      await setVifQos('conn-123', 'OpaqueRef:vif1', {
        algorithmType: 'ratelimit',
        algorithmParams: { kbits: '100000' },
      })

      expect(mockCallWithSession).toHaveBeenCalledWith('VIF.set_qos_algorithm_type', [
        'OpaqueRef:vif1', 'ratelimit',
      ])
      expect(mockCallWithSession).toHaveBeenCalledWith('VIF.add_to_qos_algorithm_params', [
        'OpaqueRef:vif1', 'kbits', '100000',
      ])
    })
  })

  describe('clearVifQos', () => {
    it('resets QoS algorithm type to empty', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)

      const { clearVifQos } = await import('../../src/main/xapi/services/network.service')
      await clearVifQos('conn-123', 'OpaqueRef:vif1')

      expect(mockCallWithSession).toHaveBeenCalledWith('VIF.set_qos_algorithm_type', [
        'OpaqueRef:vif1', '',
      ])
    })
  })

  // ============================================================================
  // Network tags and other_config
  // ============================================================================

  describe('getNetworkAllowedOperations', () => {
    it('returns allowed operations from network record', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        allowed_operations: ['destroy', 'add_to_tags'],
      })

      const { getNetworkAllowedOperations } = await import('../../src/main/xapi/services/network.service')
      const ops = await getNetworkAllowedOperations('conn-123', 'OpaqueRef:net1')

      expect(ops).toContain('destroy')
      expect(ops).toContain('add_to_tags')
    })

    it('returns empty array when no operations', async () => {
      mockCallWithSession.mockResolvedValueOnce({})

      const { getNetworkAllowedOperations } = await import('../../src/main/xapi/services/network.service')
      const ops = await getNetworkAllowedOperations('conn-123', 'OpaqueRef:net1')

      expect(ops).toEqual([])
    })
  })

  describe('addNetworkTag', () => {
    it('calls network.add_to_tags', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)

      const { addNetworkTag } = await import('../../src/main/xapi/services/network.service')
      await addNetworkTag('conn-123', 'OpaqueRef:net1', 'production')

      expect(mockCallWithSession).toHaveBeenCalledWith('network.add_to_tags', [
        'OpaqueRef:net1', 'production',
      ])
    })
  })

  describe('removeNetworkTag', () => {
    it('calls network.remove_from_tags', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)

      const { removeNetworkTag } = await import('../../src/main/xapi/services/network.service')
      await removeNetworkTag('conn-123', 'OpaqueRef:net1', 'production')

      expect(mockCallWithSession).toHaveBeenCalledWith('network.remove_from_tags', [
        'OpaqueRef:net1', 'production',
      ])
    })
  })

  describe('updateNetworkOtherConfig', () => {
    it('calls network.add_to_other_config', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)

      const { updateNetworkOtherConfig } = await import('../../src/main/xapi/services/network.service')
      await updateNetworkOtherConfig('conn-123', 'OpaqueRef:net1', 'vswitch', 'ovs')

      expect(mockCallWithSession).toHaveBeenCalledWith('network.add_to_other_config', [
        'OpaqueRef:net1', 'vswitch', 'ovs',
      ])
    })
  })
})

describe('pool-wide network mutation safety', () => {
  beforeEach(() => {
    mockCallWithSession.mockReset()
    mockGetClient.mockReturnValue({ callWithSession: mockCallWithSession })
  })
  it('uses lowercase ha_enabled to block management changes under HA', async () => {
    const fixture = vlanTopology()
    fixture.pifs!['OpaqueRef:pif1'].management = true
    fixture.pools!['OpaqueRef:pool1'].ha_enabled = true
    mockTopologyCalls(fixture)
    const { createVlan } = await import('../../src/main/xapi/services/network.service')
    await expect(createVlan('c', { taggedPifRef: 'OpaqueRef:pif1', vlanTag: 200, networkRef: 'OpaqueRef:net1', confirmManagementDisruption: true })).rejects.toThrow('NETWORK_MANAGEMENT_HA_BLOCKED')
    expect(mockCallWithSession).not.toHaveBeenCalledWith('pool.create_VLAN_from_PIF', expect.anything())
  })
  it('checks a management PIF on another host before a pool-wide VLAN create', async () => {
    const fixture = vlanTopology()
    fixture.pifs!['OpaqueRef:remote'] = { ...fixture.pifs!['OpaqueRef:pif1'], host: 'OpaqueRef:host2', management: true }
    mockTopologyCalls(fixture)
    const { createVlan } = await import('../../src/main/xapi/services/network.service')
    await expect(createVlan('c', { taggedPifRef: 'OpaqueRef:pif1', vlanTag: 200, networkRef: 'OpaqueRef:net1' })).rejects.toThrow('NETWORK_MANAGEMENT_CONFIRMATION_REQUIRED')
  })
  it('blocks a VLAN if a pool host lacks the corresponding device', async () => {
    mockTopologyCalls({ ...vlanTopology(), hosts: ['OpaqueRef:host1', 'OpaqueRef:host2'] })
    const { createVlan } = await import('../../src/main/xapi/services/network.service')
    await expect(createVlan('c', { taggedPifRef: 'OpaqueRef:pif1', vlanTag: 200, networkRef: 'OpaqueRef:net1' })).rejects.toThrow('VLAN_PIFS_NOT_PRESENT_ON_ALL_HOSTS')
  })
  it('blocks bonding if a pool host has no corresponding candidate PIFs', async () => {
    mockTopologyCalls({ ...bondTopology(), hosts: ['OpaqueRef:host1', 'OpaqueRef:host2'] })
    const { createBond } = await import('../../src/main/xapi/services/network.service')
    await expect(createBond('c', { pifRefs: ['OpaqueRef:pif-h1-eth0', 'OpaqueRef:pif-h1-eth1'] })).rejects.toThrow('BOND_PIFS_NOT_PRESENT_ON_ALL_HOSTS')
  })
  it('does not hide authentication errors in optional topology inventories', async () => {
    mockTopologyCalls(vlanTopology(), (method) => { if (method === 'Cluster_host.get_all_records') throw new Error('SESSION_INVALID') })
    const { getAllNetworks } = await import('../../src/main/xapi/services/network.service')
    await expect(getAllNetworks('c')).rejects.toThrow('SESSION_INVALID')
  })
  it('treats only MESSAGE_METHOD_UNKNOWN as unsupported and keeps mutations guarded', async () => {
    mockTopologyCalls(vlanTopology(), (method) => { if (method === 'Cluster_host.get_all_records') throw Object.assign(new Error('MESSAGE_METHOD_UNKNOWN'), { code: 'MESSAGE_METHOD_UNKNOWN' }) })
    const { getAllNetworks, createVlan } = await import('../../src/main/xapi/services/network.service')
    expect(await getAllNetworks('c')).toHaveLength(2)
    await expect(createVlan('c', { taggedPifRef: 'OpaqueRef:pif1', vlanTag: 200 })).rejects.toThrow('NETWORK_CLUSTER_STATUS_UNKNOWN')
  })
  it('does not destroy confirmed networking after a later create loses its response', async () => {
    const fixture = bondTopology()
    // Include only available physical PIFs for this creation scenario.
    fixture.pifs = Object.fromEntries(Object.entries(fixture.pifs!).filter(([ref]) => ref.startsWith('OpaqueRef:pif-h1')))
    for (const [ref, pif] of Object.entries({ ...fixture.pifs })) fixture.pifs[ref.replace('h1', 'h2')] = { ...pif, host: 'OpaqueRef:host2' }
    let creations = 0
    mockTopologyCalls(fixture, (method) => {
      if (method === 'network.create') return 'OpaqueRef:new-network'
      if (method === 'Bond.create') { if (++creations === 1) return 'OpaqueRef:first-bond'; throw new Error('ETIMEDOUT') }
    })
    const { createBond } = await import('../../src/main/xapi/services/network.service')
    await expect(createBond('c', { pifRefs: ['OpaqueRef:pif-h1-eth0', 'OpaqueRef:pif-h1-eth1'] })).rejects.toMatchObject({ code: 'BOND_CREATE_INCOMPLETE', details: { networkRef: 'OpaqueRef:new-network', createdBondRefs: ['OpaqueRef:first-bond'] } })
    expect(mockCallWithSession.mock.calls.some(([method]) => method === 'Bond.destroy' || method === 'network.destroy')).toBe(false)
  })
})
