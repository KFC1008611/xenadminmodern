/**
 * IPC handler registry — connects Electron ipcMain channels to XAPI services.
 * Every handler is wrapped in try/catch to prevent unhandled rejections in the main process.
 *
 * This file is the composition root — it delegates to domain-specific handler modules.
 * Individual handler logic lives in ./handlers/*.ts
 */
import type { BrowserWindow } from 'electron'

// Re-export for backward compatibility with any local consumers
export type { IpcErrorResponse } from '../../shared/types/xapi'

import { registerUpdateHandlers } from './handlers/updates'
import { registerConnectionHandlers } from './handlers/connection'
import { registerHostHandlers } from './handlers/host'
import { registerVmHandlers } from './handlers/vm'
import { registerStorageHandlers } from './handlers/storage'
import { registerInfrastructureHandlers, bindInfrastructureWindow } from './handlers/infrastructure'
import { registerHaHandlers } from './handlers/ha'
import { registerPatchHandlers } from './handlers/patch'
import { registerRbacHandlers } from './handlers/rbac'
import { registerVmAdvancedHandlers } from './handlers/vm-advanced'
import { rebindIpcOwner, registerPushContract } from './handlers/utils'
import { vmChangedContract } from '../../shared/ipc-contracts/vm'
import { setVmEventWindow } from '../xapi/services/vm-event.service'

export function bindIpcOwner(owner: BrowserWindow, trustedDocumentUrl: string): void {
  rebindIpcOwner(owner, trustedDocumentUrl)
  setVmEventWindow(owner)
  bindInfrastructureWindow(owner)
}

/**
 * Register all IPC handlers. Called once from the main process entry point.
 */
export function registerIpcHandlers(mainWindow?: BrowserWindow): void {
  setVmEventWindow(mainWindow)
  registerConnectionHandlers()
  registerUpdateHandlers()
  registerHostHandlers()
  registerVmHandlers()
  registerStorageHandlers()
  registerInfrastructureHandlers(mainWindow)
  registerHaHandlers()
  registerPatchHandlers()
  registerRbacHandlers()
  registerVmAdvancedHandlers()
  registerPushContract(vmChangedContract)
}
