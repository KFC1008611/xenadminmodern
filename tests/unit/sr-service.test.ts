/**
 * Unit tests for sr.service — verifies XAPI SR.*, VDI.*, PBD.* calls.
 * v5: Renamed from storage-service.test.ts and extended with SR management tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCallWithSession = vi.fn()
const mockClient = { callWithSession: mockCallWithSession }
const mockGetClient = vi.fn(() => mockClient)

vi.mock('../../src/main/xapi/connection-manager', () => ({
  connectionManager: {
    getClient: mockGetClient,
    getConnectionInfo: vi.fn(() => ({ poolName: 'Test Pool' })),
  },
}))

describe('sr.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCallWithSession.mockReset()
  })

  // ============================================================================
  // v4: Existing methods
  // ============================================================================

  describe('getAllSrs', () => {
    it('shows ISO repositories and filters internal udev types and includes connection metadata', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        'OpaqueRef:sr1': { name_label: 'Local storage', type: 'ext', physical_size: 100, physical_utilisation: 50, VDIs: [], shared: false },
        'OpaqueRef:sr2': { name_label: 'udev SR', type: 'udev', physical_size: 0, physical_utilisation: 0, VDIs: [], shared: false },
        'OpaqueRef:sr3': { name_label: 'ISO library', type: 'iso', physical_size: 0, physical_utilisation: 0, VDIs: [], shared: true },
      })

      const { getAllSrs } = await import('../../src/main/xapi/services/sr.service')
      const srs = await getAllSrs('conn-123')

      expect(srs).toHaveLength(2)
      expect(srs[0].name_label).toBe('Local storage')
      expect(srs[0].connectionId).toBe('conn-123')
      expect(srs[0].poolName).toBe('Test Pool')
    })

    it('throws when connectionId is invalid', async () => {
      mockGetClient.mockReturnValueOnce(undefined)

      const { getAllSrs } = await import('../../src/main/xapi/services/sr.service')
      await expect(getAllSrs('invalid-id')).rejects.toThrow('No connection found for connectionId: invalid-id')
    })

    it('normalizes XAPI string capacities before the IPC contract', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        'OpaqueRef:sr1': {
          uuid: 'sr-uuid', name_label: 'Storage', type: 'nfs',
          physical_size: '1000', physical_utilisation: '400', virtual_allocation: '600',
          VDIs: [], shared: true,
        },
      })

      const { getAllSrs } = await import('../../src/main/xapi/services/sr.service')
      const [sr] = await getAllSrs('conn-123')
      expect(sr).toMatchObject({ physical_size: 1000, physical_utilisation: 400, virtual_allocation: 600 })
    })

    it('keeps an unmeasured ISO SR without rejecting the whole pool or inventing free space', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        'OpaqueRef:disk': { uuid: 'disk', name_label: 'Local', type: 'ext', physical_size: '1000', physical_utilisation: '200', virtual_allocation: '300', VDIs: [], shared: false },
        'OpaqueRef:iso': { uuid: 'iso', name_label: 'ISO', type: 'iso', physical_size: '-1', physical_utilisation: '-1', virtual_allocation: '-1', VDIs: [], shared: true },
      })
      const { getAllSrs } = await import('../../src/main/xapi/services/sr.service')
      const { srListContract } = await import('../../src/shared/ipc-contracts/storage')
      const { srFreeBytes, summarizeSrCapacity } = await import('../../src/shared/storage-capacity')
      const records = srListContract.resultSchema.parse(await getAllSrs('conn-123'))
      expect(records).toHaveLength(2)
      expect(srFreeBytes(records[1])).toBeNull()
      expect(summarizeSrCapacity(records)).toEqual({ total: 1000, used: 200 })
      expect(summarizeSrCapacity([{ ...records[1], type: 'nfs' }])).toEqual({ total: null, used: null })
    })
  })

  describe('getAllVdis', () => {
    it('returns VDIs with connection metadata', async () => {
      mockCallWithSession
        .mockResolvedValueOnce(['OpaqueRef:vdi1'])
        .mockResolvedValueOnce({
          uuid: 'uuid-vdi1',
          name_label: 'Test VDI',
          virtual_size: '10737418240',
          physical_utilisation: '5368709120',
          type: 'user',
          SR: 'OpaqueRef:sr1',
          VBDs: [],
          read_only: false,
        })

      const { getAllVdis } = await import('../../src/main/xapi/services/sr.service')
      const vdis = await getAllVdis('conn-123', 'OpaqueRef:sr1')

      expect(vdis).toHaveLength(1)
      expect(vdis[0].name_label).toBe('Test VDI')
      expect(vdis[0].virtual_size).toBe(10737418240)
      expect(vdis[0].physical_utilisation).toBe(5368709120)
      expect(vdis[0].connectionId).toBe('conn-123')
    })
  })

  describe('createVdi', () => {
    it('calls VDI.create with correct params', async () => {
      mockCallWithSession.mockResolvedValueOnce('OpaqueRef:new-vdi')
      const { createVdi } = await import('../../src/main/xapi/services/sr.service')
      const ref = await createVdi('conn-123', 'OpaqueRef:sr1', 'my-disk', 10737418240)

      expect(ref).toBe('OpaqueRef:new-vdi')
      expect(mockCallWithSession).toHaveBeenCalledWith('VDI.create', [
        expect.objectContaining({
          name_label: 'my-disk',
          SR: 'OpaqueRef:sr1',
          virtual_size: '10737418240',
          type: 'user',
        }),
      ])
    })
  })

  describe('destroyVdi', () => {
    it('deletes an unattached VDI when XAPI allows destroy', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ VBDs: [], type: 'user', allowed_operations: ['destroy'] })
        .mockResolvedValueOnce(null)
      const { destroyVdi } = await import('../../src/main/xapi/services/sr.service')
      await expect(destroyVdi('conn-123', 'OpaqueRef:vdi1'))
        .resolves.toEqual({ vdiDeleted: true })
      expect(mockCallWithSession).toHaveBeenCalledWith('VDI.destroy', ['OpaqueRef:vdi1'])
    })

    it('deletes an exclusive halted VM disk after removing its VBD', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ VBDs: ['OpaqueRef:vbd1'], type: 'user' })
        .mockResolvedValueOnce({ VDI: 'OpaqueRef:vdi1', VM: 'OpaqueRef:vm1', type: 'Disk', mode: 'RW', other_config: { owner: 'true' }, currently_attached: false })
        .mockResolvedValueOnce({ power_state: 'Halted' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ VBDs: [], type: 'user', allowed_operations: ['destroy'] })
        .mockResolvedValueOnce(null)
      const { destroyVdi } = await import('../../src/main/xapi/services/sr.service')
      await expect(destroyVdi('conn-123', 'OpaqueRef:vdi1'))
        .resolves.toEqual({ vdiDeleted: true, detachedVbdRef: 'OpaqueRef:vbd1' })
      const methods = mockCallWithSession.mock.calls.map((call) => call[0])
      expect(methods.indexOf('VBD.destroy')).toBeLessThan(methods.indexOf('VDI.destroy'))
    })

    it('reports a detached VBD when the VDI cannot be destroyed', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ VBDs: ['OpaqueRef:vbd1'], type: 'user' })
        .mockResolvedValueOnce({ VDI: 'OpaqueRef:vdi1', VM: 'OpaqueRef:vm1', type: 'Disk', mode: 'RW', other_config: { owner: 'true' }, currently_attached: false })
        .mockResolvedValueOnce({ power_state: 'Halted' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ VBDs: [], type: 'user', allowed_operations: [] })
      const { destroyVdi } = await import('../../src/main/xapi/services/sr.service')
      await expect(destroyVdi('conn-123', 'OpaqueRef:vdi1'))
        .resolves.toMatchObject({ vdiDeleted: false, detachedVbdRef: 'OpaqueRef:vbd1' })
      expect(mockCallWithSession).not.toHaveBeenCalledWith('VDI.destroy', ['OpaqueRef:vdi1'])
    })
  })

  // ============================================================================
  // v5: New SR management methods
  // ============================================================================

  describe('createSr', () => {
    it('creates EXT SR with correct params', async () => {
      mockCallWithSession
        .mockResolvedValueOnce(['ext', 'nfs', 'lvmoiscsi', 'lvmohba']) // SR.get_supported_types
        .mockResolvedValueOnce({ enabled: true }) // host.get_record
        .mockResolvedValueOnce('OpaqueRef:new-sr') // SR.create
        .mockResolvedValueOnce({ PBDs: ['OpaqueRef:pbd'] })
        .mockResolvedValueOnce({ SR: 'OpaqueRef:new-sr', host: 'OpaqueRef:host1', currently_attached: true })
        .mockResolvedValueOnce(null) // SR.scan

      const { createSr } = await import('../../src/main/xapi/services/sr.service')
      const ref = await createSr('conn-123', 'OpaqueRef:host1', {
        type: 'ext',
        nameLabel: 'Local EXT',
        nameDescription: 'Local storage',
      })

      expect(ref).toBe('OpaqueRef:new-sr')
      expect(mockCallWithSession).toHaveBeenCalledWith('SR.create', [
        'OpaqueRef:host1',
        {},
        '0',
        'Local EXT',
        'Local storage',
        'ext',
        '',
        false,
        {},
      ])
    })

    it('creates NFS SR with server and path', async () => {
      mockCallWithSession
        .mockResolvedValueOnce(['ext', 'nfs', 'lvmoiscsi', 'lvmohba']) // SR.get_supported_types
        .mockResolvedValueOnce({ enabled: true }) // host.get_record
        .mockResolvedValueOnce('OpaqueRef:nfs-sr') // SR.create
        .mockResolvedValueOnce({ PBDs: ['OpaqueRef:pbd'] })
        .mockResolvedValueOnce({ SR: 'OpaqueRef:nfs-sr', host: 'OpaqueRef:host1', currently_attached: true })
        .mockResolvedValueOnce(null) // SR.scan

      const { createSr } = await import('../../src/main/xapi/services/sr.service')
      const ref = await createSr('conn-123', 'OpaqueRef:host1', {
        type: 'nfs',
        nameLabel: 'NFS Storage',
        nameDescription: 'NFS share',
        nfsServer: '192.168.1.100',
        nfsPath: '/export/storage',
      })

      expect(ref).toBe('OpaqueRef:nfs-sr')
      expect(mockCallWithSession).toHaveBeenCalledWith('SR.create', [
        'OpaqueRef:host1',
        { server: '192.168.1.100', serverpath: '/export/storage' },
        '0',
        'NFS Storage',
        'NFS share',
        'nfs',
        '',
        true, // shared because in pool
        {},
      ])
    })

    it('creates iSCSI SR with target and CHAP credentials', async () => {
      mockCallWithSession
        .mockResolvedValueOnce(['ext', 'nfs', 'lvmoiscsi', 'lvmohba']) // SR.get_supported_types
        .mockResolvedValueOnce({ enabled: true }) // host.get_record
        .mockResolvedValueOnce('<SRlist/>') // selected LUN has no existing SR
        .mockResolvedValueOnce('OpaqueRef:iscsi-sr') // SR.create
        .mockResolvedValueOnce({ PBDs: ['OpaqueRef:pbd'] })
        .mockResolvedValueOnce({ SR: 'OpaqueRef:iscsi-sr', host: 'OpaqueRef:host1', currently_attached: true })
        .mockResolvedValueOnce(null) // SR.scan

      const { createSr } = await import('../../src/main/xapi/services/sr.service')
      const ref = await createSr('conn-123', 'OpaqueRef:host1', {
        type: 'iscsi',
        nameLabel: 'iSCSI Storage',
        nameDescription: 'iSCSI LUN',
        iscsiTarget: '192.168.1.200',
        iscsiIqn: 'iqn.2000-01.com.test:storage',
        iscsiLun: '3600c0ff0001234567890abcdef',
        chapUser: 'admin',
        chapPassword: 'secret123',
      })

      expect(ref).toBe('OpaqueRef:iscsi-sr')
      expect(mockCallWithSession).toHaveBeenCalledWith('SR.create', [
        'OpaqueRef:host1',
        {
          target: '192.168.1.200',
          targetIQN: 'iqn.2000-01.com.test:storage',
          SCSIid: '3600c0ff0001234567890abcdef',
          chapuser: 'admin',
          chappassword: 'secret123',
        },
        '0',
        'iSCSI Storage',
        'iSCSI LUN',
        'lvmoiscsi',
        '',
        true,
        {},
      ])
    })

    it('throws when backend SR type is not supported by host', async () => {
      mockCallWithSession.mockResolvedValueOnce(['ext', 'nfs']) // SR.get_supported_types

      const { createSr } = await import('../../src/main/xapi/services/sr.service')
      await expect(createSr('conn-123', 'OpaqueRef:host1', {
        type: 'iscsi',
        nameLabel: 'iSCSI Storage',
        nameDescription: 'iSCSI LUN',
        iscsiTarget: '192.168.1.200', iscsiIqn: 'iqn.example', iscsiLun: '3600abc',
      })).rejects.toThrow("SR type 'lvmoiscsi' is not supported on this host")
    })

    it('throws error for NFS without server/path', async () => {
      const { createSr } = await import('../../src/main/xapi/services/sr.service')
      await expect(createSr('conn-123', 'OpaqueRef:host1', {
        type: 'nfs',
        nameLabel: 'NFS',
        nameDescription: '',
      })).rejects.toThrow('NFS server and path are required')
    })

    it('throws error for unsupported SR type', async () => {
      const { createSr } = await import('../../src/main/xapi/services/sr.service')
      await expect(createSr('conn-123', 'OpaqueRef:host1', {
        type: 'unsupported' as any,
        nameLabel: 'Test',
        nameDescription: '',
      })).rejects.toThrow('Unsupported SR type')
    })
  })

  describe('destroySr', () => {
    it('calls SR.destroy', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)
      const { destroySr } = await import('../../src/main/xapi/services/sr.service')
      await destroySr('conn-123', 'OpaqueRef:sr1')
      expect(mockCallWithSession).toHaveBeenCalledWith('SR.destroy', ['OpaqueRef:sr1'])
    })
  })

  describe('scanSr', () => {
    it('calls SR.scan', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)
      const { scanSr } = await import('../../src/main/xapi/services/sr.service')
      await scanSr('conn-123', 'OpaqueRef:sr1')
      expect(mockCallWithSession).toHaveBeenCalledWith('SR.scan', ['OpaqueRef:sr1'])
    })
  })

  describe('detachSr', () => {
    it('unplugs PBDs and forgets SR', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ PBDs: ['OpaqueRef:pbd1', 'OpaqueRef:pbd2'] }) // SR.get_record
        .mockResolvedValueOnce(null) // PBD.unplug 1
        .mockResolvedValueOnce(null) // PBD.unplug 2
        .mockResolvedValueOnce(null) // SR.forget

      const { detachSr } = await import('../../src/main/xapi/services/sr.service')
      await detachSr('conn-123', 'OpaqueRef:sr1')

      expect(mockCallWithSession).toHaveBeenCalledWith('SR.get_record', ['OpaqueRef:sr1'])
      expect(mockCallWithSession).toHaveBeenCalledWith('PBD.unplug', ['OpaqueRef:pbd1'])
      expect(mockCallWithSession).toHaveBeenCalledWith('PBD.unplug', ['OpaqueRef:pbd2'])
      expect(mockCallWithSession).toHaveBeenCalledWith('SR.forget', ['OpaqueRef:sr1'])
    })

    it('ignores DEVICE_ALREADY_DETACHED error', async () => {
      const error = new Error('DEVICE_ALREADY_DETACHED')
      ;(error as any).faultString = 'DEVICE_ALREADY_DETACHED'
      mockCallWithSession
        .mockResolvedValueOnce({ PBDs: ['OpaqueRef:pbd1'] }) // SR.get_record
        .mockRejectedValueOnce(error) // PBD.unplug fails
        .mockResolvedValueOnce(null) // SR.forget

      const { detachSr } = await import('../../src/main/xapi/services/sr.service')
      await expect(detachSr('conn-123', 'OpaqueRef:sr1')).resolves.not.toThrow()
    })
  })

  describe('setDefaultSr', () => {
    it('sets and reads back the default SR', async () => {
      mockCallWithSession.mockResolvedValueOnce({ type: 'nfs' }).mockResolvedValueOnce(null).mockResolvedValueOnce('OpaqueRef:sr1')
      const { setDefaultSr } = await import('../../src/main/xapi/services/sr.service')
      await setDefaultSr('conn-123', 'OpaqueRef:pool1', 'OpaqueRef:sr1')
      expect(mockCallWithSession).toHaveBeenCalledWith('pool.set_default_SR', ['OpaqueRef:pool1', 'OpaqueRef:sr1'])
    })

    it('rejects ISO defaults before mutation and reports a readback mismatch without retrying', async () => {
      mockCallWithSession.mockResolvedValueOnce({ type: 'iso' })
      const { setDefaultSr } = await import('../../src/main/xapi/services/sr.service')
      await expect(setDefaultSr('conn-123', 'OpaqueRef:pool1', 'OpaqueRef:sr1')).rejects.toThrow('ISO 库')
      expect(mockCallWithSession).not.toHaveBeenCalledWith('pool.set_default_SR', expect.anything())
      mockCallWithSession.mockResolvedValueOnce({ type: 'nfs' }).mockResolvedValueOnce(null).mockResolvedValueOnce('OpaqueRef:other')
      await expect(setDefaultSr('conn-123', 'OpaqueRef:pool1', 'OpaqueRef:sr1')).rejects.toMatchObject({ code: 'SR_DEFAULT_UNCONFIRMED' })
      expect(mockCallWithSession.mock.calls.filter(([method]) => method === 'pool.set_default_SR')).toHaveLength(1)
    })
  })

  describe('probeNfs', () => {
    it('parses NFS probe XML result', async () => {
      const xmlResponse = `<?xml version="1.0"?>
<SRlist>
  <SR>
    <server>192.168.1.100</server>
    <serverpath>/export/data1</serverpath>
  </SR>
  <SR>
    <server>192.168.1.100</server>
    <serverpath>/export/data2</serverpath>
  </SR>
</SRlist>`
      mockCallWithSession.mockResolvedValueOnce(xmlResponse)

      const { probeNfs } = await import('../../src/main/xapi/services/sr.service')
      const targets = await probeNfs('conn-123', 'OpaqueRef:host1', '192.168.1.100')

      expect(targets).toHaveLength(2)
      expect(targets[0]).toEqual({ server: '192.168.1.100', path: '/export/data1' })
      expect(targets[1]).toEqual({ server: '192.168.1.100', path: '/export/data2' })
      expect(mockCallWithSession).toHaveBeenCalledWith('SR.probe', [
        'OpaqueRef:host1',
        { server: '192.168.1.100' },
        'nfs',
        {},
      ])
    })

    it('returns empty array when no exports found', async () => {
      mockCallWithSession.mockResolvedValueOnce('<?xml version="1.0"?><SRlist></SRlist>')

      const { probeNfs } = await import('../../src/main/xapi/services/sr.service')
      const targets = await probeNfs('conn-123', 'OpaqueRef:host1', '192.168.1.100')

      expect(targets).toHaveLength(0)
    })
  })

  describe('probeIscsi', () => {
    it('parses iSCSI probe XML result', async () => {
      const xmlResponse = `<?xml version="1.0"?>
<SRlist>
  <SR>
    <targetIQN>iqn.2000-01.com.test:storage1</targetIQN>
    <address>192.168.1.200</address>
    <port>3260</port>
  </SR>
  <SR>
    <targetIQN>iqn.2000-01.com.test:storage2</targetIQN>
    <address>192.168.1.200</address>
    <port>3260</port>
  </SR>
</SRlist>`
      mockCallWithSession.mockResolvedValueOnce(xmlResponse)

      const { probeIscsi } = await import('../../src/main/xapi/services/sr.service')
      const targets = await probeIscsi('conn-123', 'OpaqueRef:host1', '192.168.1.200')

      expect(targets).toHaveLength(2)
      expect(targets[0]).toEqual({
        iqn: 'iqn.2000-01.com.test:storage1',
        address: '192.168.1.200',
        port: 3260,
      })
      expect(mockCallWithSession).toHaveBeenCalledWith('SR.probe', [
        'OpaqueRef:host1',
        { target: '192.168.1.200' },
        'lvmoiscsi',
        {},
      ])
    })

    it('uses default port 3260 when not specified', async () => {
      const xmlResponse = `<?xml version="1.0"?>
<SRlist>
  <SR>
    <targetIQN>iqn.2000-01.com.test:storage</targetIQN>
  </SR>
</SRlist>`
      mockCallWithSession.mockResolvedValueOnce(xmlResponse)

      const { probeIscsi } = await import('../../src/main/xapi/services/sr.service')
      const targets = await probeIscsi('conn-123', 'OpaqueRef:host1', '192.168.1.200')

      expect(targets).toHaveLength(1)
      expect(targets[0].port).toBe(3260)
    })
  })
  it('preserves the entered NFS server when exports omit it and decodes XML entities', async () => {
    mockCallWithSession.mockResolvedValueOnce('<nfs-exports><Export><Path>/a&amp;b</Path></Export></nfs-exports>')
    const { probeNfs } = await import('../../src/main/xapi/services/sr.service')
    await expect(probeNfs('conn', 'OpaqueRef:host', 'nas.example')).resolves.toEqual([{ server: 'nas.example', path: '/a&b' }])
  })

  it('reads IQNs from documented discovery error XML and discovers the SCSIid separately', async () => {
    mockCallWithSession.mockRejectedValueOnce({ code: 'SR_BACKEND_FAILURE_96', params: ['', '<iscsi-target-iqns><TGT><TargetIQN>iqn.test</TargetIQN><IPAddress>10.0.0.1</IPAddress></TGT></iscsi-target-iqns>'] })
    const { probeIscsi } = await import('../../src/main/xapi/services/sr.service')
    await expect(probeIscsi('conn', 'OpaqueRef:host', '10.0.0.1')).resolves.toEqual([{ iqn: 'iqn.test', address: '10.0.0.1', port: 3260 }])
    mockCallWithSession.mockRejectedValueOnce({ code: 'SR_BACKEND_FAILURE_107', params: ['', '<iscsi-target><LUN><LUNid>150</LUNid><SCSIid>3600abc</SCSIid><size>1024</size><vendor>ACME</vendor></LUN></iscsi-target>'] })
    await expect(probeIscsi('conn', 'OpaqueRef:host', '10.0.0.1', { iqn: 'iqn.test' })).resolves.toMatchObject([{ luns: [{ id: '3600abc', lunId: '150', size: 1024, vendor: 'ACME' }] }])
  })

  it('rejects a numeric LUN number before any SR mutation', async () => {
    const { createSr } = await import('../../src/main/xapi/services/sr.service')
    await expect(createSr('conn', 'OpaqueRef:host', { type: 'iscsi', nameLabel: 'x', nameDescription: '', iscsiTarget: 'nas', iscsiIqn: 'iqn.test', iscsiLun: '0' })).rejects.toThrow('LUN 序号')
    expect(mockCallWithSession).not.toHaveBeenCalled()
  })

  it('does not create over an SR already discovered on the selected iSCSI LUN', async () => {
    mockCallWithSession.mockResolvedValueOnce(['lvmoiscsi']).mockResolvedValueOnce({ enabled: false })
      .mockResolvedValueOnce('<SRlist><SR><UUID>existing-sr-uuid</UUID></SR></SRlist>')
    const { createSr } = await import('../../src/main/xapi/services/sr.service')
    await expect(createSr('conn', 'host', { type: 'iscsi', nameLabel: 'new', nameDescription: '', iscsiTarget: 'nas', iscsiIqn: 'iqn.test', iscsiLun: '3600abc' }))
      .rejects.toMatchObject({ code: 'SR_ALREADY_EXISTS_ON_DEVICE', details: { srUuids: ['existing-sr-uuid'] } })
    expect(mockCallWithSession).not.toHaveBeenCalledWith('SR.create', expect.anything())
  })

  it('keeps a created SR visible when its host PBD is not attached', async () => {
    mockCallWithSession.mockResolvedValueOnce(['nfs']).mockResolvedValueOnce({ enabled: false })
      .mockResolvedValueOnce('OpaqueRef:new-sr').mockResolvedValueOnce({ PBDs: ['pbd'] })
      .mockResolvedValueOnce({ SR: 'OpaqueRef:new-sr', host: 'host', currently_attached: false })
    const { createSr } = await import('../../src/main/xapi/services/sr.service')
    await expect(createSr('conn', 'host', { type: 'nfs', nameLabel: 'new', nameDescription: '', nfsServer: 'nas', nfsPath: '/export' }))
      .rejects.toMatchObject({ code: 'SR_CREATED_INCOMPLETE', details: { srRef: 'OpaqueRef:new-sr' } })
    expect(mockCallWithSession).not.toHaveBeenCalledWith('SR.destroy', expect.anything())
  })

})

describe('iSCSI portal transport', () => {
  beforeEach(() => { mockCallWithSession.mockReset() })
  it('passes the selected portal port through probe and creation', async () => {
    const { probeIscsi, createSr } = await import('../../src/main/xapi/services/sr.service')
    mockCallWithSession.mockResolvedValueOnce('<iscsi-target><LUN><SCSIid>3600abc</SCSIid><LUNid>1</LUNid></LUN></iscsi-target>')
    await expect(probeIscsi('conn', 'OpaqueRef:host', '10.0.0.2', { iqn: 'iqn.test', port: 3261 }))
      .resolves.toMatchObject([{ address: '10.0.0.2', port: 3261 }])
    expect(mockCallWithSession).toHaveBeenLastCalledWith('SR.probe', ['OpaqueRef:host', { target: '10.0.0.2', targetIQN: 'iqn.test', port: '3261' }, 'lvmoiscsi', {}])
    mockCallWithSession.mockResolvedValueOnce(['lvmoiscsi']).mockResolvedValueOnce({ uuid: 'host' })
      .mockResolvedValueOnce('<SRlist/>').mockResolvedValueOnce('OpaqueRef:new')
      .mockResolvedValueOnce({ PBDs: ['OpaqueRef:pbd'] })
      .mockResolvedValueOnce({ SR: 'OpaqueRef:new', host: 'OpaqueRef:host', currently_attached: true })
      .mockResolvedValueOnce(undefined)
    await createSr('conn', 'OpaqueRef:host', { type: 'iscsi', nameLabel: 'Storage', nameDescription: '',
      iscsiTarget: '10.0.0.2', iscsiPort: 3261, iscsiIqn: 'iqn.test', iscsiLun: '3600abc' })
    expect(mockCallWithSession).toHaveBeenCalledWith('SR.create', ['OpaqueRef:host',
      { target: '10.0.0.2', targetIQN: 'iqn.test', port: '3261', SCSIid: '3600abc' },
      '0', 'Storage', '', 'lvmoiscsi', '', true, {}])
  })
})


describe('SR identity editing', () => {
  const update = { nameLabel: 'New name', nameDescription: 'New description', expectedNameLabel: 'Old name', expectedNameDescription: 'Old description' }
  beforeEach(() => { mockCallWithSession.mockReset() })
  it('reads first, writes only changed identity fields and confirms both via SR.get_record', async () => {
    mockCallWithSession.mockResolvedValueOnce({ name_label: 'Old name', name_description: 'Old description' })
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ name_label: 'New name', name_description: 'New description' })
    const { updateSrIdentity } = await import('../../src/main/xapi/services/sr.service')
    await expect(updateSrIdentity('conn-123', 'OpaqueRef:sr', update)).resolves.toEqual({ nameLabel: 'New name', nameDescription: 'New description' })
    expect(mockCallWithSession.mock.calls).toEqual([
      ['SR.get_record', ['OpaqueRef:sr']], ['SR.set_name_label', ['OpaqueRef:sr', 'New name']],
      ['SR.set_name_description', ['OpaqueRef:sr', 'New description']], ['SR.get_record', ['OpaqueRef:sr']],
    ])
  })
  it('preserves concurrent changes to an untouched description', async () => {
    mockCallWithSession.mockResolvedValueOnce({ name_label: 'Old name', name_description: 'Administrator note' })
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce({ name_label: 'New name', name_description: 'Administrator note' })
    const { updateSrIdentity } = await import('../../src/main/xapi/services/sr.service')
    await expect(updateSrIdentity('conn-123', 'OpaqueRef:sr', { ...update, nameDescription: 'Old description' })).resolves.toEqual({ nameLabel: 'New name', nameDescription: 'Administrator note' })
    expect(mockCallWithSession.mock.calls.map(([method]) => method)).toEqual(['SR.get_record', 'SR.set_name_label', 'SR.get_record'])
  })
  it('rejects a stale edit before performing any writes', async () => {
    mockCallWithSession.mockResolvedValueOnce({ name_label: 'Other name', name_description: 'Old description' })
    const { updateSrIdentity } = await import('../../src/main/xapi/services/sr.service')
    await expect(updateSrIdentity('conn-123', 'OpaqueRef:sr', update)).rejects.toThrow('SR_IDENTITY_CONFLICT')
    expect(mockCallWithSession).toHaveBeenCalledTimes(1)
  })
  it('reports a partially applied edit without repeating writes or rolling back another field', async () => {
    mockCallWithSession.mockResolvedValueOnce({ name_label: 'Old name', name_description: 'Old description' })
      .mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('description denied'))
    const { updateSrIdentity } = await import('../../src/main/xapi/services/sr.service')
    await expect(updateSrIdentity('conn-123', 'OpaqueRef:sr', update)).rejects.toMatchObject({ code: 'SR_IDENTITY_UNCONFIRMED' })
    expect(mockCallWithSession).toHaveBeenCalledTimes(6)
  })
  it('does not report success when readback cannot be confirmed', async () => {
    mockCallWithSession.mockResolvedValueOnce({ name_label: 'Old name', name_description: 'Old description' })
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('read unavailable'))
    const { updateSrIdentity } = await import('../../src/main/xapi/services/sr.service')
    await expect(updateSrIdentity('conn-123', 'OpaqueRef:sr', update)).rejects.toMatchObject({ code: 'SR_IDENTITY_UNCONFIRMED' })
    expect(mockCallWithSession).toHaveBeenCalledTimes(6)
  })
})

describe('storage write reconciliation and connection modes', () => {
  const lost = () => Object.assign(new Error('response lost'), { code: 'ECONNRESET', details: { kind: 'transport' } })
  beforeEach(() => { mockCallWithSession.mockReset(); mockGetClient.mockReturnValue(mockClient) })
  const disk = { VBDs: ['OpaqueRef:vbd'], type: 'user', allowed_operations: ['destroy'] }
  const vbd = { VDI: 'OpaqueRef:vdi', VM: 'OpaqueRef:vm', type: 'Disk', mode: 'RW', other_config: { owner: 'true' }, currently_attached: false }

  it('reports deletion after the server deleted the disk and lost its response', async () => {
    let deleted = false
    mockCallWithSession.mockImplementation(async (method: string) => {
      if (method === 'VDI.get_record') { if (deleted) throw new Error('HANDLE_INVALID: VDI'); return disk }
      if (method === 'VBD.get_record') return vbd
      if (method === 'VM.get_record') return { power_state: 'Halted' }
      if (method === 'VBD.destroy') return undefined
      if (method === 'VDI.destroy') { deleted = true; throw lost() }
      throw new Error(`Unexpected method ${method}`)
    })
    const { destroyVdi } = await import('../../src/main/xapi/services/sr.service')
    await expect(destroyVdi('conn-1', 'OpaqueRef:vdi')).resolves.toEqual({ vdiDeleted: true, detachedVbdRef: 'OpaqueRef:vbd' })
    expect(mockCallWithSession.mock.calls.filter(([method]) => method === 'VDI.destroy')).toHaveLength(1)
  })

  it('does not claim the disk was retained when the delete response and reads are lost', async () => {
    let submitted = false
    mockCallWithSession.mockImplementation(async (method: string) => {
      if (method === 'VDI.get_record') { if (submitted) throw lost(); return disk }
      if (method === 'VBD.get_record') return vbd
      if (method === 'VM.get_record') return { power_state: 'Halted' }
      if (method === 'VBD.destroy') return undefined
      if (method === 'VDI.destroy') { submitted = true; throw lost() }
      throw new Error(`Unexpected method ${method}`)
    })
    const { destroyVdi } = await import('../../src/main/xapi/services/sr.service')
    await expect(destroyVdi('conn-1', 'OpaqueRef:vdi')).rejects.toMatchObject({ code: 'RESOURCE_RESULT_READ_FAILED' })
  })

  it('creates an NFS ISO repository with the ISO driver and ISO content type', async () => {
    mockCallWithSession.mockImplementation(async (method: string) => {
      if (method === 'SR.get_supported_types') return ['iso']
      if (method === 'host.get_record') return { uuid: 'host-uuid' }
      if (method === 'SR.create') return 'OpaqueRef:iso'
      if (method === 'SR.get_record') return { PBDs: ['OpaqueRef:pbd'] }
      if (method === 'PBD.get_record') return { SR: 'OpaqueRef:iso', host: 'OpaqueRef:host', currently_attached: true }
      if (method === 'SR.scan') return undefined
      throw new Error(`Unexpected method ${method}`)
    })
    const { createSr } = await import('../../src/main/xapi/services/sr.service')
    await expect(createSr('conn-1', 'OpaqueRef:host', { type: 'iso', nameLabel: 'Install media', nameDescription: '', nfsServer: '192.0.2.10', nfsPath: '/iso' })).resolves.toBe('OpaqueRef:iso')
    expect(mockCallWithSession).toHaveBeenCalledWith('SR.create', ['OpaqueRef:host', { location: '192.0.2.10:/iso', type: 'nfs_iso' }, '0', 'Install media', '', 'iso', 'iso', true, {}])
  })

  it('reattaches the probed iSCSI UUID without formatting the existing storage', async () => {
    mockCallWithSession.mockImplementation(async (method: string) => {
      if (method === 'SR.get_supported_types') return ['lvmoiscsi']
      if (method === 'host.get_record') return { uuid: 'host-uuid' }
      if (method === 'SR.probe') return '<SRlist><SR><UUID>existing-uuid</UUID></SR></SRlist>'
      if (method === 'SR.get_by_uuid') throw new Error('UUID_INVALID: SR')
      if (method === 'SR.introduce') return 'OpaqueRef:existing'
      if (method === 'PBD.get_all_records') return {}
      if (method === 'PBD.create') return 'OpaqueRef:pbd'
      if (method === 'PBD.plug' || method === 'SR.scan') return undefined
      if (method === 'SR.get_record') return { uuid: 'existing-uuid', type: 'lvmoiscsi' }
      if (method === 'PBD.get_record') return { SR: 'OpaqueRef:existing', host: 'OpaqueRef:host', currently_attached: true }
      throw new Error(`Unexpected method ${method}`)
    })
    const { createSr } = await import('../../src/main/xapi/services/sr.service')
    await expect(createSr('conn-1', 'OpaqueRef:host', { type: 'iscsi', nameLabel: 'Existing', nameDescription: '', iscsiTarget: '192.0.2.10', iscsiIqn: 'iqn.test', iscsiLun: 'scsi-id', existingSrUuid: 'existing-uuid' })).resolves.toBe('OpaqueRef:existing')
    expect(mockCallWithSession).toHaveBeenCalledWith('SR.introduce', ['existing-uuid', 'Existing', '', 'lvmoiscsi', 'user', true, {}])
    expect(mockCallWithSession.mock.calls.some(([method]) => method === 'SR.create')).toBe(false)
  })

  it('rejects reattachment when the device no longer reports the selected UUID', async () => {
    mockCallWithSession.mockResolvedValueOnce(['lvmoiscsi']).mockResolvedValueOnce({}).mockResolvedValueOnce('<SRlist><SR><UUID>changed</UUID></SR></SRlist>')
    const { createSr } = await import('../../src/main/xapi/services/sr.service')
    await expect(createSr('conn-1', 'OpaqueRef:host', { type: 'iscsi', nameLabel: 'Existing', nameDescription: '', iscsiTarget: '192.0.2.10', iscsiIqn: 'iqn.test', iscsiLun: 'scsi-id', existingSrUuid: 'old-uuid' })).rejects.toThrow('UUID 已变化')
    expect(mockCallWithSession.mock.calls.some(([method]) => method === 'SR.create' || method === 'SR.introduce' || method === 'PBD.create')).toBe(false)
  })
})
