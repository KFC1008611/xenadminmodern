import { useEffect, useId, useRef, useState } from 'react'
import { ListChecks, X } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useFeedbackStore } from '../../store/feedback.store'
import { useBatchStore } from '../../store/batch.store'
import { useCopyStore } from '../../store/copy.store'
import { useExportPanelStore } from '../../store/exportPanel.store'
import { useImportWizardStore } from '../../store/importWizard.store'
import { useMultiDataStore } from '../../store/multiData.store'
import { OperationTasks } from '../feedback/OperationTasks'
import { BatchProgressDialog } from '../batch/BatchProgressDialog'
import { CopyTaskPanel } from '../vm/CopyTaskPanel'
import { ImportTransferPanel } from '../vm/ImportTransferPanel'
import ExportPanel from '../export/ExportPanel'
import TasksPage from '../../pages/TasksPage'
import { isTransferTerminal } from '../../lib/transferTracking'
import { isBatchRunning } from '../../../../shared/batch-policy'

export function TaskCenter() {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const id = useId()
  const { pathname } = useLocation()
  const progress = useFeedbackStore((s) => s.progress)
  const batch = useBatchStore((s) => s.activeTasks)
  const copies = useCopyStore((s) => s.operations)
  const imports = useImportWizardStore((s) => s.history)
  const exports = useExportPanelStore((s) => s.tasks)
  const tasks = useMultiDataStore((s) => s.tasks)
  const active = progress.some((p) => ['pending', 'running'].includes(p.status)) || batch.some((t) => isBatchRunning(t.status))
    || copies.some((op) => !isTransferTerminal(op.status))
    || imports.some((item) => !item.recordMissing && !isTransferTerminal(item.operation.status))
    || exports.some((task) => !task.recordMissing && (!isTransferTerminal(task.status) || task.cleanupPending))
    || tasks.some((task) => ['pending', 'cancelling'].includes(task.status))

  useEffect(() => { setOpen(false) }, [pathname])
  useEffect(() => {
    if (!open) return
    panel.current?.focus()
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  const close = () => { setOpen(false); trigger.current?.focus() }

  return <div ref={root} className="app-no-drag relative" onKeyDown={(event) => {
    if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
  }}>
    <button ref={trigger} type="button" aria-label={active ? '任务通知，有进行中的任务' : '任务通知'} title="任务通知"
      aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}
      className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <ListChecks className="h-4 w-4" />
      {active && <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" />}
    </button>
    {/* Keep observers mounted when collapsed, so hiding progress never stops a task. */}
    <aside ref={panel} id={id} hidden={!open} tabIndex={-1} aria-label="任务通知"
      className="absolute right-0 top-full z-40 mt-2 w-[28rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-input bg-card text-foreground shadow-xl focus:outline-none">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">任务通知</h2>
        <Link to="/tasks" onClick={() => setOpen(false)} className="ml-auto mr-3 text-xs text-accent-foreground">全部任务</Link>
        <button type="button" onClick={close} aria-label="收起任务通知" className="rounded p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
      </div>
      <div className="max-h-[calc(100dvh-var(--window-top-offset)-8rem)] space-y-4 overflow-y-auto overscroll-contain p-3 [overflow-wrap:anywhere]">
        <OperationTasks />
        <BatchProgressDialog />
        <ImportTransferPanel />
        <ExportPanel />
        <CopyTaskPanel />
        <TasksPage compact />
      </div>
    </aside>
  </div>
}
