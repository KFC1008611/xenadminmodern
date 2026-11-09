import type { EventEmitter } from 'node:events'

/** Let Squirrel verify the application before management connections are closed. */
export function stageMacUpdate(updater: EventEmitter & { checkForUpdates(): void }): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer)
      updater.removeListener('error', failed)
      updater.removeListener('update-downloaded', downloaded)
      if (error) reject(new Error('更新包签名验证失败或准备超时，请重新下载更新'))
      else resolve()
    }
    const failed = (error: Error) => finish(error)
    const downloaded = () => finish()
    const timer = setTimeout(() => finish(new Error('Update staging timed out')), 120_000)
    updater.once('error', failed)
    updater.once('update-downloaded', downloaded)
    try { updater.checkForUpdates() } catch (error) { finish(error as Error) }
  })
}
