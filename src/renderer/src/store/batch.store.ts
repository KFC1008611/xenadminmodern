import { create } from 'zustand'
import type { BatchTarget, BatchOperationTask, BatchProgressEvent } from '../types/batch'
import type { BatchOperationInput, BatchRetryConfirmation, BatchTask, BatchTaskOptions, BatchTaskWithItems, ConnectedVmRecord } from '../../../shared/types/xapi'
import { batchOperationBlockReason, batchTargetKey, batchTargetIdentityReason, isBatchRunning, type SupportedBatchType } from '../../../shared/batch-policy'
import { useMultiDataStore } from './multiData.store'
import { useConnectionManagerStore } from './connectionManager.store'
import { useTaskHistoryStore } from './taskHistory.store'

export function batchSelectionChangeReason(target: BatchTarget, vm: ConnectedVmRecord | null = useMultiDataStore.getState().vms
  .find((item) => item.connectionId === target.connectionId && item.ref === target.vmRef) ?? null): string | null {
  const connection = useConnectionManagerStore.getState().connections.find((item) => item.id === target.connectionId)
  const { domainStates } = useMultiDataStore.getState()
  if (!connection || connection.state !== 'connected') return '资源池连接已断开，请重新连接后选择虚拟机'
  if (target.intent && (target.intent.poolUuid !== connection.poolUuid || target.intent.epoch !== connection.epoch)) {
    return '资源池连接已变化，请重新选择虚拟机'
  }
  if ((vm && (vm.uuid !== target.intent?.vmUuid || vm.is_a_template || vm.is_a_snapshot || vm.is_control_domain))
    || (!vm && domainStates[target.connectionId]?.vms?.lastSuccessAt)) return '虚拟机已变化或不在当前清单中，请重新选择'
  return null
}

