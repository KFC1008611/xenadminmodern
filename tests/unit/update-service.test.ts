import { stageMacUpdate } from '../../src/main/updates/mac-staging'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureJsonStoreDirectory, readJsonStore } from '../../src/main/persistence/json-store'
import { UpdateService } from '../../src/main/updates/update-service'
import { beginUpdateInstallation, endUpdateInstallation, enterApplicationRequest } from '../../src/main/lifecycle/update-admission'
import { updateSetEnabledContract, updateStateSchema } from '../../src/shared/ipc-contracts/updates'
import { createUpdateApi } from '../../src/preload/update-api'

class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  allowPrerelease = true
  allowDowngrade = true
  checkForUpdates = vi.fn().mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: '1.10.0' } })
  downloadUpdate = vi.fn().mockImplementation(async () => { this.emit('update-downloaded', { version: '1.10.0' }); return ['/cache/update'] })
  quitAndInstall = vi.fn()
}
let directory: string
let updater: FakeUpdater
let install: ReturnType<typeof vi.fn>
let service: UpdateService
beforeEach(() => {
  vi.useFakeTimers()
  directory = mkdtempSync(join(tmpdir(), 'xenadmin-updates-'))
  configureJsonStoreDirectory(directory)
  updater = new FakeUpdater()
  install = vi.fn().mockResolvedValue(undefined)
  service = new UpdateService(updater as never, '1.2.1', true, install)
})
afterEach(() => {
  service.stop()
  endUpdateInstallation()
  configureJsonStoreDirectory(null)
  rmSync(directory, { recursive: true, force: true })
  vi.useRealTimers()
})

