/**
 * Infrastructure IPC handlers — pool, tasks, alerts, profiles, console, dialog, metrics, alert rules/history, batch.
 */
import { BrowserWindow, dialog } from 'electron'
import { connectSavedProfile } from '../../profiles/saved-connection.service'
import { handleContract, registerPushContract } from './utils'
import * as InfrastructureIpc from '../../../shared/ipc-contracts/infrastructure'
import * as ObservabilityIpc from '../../../shared/ipc-contracts/observability'
import { assertAuditedFeatureAvailable } from '../../../shared/audited-features'
import { sendIpcContractPush } from '../ipc-contract-sender'
import { getPool, addHostToPool, removeHostFromPool, transferPoolMaster } from '../../xapi/services/pool.service'
import { getAllTasks, cancelTask } from '../../xapi/services/task.service'
import {
  listProfiles,
  saveProfile,
  deleteProfile,
  hasPassword,
} from '../../profiles/profile.service'
import {
  openConsoleSession,
  closeConsoleSession,
} from '../../console/console.service'
import {
  getAllAlerts,
  dismissAlert,
  dismissAllAlerts,
  getAlertHistory,
  acknowledgeAlert,
  getAlertCountByStatus,
  alertEmitter,
} from '../../xapi/services/alert.service'
import {
  startMetricsCollection,
  stopMetricsCollection,
  getMetricsHistory,
  getMetricsRange,
  getMetricsStats,
  getVmMetricsRange,
  collectVmMetrics,
  getCollectionError,
} from '../../xapi/services/metrics.service'
import {
  getAlertRules,
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
} from '../../xapi/services/alert-rule.service'
import { evaluateOnce } from '../../xapi/services/alert-engine.service'
import { initDatabase } from '../../xapi/services/metrics-db.service'
import {
  initBatchTaskManager,
} from '../../batch'
import {
  getNotificationConfig,
  saveNotificationConfig,
  initDefaultConfig,
  getNotificationHistory,
  sendAlertNotification,
  testNotification,
} from '../../xapi/services/alert-notification.service'
import type {
  AlertHistoryRecord,
} from '../../../shared/types/xapi'

let detachAlertForwarding: (() => void) | null = null

export function bindInfrastructureWindow(mainWindow?: BrowserWindow): void {
  initBatchTaskManager(mainWindow)
  if (detachAlertForwarding) {
    detachAlertForwarding()
    detachAlertForwarding = null
  }

  if (mainWindow) {
    const forwardAlert = (record: AlertHistoryRecord) => {
      if (!mainWindow.isDestroyed()) {
        sendIpcContractPush(
          mainWindow.webContents,
          ObservabilityIpc.alertTriggeredContract,
          record,
        )
      }
    }

    const maybeWindow = mainWindow as unknown as {
      on?: (event: string, listener: (...args: any[]) => void) => void
      removeListener?: (event: string, listener: (...args: any[]) => void) => void
    }

    const cleanupForwarding = () => {
      alertEmitter.removeListener('alertTriggered', forwardAlert)
      if (typeof maybeWindow.removeListener === 'function') {
        maybeWindow.removeListener('closed', onWindowClosed)
      }
    }

    const onWindowClosed = () => {
      cleanupForwarding()
      if (detachAlertForwarding === cleanupForwarding) {
        detachAlertForwarding = null
      }
    }

    alertEmitter.on('alertTriggered', forwardAlert)
    if (typeof maybeWindow.on === 'function') {
      maybeWindow.on('closed', onWindowClosed)
    }

    detachAlertForwarding = cleanupForwarding
  }

}

