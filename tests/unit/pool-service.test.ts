/**
 * Unit tests for pool.service — verifies XAPI pool.* calls.
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

describe('pool.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getPool returns pool record with ref and connectionId', async () => {
    mockCallWithSession
      .mockResolvedValueOnce(['OpaqueRef:pool1'])
      .mockResolvedValueOnce({
        uuid: 'uuid-pool1',
        name_label: 'My Pool',
        name_description: 'Production pool',
        master: 'OpaqueRef:host1',
        default_SR: 'OpaqueRef:sr1',
        ha_enabled: false, // XenAPI pool field: ha_enabled (not HA_enabled)
      })

    const { getPool } = await import('../../src/main/xapi/services/pool.service')
    const pool = await getPool('conn-123')

    expect(pool).not.toBeNull()
    expect(pool!.ref).toBe('OpaqueRef:pool1')
    expect(pool!.name_label).toBe('My Pool')
    expect(pool!.master).toBe('OpaqueRef:host1')
    expect(pool!.ha_enabled).toBe(false)
    expect(pool!.connectionId).toBe('conn-123')
    expect(mockCallWithSession).toHaveBeenCalledWith('pool.get_all', [])
    expect(mockCallWithSession).toHaveBeenCalledWith('pool.get_record', ['OpaqueRef:pool1'])
  })

  it('getPool returns null when no pools exist', async () => {
    mockCallWithSession.mockResolvedValueOnce([])

    const { getPool } = await import('../../src/main/xapi/services/pool.service')
    const pool = await getPool('conn-123')

    expect(pool).toBeNull()
    expect(mockCallWithSession).toHaveBeenCalledTimes(1)
  })

  it('getPool uses only the first pool ref when multiple exist', async () => {
    mockCallWithSession
      .mockResolvedValueOnce(['OpaqueRef:pool1', 'OpaqueRef:pool2'])
      .mockResolvedValueOnce({
        uuid: 'uuid-pool1',
        name_label: 'First Pool',
        name_description: '',
        master: 'OpaqueRef:host1',
        default_SR: 'OpaqueRef:sr1',
        ha_enabled: true, // XenAPI pool field: ha_enabled
      })

    const { getPool } = await import('../../src/main/xapi/services/pool.service')
    const pool = await getPool('conn-123')

    expect(pool!.ref).toBe('OpaqueRef:pool1')
    expect(pool!.ha_enabled).toBe(true)
    // Should only call get_record once for the first ref
    expect(mockCallWithSession).toHaveBeenCalledTimes(2)
    expect(mockCallWithSession).toHaveBeenCalledWith('pool.get_record', ['OpaqueRef:pool1'])
  })

  it('getPool propagates XAPI errors', async () => {
    mockCallWithSession.mockRejectedValueOnce(new Error('SESSION_INVALID'))

    const { getPool } = await import('../../src/main/xapi/services/pool.service')
    await expect(getPool('conn-123')).rejects.toThrow('SESSION_INVALID')
  })

  it('getPool throws when connectionId is invalid', async () => {
    mockGetClient.mockReturnValueOnce(undefined)

    const { getPool } = await import('../../src/main/xapi/services/pool.service')
    await expect(getPool('invalid-id')).rejects.toThrow('No connection found for connectionId: invalid-id')
  })
})
