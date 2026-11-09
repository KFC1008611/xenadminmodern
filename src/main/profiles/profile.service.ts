/**
 * Profile service — persists connection profiles to disk and passwords using Electron safeStorage.
 * Profiles are stored as JSON in <userData>/profiles.json;
 * passwords are encrypted with safeStorage and stored in <userData>/passwords.enc.json.
 *
 * Migrated from keytar (deprecated) to Electron safeStorage (built-in, cross-platform).
 */
import { app, safeStorage } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { randomUUID } from 'crypto'
import type { ConnectionProfile, XapiTransportScheme } from '../../shared/types/xapi'

// Re-export shared type for backward compatibility
export type { ConnectionProfile }

let mutationQueue: Promise<void> = Promise.resolve()

/** Serialize read-modify-write operations across both legacy profile files. */
function serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation)
  mutationQueue = result.then(() => undefined, () => undefined)
  return result
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), { encoding: 'utf-8', mode: 0o600, flag: 'wx' })
    await fs.rename(temporaryPath, filePath)
  } catch (error) {
    try { await fs.unlink(temporaryPath) } catch { /* Preserve the original destination. */ }
    throw error
  }
}

type StoredConnectionProfile = Omit<ConnectionProfile, 'scheme'> & {
  scheme?: unknown
}

function normalizeScheme(scheme: unknown): XapiTransportScheme {
  return scheme === 'http:' ? 'http:' : 'https:'
}

function normalizeProfile(profile: StoredConnectionProfile): ConnectionProfile {
  return {
    ...profile,
    scheme: normalizeScheme(profile.scheme),
  }
}

/** Returns the absolute path to profiles.json in the Electron userData directory. */
function profilesFilePath(): string {
  return path.join(app.getPath('userData'), 'profiles.json')
}

/** Returns the absolute path to the encrypted passwords store. */
function passwordsFilePath(): string {
  return path.join(app.getPath('userData'), 'passwords.enc.json')
}

/**
 * Reads the encrypted passwords store from disk.
 * Returns a Map of profileId → encrypted-password-base64.
 * Returns an empty Map if the file does not exist.
 */
async function loadEncryptedPasswords(): Promise<Map<string, string>> {
  const filePath = passwordsFilePath()
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    const obj: Record<string, string> = JSON.parse(raw)
    return new Map(Object.entries(obj))
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return new Map()
    }
    throw err
  }
}

/**
 * Writes the encrypted passwords store to disk.
 */
async function saveEncryptedPasswords(passwords: Map<string, string>): Promise<void> {
  const filePath = passwordsFilePath()
  const obj: Record<string, string> = Object.fromEntries(passwords)
  await writeJsonAtomically(filePath, obj)
}

/**
 * Reads all saved connection profiles from disk.
 * Returns them sorted by lastConnected descending (most recent first).
 * Returns an empty array if the file does not yet exist.
 */
export async function listProfiles(): Promise<ConnectionProfile[]> {
  const filePath = profilesFilePath()
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    const profiles = (JSON.parse(raw) as StoredConnectionProfile[]).map(normalizeProfile)
    // Sort by lastConnected descending; null values go to the end
    return profiles.sort((a, b) => {
      if (a.lastConnected === null && b.lastConnected === null) return 0
      if (a.lastConnected === null) return 1
      if (b.lastConnected === null) return -1
      return b.lastConnected.localeCompare(a.lastConnected)
    })
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return []
    }
    throw err
  }
}

/**
 * Saves (upserts) a profile by id and stores its password using Electron safeStorage.
 * Creates profiles.json if it does not exist.
 */
export async function saveProfile(profile: ConnectionProfile, password: string | null): Promise<void> {
  return serializeMutation(async () => {
    const filePath = profilesFilePath()
    const existing = await listProfiles()

    const idx = existing.findIndex((p) => p.id === profile.id)
    if (idx >= 0) {
      existing[idx] = profile
    } else {
      existing.push(profile)
    }

    await writeJsonAtomically(filePath, existing)

    if (password === null) return

    // Encrypt and store password with safeStorage
    const passwords = await loadEncryptedPasswords()
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('系统凭据存储不可用，密码未保存')
    const encrypted = await safeStorage.encryptStringAsync(password)
    passwords.set(profile.id, encrypted.toString('base64'))
    await saveEncryptedPasswords(passwords)
  })
}

/**
 * Deletes a profile by id and removes its encrypted password.
 * Password deletion errors are silently ignored.
 */
export async function deleteProfile(id: string): Promise<void> {
  return serializeMutation(async () => {
    const filePath = profilesFilePath()
    const existing = await listProfiles()
    const updated = existing.filter((p) => p.id !== id)
    await writeJsonAtomically(filePath, updated)

    try {
      const passwords = await loadEncryptedPasswords()
      passwords.delete(id)
      await saveEncryptedPasswords(passwords)
    } catch {
      // Silently ignore password deletion errors
    }
  })
}

/**
 * Retrieves the stored password for a profile id.
 * Returns null if no password is found, without throwing.
 */
export async function getPassword(id: string): Promise<string | null> {
  try {
    const passwords = await loadEncryptedPasswords()
    const encryptedBase64 = passwords.get(id)
    if (!encryptedBase64) {
      return null
    }
    const buffer = Buffer.from(encryptedBase64, 'base64')
    if (!await safeStorage.isAsyncEncryptionAvailable()) {
      console.warn('[profile.service] safeStorage encryption not available, cannot decrypt password')
      return null
    }
    const { result } = await safeStorage.decryptStringAsync(buffer)
    return result
  } catch {
    return null
  }
}

export async function hasPassword(id: string): Promise<boolean> {
  const passwords = await loadEncryptedPasswords()
  // This is inventory, not a credential access. Even an availability probe can
  // initialize the macOS Keychain provider and ask for permission.
  return Boolean(passwords.get(id))
}