export function registerInfrastructureHandlers(mainWindow?: BrowserWindow): void {
  // Pool
  handleContract(InfrastructureIpc.poolGetContract, getPool)

  handleContract(InfrastructureIpc.poolAddHostContract, (connectionId, params) => {
    assertAuditedFeatureAvailable('pool.join')
    return addHostToPool(connectionId, params)
  })

  handleContract(InfrastructureIpc.poolRemoveHostContract, (connectionId, hostRef) => {
    assertAuditedFeatureAvailable('pool.eject')
    return removeHostFromPool(connectionId, hostRef)
  })

  handleContract(InfrastructureIpc.poolTransferMasterContract, (connectionId, newMasterRef) => {
    assertAuditedFeatureAvailable('pool.governance')
    return transferPoolMaster(connectionId, newMasterRef)
  })

  // Tasks
  handleContract(InfrastructureIpc.taskListContract, getAllTasks)

  handleContract(InfrastructureIpc.taskCancelContract, cancelTask)

  // XAPI Alerts
  handleContract(ObservabilityIpc.alertsGetAllContract, getAllAlerts)

  handleContract(ObservabilityIpc.alertsDismissContract, dismissAlert)

  handleContract(ObservabilityIpc.alertsDismissAllContract, dismissAllAlerts)

  // Profiles
  handleContract(InfrastructureIpc.profileListContract, listProfiles)
  handleContract(InfrastructureIpc.profileSaveContract, saveProfile)
  handleContract(InfrastructureIpc.profileDeleteContract, deleteProfile)
  handleContract(InfrastructureIpc.profileHasPasswordContract, hasPassword)
  handleContract(InfrastructureIpc.profileConnectContract, connectSavedProfile)

  // Dialog
  handleContract(InfrastructureIpc.dialogShowOpenContract, (options?) => {
    const ownerWindow = mainWindow && !mainWindow.isDestroyed()
      ? mainWindow
      : BrowserWindow.getFocusedWindow() ?? undefined
    if (ownerWindow) {
      return dialog.showOpenDialog(ownerWindow, options ?? {})
    }
    return dialog.showOpenDialog(options ?? {})
  })

  handleContract(InfrastructureIpc.dialogShowSaveContract, (options?) => {
    const ownerWindow = mainWindow && !mainWindow.isDestroyed()
      ? mainWindow
      : BrowserWindow.getFocusedWindow() ?? undefined
    if (ownerWindow) {
      return dialog.showSaveDialog(ownerWindow, options ?? {})
    }
    return dialog.showSaveDialog(options ?? {})
  })

  // Console
  handleContract(InfrastructureIpc.consoleGetUrlContract, openConsoleSession)

  handleContract(InfrastructureIpc.consoleCloseContract, closeConsoleSession)

  // Metrics
  handleContract(ObservabilityIpc.metricsStartCollectionContract, startMetricsCollection)

  handleContract(ObservabilityIpc.metricsStopCollectionContract, stopMetricsCollection)

  handleContract(ObservabilityIpc.metricsGetHistoryContract, getMetricsHistory)

  handleContract(ObservabilityIpc.metricsGetRangeContract, async (...args) => {
    await initDatabase()
    return getMetricsRange(...args)
  })

  handleContract(ObservabilityIpc.metricsGetStatsContract, async (...args) => {
    await initDatabase()
    return getMetricsStats(...args)
  })

  handleContract(ObservabilityIpc.metricsGetVmHistoryContract, async (
    connectionId,
    vmRef,
    params,
  ) => {
    await initDatabase()
    try {
      await collectVmMetrics(connectionId, vmRef)
    } catch {
      // Non-fatal: return persisted history even if on-demand sample fails.
    }
    return getVmMetricsRange(connectionId, vmRef, params)
  })

  handleContract(ObservabilityIpc.metricsGetCollectionErrorContract, getCollectionError)

  // Alert Rules (local operations, no connectionId)
  handleContract(ObservabilityIpc.alertRulesListContract, getAlertRules)
  handleContract(ObservabilityIpc.alertRulesCreateContract, createAlertRule)
  handleContract(ObservabilityIpc.alertRulesUpdateContract, updateAlertRule)
  handleContract(ObservabilityIpc.alertRulesDeleteContract, deleteAlertRule)
  handleContract(ObservabilityIpc.alertRulesEvaluateContract, evaluateOnce)

  // Alert History (local operations, no connectionId)
  handleContract(ObservabilityIpc.alertHistoryListContract, getAlertHistory)
  handleContract(ObservabilityIpc.alertHistoryAcknowledgeContract, acknowledgeAlert)
  handleContract(ObservabilityIpc.alertHistoryGetCountContract, getAlertCountByStatus)

  // Alert event forwarding — push triggered alerts to renderer.
  // Re-register safely to avoid accumulating listeners across re-initialization.
  registerPushContract(ObservabilityIpc.alertTriggeredContract)
  bindInfrastructureWindow(mainWindow)

  // Batch operations
  registerPushContract(InfrastructureIpc.batchProgressContract)
  const batchTaskManager = initBatchTaskManager(mainWindow)

  handleContract(InfrastructureIpc.batchSubmitContract, async (task) => {
    const { type, targets, options } = task
    const taskId = await batchTaskManager.submitTask(
      type,
      targets,
      options,
      task.requestId,
    )
    return { taskId }
  })

  handleContract(InfrastructureIpc.batchCancelContract, async (taskId) => {
    await batchTaskManager.cancelTask(taskId)
  })

  handleContract(InfrastructureIpc.batchGetStatusContract, async (taskId) => {
    const task = batchTaskManager.getTaskStatus(taskId)
    if (!task) {
      throw new Error('TASK_NOT_FOUND')
    }
    return task
  })

  handleContract(InfrastructureIpc.batchListContract, async () => {
    return batchTaskManager.getAllTasks()
  })

  handleContract(InfrastructureIpc.batchRetryContract, async (taskId, confirmation) => {
    await batchTaskManager.retryFailedItems(taskId, confirmation)
  })

  // v9: Alert notifications
  handleContract(ObservabilityIpc.alertNotifyConfigGetContract, () => {
    initDefaultConfig()
    return getNotificationConfig()!
  })

  handleContract(ObservabilityIpc.alertNotifyConfigSaveContract, (config) => {
    saveNotificationConfig(config)
    return { success: true as const }
  })

  handleContract(ObservabilityIpc.alertNotifyTestContract, (channel, config) => {
    return testNotification(channel, config)
  })

  handleContract(ObservabilityIpc.alertNotifyHistoryContract, (filters?) => {
    return getNotificationHistory(filters)
  })

  handleContract(ObservabilityIpc.alertNotifySendContract, (payload) => {
    return sendAlertNotification(payload)
  })
}
