import type { VmPowerIntent } from '../../../shared/types/xapi'
import { connectionManager } from '../connection-manager'
import { canRunVmAction, VM_POWER_OPERATIONS, type VmPowerAction } from '../../../shared/vm-actions'
import { waitForXapiTask, taskOutcomeUnknown } from './xapi-task'
import { readOperationResult, ReadScopeChangedError } from '../../../shared/read-operation-result'

// Single and batch operations share reservations, taken before the first read.
const inFlight = new Set<string>()

function powerError(code: string, message: string, outcome: 'failed' | 'unknown') {
  return Object.assign(new Error(message), { code, details: { outcome } })
}

export async function runVmPowerAction(connectionId: string, vmRef: string, action: VmPowerAction, intent?: VmPowerIntent): Promise<void> {
  const key = JSON.stringify([connectionId, vmRef])
  if (inFlight.has(key)) throw powerError('VM_POWER_IN_PROGRESS', '该 VM 的电源操作正在执行，请等待结果', 'failed')
  inFlight.add(key)
  let resourceKey: string | undefined
  try {
    const client = connectionManager.getClient(connectionId)
    if (!client) throw powerError('VM_POWER_PRECHECK_FAILED', '连接已断开，请重新连接后读取 VM 状态', 'failed')
    const info = connectionManager.getConnectionInfo(connectionId)
    const identity = JSON.stringify([info?.poolUuid, info?.epoch])
    const currentConnection = () => {
      const fresh = connectionManager.getConnectionInfo(connectionId)
      return JSON.stringify([fresh?.poolUuid, fresh?.epoch]) === identity
        && connectionManager.getClient(connectionId) === client
    }
    let before: any
    try { before = await client.callWithSession('VM.get_record', [vmRef]) } catch (error: any) {
      throw powerError('VM_POWER_PRECHECK_FAILED', `无法读取最新 VM 状态，未提交电源操作：${error?.message || String(error)}`, 'failed')
    }
    if (!before || typeof before !== 'object') throw powerError('VM_POWER_PRECHECK_FAILED', 'VM 状态无效，未提交电源操作', 'failed')
    const guard = canRunVmAction(before, action)
    const intentMatches = !intent || (intent.vmUuid === before.uuid
      && (intent.poolUuid === undefined || intent.poolUuid === info?.poolUuid)
      && (intent.epoch === undefined || intent.epoch === info?.epoch))
    if (!guard.canRun || !before?.uuid || !intentMatches || !currentConnection()) {
      throw powerError('VM_POWER_PRECHECK_FAILED', (!intentMatches ? '确认后 VM 或资源池连接已变化，请刷新后重新确认' : guard.reason) || 'VM 或资源池身份已变化，请刷新后重新确认', 'failed')
    }
    // Two management connections may point at the same VM in one resource pool.
    resourceKey = JSON.stringify(['vm', info?.poolUuid || connectionId, before.uuid])
    if (inFlight.has(resourceKey)) {
      resourceKey = undefined
      throw powerError('VM_POWER_IN_PROGRESS', '该 VM 已从另一个管理连接发起电源操作，请等待结果', 'failed')
    }
    inFlight.add(resourceKey)
    const { operation, state, label } = VM_POWER_OPERATIONS[action]
    const args = action === 'start' || action === 'resume' ? [vmRef, false, false] : [vmRef]
    let taskRef: string
    try {
      taskRef = await client.callWithSession(`Async.VM.${operation}`, args)
    } catch (error: any) {
      if (error?.details?.kind === 'xapi') throw error
      throw powerError('VM_POWER_OUTCOME_UNKNOWN', `无法获取${label}请求的响应：${error?.message || String(error)}`, 'unknown')
    }
    if (typeof taskRef !== 'string' || !taskRef.startsWith('OpaqueRef:') || taskRef === 'OpaqueRef:NULL') {
      throw powerError('VM_POWER_OUTCOME_UNKNOWN', `${label}响应缺少有效任务引用，无法获取执行结果`, 'unknown')
    }
    await waitForXapiTask(client, taskRef)
    try {
      await readOperationResult(async () => {
        const after = await client.callWithSession('VM.get_record', [vmRef])
        if (after?.uuid !== before.uuid) throw new ReadScopeChangedError()
        if (after.power_state !== state) throw new Error(`VM 当前状态为 ${after.power_state}，预期为 ${state}`)
      }, { isCurrent: currentConnection })
    } catch (error) {
      throw taskOutcomeUnknown(taskRef, error instanceof Error ? error.message : String(error))
    }
    // Keep the server task available for inspection, including after observation failure.
  } finally {
    inFlight.delete(key)
    if (resourceKey) inFlight.delete(resourceKey)
  }
}
