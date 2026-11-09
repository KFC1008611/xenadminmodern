import { createLogger } from '../logger'
import { connectionManager } from '../xapi/connection-manager'
import { getPassword, listProfiles, saveProfile } from './profile.service'

const connectingProfiles = new Map<string, Promise<{ id: string }>>()

export async function connectSavedProfile(profileId: string, suppliedPassword?: string): Promise<{ id: string }> {
  const pending = connectingProfiles.get(profileId)
  if (pending) return pending
  const operation = (async () => {
    const profile = (await listProfiles()).find((entry) => entry.id === profileId)
    if (!profile) throw new Error('已保存服务器不存在，请刷新列表')
    const existing = connectionManager.getConnectionInfo(profileId)
    if (existing?.state === 'connected') return { id: profileId }
    const password = suppliedPassword ?? await getPassword(profileId)
    if (!password) throw Object.assign(new Error('无法读取已保存密码，请重新输入密码'), { code: 'SAVED_PASSWORD_UNAVAILABLE' })
    const id = await connectionManager.connect({
      host: profile.host, port: profile.port, scheme: profile.scheme,
      username: profile.username, password, name: profile.name,
      allowSelfSigned: profile.allowSelfSigned ?? false,
    }, profileId)
    // Connection success is independent from an optional last-used timestamp write.
    try {
      await saveProfile({ ...profile, lastConnected: new Date().toISOString() }, suppliedPassword ?? null)
    } catch {
      createLogger('SavedConnection').warn('连接成功，但保存服务器记录失败')
    }
    return { id }
  })()
  connectingProfiles.set(profileId, operation)
  try { return await operation } finally { connectingProfiles.delete(profileId) }
}
