import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeAction, executeConfirm } from '../../src/renderer/src/lib/executeAction'
import { useFeedbackStore } from '../../src/renderer/src/store/feedback.store'

describe('operation result feedback', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useFeedbackStore.setState({ toasts: [], progress: [], confirmDialog: null })
  })
  afterEach(() => vi.useRealTimers())

  it('keeps a successful mutation successful when its follow-up read fails', async () => {
    const action = vi.fn().mockResolvedValue(undefined)
    const onError = vi.fn()
    expect(await executeAction({ label: '启动 VM A', action, onError, trackProgress: true,
      onSuccess: async () => { throw new Error('连接中断') },
    })).toBe(true)
    expect(action).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
    expect(useFeedbackStore.getState().progress[0].status).toBe('completed')
    expect(useFeedbackStore.getState().toasts).toEqual([
      expect.objectContaining({ type: 'warning', message: expect.stringContaining('已完成，但后续刷新失败：连接中断') }),
    ])
  })

  it('does not refresh after a rejected mutation and preserves its error', async () => {
    const onSuccess = vi.fn()
    expect(await executeAction({ label: '操作', trackProgress: true, onSuccess,
      action: async () => { throw { faultString: 'PERMISSION_DENIED' } },
    })).toBe(false)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(useFeedbackStore.getState().progress[0]).toMatchObject({ status: 'failed', error: 'PERMISSION_DENIED' })
    expect(useFeedbackStore.getState().toasts[0]).toMatchObject({ type: 'error', message: '操作失败：PERMISSION_DENIED' })
  })

  it('reports a lost VM power result as unknown without retrying or reporting failure', async () => {
    const action = vi.fn().mockRejectedValue(Object.assign(new Error('请核对任务'), { code: 'VM_POWER_OUTCOME_UNKNOWN' }))
    expect(await executeAction({ label: '重启 VM', trackProgress: true, action })).toBe(false)
    expect(action).toHaveBeenCalledOnce()
    expect(useFeedbackStore.getState().progress[0].status).toBe('unknown')
    expect(useFeedbackStore.getState().toasts[0]).toMatchObject({ type: 'warning', message: expect.stringContaining('状态读取失败') })
  })

  it('reports success once after completing the action and refresh', async () => {
    const onSuccess = vi.fn()
    expect(await executeAction({ label: '重命名网络', context: '池 A', action: async () => {}, onSuccess })).toBe(true)
    expect(onSuccess).toHaveBeenCalledOnce()
    expect(useFeedbackStore.getState().toasts).toEqual([expect.objectContaining({ type: 'success', message: '重命名网络 (池 A)成功' })])
  })

  it('keeps one completed result for tracked operations without duplicating a success toast', async () => {
    expect(await executeAction({ label: '启动 VM A', context: '池 A', trackProgress: true, action: async () => {} })).toBe(true)
    expect(useFeedbackStore.getState().progress).toEqual([expect.objectContaining({ label: '启动 VM A (池 A)', status: 'completed' })])
    expect(useFeedbackStore.getState().toasts).toEqual([])
  })

  it('resolves a replaced confirmation as cancelled without submitting its action', async () => {
    const firstAction = vi.fn()
    const secondAction = vi.fn().mockResolvedValue(undefined)
    const first = executeConfirm({ title: '移除 A', message: 'A', label: '移除 A', action: firstAction })
    const second = executeConfirm({ title: '移除 B', message: 'B', label: '移除 B', action: secondAction })
    expect(await first).toBe(false)
    expect(firstAction).not.toHaveBeenCalled()
    useFeedbackStore.getState().resolveConfirm(true)
    expect(await second).toBe(true)
    expect(secondAction).toHaveBeenCalledOnce()
  })

  it('keeps the current completed record until explicitly deleted', () => {
    const store = useFeedbackStore.getState()
    store.startProgress('same-target', '第一次')
    store.completeProgress('same-target')
    vi.advanceTimersByTime(1000)
    store.startProgress('same-target', '第二次')
    vi.advanceTimersByTime(2000)
    expect(useFeedbackStore.getState().progress).toEqual([expect.objectContaining({ label: '第二次', status: 'running' })])
    store.completeProgress('same-target')
    vi.advanceTimersByTime(3000)
    expect(useFeedbackStore.getState().progress).toEqual([expect.objectContaining({ label: '第二次', status: 'completed' })])
    store.removeProgress('same-target')
    expect(useFeedbackStore.getState().progress).toEqual([])
  })
})
