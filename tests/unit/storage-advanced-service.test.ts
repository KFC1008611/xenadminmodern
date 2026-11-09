/**
 * Unit tests for storage-advanced.service — verifies advanced VDI XAPI call signatures.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isoListContract, srGetThinStatsContract } from '../../src/shared/ipc-contracts/storage'

const mockCallWithSession = vi.fn()
const mockClient = { callWithSession: mockCallWithSession }
const mockGetClient = vi.fn(() => mockClient)

vi.mock('../../src/main/xapi/connection-manager', () => ({
  connectionManager: {
    getClient: mockGetClient,
    getConnectionInfo: vi.fn(() => ({ poolName: 'Test Pool' })),
  },
}))

describe('storage-advanced.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCallWithSession.mockReset()
  })

  it('cloneVdi passes empty driver params and renames the clone', async () => {
    mockCallWithSession
      .mockResolvedValueOnce('OpaqueRef:new-vdi')
      .mockResolvedValueOnce(undefined)

    const { cloneVdi } = await import('../../src/main/xapi/services/storage-advanced.service')
    const ref = await cloneVdi('conn-123', {
      vdiRef: 'OpaqueRef:vdi1',
      nameLabel: 'clone-name',
    })

    expect(ref).toBe('OpaqueRef:new-vdi')
    expect(mockCallWithSession).toHaveBeenNthCalledWith(1, 'VDI.clone', ['OpaqueRef:vdi1', {}])
    expect(mockCallWithSession).toHaveBeenNthCalledWith(2, 'VDI.set_name_label', [
      'OpaqueRef:new-vdi',
      'clone-name',
    ])
  })

  it('snapshotVdi passes empty driver params and renames the snapshot', async () => {
    mockCallWithSession
      .mockResolvedValueOnce('OpaqueRef:snapshot-vdi')
      .mockResolvedValueOnce(undefined)

    const { snapshotVdi } = await import('../../src/main/xapi/services/storage-advanced.service')
    const ref = await snapshotVdi('conn-123', 'OpaqueRef:vdi1', 'snapshot-name')

    expect(ref).toBe('OpaqueRef:snapshot-vdi')
    expect(mockCallWithSession).toHaveBeenNthCalledWith(1, 'VDI.snapshot', ['OpaqueRef:vdi1', {}])
    expect(mockCallWithSession).toHaveBeenNthCalledWith(2, 'VDI.set_name_label', [
      'OpaqueRef:snapshot-vdi',
      'snapshot-name',
    ])
  })

  it('copyVdi passes null base and destination VDI refs', async () => {
    mockCallWithSession.mockResolvedValueOnce('OpaqueRef:copied-vdi')

    const { copyVdi } = await import('../../src/main/xapi/services/storage-advanced.service')
    const ref = await copyVdi('conn-123', {
      vdiRef: 'OpaqueRef:vdi1',
      targetSrRef: 'OpaqueRef:sr2',
    })

    expect(ref).toBe('OpaqueRef:copied-vdi')
    expect(mockCallWithSession).toHaveBeenCalledWith('VDI.copy', [
      'OpaqueRef:vdi1',
      'OpaqueRef:sr2',
      'OpaqueRef:NULL',
      'OpaqueRef:NULL',
    ])
  })

  it('normalizes ISO capacities from XML-RPC strings before the production IPC contract', async () => {
    mockCallWithSession.mockImplementation(async (method) => method === 'SR.get_record' ? { type: 'iso' } : {
      'OpaqueRef:iso': { uuid: 'iso-uuid', name_label: 'installer.iso', virtual_size: '4096',
        physical_utilisation: '4096', SR: 'OpaqueRef:sr', type: 'user', read_only: true, VBDs: [] },
    })
    const { getIsos } = await import('../../src/main/xapi/services/storage-advanced.service')
    const records = isoListContract.resultSchema.parse(await getIsos('conn-123', 'OpaqueRef:sr'))
    expect(records[0]).toMatchObject({ virtual_size: 4096, physical_utilisation: 4096 })
  })

  it('normalizes SR capacity strings and rejects absent capacity instead of inventing zero', async () => {
    mockCallWithSession.mockResolvedValueOnce({ physical_size: '1024', physical_utilisation: '512', virtual_allocation: '2048' })
      .mockResolvedValueOnce({ physical_size: 'invalid' })
    const { getSrThinProvisioningStats } = await import('../../src/main/xapi/services/storage-advanced.service')
    expect(srGetThinStatsContract.resultSchema.parse(await getSrThinProvisioningStats('conn-123', 'OpaqueRef:sr')))
      .toEqual({ physicalSize: 1024, physicalUtilisation: 512, virtualAllocation: 2048, overprovisionRatio: 2 })
    await expect(getSrThinProvisioningStats('conn-123', 'OpaqueRef:sr')).rejects.toThrow('未返回有效容量数据')
  })

  it('confirms PBD attachment after plug and never replays an unconfirmed request', async () => {
    mockCallWithSession.mockResolvedValueOnce(undefined).mockResolvedValueOnce(true)
      .mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('connection lost'))
    const { plugPbd } = await import('../../src/main/xapi/services/storage-advanced.service')
    await expect(plugPbd('conn-123', 'OpaqueRef:pbd')).resolves.toBeUndefined()
    await expect(plugPbd('conn-123', 'OpaqueRef:pbd')).rejects.toMatchObject({ code: 'PBD_STATE_UNCONFIRMED' })
    expect(mockCallWithSession.mock.calls.filter(([method]) => method === 'PBD.plug')).toHaveLength(2)
  })
})
