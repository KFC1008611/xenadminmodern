/**
 * ExportPanel store — manages background export tasks state
 * Allows multiple concurrent exports with progress tracking
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { VmTransferProgress } from '../../../shared/types/xapi'
import { isTransferTerminal, missingTransferRecordMessage } from '../lib/transferTracking'

export interface ExportTask extends Pick<VmTransferProgress, 'phase' | 'transfer' | 'validation'> {
  exportId: string
  vmName: string
  connectionId: string
  progress: number
  status: 'pending' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'unknown'
  bytesTransferred: number
  bytesTotal: number
  message: string
  filePath: string
  startedAt: number
  cleanupPending?: boolean
  warnings?: string[]
  finishedAt?: number
  recordMissing?: boolean
}

interface ExportPanelState {
  tasks: ExportTask[]

  addTask: (task: ExportTask) => void
  updateTask: (exportId: string, updates: Partial<ExportTask>) => void
  markRecordMissing: (exportId: string) => void
  removeTask: (exportId: string) => void
  clearCompleted: () => void
  getActiveTasks: () => ExportTask[]
}

export const useExportPanelStore = create<ExportPanelState>()(persist((set, get) => ({
  tasks: [],

  addTask: (task: ExportTask) => {
    set((state) => ({
      tasks: [...state.tasks, task],
    }))
  },

  updateTask: (exportId: string, updates: Partial<ExportTask>) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.exportId === exportId && !(isTransferTerminal(task.status) && updates.status && updates.status !== task.status)
          ? { ...task, ...updates } : task
      ),
    }))
  },

  markRecordMissing: (exportId) => set((state) => ({ tasks: state.tasks.map((task) => task.exportId !== exportId ? task : {
    ...task, recordMissing: true, cleanupPending: false,
    status: isTransferTerminal(task.status) ? task.status : 'unknown',
    message: missingTransferRecordMessage('export'),
  }) })),

  removeTask: (exportId: string) => {
    set((state) => ({
      tasks: state.tasks.filter((task) => task.exportId !== exportId || task.cleanupPending || !task.recordMissing && !isTransferTerminal(task.status)),
    }))
  },

  clearCompleted: () => {
    set((state) => ({
      tasks: state.tasks.filter(
        (task) => task.cleanupPending || !task.recordMissing && !isTransferTerminal(task.status)
      ),
    }))
  },

  getActiveTasks: () => {
    const { tasks } = get()
    return tasks.filter(
      (task) => !task.recordMissing && (!isTransferTerminal(task.status) || task.cleanupPending),
    )
  },
}), {
  name: 'xenadmin-export-tasks',
  partialize: ({ tasks }) => ({ tasks }),
  merge: (persisted, current) => {
    const saved = persisted as Partial<ExportPanelState>
    return { ...current, tasks: (saved.tasks ?? []).map((task) =>
      task.recordMissing || isTransferTerminal(task.status) ? task : {
        ...task, status: 'unknown' as const, message: '等待重新连接资源池核对原导出任务',
      }) }
  },
}))
