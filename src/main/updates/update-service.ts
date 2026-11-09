import type { AppUpdater } from 'electron-updater'
import type { UpdateState } from '../../shared/ipc-contracts/updates'
import { readJsonStore, writeJsonStore } from '../persistence/json-store'

const CHECK_INTERVAL = 6 * 60 * 60 * 1000

type Updater = Pick<AppUpdater, 'on' | 'autoDownload' | 'autoInstallOnAppQuit' | 'allowPrerelease' | 'allowDowngrade' | 'checkForUpdates' | 'downloadUpdate' | 'quitAndInstall'>

export class UpdateService {
  private state: UpdateState
  private timer?: ReturnType<typeof setTimeout>
  private stopped = false
  private generation = 0
  private checking = false
  private downloading = false
  private downloadReady = false

  constructor(private readonly updater: Updater, version: string, supported: boolean, private readonly install: () => Promise<void>) {
    let enabled = false
    let message = supported ? '' : '请使用已安装的正式版本检查更新'
    try {
      const saved = readJsonStore<unknown>('updates', { enabled: true })
      if (!saved || typeof saved !== 'object' || typeof (saved as { enabled?: unknown }).enabled !== 'boolean') throw new Error('Invalid update settings')
      enabled = (saved as { enabled: boolean }).enabled
    } catch { message = '无法读取更新设置，自动检查已停止，请重新保存开关' }
    this.state = { currentVersion: version, enabled, supported, status: 'idle', version: null, progress: 0, checkedAt: null, message }
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowPrerelease = false
    updater.allowDowngrade = false
    updater.on('error', () => {
      if (this.downloading || this.state.status === 'installing') this.fail('更新失败，请重新检查并下载更新')
    })
    updater.on('download-progress', (progress) => {
      if (this.downloading && Number.isFinite(progress.percent)) this.patch({ progress: Math.max(0, Math.min(100, progress.percent)) })
    })
    updater.on('update-downloaded', () => {
      if (!this.downloading) return
      this.downloadReady = true
      this.patch({ status: 'downloaded', progress: 100, message: '' })
    })
  }

  getState(): UpdateState { return { ...this.state } }
  private patch(change: Partial<UpdateState>): void { this.state = { ...this.state, ...change } }
  private fail(message: string): void { this.downloadReady = false; this.patch({ status: 'error', message }) }

  start(): void { this.schedule(15_000) }
  stop(): void { this.stopped = true; this.generation++; clearTimeout(this.timer) }
  private schedule(delay = CHECK_INTERVAL): void {
    clearTimeout(this.timer)
    if (this.stopped || !this.state.enabled || !this.state.supported) return
    this.timer = setTimeout(() => {
      void this.check(false).finally(() => this.schedule())
    }, delay)
    this.timer.unref?.()
  }

  setEnabled(enabled: boolean): UpdateState {
    if (this.state.status === 'installing') throw new Error('正在安装更新')
    writeJsonStore('updates', { enabled }, { flush: true })
    this.generation++
    this.patch({ enabled })
    if (['idle', 'checking'].includes(this.state.status)) this.patch({ status: 'idle', message: this.state.supported ? '' : '请使用已安装的正式版本检查更新' })
    this.schedule(enabled ? 15_000 : CHECK_INTERVAL)
    return this.getState()
  }

  async check(manual = true): Promise<UpdateState> {
    if (!this.state.supported) throw new Error(this.state.message)
    if (this.stopped || this.checking || this.downloading || ['downloaded', 'installing'].includes(this.state.status) || (!manual && !this.state.enabled)) return this.getState()
    this.checking = true
    const generation = this.generation
    this.patch({ status: 'checking', message: '正在检查更新' })
    try {
      const result = await this.updater.checkForUpdates()
      if (generation !== this.generation || this.stopped) return this.getState()
      if (!result) throw new Error('No update result')
      // electron-updater performs SemVer comparison and rejects prereleases/downgrades.
      if (result.isUpdateAvailable) {
        this.patch({ status: 'available', version: result.updateInfo.version, progress: 0, checkedAt: Date.now(), message: `发现新版本 ${result.updateInfo.version}` })
      } else {
        this.patch({ status: 'current', version: null, progress: 0, checkedAt: Date.now(), message: '已是最新版本' })
      }
    } catch {
      if (generation === this.generation && !this.stopped) this.fail('检查失败，请检查网络连接或稍后重试；发布版本需包含当前平台的更新文件')
    } finally { this.checking = false }
    return this.getState()
  }

  download(): UpdateState {
    if (this.checking || this.downloading || this.state.status !== 'available') throw new Error('请先检查并确认可用的新版本')
    this.downloading = true
    this.downloadReady = false
    this.patch({ status: 'downloading', progress: 0, message: '正在下载更新' })
    void this.updater.downloadUpdate().then(() => {
      if (!this.downloadReady) this.fail('下载未完成，请重新检查更新')
    }).catch(() => this.fail('下载或校验失败，请检查网络后重新检查更新')).finally(() => { this.downloading = false })
    return this.getState()
  }

  requestInstall(): UpdateState {
    if (!this.downloadReady || this.state.status !== 'downloaded') throw new Error('更新包尚未下载并校验完成')
    this.patch({ status: 'installing', message: '正在准备重启安装' })
    // Return the IPC response before teardown starts.
    setImmediate(() => {
      void this.install().catch((error: unknown) => {
        this.patch({ status: this.downloadReady ? 'downloaded' : 'error', message: error instanceof Error ? error.message : '无法开始安装，请稍后重试' })
      })
    })
    return this.getState()
  }
}

let service: UpdateService | undefined
export function configureUpdateService(value: UpdateService): void { service = value }
export function getUpdateService(): UpdateService {
  if (!service) throw new Error('更新服务尚未启动')
  return service
}
