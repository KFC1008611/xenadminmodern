/**
 * Task service — wraps XAPI task.* methods for monitoring async operations.
 * All functions accept connectionId as the first parameter for multi-connection support.
 */
import { connectionManager } from '../connection-manager'
import { toIpcDateTime } from '../xapi-datetime'
import { waitForXapiTask, XapiTaskError } from './xapi-task'
import type { TaskCancellationResult } from '../../../shared/types/xapi'

export interface TaskRecord {
  ref: string
  uuid: string
  name_label: string
  name_description: string
  status: 'pending' | 'success' | 'failure' | 'cancelling' | 'cancelled'
  progress: number
  created: string
  finished: string
  error_info: string[]
}

export interface ConnectedTaskRecord extends TaskRecord {
  connectionId: string
  poolName: string
}

function getClient(connectionId: string) {
  const client = connectionManager.getClient(connectionId)
  if (!client) {
    throw new Error(`No connection found for connectionId: ${connectionId}`)
  }
  return client
}

function getPoolName(connectionId: string): string {
  return connectionManager.getConnectionInfo(connectionId)?.poolName ?? connectionId
}

export async function getAllTasks(connectionId: string): Promise<ConnectedTaskRecord[]> {
  const client = getClient(connectionId)
  const poolName = getPoolName(connectionId)
  // Use get_all_records to avoid N+1 pattern
  const allRecords: Record<string, any> = await client.callWithSession('task.get_all_records', [])
  const records = Object.entries(allRecords).map(([ref, record]) => ({
    ref,
    ...record,
    created: toIpcDateTime(record.created),
    finished: toIpcDateTime(record.finished),
    connectionId,
    poolName,
  })) as ConnectedTaskRecord[]
  return records
}

export async function cancelTask(connectionId: string, taskRef: string): Promise<TaskCancellationResult> {
  const client = getClient(connectionId)
  try { await client.callWithSession('task.cancel', [taskRef]) } catch (error: any) {
    if (error?.details?.kind !== 'transport') throw error
    // A lost acknowledgement does not authorize a second cancellation request.
  }
  try {
    await waitForXapiTask(client, taskRef)
    return { status: 'success', message: '任务已正常完成，取消未阻止任务完成' }
  } catch (error) {
    if (error instanceof XapiTaskError && error.code === 'TASK_CANCELLED') {
      return { status: 'cancelled', message: '任务已取消（服务器已确认）' }
    }
    if (error instanceof XapiTaskError && error.code === 'TASK_FAILED') {
      return { status: 'failure', message: error.message }
    }
    throw error
  }
}
