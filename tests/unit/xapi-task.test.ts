import { describe, expect, it, vi } from 'vitest'
import { waitForXapiTask } from '../../src/main/xapi/services/xapi-task'

describe('XAPI async task completion', () => {
  it('waits for status success instead of treating a pending task as complete', async () => {
    const callWithSession = vi.fn()
      .mockResolvedValueOnce({ status: 'pending', progress: 1 })
      .mockResolvedValueOnce({ status: 'success', result: 'OpaqueRef:result' })
    const task = await waitForXapiTask({ callWithSession }, 'OpaqueRef:task', { pollMs: 0 })
    expect(task.result).toBe('OpaqueRef:result')
    expect(callWithSession).toHaveBeenCalledTimes(2)
  })

  it('surfaces the XAPI failure details', async () => {
    const callWithSession = vi.fn().mockResolvedValue({ status: 'failure', error_info: ['SR_BACKEND_FAILURE', 'disk full'] })
    await expect(waitForXapiTask({ callWithSession }, 'OpaqueRef:task'))
      .rejects.toMatchObject({ code: 'TASK_FAILED', details: { taskRef: 'OpaqueRef:task' } })
  })

  it('bounds consecutive task read failures without resubmitting', async () => {
    const callWithSession = vi.fn().mockRejectedValue(new Error('connection lost'))
    await expect(waitForXapiTask({ callWithSession }, 'OpaqueRef:task', { pollMs: 0 }))
      .rejects.toMatchObject({ code: 'TASK_OUTCOME_UNKNOWN', message: expect.stringContaining('connection lost') })
    expect(callWithSession).toHaveBeenCalledTimes(3)
  })

  it('automatically recovers transient task reads and returns the original result', async () => {
    const callWithSession = vi.fn().mockRejectedValueOnce(new Error('temporary disconnect'))
      .mockResolvedValueOnce({ status: 'success', result: 'original-result' })
    await expect(waitForXapiTask({ callWithSession }, 'OpaqueRef:task', { pollMs: 0 }))
      .resolves.toMatchObject({ result: 'original-result' })
    expect(callWithSession.mock.calls).toEqual([['task.get_record', ['OpaqueRef:task']], ['task.get_record', ['OpaqueRef:task']]])
  })

  it('resets consecutive failures after a valid pending response', async () => {
    const callWithSession = vi.fn().mockRejectedValueOnce(new Error('first'))
      .mockResolvedValueOnce({ status: 'pending' }).mockRejectedValueOnce(new Error('second'))
      .mockResolvedValueOnce({ status: 'success' })
    await expect(waitForXapiTask({ callWithSession }, 'OpaqueRef:task', { pollMs: 0, maxReadFailures: 2 }))
      .resolves.toMatchObject({ status: 'success' })
  })

  it('stops waiting when a task stays pending beyond the deadline', async () => {
    const callWithSession = vi.fn().mockResolvedValue({ status: 'pending' })
    await expect(waitForXapiTask({ callWithSession }, 'OpaqueRef:task', { timeoutMs: 0 }))
      .rejects.toMatchObject({ code: 'TASK_OUTCOME_UNKNOWN' })
  })
})
