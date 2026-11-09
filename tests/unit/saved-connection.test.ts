import { beforeEach, describe, expect, it, vi } from 'vitest'
const { mockConnect, mockPassword, mockSave, mockInfo } = vi.hoisted(() => ({ mockConnect: vi.fn(), mockPassword: vi.fn(), mockSave: vi.fn(), mockInfo: vi.fn() }))
vi.mock('../../src/main/xapi/connection-manager', () => ({ connectionManager: { connect: mockConnect, getConnectionInfo: mockInfo } }))
vi.mock('../../src/main/profiles/profile.service', () => ({
  listProfiles: vi.fn(async () => [{ id: 'saved', host: '192.0.2.4', port: 443, scheme: 'https:', username: 'root', name: 'Lab' }]),
  getPassword: mockPassword, saveProfile: mockSave,
}))
vi.mock('../../src/main/logger', () => ({ createLogger: () => ({ warn: vi.fn() }) }))
import { connectSavedProfile } from '../../src/main/profiles/saved-connection.service'
beforeEach(() => { vi.clearAllMocks(); mockInfo.mockReturnValue(undefined); mockPassword.mockResolvedValue('stored'); mockConnect.mockResolvedValue('saved'); mockSave.mockResolvedValue(undefined) })
describe('main-owned profile connections', () => {
  it('uses stored credentials only in main and returns the stable profile identity', async () => {
    await expect(connectSavedProfile('saved')).resolves.toEqual({ id: 'saved' })
    expect(mockConnect).toHaveBeenCalledWith(expect.objectContaining({ password: 'stored', allowSelfSigned: false }), 'saved')
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'saved' }), null)
  })
  it('coalesces concurrent connects and avoids a second login', async () => {
    const [first, second] = await Promise.all([connectSavedProfile('saved'), connectSavedProfile('saved')])
    expect(first).toEqual(second)
    expect(mockConnect).toHaveBeenCalledTimes(1)
  })
  it('does not turn an authenticated connection into a failure when timestamp storage fails', async () => {
    mockSave.mockRejectedValue(new Error('disk full'))
    await expect(connectSavedProfile('saved')).resolves.toEqual({ id: 'saved' })
  })
  it('requires a supplied password if the encrypted credential cannot be read', async () => {
    mockPassword.mockResolvedValue(null)
    await expect(connectSavedProfile('saved')).rejects.toThrow('重新输入密码')
    expect(mockConnect).not.toHaveBeenCalled()
  })
})
