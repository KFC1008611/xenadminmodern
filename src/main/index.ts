/**
 * Electron main process entry point.
 * Creates the BrowserWindow and registers all IPC handlers before the renderer loads.
 */
import { app, BrowserWindow, autoUpdater as nativeUpdater } from 'electron'
import { autoUpdater } from 'electron-updater'
import { UpdateService, configureUpdateService } from './updates/update-service'
import { stageMacUpdate } from './updates/mac-staging'
import { beginUpdateInstallation, endUpdateInstallation, isUpdateInstalling } from './lifecycle/update-admission'
import { isBatchRunning } from '../shared/batch-policy'
import { hasPendingCopies } from './xapi/services/vm-copy.service'
import { hasPendingTransfers } from './xapi/services/vm-import.service'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { connectionManager } from './xapi/connection-manager'
import { recoverTransfersForConnection } from './xapi/services/vm-import.service'
import { configureJsonStoreDirectory } from './persistence/json-store'
import { bindIpcOwner, registerIpcHandlers } from './ipc/handlers'
import { closeAllConsoleSessions } from './console/console.service'
import { stopAllVmEventWatchers } from './xapi/services/vm-event.service'
// v7: metrics/alert store and engine lifecycle
import { initDatabase, closeDatabase } from './xapi/services/metrics-db.service'
import { initDefaultRules } from './xapi/services/alert-rule.service'
import { startAlertEngine, stopAlertEngine } from './xapi/services/alert-engine.service'
import { stopAllCollections } from './xapi/services/metrics.service'
// v8: Batch task manager lifecycle
import { getBatchTaskManager, closeBatchTaskDatabase } from './batch'
import { runShutdownSteps } from './lifecycle/shutdown'

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    }
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    bindIpcOwner(mainWindow, rendererUrl)
    mainWindow.loadURL(rendererUrl)
  } else {
    const observationQuery = process.argv.includes('--b0-observation')
      ? { query: { b0Observation: 'guards' } }
      : undefined
    const rendererPath = join(__dirname, '../renderer/index.html')
    const trustedDocumentUrl = pathToFileURL(rendererPath)
    if (observationQuery) trustedDocumentUrl.searchParams.set('b0Observation', 'guards')
    bindIpcOwner(mainWindow, trustedDocumentUrl.href)
    mainWindow.loadFile(rendererPath, observationQuery)
  }

  return mainWindow
}

app.whenReady().then(() => {
  // Set app user model id for Windows
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.xcpng.xenadmin-modern')
  }

  app.on('browser-window-created', (_, window) => {
    // Watch window shortcuts (simplified from @electron-toolkit/utils)
    window.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.code === 'F12') {
        if (window.webContents.isDevToolsOpened()) {
          window.webContents.closeDevTools()
        } else {
          window.webContents.openDevTools({ mode: 'undocked' })
        }
      }
    })
  })

  configureJsonStoreDirectory(join(app.getPath('userData'), 'state'))

  autoUpdater.logger = null
  autoUpdater.setFeedURL({ provider: 'github', owner: 'KFC1008611', repo: 'xenadminmodern', private: false })
  const updates = new UpdateService(autoUpdater, app.getVersion(), app.isPackaged &&
    (process.platform !== 'linux' || Boolean(process.env.APPIMAGE)), async () => {
    beginUpdateInstallation()
    try {
      if (getBatchTaskManager().getAllTasks().some((task) => isBatchRunning(task.status)) || hasPendingCopies() || hasPendingTransfers()) {
        throw new Error('仍有批量任务、复制或导入导出任务，请处理完成后再安装更新')
      }
      if (process.platform === 'darwin') await stageMacUpdate(nativeUpdater)
      const failures: string[] = []
      await cleanupApplication((name) => { failures.push(name) })
      if (failures.length) throw new Error('退出清理失败，请重新启动应用后重试更新')
      shutdownFinished = true
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error) => { app.removeListener('before-quit', quitting); reject(error) }
        const quitting = () => { autoUpdater.removeListener('error', failed); resolve() }
        autoUpdater.once('error', failed)
        app.once('before-quit', quitting)
        try { autoUpdater.quitAndInstall() } catch (error) { autoUpdater.emit('error', error as Error) }
      })
    } catch (error) {
      shutdownFinished = false
      endUpdateInstallation()
      throw error
    }
  })
  configureUpdateService(updates)
  updates.start()
  app.once('before-quit', () => updates.stop())

  connectionManager.onConnectionReady((id) => {
    void recoverTransfersForConnection(id).catch((error) => console.error('Transfer recovery failed', error))
  })

  // Metric history restores in bounded worker chunks while the first window opens.
  const databaseReady = initDatabase()
  initDefaultRules()

  const mainWindow = createWindow()
  registerIpcHandlers(mainWindow)

  // Start alert engine (60s evaluation interval).
  void databaseReady.then(() => {
    if (!shutdownStarted) startAlertEngine()
  }).catch((error) => console.error('Metric history could not be restored', error))

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

let shutdownStarted = false
let shutdownFinished = false
app.on('before-quit', (event) => {
  if (shutdownFinished) return
  event.preventDefault()
  if (shutdownStarted || isUpdateInstalling()) return
  shutdownStarted = true
  void cleanupApplication((name, error) => console.error(`Shutdown cleanup failed: ${name}`, error)).finally(() => {
    shutdownFinished = true
    app.quit()
  })
})

function cleanupApplication(report: (name: string, error: unknown) => void): Promise<void> {
  return runShutdownSteps([
    { name: 'stop alert engine', run: stopAlertEngine },
    { name: 'stop metrics collection', run: stopAllCollections },
    { name: 'stop batch tasks', run: () => getBatchTaskManager().stopAll() },
    { name: 'close batch task store', run: closeBatchTaskDatabase },
    { name: 'close consoles', run: closeAllConsoleSessions },
    { name: 'stop VM event watchers', run: stopAllVmEventWatchers },
    { name: 'disconnect servers', run: () => connectionManager.disconnectAll() },
    { name: 'flush metrics store', run: closeDatabase },
  ], report)
}