let readRevision = 0
const pushVersions = new Map<string, number>()
const detailReads = new Map<string, number>()
function normalizeTask(task: BatchTask | BatchTaskWithItems): BatchOperationTask {
  const items = 'items' in task ? task.items : []
  return { ...task, items, results: items.map((item) => ({
    connectionId: item.connectionId, status: item.status, vmRef: item.vmRef, vmName: item.vmName,
    success: item.status === 'completed' || item.status === 'skipped', error: item.error,
  })) }
}
function sameOutcome(a: BatchOperationTask, b: BatchOperationTask): boolean {
  // A summary may add timestamps omitted by pushes without changing item outcomes.
  return a.status === b.status && (a.startedAt === undefined || a.startedAt === b.startedAt)
    && (a.completedAt === undefined || a.completedAt === b.completedAt)
    && (['total', 'completed', 'failed', 'unknown', 'cancelled'] as const)
      .every((key) => (a.progress[key] ?? 0) === (b.progress[key] ?? 0))
}
function refreshResources(task: BatchOperationTask): void {
  for (const id of new Set(task.targets.map((target) => target.connectionId))) {
    void useMultiDataStore.getState().refreshConnection(id, { afterMutation: true })
  }
}
interface BatchStore {
  selectedVms: BatchTarget[]
  selectionNotice: string | null
  activeTask: BatchOperationTask | null
  activeTasks: BatchOperationTask[]
  taskHistory: BatchOperationTask[]
  isLoading: boolean
  isSubmitting: boolean
  pendingTaskIds: string[]
  unconfirmedSubmission: BatchOperationInput | null
  error: string | null
  unsubscribeProgress: (() => void) | null
  setSelectedVms: (vms: BatchTarget[]) => void
  toggleVmSelection: (vm: BatchTarget) => void
  selectAll: (vms: BatchTarget[]) => void
  clearSelection: () => void
  reconcileSelection: () => void
  isSelected: (connectionId: string, vmRef: string) => boolean
  submitTask: (type: SupportedBatchType, targets?: BatchTarget[], options?: BatchTaskOptions) => Promise<string>
  cancelTask: (taskId: string) => Promise<void>
  retryTask: (taskId: string, confirmation: BatchRetryConfirmation) => Promise<void>
  refreshTasks: () => Promise<void>
  clearActiveTask: () => void
  loadTaskDetails: (taskId: string) => Promise<BatchOperationTask | null>
  startProgressSubscription: () => void
  stopProgressSubscription: () => void
  handleProgressEvent: (event: BatchProgressEvent) => void
}
export const useBatchStore = create<BatchStore>((set, get) => {
  const allTasks = () => [...get().activeTasks, ...get().taskHistory, ...(get().activeTask ? [get().activeTask!] : [])]
  const reconcile = (tasks: BatchOperationTask[]) => {
    const activeTasks = tasks.filter((task) => isBatchRunning(task.status))
    const displayed = get().activeTask
    set({
      // The displayed result stays until dismissed, independently of the live queue.
      activeTasks, activeTask: tasks.find((task) => task.id === displayed?.id) ?? displayed ?? activeTasks[0] ?? null,
      taskHistory: tasks.filter((task) => !isBatchRunning(task.status)).sort((a, b) => b.createdAt - a.createdAt),
    })
  }
  const pending = (id: string, add: boolean) => {
    const pendingTaskIds = add ? [...get().pendingTaskIds, id] : get().pendingTaskIds.filter((entry) => entry !== id)
    set({ pendingTaskIds, isLoading: get().isSubmitting || pendingTaskIds.length > 0 })
  }
  return {
    selectedVms: [], selectionNotice: null, activeTask: null, activeTasks: [], taskHistory: [],
    isLoading: false, isSubmitting: false, pendingTaskIds: [], unconfirmedSubmission: null, error: null, unsubscribeProgress: null,
    setSelectedVms: (vms) => set({ selectedVms: vms, selectionNotice: null }),
    toggleVmSelection: (vm) => {
      const exists = get().isSelected(vm.connectionId, vm.vmRef)
      set({ selectedVms: exists ? get().selectedVms.filter((item) => batchTargetKey(item) !== batchTargetKey(vm)) : [...get().selectedVms, vm], selectionNotice: null })
    },
    selectAll: (vms) => set({ selectedVms: vms, selectionNotice: null }),
    clearSelection: () => set({ selectedVms: [], selectionNotice: null }),
    reconcileSelection: () => {
      if (get().isSubmitting) return
      const previous = get().selectedVms
      const vms = new Map(useMultiDataStore.getState().vms.map((vm) => [JSON.stringify([vm.connectionId, vm.ref]), vm]))
      const selectedVms = previous.flatMap((target) => {
        const vm = vms.get(batchTargetKey(target)) ?? null
        if (batchSelectionChangeReason(target, vm)) return []
        return [vm && vm.name_label !== target.vmName ? { ...target, vmName: vm.name_label } : target]
      })
      if (selectedVms.length !== previous.length || selectedVms.some((target, index) => target !== previous[index])) {
        set({ selectedVms, ...(selectedVms.length !== previous.length ? {
          selectionNotice: `已移除 ${previous.length - selectedVms.length} 台失效选择：虚拟机或资源池连接已变化，请重新选择。`,
        } : {}) })
      }
    },
    isSelected: (connectionId, vmRef) => get().selectedVms.some((vm) => vm.connectionId === connectionId && vm.vmRef === vmRef),

    submitTask: async (type, explicitTargets, options) => {
      if (get().isSubmitting) throw new Error('批量任务正在提交，请等待受理结果')
      const targets = structuredClone(explicitTargets ?? get().selectedVms)
      if (!targets.length) throw new Error('请先选择虚拟机')
      const blocked = batchOperationBlockReason(type, options) || targets.map(batchTargetIdentityReason).find(Boolean)
      if (blocked) throw new Error(blocked)
      const previous = get().unconfirmedSubmission
      const input: BatchOperationInput = previous && previous.type === type && JSON.stringify(previous.targets) === JSON.stringify(targets)
        && JSON.stringify(previous.options) === JSON.stringify(options) ? previous : { requestId: crypto.randomUUID(), type, targets, ...(options ? { options } : {}) }
      set({ isSubmitting: true, isLoading: true, error: null, unconfirmedSubmission: input })
      try {
        get().startProgressSubscription()
        const result = await window.xapi.batch.submit(input)
        const retainAdmission = () => {
          const existing = allTasks().find((task) => task.id === result.taskId)
          if (existing) { set({ activeTask: existing }); return }
          const placeholder: BatchOperationTask = { id: result.taskId, type, targets, options, status: 'pending', progress: { total: targets.length, completed: 0, failed: 0 }, results: [], createdAt: Date.now() }
          reconcile([...allTasks().filter((old, index, array) => array.findIndex((entry) => entry.id === old.id) === index), placeholder])
          set({ activeTask: placeholder })
        }
        retainAdmission()
        // Admission has succeeded. Clear only the exact submitted selection, even if progress reads fail.
        const submitted = new Set(targets.map((target) => JSON.stringify(target)))
        set({ selectedVms: get().selectedVms.filter((vm) => !submitted.has(JSON.stringify(vm))), unconfirmedSubmission: null })
        await get().refreshTasks()
        if (![...get().activeTasks, ...get().taskHistory].some((task) => task.id === result.taskId)) {
          try {
            const task = normalizeTask(await window.xapi.batch.getStatus(result.taskId))
            reconcile([...allTasks().filter((old, index, array) => old.id !== task.id && array.findIndex((entry) => entry.id === old.id) === index), task])
          } catch (error: any) {
            retainAdmission()
            set({ error: '任务已提交（' + result.taskId + '），暂时无法读取进度：' + (error?.message || String(error)) })
          }
        } else if (get().error) set({ error: '任务已提交（' + result.taskId + '）：' + get().error })
        return result.taskId
      } catch (error: any) {
        set({ error: '批量提交响应读取失败，请先核对任务记录。再次提交相同目标会沿用原请求：' + (error?.message || String(error)) })
        throw error
      } finally { set({ isSubmitting: false, isLoading: get().pendingTaskIds.length > 0 }) }
    },
    cancelTask: async (taskId) => {
      if (get().pendingTaskIds.includes(taskId)) return
      pushVersions.set(taskId, (pushVersions.get(taskId) ?? 0) + 1)
      pending(taskId, true); set({ error: null })
      try { await window.xapi.batch.cancel(taskId); await get().refreshTasks() }
      catch (error: any) { set({ error: error?.message || '停止后续操作失败' }); throw error }
      finally { pending(taskId, false) }
    },
    retryTask: async (taskId, confirmation) => {
      if (get().pendingTaskIds.includes(taskId)) return
      pushVersions.set(taskId, (pushVersions.get(taskId) ?? 0) + 1)
      pending(taskId, true); set({ error: null })
      try {
        get().startProgressSubscription()
        await window.xapi.batch.retry(taskId, confirmation)
        useTaskHistoryStore.getState().restoreRecord(`batch:${taskId}`)
        await get().refreshTasks()
      }
      catch (error: any) { set({ error: error?.message || '重试提交失败，请先核对原任务' }); throw error }
      finally { pending(taskId, false) }
    },
    refreshTasks: async () => {
      const revision = ++readRevision
      const versions = new Map(pushVersions)
      try {
        get().startProgressSubscription()
        const tasks = (await window.xapi.batch.list()).map(normalizeTask)
        // Active tasks and the displayed terminal result share three detail-read slots.
        const detailTasks = tasks.filter((task) => isBatchRunning(task.status) || task.id === get().activeTask?.id)
        let next = 0
        const details = new Map<string, BatchOperationTask>()
        const detailErrors = new Map<string, string>()
        await Promise.all(Array.from({ length: Math.min(3, detailTasks.length) }, async () => {
          while (next < detailTasks.length) {
            const task = detailTasks[next++]
            try { details.set(task.id, normalizeTask(await window.xapi.batch.getStatus(task.id))) }
            catch (error: any) { detailErrors.set(task.id, error?.message || '读取任务详情失败') }
          }
        }))
        if (revision !== readRevision) return
        const merged = tasks.map((summary) => {
          const task = details.get(summary.id) ?? summary
          const previous = allTasks().find((old) => old.id === task.id)
          if (previous && (pushVersions.get(task.id) ?? 0) !== (versions.get(task.id) ?? 0)) return previous
          if (previous && !isBatchRunning(task.status) && isBatchRunning(previous.status)) refreshResources(task)
          return previous && !task.items?.length && sameOutcome(previous, task) ? { ...task, items: previous.items, results: previous.results } : task
        })
        reconcile(merged)
        const displayedId = get().activeTask?.id ?? ''
        set({ error: (pushVersions.get(displayedId) ?? 0) === (versions.get(displayedId) ?? 0)
          ? detailErrors.get(displayedId) ?? null : null })
        if (!get().activeTasks.length) get().stopProgressSubscription()
      } catch (error: any) { if (revision === readRevision) set({ error: error?.message || '读取批量任务失败' }) }
    },
    loadTaskDetails: async (taskId) => {
      const request = (detailReads.get(taskId) ?? 0) + 1
      detailReads.set(taskId, request)
      const version = pushVersions.get(taskId)
      try {
        const task = normalizeTask(await window.xapi.batch.getStatus(taskId))
        if (detailReads.get(taskId) !== request || pushVersions.get(taskId) !== version) return null
        const tasks = allTasks().filter((old, index, array) => array.findIndex((entry) => entry.id === old.id) === index && old.id !== taskId)
        reconcile([...tasks, task])
        return task
      } catch (error: any) { set({ error: error?.message || '读取任务详情失败' }); return null }
    },
    clearActiveTask: () => {
      if (!get().activeTask || !isBatchRunning(get().activeTask!.status)) set({ activeTask: get().activeTasks[0] ?? null })
    },
    startProgressSubscription: () => {
      if (get().unsubscribeProgress) return
      set({ unsubscribeProgress: window.xapi.onBatchProgress((event) => get().handleProgressEvent(event)) })
    },
    stopProgressSubscription: () => { get().unsubscribeProgress?.(); set({ unsubscribeProgress: null }) },
    handleProgressEvent: (event) => {
      pushVersions.set(event.taskId, (pushVersions.get(event.taskId) ?? 0) + 1)
      const task = allTasks().find((old) => old.id === event.taskId)
      if (!task) { void get().refreshTasks(); return }
      const updated: BatchOperationTask = {
        ...task, status: event.status, progress: event.progress,
        ...(isBatchRunning(event.status) ? { completedAt: undefined } : {}),
        results: event.currentResult ? [...task.results.filter((item) => !(item.connectionId === event.currentResult!.connectionId && item.vmRef === event.currentResult!.vmRef)), event.currentResult] : task.results,
      }
      const tasks = allTasks().filter((old, index, array) => old.id !== task.id && array.findIndex((entry) => entry.id === old.id) === index)
      reconcile([updated, ...tasks])
      if (!isBatchRunning(event.status)) { refreshResources(updated); void get().refreshTasks() }
    },
  }
})
