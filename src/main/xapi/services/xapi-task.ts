/** Observe an XAPI Async.* task without replaying its mutation on a read failure. */
export type XapiTaskClient = {
  callWithSession: (method: string, params: unknown[]) => Promise<any>
}

export class XapiTaskError extends Error {
  constructor(
    readonly code: 'TASK_FAILED' | 'TASK_CANCELLED' | 'TASK_OUTCOME_UNKNOWN',
    message: string,
    readonly details: { taskRef: string },
  ) {
    super(message)
  }
}

const POLL_MS = 1000
const TIMEOUT_MS = 10 * 60 * 1000

export async function waitForXapiTask(
  client: XapiTaskClient,
  taskRef: string,
  options: { pollMs?: number; timeoutMs?: number; maxReadFailures?: number } = {},
): Promise<any> {
  const pollMs = options.pollMs ?? POLL_MS
  const deadline = Date.now() + (options.timeoutMs ?? TIMEOUT_MS)
  let readFailures = 0

  while (true) {
    let task: any
    try {
      task = await client.callWithSession('task.get_record', [taskRef])
      readFailures = 0
    } catch (error) {
      if (++readFailures >= (options.maxReadFailures ?? 3) || Date.now() >= deadline) {
        throw new XapiTaskError(
          'TASK_OUTCOME_UNKNOWN',
          `无法获取任务 ${taskRef} 的执行结果：${error instanceof Error ? error.message : String(error)}`,
          { taskRef },
        )
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs))
      continue
    }

    if (task?.status === 'success') return task
    if (task?.status === 'failure') {
      const reason = Array.isArray(task.error_info) ? task.error_info.join(': ') : ''
      throw new XapiTaskError('TASK_FAILED', `任务 ${taskRef} 失败${reason ? `：${reason}` : '。'}`, { taskRef })
    }
    if (task?.status === 'cancelled') {
      throw new XapiTaskError('TASK_CANCELLED', `任务 ${taskRef} 已取消。`, { taskRef })
    }
    if (task?.status !== 'pending' && task?.status !== 'cancelling') {
      throw new XapiTaskError('TASK_OUTCOME_UNKNOWN', `任务 ${taskRef} 返回无效状态：${String(task?.status)}`, { taskRef })
    }
    if (Date.now() >= deadline) {
      throw new XapiTaskError('TASK_OUTCOME_UNKNOWN', `等待任务 ${taskRef} 执行结果超时，服务器仍报告 ${task.status}。`, { taskRef })
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

export function taskOutcomeUnknown(taskRef: string, reason?: string): XapiTaskError {
  return new XapiTaskError(
    'TASK_OUTCOME_UNKNOWN',
    `服务器任务 ${taskRef} 已成功，但无法获取最终资源状态${reason ? `：${reason}` : '。'}`,
    { taskRef },
  )
}
