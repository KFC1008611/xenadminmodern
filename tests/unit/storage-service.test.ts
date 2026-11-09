/**
 * Unit tests for storage.service — verifies SR/VDI XAPI calls.
 * v4: Updated to mock connectionManager instead of singleton xapiClient.
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

describe('storage.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getAllSrs filters out udev and iso types and includes connection metadata', async () => {
    mockCallWithSession.mockResolvedValueOnce({
      'OpaqueRef:sr1': { name_label: 'Local storage', type: 'ext', physical_size: 100, physical_utilisation: 50, VDIs: [], shared: false },
      'OpaqueRef:sr2': { name_label: 'udev SR', type: 'udev', physical_size: 0, physical_utilisation: 0, VDIs: [], shared: false },
      'OpaqueRef:sr3': { name_label: 'ISO library', type: 'iso', physical_size: 0, physical_utilisation: 0, VDIs: [], shared: true },
    })

    const { getAllSrs } = await import('../../src/main/xapi/services/storage.service')
    const srs = await getAllSrs('conn-123')

    expect(mockCallWithSession).toHaveBeenCalledOnce()
    expect(mockCallWithSession).toHaveBeenCalledWith('SR.get_all_records', [])
    expect(srs).toHaveLength(1)
    expect(srs[0].name_label).toBe('Local storage')
    expect(srs[0].connectionId).toBe('conn-123')
    expect(srs[0].poolName).toBe('Test Pool')
  })

  it('getAllSrs throws when connectionId is invalid', async () => {
    mockGetClient.mockReturnValueOnce(undefined)

    const { getAllSrs } = await import('../../src/main/xapi/services/storage.service')
    await expect(getAllSrs('invalid-id')).rejects.toThrow('No connection found for connectionId: invalid-id')
  })

  it('getAllVdis returns VDIs with connection metadata', async () => {
    mockCallWithSession
      .mockResolvedValueOnce(['OpaqueRef:vdi1'])
      .mockResolvedValueOnce({
        uuid: 'uuid-vdi1',
        name_label: 'Test VDI',
        virtual_size: 10737418240,
        physical_utilisation: 5368709120,
        type: 'user',
        SR: 'OpaqueRef:sr1',
        VBDs: [],
        read_only: false,
      })

    const { getAllVdis } = await import('../../src/main/xapi/services/storage.service')
    const vdis = await getAllVdis('conn-123', 'OpaqueRef:sr1')

    expect(vdis).toHaveLength(1)
    expect(vdis[0].name_label).toBe('Test VDI')
    expect(vdis[0].connectionId).toBe('conn-123')
    expect(vdis[0].poolName).toBe('Test Pool')
  })

  it('createVdi calls VDI.create with correct params', async () => {
    mockCallWithSession.mockResolvedValueOnce('OpaqueRef:new-vdi')
    const { createVdi } = await import('../../src/main/xapi/services/storage.service')
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

  it('destroyVdi calls VDI.destroy', async () => {
    mockCallWithSession.mockResolvedValueOnce(null)
    const { destroyVdi } = await import('../../src/main/xapi/services/storage.service')
    await destroyVdi('conn-123', 'OpaqueRef:vdi1')
    expect(mockCallWithSession).toHaveBeenCalledWith('VDI.destroy', ['OpaqueRef:vdi1'])
  })
})
