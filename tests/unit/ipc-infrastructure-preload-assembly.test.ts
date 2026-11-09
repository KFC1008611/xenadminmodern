import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('infrastructure and observability IPC production assembly', () => {
  it('wires both builders into the contextBridge surface without raw migrated invokes', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/preload/index.ts'), 'utf8')

    expect(source).toContain("import { createInfrastructureApi } from './infrastructure-api'")
    expect(source).toContain("import { createObservabilityApi } from './observability-api'")
    expect(source).toContain('const infrastructureApi = createInfrastructureApi(ipcRenderer)')
    expect(source).toContain('const observabilityApi = createObservabilityApi(ipcRenderer)')

    for (const exposure of [
      'pool: infrastructureApi.pool',
      'tasks: infrastructureApi.tasks',
      'profiles: infrastructureApi.profiles',
      'console: infrastructureApi.console',
      'dialog: infrastructureApi.dialog',
      'batch: infrastructureApi.batch',
      'console: infrastructureApi.vm.console',
      'metrics: observabilityApi.metrics',
      'alerts: observabilityApi.alerts',
      'alertRules: observabilityApi.alertRules',
      'alertHistory: observabilityApi.alertHistory',
      'alertNotify: observabilityApi.alertNotify',
      'onAlertTriggered: observabilityApi.onAlertTriggered',
      'onBatchProgress: infrastructureApi.onBatchProgress',
    ]) {
      expect(source).toContain(exposure)
    }

    expect(source).not.toMatch(
      /invoke(?:<[^>]+>)?\s*\(\s*Ch\.(?:POOL_|TASK_|PROFILE_|CONSOLE_|DIALOG_|BATCH_|METRICS_|ALERTS_|ALERT_RULES_|ALERT_HISTORY_|ALERT_NOTIFY_)/m,
    )
    expect(source).not.toContain('ipcRenderer.on(Ch.EVENT_ALERT_TRIGGERED')
    expect(source).not.toContain('ipcRenderer.on(Ch.EVENT_BATCH_PROGRESS')
  })

  it('registers and sends both one-way pushes through descriptors', () => {
    const handlerSource = readFileSync(
      resolve(process.cwd(), 'src/main/ipc/handlers/infrastructure.ts'),
      'utf8',
    )
    const batchSource = readFileSync(
      resolve(process.cwd(), 'src/main/batch/batch-task.manager.ts'),
      'utf8',
    )

    expect(handlerSource).toContain(
      'registerPushContract(ObservabilityIpc.alertTriggeredContract)',
    )
    expect(handlerSource).toContain(
      'registerPushContract(InfrastructureIpc.batchProgressContract)',
    )
    expect(handlerSource).toContain(
      'sendIpcContractPush('
    )
    expect(batchSource).toContain(
      'sendIpcContractPush(this.mainWindow.webContents, batchProgressContract, event)',
    )
    expect(handlerSource).not.toContain(
      'handleContract(ObservabilityIpc.alertTriggeredContract',
    )
    expect(handlerSource).not.toContain(
      'handleContract(InfrastructureIpc.batchProgressContract',
    )
  })
})
