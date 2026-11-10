import { useSearchParams } from 'react-router-dom'
import { useFeedbackStore } from '../store/feedback.store'
import { useImportWizardStore } from '../store/importWizard.store'
import { useExportPanelStore } from '../store/exportPanel.store'
import { useTaskHistoryStore } from '../store/taskHistory.store'
import { useCopyStore } from '../store/copy.store'
import TasksPage from './TasksPage'
import BatchHistoryPage from './BatchHistoryPage'
import { OperationTasks } from '../components/feedback/OperationTasks'
import { ImportTransferPanel } from '../components/vm/ImportTransferPanel'
import ExportPanel from '../components/export/ExportPanel'
import { CopyTaskPanel } from '../components/vm/CopyTaskPanel'

const tabs = [
  { value: 'operations', label: '操作记录' },
  { value: 'server', label: '服务器任务' },
  { value: 'batch', label: '批量任务' },
]

export default function TaskHistoryPage() {
  const hasOperations = useFeedbackStore((state) => state.progress.length > 0)
  const hasImports = useImportWizardStore((state) => state.history.length > 0)
  const hasExports = useExportPanelStore((state) => state.tasks.length > 0)
  const deleted = useTaskHistoryStore((state) => state.deletedRecords)
  const hasCopies = useCopyStore((state) => state.operations.some((operation) => !deleted.includes(`copy:${operation.id}`)) || !!state.readError)
  const [params, setParams] = useSearchParams()
  const tab = tabs.some((item) => item.value === params.get('tab')) ? params.get('tab') : 'operations'

  return (
    <div className="space-y-5">
      <h1 className="sr-only">任务</h1>
      <nav aria-label="任务记录" className="!mt-0 flex gap-2">
        {tabs.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={tab === item.value}
            onClick={() => setParams(item.value === 'operations' ? {} : { tab: item.value })}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === item.value ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {tab === 'operations' && (
        <div className="grid min-w-0 gap-5 xl:grid-cols-2">
          {hasOperations && <OperationTasks />}
          {hasImports && <ImportTransferPanel observe={false} />}
          {hasExports && <ExportPanel observe={false} />}
          {hasCopies && <CopyTaskPanel observe={false} />}
        </div>
      )}
      {tab === 'operations' && !hasOperations && !hasImports && !hasExports && !hasCopies && (
        <p className="py-12 text-center text-sm text-muted-foreground">暂无操作记录</p>
      )}
      {tab === 'server' && <TasksPage embedded observe={false} />}
      {tab === 'batch' && <BatchHistoryPage embedded observe={false} />}
    </div>
  )
}
