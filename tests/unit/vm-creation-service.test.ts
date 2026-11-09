import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCallWithSession = vi.fn()
const mockGetClient = vi.fn(() => ({ callWithSession: mockCallWithSession }))

const resourceRecords: Record<string, Record<string, any>> = {
  'host.get_all_records': {
    'OpaqueRef:host-a': { name_label: 'Host A', enabled: true, metrics: 'OpaqueRef:hm-a' },
    'OpaqueRef:host-b': { name_label: 'Host B', enabled: true, metrics: 'OpaqueRef:hm-b' },
    'OpaqueRef:host-off': { name_label: 'Disabled', enabled: false, metrics: 'OpaqueRef:hm-off' },
  },
  'host_metrics.get_all_records': {
    'OpaqueRef:hm-a': { memory_free: '8192', live: true },
    'OpaqueRef:hm-b': { memory_free: '4096', live: true },
    'OpaqueRef:hm-off': { memory_free: '9999' },
  },
  'host_cpu.get_all_records': {
    'OpaqueRef:cpu-a-0': { host: 'OpaqueRef:host-a' },
    'OpaqueRef:cpu-a-1': { host: 'OpaqueRef:host-a' },
    'OpaqueRef:cpu-b-0': { host: 'OpaqueRef:host-b' },
  },
  'SR.get_all_records': {
    'OpaqueRef:local-sr': { name_label: 'Local', type: 'lvm', shared: false, physical_size: '1000', physical_utilisation: '250' },
    'OpaqueRef:shared-sr': { name_label: 'Shared', type: 'nfs', shared: true, physical_size: '2000', physical_utilisation: '500' },
    'OpaqueRef:detached-sr': { name_label: 'Detached', type: 'lvm', shared: false, physical_size: '1000', physical_utilisation: '0' },
    'OpaqueRef:iso-sr': { name_label: 'ISO', type: 'iso', content_type: 'iso', shared: false, physical_size: '100', physical_utilisation: '10' },
  },
  'PBD.get_all_records': {
    'OpaqueRef:pbd-local': { SR: 'OpaqueRef:local-sr', host: 'OpaqueRef:host-a', currently_attached: true },
    'OpaqueRef:pbd-shared-a': { SR: 'OpaqueRef:shared-sr', host: 'OpaqueRef:host-a', currently_attached: true },
    'OpaqueRef:pbd-shared-b': { SR: 'OpaqueRef:shared-sr', host: 'OpaqueRef:host-b', currently_attached: true },
    'OpaqueRef:pbd-detached': { SR: 'OpaqueRef:detached-sr', host: 'OpaqueRef:host-b', currently_attached: false },
    'OpaqueRef:pbd-iso': { SR: 'OpaqueRef:iso-sr', host: 'OpaqueRef:host-a', currently_attached: true },
  },
  'VDI.get_all_records': {
    'OpaqueRef:iso': { name_label: 'ubuntu.iso', SR: 'OpaqueRef:iso-sr', type: 'user', read_only: true },
    'OpaqueRef:data': { name_label: 'disk', SR: 'OpaqueRef:local-sr', type: 'user', read_only: false, virtual_size: '100' },
    'OpaqueRef:large-data': { name_label: 'large disk', SR: 'OpaqueRef:local-sr', type: 'user', read_only: false, virtual_size: '800' },
  },
  'VBD.get_all_records': {
    'OpaqueRef:template-vbd': { VM: 'OpaqueRef:template', VDI: 'OpaqueRef:data', type: 'Disk' },
  },
  'network.get_all_records': {
    'OpaqueRef:network-a': { name_label: 'Guest A', managed: true, other_config: {}, PIFs: ['OpaqueRef:pif-a'] },
    'OpaqueRef:internal': { name_label: 'Internal', managed: true, other_config: { automatic: 'false' }, PIFs: [] },
    'OpaqueRef:hidden': { name_label: 'Installer', managed: true, other_config: { is_guest_installer_network: 'true' }, PIFs: [] },
  },
  'PIF.get_all_records': {
    'OpaqueRef:pif-a': { host: 'OpaqueRef:host-a', network: 'OpaqueRef:network-a', currently_attached: true },
  },
}

vi.mock('../../src/main/xapi/connection-manager', () => ({
  connectionManager: { getClient: mockGetClient },
}))

describe('vm-creation.service resources', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetClient.mockReturnValue({ callWithSession: mockCallWithSession })
    mockCallWithSession.mockImplementation(async (method: string) => {
      return resourceRecords[method]
    })
  })

  it('normalizes only attached resources with exact compatible host membership', async () => {
    const { getVmCreationResources } = await import('../../src/main/xapi/services/vm-creation.service')

    const result = await getVmCreationResources('conn')

    expect(result.hosts).toEqual([
      { ref: 'OpaqueRef:host-a', name: 'Host A', enabled: true, memoryFree: 8192, cpuCount: 2 },
      { ref: 'OpaqueRef:host-b', name: 'Host B', enabled: true, memoryFree: 4096, cpuCount: 1 },
    ])
    expect(result.srs).toEqual([
      expect.objectContaining({ ref: 'OpaqueRef:local-sr', freeBytes: 750, hostRefs: ['OpaqueRef:host-a'] }),
      expect.objectContaining({ ref: 'OpaqueRef:shared-sr', freeBytes: 1500, hostRefs: ['OpaqueRef:host-a', 'OpaqueRef:host-b'] }),
    ])
    expect(result.srs.map((sr) => sr.ref)).not.toContain('OpaqueRef:detached-sr')
    expect(result.networks).toEqual([
      expect.objectContaining({ ref: 'OpaqueRef:network-a', hostRefs: ['OpaqueRef:host-a'], autoPlug: true }),
      expect.objectContaining({ ref: 'OpaqueRef:internal', hostRefs: ['OpaqueRef:host-a', 'OpaqueRef:host-b'], autoPlug: false }),
    ])
    expect(result.networks.map((network) => network.ref)).not.toContain('OpaqueRef:hidden')
    expect(result.isos).toEqual([
      { ref: 'OpaqueRef:iso', name: 'ubuntu.iso', srRef: 'OpaqueRef:iso-sr', hostRefs: ['OpaqueRef:host-a'] },
    ])
  })

  it('rejects an unknown connection before loading records', async () => {
    mockGetClient.mockReturnValueOnce(undefined as any)
    const { getVmCreationResources } = await import('../../src/main/xapi/services/vm-creation.service')

    await expect(getVmCreationResources('missing')).rejects.toThrow('No connection found')
  })

})
