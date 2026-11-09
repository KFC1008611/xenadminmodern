/**
 * Unit tests for profile.service — verifies disk persistence and keychain interactions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'path'

// Mock electron app + safeStorage
const mockEncryptString = vi.fn((value: string) => Buffer.from(`enc:${value}`))
const mockDecryptString = vi.fn((buf: Buffer) => {
  const raw = buf.toString()
  return raw.startsWith('enc:') ? raw.slice(4) : raw
})
const mockIsEncryptionAvailable = vi.fn(() => true)
const mockGetPath = vi.fn(() => '/mock/userData')

vi.mock('electron', () => ({
  app: {
    getPath: mockGetPath,
  },
  safeStorage: {
    encryptStringAsync: mockEncryptString,
    decryptStringAsync: vi.fn(async (buffer: Buffer) => ({ result: mockDecryptString(buffer), shouldReEncrypt: false })),
    isAsyncEncryptionAvailable: mockIsEncryptionAvailable,
  },
}))

// Mock fs/promises
const mockReadFile = vi.fn()
const mockWriteFile = vi.fn()
const mockRename = vi.fn()
const mockUnlink = vi.fn()

vi.mock('fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  rename: mockRename,
  unlink: mockUnlink,
}))

const PROFILES_PATH = path.join('/mock/userData', 'profiles.json')
const PASSWORDS_PATH = path.join('/mock/userData', 'passwords.enc.json')

describe('profile.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadFile.mockReset()
    mockWriteFile.mockReset().mockResolvedValue(undefined)
    mockRename.mockReset().mockResolvedValue(undefined)
    mockUnlink.mockReset().mockResolvedValue(undefined)
    mockGetPath.mockReturnValue('/mock/userData')
    vi.resetModules()
  })

  describe('listProfiles', () => {
    it('returns empty array when profiles.json does not exist', async () => {
      const err = Object.assign(new Error('Not found'), { code: 'ENOENT' })
      mockReadFile.mockRejectedValueOnce(err)

      const { listProfiles } = await import('../../src/main/profiles/profile.service')
      const profiles = await listProfiles()

      expect(profiles).toEqual([])
    })

    it('returns parsed profiles from disk', async () => {
      const stored = [
        { id: 'id1', name: 'Production', host: '10.0.0.1', port: 443, username: 'root', lastConnected: '2024-03-01T10:00:00Z' },
        { id: 'id2', name: 'Staging', host: '10.0.0.2', port: 443, username: 'root', lastConnected: '2024-02-01T10:00:00Z' },
      ]
      mockReadFile.mockResolvedValueOnce(JSON.stringify(stored))

      const { listProfiles } = await import('../../src/main/profiles/profile.service')
      const profiles = await listProfiles()

      expect(profiles).toHaveLength(2)
      expect(profiles[0].id).toBe('id1') // sorted by lastConnected desc
    })

    it('normalizes legacy profiles without a scheme to HTTPS', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify([
        {
          id: 'legacy',
          name: 'Legacy Server',
          host: '10.0.0.1',
          port: 80,
          username: 'root',
          lastConnected: null,
        },
      ]))

      const { listProfiles } = await import('../../src/main/profiles/profile.service')

      await expect(listProfiles()).resolves.toEqual([
        expect.objectContaining({ id: 'legacy', scheme: 'https:' }),
      ])
    })

    it('sorts profiles by lastConnected descending, null last', async () => {
      const stored = [
        { id: 'id1', name: 'A', host: '10.0.0.1', port: 443, username: 'root', lastConnected: null },
        { id: 'id2', name: 'B', host: '10.0.0.2', port: 443, username: 'root', lastConnected: '2024-01-01T00:00:00Z' },
        { id: 'id3', name: 'C', host: '10.0.0.3', port: 443, username: 'root', lastConnected: '2024-06-01T00:00:00Z' },
      ]
      mockReadFile.mockResolvedValueOnce(JSON.stringify(stored))

      const { listProfiles } = await import('../../src/main/profiles/profile.service')
      const profiles = await listProfiles()

      expect(profiles[0].id).toBe('id3') // most recent first
      expect(profiles[1].id).toBe('id2')
      expect(profiles[2].id).toBe('id1') // null last
    })

    it('propagates non-ENOENT errors', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('PERMISSION_DENIED'))

      const { listProfiles } = await import('../../src/main/profiles/profile.service')
      await expect(listProfiles()).rejects.toThrow('PERMISSION_DENIED')
    })
  })

  describe('saveProfile', () => {
    it('writes a new profile and stores encrypted password', async () => {
      const err = Object.assign(new Error('Not found'), { code: 'ENOENT' })
      mockReadFile.mockRejectedValueOnce(err) // listProfiles call returns empty
      mockReadFile.mockRejectedValueOnce(err) // loadEncryptedPasswords
      mockWriteFile.mockResolvedValueOnce(undefined) // profiles.json
      mockWriteFile.mockResolvedValueOnce(undefined) // passwords.enc.json

      const profile = {
        id: 'id-new',
        name: 'New Server',
        host: '10.0.0.5',
        port: 443,
        scheme: 'http:' as const,
        username: 'root',
        lastConnected: null,
      }
      const { saveProfile } = await import('../../src/main/profiles/profile.service')
      await saveProfile(profile, 'secret123')

      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining(`${PROFILES_PATH}.`),
        expect.stringContaining('id-new'),
        { encoding: 'utf-8', mode: 0o600, flag: 'wx' }
      )
      const writtenProfile = JSON.parse(String(mockWriteFile.mock.calls[0][1]))[0]
      expect(writtenProfile.scheme).toBe('http:')
      expect(mockEncryptString).toHaveBeenCalledWith('secret123')
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining(`${PASSWORDS_PATH}.`),
        expect.stringContaining('"id-new"'),
        { encoding: 'utf-8', mode: 0o600, flag: 'wx' }
      )
    })

    it('upserts an existing profile by id', async () => {
      const existing = [
        { id: 'id1', name: 'Old Name', host: '10.0.0.1', port: 443, username: 'root', lastConnected: null }
      ]
      mockReadFile.mockResolvedValueOnce(JSON.stringify(existing))
      mockReadFile.mockRejectedValueOnce(Object.assign(new Error('Not found'), { code: 'ENOENT' }))
      mockWriteFile.mockResolvedValueOnce(undefined)
      mockWriteFile.mockResolvedValueOnce(undefined)

      const updated = { id: 'id1', name: 'New Name', host: '10.0.0.1', port: 443, username: 'admin', lastConnected: '2024-01-01T00:00:00Z' }
      const { saveProfile } = await import('../../src/main/profiles/profile.service')
      await saveProfile(updated, 'newpass')

      const writtenData = JSON.parse(mockWriteFile.mock.calls[0][1])
      expect(writtenData).toHaveLength(1) // still one profile
      expect(writtenData[0].name).toBe('New Name')
      expect(writtenData[0].username).toBe('admin')
    })
  })

  describe('deleteProfile', () => {
    it('removes profile from disk and deletes encrypted password entry', async () => {
      const existing = [
        { id: 'id1', name: 'Server A', host: '10.0.0.1', port: 443, username: 'root', lastConnected: null },
        { id: 'id2', name: 'Server B', host: '10.0.0.2', port: 443, username: 'root', lastConnected: null },
      ]
      mockReadFile.mockResolvedValueOnce(JSON.stringify(existing)) // listProfiles
      mockWriteFile.mockResolvedValueOnce(undefined) // profiles.json
      mockReadFile.mockResolvedValueOnce(JSON.stringify({ id1: Buffer.from('enc:a').toString('base64') })) // passwords
      mockWriteFile.mockResolvedValueOnce(undefined) // passwords.enc.json

      const { deleteProfile } = await import('../../src/main/profiles/profile.service')
      await deleteProfile('id1')

      const writtenData = JSON.parse(mockWriteFile.mock.calls[0][1])
      expect(writtenData).toHaveLength(1)
      expect(writtenData[0].id).toBe('id2')
      const passwordJson = JSON.parse(String(mockWriteFile.mock.calls[1][1]))
      expect(passwordJson.id1).toBeUndefined()
    })

    it('silently ignores encrypted password store errors', async () => {
      const existing = [{ id: 'id1', name: 'Server A', host: '10.0.0.1', port: 443, username: 'root', lastConnected: null }]
      mockReadFile.mockResolvedValueOnce(JSON.stringify(existing))
      mockWriteFile.mockResolvedValueOnce(undefined)
      mockReadFile.mockRejectedValueOnce(new Error('PASSWORD_STORE_ERROR'))

      const { deleteProfile } = await import('../../src/main/profiles/profile.service')
      // Should not throw even when password store operations fail
      await expect(deleteProfile('id1')).resolves.toBeUndefined()
    })
  })

  it('checks saved entries without touching the system credential store', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ id1: Buffer.from('enc:stored').toString('base64') }))
    const { hasPassword } = await import('../../src/main/profiles/profile.service')
    expect(await hasPassword('id1')).toBe(true)
    expect(await hasPassword('missing')).toBe(false)
    expect(mockIsEncryptionAvailable).not.toHaveBeenCalled()
    expect(mockDecryptString).not.toHaveBeenCalled()
  })

  it('keeps asynchronous credential access pending without blocking profile inventory', async () => {
    let release!: (available: boolean) => void
    mockIsEncryptionAvailable.mockReturnValueOnce(new Promise<boolean>((resolve) => { release = resolve }) as any)
    mockReadFile.mockImplementation(async (file: string) => file === PROFILES_PATH ? '[]' : JSON.stringify({ id1: Buffer.from('enc:stored').toString('base64') }))
    const { getPassword, listProfiles } = await import('../../src/main/profiles/profile.service')
    const pending = getPassword('id1')
    expect(await listProfiles()).toEqual([])
    release(true)
    expect(await pending).toBe('stored')
  })

  describe('getPassword', () => {
    it('returns decrypted password from encrypted store', async () => {
      const encrypted = Buffer.from('enc:my-secret-password').toString('base64')
      mockReadFile.mockResolvedValueOnce(JSON.stringify({ id1: encrypted }))

      const { getPassword } = await import('../../src/main/profiles/profile.service')
      const pw = await getPassword('id1')

      expect(pw).toBe('my-secret-password')
      expect(mockDecryptString).toHaveBeenCalledTimes(1)
    })

    it('returns null when no password is found in encrypted store', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify({}))

      const { getPassword } = await import('../../src/main/profiles/profile.service')
      const pw = await getPassword('id-unknown')

      expect(pw).toBeNull()
    })

    it('returns null when encrypted store read fails instead of propagating the error', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('STORE_UNAVAILABLE'))

      const { getPassword } = await import('../../src/main/profiles/profile.service')
      const pw = await getPassword('id1')

      expect(pw).toBeNull()
    })

    it('returns null when encryption is unavailable', async () => {
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      mockIsEncryptionAvailable.mockReturnValueOnce(false)
      mockReadFile.mockResolvedValueOnce(JSON.stringify({
        id1: Buffer.from('enc:my-secret-password').toString('base64'),
      }))

      const { getPassword } = await import('../../src/main/profiles/profile.service')
      const pw = await getPassword('id1')

      expect(pw).toBeNull()
      expect(warning).toHaveBeenCalledTimes(1)
      expect(warning).toHaveBeenCalledWith(
        '[profile.service] safeStorage encryption not available, cannot decrypt password',
      )
      warning.mockRestore()
    })
  })
  it('preserves all profiles and credentials during concurrent writes in a real temporary directory', async () => {
    const actualFs = await vi.importActual<typeof import('fs/promises')>('fs/promises')
    const os = await import('os')
    const directory = await actualFs.mkdtemp(path.join(os.tmpdir(), 'xenadmin-profile-concurrency-'))
    mockGetPath.mockReturnValue(directory)
    mockReadFile.mockImplementation(actualFs.readFile)
    mockWriteFile.mockImplementation(actualFs.writeFile)
    mockRename.mockImplementation(actualFs.rename)
    mockUnlink.mockImplementation(actualFs.unlink)
    try {
      const { saveProfile, deleteProfile, listProfiles, getPassword } = await import('../../src/main/profiles/profile.service')
      const profile = (id: string) => ({ id, host: '192.0.2.1', port: 443, scheme: 'https:' as const, username: 'fixture', name: id, lastConnected: null })
      await Promise.all(Array.from({ length: 12 }, (_, index) => saveProfile(profile(`profile-${index}`), `fixture-${index}`)))
      expect(await listProfiles()).toHaveLength(12)
      for (let index = 0; index < 12; index++) expect(await getPassword(`profile-${index}`)).toBe(`fixture-${index}`)
      await Promise.all([deleteProfile('profile-0'), saveProfile({ ...profile('profile-1'), name: 'updated' }, null), saveProfile(profile('profile-new'), 'fixture-new')])
      expect((await listProfiles()).map((entry) => entry.id)).not.toContain('profile-0')
      expect(await getPassword('profile-0')).toBeNull()
      expect(await getPassword('profile-1')).toBe('fixture-1')
      expect(await getPassword('profile-new')).toBe('fixture-new')
      expect((await actualFs.readdir(directory)).sort()).toEqual(['passwords.enc.json', 'profiles.json'])
      if (process.platform !== 'win32') expect((await actualFs.stat(path.join(directory, 'passwords.enc.json'))).mode & 0o777).toBe(0o600)
    } finally { await actualFs.rm(directory, { recursive: true, force: true }) }
  })

  it('keeps the mutation queue usable after a failed atomic rename', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    mockRename.mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
    const { saveProfile } = await import('../../src/main/profiles/profile.service')
    const profile = { id: 'fixture', name: 'fixture', host: '192.0.2.1', port: 443, scheme: 'https:' as const, username: 'fixture', lastConnected: null }
    await expect(saveProfile(profile, null)).rejects.toThrow('disk full')
    await expect(saveProfile(profile, null)).resolves.toBeUndefined()
    expect(mockUnlink).toHaveBeenCalledTimes(1)
    expect(mockRename).toHaveBeenCalledTimes(2)
  })

})
