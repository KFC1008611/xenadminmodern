import { TaskRecords } from './TaskRecords'
import { useFeedbackStore } from '../../store/feedback.store'
import { X, Loader2, CheckCircle, AlertCircle } from 'lucide-react'

export function OperationTasks() {
  const { progress, removeProgress } = useFeedbackStore()
  return <section aria-label="普通操作" className="space-y-2">
    {progress.length > 0 && <h3 className="text-sm font-medium">普通操作</h3>}
      {progress.length > 0 && (
        <div aria-label="操作进度" className="flex flex-col gap-2">
          <TaskRecords records={progress} finished={(entry) => ['completed', 'failed'].includes(entry.status)}>{(entry) => (
            <div
              key={entry.id}
              role={entry.status === 'failed' || entry.status === 'unknown' ? 'alert' : 'status'}
              className="shrink-0 bg-muted border border-border rounded-lg px-3 py-3"
            >
              <div className="flex items-center gap-2 mb-2">
                {entry.status === 'running' && (
                  <Loader2 className="w-3.5 h-3.5 text-accent-foreground animate-spin" />
                )}
                {entry.status === 'completed' && (
                  <CheckCircle className="w-3.5 h-3.5 text-success" />
                )}
                {entry.status === 'unknown' && <AlertCircle className="w-3.5 h-3.5 text-warning" />}
                {entry.status === 'failed' && (
                  <AlertCircle className="w-3.5 h-3.5 text-danger" />
                )}
                <span className="min-w-0 break-words text-sm text-foreground">{entry.label}</span>
                {(entry.status === 'completed' || entry.status === 'failed' || entry.status === 'unknown') && (
                  <button
                    onClick={() => removeProgress(entry.id)}
                    title="仅删除本地记录，不撤销操作" aria-label={entry.status === 'unknown' ? '关闭读取故障提示' : entry.status === 'failed' ? '关闭失败操作' : '关闭已完成操作'}
                    className="ml-auto flex-shrink-0"
                  >
                    <X className="w-3 h-3 text-subtle hover:text-secondary-foreground" />
                  </button>
                )}
              </div>
              <p className="mb-1 flex justify-between gap-3 text-xs text-muted-foreground"><span>{entry.status === 'running' ? '执行中' : entry.status === 'completed' ? '已完成' : entry.status === 'unknown' ? '状态读取失败' : '失败'}</span>{entry.progress >= 0 && <span className="tabular-nums">{Math.floor(Math.max(0, Math.min(100, entry.progress)))}%</span>}</p>
              {entry.progress >= 0 && (
                <div role="progressbar" aria-label={`${entry.label}进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, entry.progress))} className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      entry.status === 'completed'
                        ? 'bg-success-solid'
                        : entry.status === 'failed'
                          ? 'bg-danger-solid'
                          : 'bg-primary'
                    }`}
                    style={{ width: `${Math.max(0, Math.min(100, entry.progress))}%` }}
                  />
                </div>
              )}
              {entry.status === 'running' && <p className="mt-1 text-xs text-muted-foreground">当前操作不支持直接取消</p>}
              {(entry.status === 'failed' || entry.status === 'unknown') && entry.error && (
                <p className={`break-words text-xs mt-1 ${entry.status === 'unknown' ? 'text-warning' : 'text-danger'}`}>{entry.error}</p>
              )}
            </div>
          )}</TaskRecords>
        </div>
      )}

  </section>
}