describe('built-in updates', () => {
  it('checks after startup and every six hours without downloading or installing', async () => {
    service.start()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(service.getState()).toMatchObject({ status: 'available', version: '1.10.0' })
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(updater.allowPrerelease).toBe(false)
    expect(updater.allowDowngrade).toBe(false)
  })
  it('persists disabling automatic checks and keeps manual checking available', async () => {
    service.start()
    service.setEnabled(false)
    await vi.advanceTimersByTimeAsync(7 * 60 * 60 * 1000)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(readJsonStore('updates', {})).toEqual({ enabled: false })
    const restored = new UpdateService(updater as never, '1.2.1', true, install)
    expect(restored.getState().enabled).toBe(false)
    await restored.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    restored.stop()
  })
  it('discards a late check after disabling and deduplicates concurrent checks', async () => {
    let finish!: (value: unknown) => void
    updater.checkForUpdates.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const pending = service.check()
    await service.check()
    service.setEnabled(false)
    finish({ isUpdateAvailable: true, updateInfo: { version: '9.0.0' } })
    await pending
    expect(service.getState()).toMatchObject({ enabled: false, status: 'idle', version: null })
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })
  it('does not turn a failed check into a current-version confirmation', async () => {
    updater.checkForUpdates.mockRejectedValueOnce(new Error('network failed'))
    expect(await service.check()).toMatchObject({ status: 'error', checkedAt: null })
    updater.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: false, updateInfo: { version: '1.2.1' } })
    expect(await service.check()).toMatchObject({ status: 'current', version: null, checkedAt: expect.any(Number) })
  })
  it('downloads inside the app, exposes progress and only permits installation after the downloaded event', async () => {
    expect(() => service.requestInstall()).toThrow()
    await service.check()
    let finish!: (value: string[]) => void
    updater.downloadUpdate.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    expect(service.download().status).toBe('downloading')
    updater.emit('download-progress', { percent: 42.5 })
    expect(service.getState().progress).toBe(42.5)
    expect(() => service.download()).toThrow()
    expect(() => service.requestInstall()).toThrow()
    updater.emit('update-downloaded', { version: '1.10.0' })
    finish(['/cache/update'])
    await Promise.resolve()
    expect(service.requestInstall().status).toBe('installing')
    await vi.advanceTimersByTimeAsync(0)
    expect(install).toHaveBeenCalledTimes(1)
  })
  it('reports download checksum errors and permits a new check', async () => {
    await service.check()
    updater.downloadUpdate.mockRejectedValueOnce(new Error('sha512 mismatch'))
    service.download()
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getState().status).toBe('error')
    expect(() => service.requestInstall()).toThrow()
    expect((await service.check()).status).toBe('available')
  })
  it('keeps an explicitly started download running when automatic checks are disabled', async () => {
    await service.check()
    service.download()
    service.setEnabled(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getState()).toMatchObject({ enabled: false, status: 'downloaded' })
    expect(install).not.toHaveBeenCalled()
  })
  it('shows the installation guard failure and allows retrying the downloaded package', async () => {
    await service.check()
    service.download()
    await vi.advanceTimersByTimeAsync(0)
    install.mockRejectedValueOnce(new Error('仍有批量任务'))
    service.requestInstall()
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getState()).toMatchObject({ status: 'downloaded', message: '仍有批量任务' })
    service.requestInstall()
    await vi.advanceTimersByTimeAsync(0)
    expect(install).toHaveBeenCalledTimes(2)
  })
  it('does not contact the update server from unpackaged or unsupported builds', async () => {
    const unsupported = new UpdateService(updater as never, '1.2.1', false, install)
    unsupported.start()
    await vi.advanceTimersByTimeAsync(20_000)
    await expect(unsupported.check()).rejects.toThrow()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    unsupported.stop()
  })
  it('fails closed on corrupt preferences and only enables checks after a successful save', () => {
    writeFileSync(join(directory, 'updates.json'), '{invalid')
    const restored = new UpdateService(updater as never, '1.2.1', true, install)
    expect(restored.getState().enabled).toBe(false)
    expect(restored.setEnabled(true).enabled).toBe(true)
    restored.stop()
  })
  it('stops timers and discards pending responses during shutdown', async () => {
    service.start()
    service.stop()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })
  it('blocks installation during active IPC work and rejects new work during installation', () => {
    const leave = enterApplicationRequest('vm:start')
    expect(() => beginUpdateInstallation()).toThrow('正在处理请求')
    leave()
    beginUpdateInstallation()
    expect(() => enterApplicationRequest('vm:start')).toThrow('正在准备安装更新')
    expect(() => enterApplicationRequest('updates:getState')()).not.toThrow()
    endUpdateInstallation()
    expect(() => enterApplicationRequest('vm:list')()).not.toThrow()
  })
  it('waits for native macOS signature verification before completing staging', async () => {
    const native = Object.assign(new EventEmitter(), { checkForUpdates: vi.fn() })
    const staged = stageMacUpdate(native)
    expect(native.checkForUpdates).toHaveBeenCalledTimes(1)
    native.emit('update-downloaded')
    await staged
    expect(native.listenerCount('error')).toBe(0)
    expect(native.listenerCount('update-downloaded')).toBe(0)
  })
  it('rejects a failed or timed-out native macOS staging operation', async () => {
    const native = Object.assign(new EventEmitter(), { checkForUpdates: vi.fn() })
    const failed = expect(stageMacUpdate(native)).rejects.toThrow('签名验证失败')
    native.emit('error', new Error('invalid signature'))
    await failed
    const timeout = expect(stageMacUpdate(native)).rejects.toThrow('准备超时')
    await vi.advanceTimersByTimeAsync(120_000)
    await timeout
    expect(native.listenerCount('error')).toBe(0)
  })
  it('configures GitHub update manifests and installable targets for all desktop platforms', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.dependencies['electron-updater']).toBe('6.8.12')
    expect(pkg.build.publish).toEqual([{ provider: 'github', owner: 'KFC1008611', repo: 'xenadminmodern', releaseType: 'release' }])
    expect(pkg.build.mac.target).toEqual(['dmg', 'zip'])
    expect(pkg.build.win.target).toEqual(['nsis'])
    expect(pkg.build.linux.target).toEqual(['AppImage'])
    expect(readFileSync('.github/workflows/release.yml', 'utf8')).toContain('release/latest-mac.yml')
  })
  it('validates IPC preferences and update state and exposes only typed updater calls', async () => {
    expect(() => updateSetEnabledContract.argsSchema.parse(['false'])).toThrow()
    expect(() => updateStateSchema.parse({ ...service.getState(), progress: Infinity })).toThrow()
    const transport = { invoke: vi.fn().mockResolvedValue(service.getState()) }
    const api = createUpdateApi(transport)
    await api.getState()
    await api.setEnabled(false)
    await api.check()
    await api.download()
    await api.install()
    expect(transport.invoke.mock.calls.map(([channel]) => channel)).toEqual(['updates:getState', 'updates:setEnabled', 'updates:check', 'updates:download', 'updates:install'])
  })
})
