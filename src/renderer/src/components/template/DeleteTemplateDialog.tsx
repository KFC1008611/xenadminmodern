/**
 * DeleteTemplateDialog — Confirmation dialog for deleting a VM template
 */
import { useState, useRef } from 'react'
import { X, AlertTriangle, Loader2 } from 'lucide-react'
import { useToast } from '../toast/useToast'
import { DesktopDialog } from '../layout/DesktopDialog'

interface DeleteTemplateDialogProps {
  open: boolean
  onClose: () => void
  template: {
    ref: string
    name_label: string
    connectionId: string
    is_default_template?: boolean
    other_config?: Record<string, string>
  } | null
  onSuccess: () => void | Promise<void>
}

export function DeleteTemplateDialog(props: DeleteTemplateDialogProps) {
  if (!props.open || !props.template) return null
  return <DeleteTemplateConfirmation key={JSON.stringify([props.template.connectionId, props.template.ref])} {...props} template={props.template} />
}

function DeleteTemplateConfirmation({
  open,
  onClose,
  template,
  onSuccess,
}: DeleteTemplateDialogProps & { template: NonNullable<DeleteTemplateDialogProps['template']> }) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteDisks, setDeleteDisks] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const submittedRef = useRef(false)
  const [deleted, setDeleted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toast = useToast()

  // Check if this is a system template that cannot be deleted
  const isSystemTemplate =
    template?.is_default_template === true ||
    template?.other_config?.['default_template'] === 'true'

  const handleDelete = async () => {
    if (isSystemTemplate || submittedRef.current) return

    submittedRef.current = true
    setSubmitted(true)
    setIsDeleting(true)
    setError(null)

    try {
      const result = await window.xapi.template.delete(template.connectionId, {
        templateRef: template.ref,
        deleteDisks,
      })
      setDeleted(true)
      let refreshError = ''
      try { await onSuccess() } catch (e: any) {
        refreshError = `清单刷新失败：${e?.message || String(e)}`
      }
      if (result.failedVdiRefs.length > 0) {
        setError(`模板已删除，以下磁盘因安全保护或清理失败而未完成删除，请到存储中检查：${result.failedVdiRefs.join('、')}${refreshError ? `。${refreshError}` : ''}`)
        return
      }
      if (refreshError) {
        setError(`模板已删除${deleteDisks ? '，所属硬盘已清理' : '，硬盘保留'}。${refreshError}`)
        return
      }
      toast.success(`模板 "${template.name_label}" 已删除${deleteDisks ? '，所属硬盘已清理' : '，硬盘保留'}`)
      onClose()
    } catch (e: any) {
      const errorMessage = e?.message || String(e)
      setError(`删除请求失败：${errorMessage}。请刷新模板及存储清单后再操作。`)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleClose = () => {
    if (isDeleting) return
    onClose()
  }

  return (
    <DesktopDialog open={open} title="删除模板" onClose={handleClose} busy={isDeleting} className="max-w-md border border-input bg-card shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-input">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-danger-soft rounded-lg">
            <AlertTriangle className="w-5 h-5 text-danger" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">
            删除模板
          </h2>
        </div>
        <button
          type="button"
          onClick={handleClose}
          aria-label="关闭"
          className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors disabled:opacity-50"
          disabled={isDeleting}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="px-6 py-5 space-y-5">
        {/* Confirmation Message */}
        <div className="text-center">
          <p className="break-words text-secondary-foreground">
            {deleted ? '已删除模板' : '确定要删除模板'} <span className="text-foreground font-medium">"{template.name_label}"</span>{deleted ? '。' : ' 吗？'}
          </p>
        </div>

        {/* System Template Warning */}
        {isSystemTemplate && (
          <div className="flex items-start gap-3 p-3 bg-warning-soft border border-warning/30 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-warning font-medium">系统模板无法删除</p>
              <p className="text-xs text-warning mt-1">
                这是系统默认模板，不允许删除。
              </p>
            </div>
          </div>
        )}

        {!isSystemTemplate && (
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input type="checkbox" checked={deleteDisks} onChange={(event) => setDeleteDisks(event.target.checked)} disabled={submitted} className="mt-0.5 h-4 w-4 shrink-0" />
              同时删除所属硬盘
            </label>
            <p className="text-sm text-muted-foreground">
              {deleteDisks ? '永久删除模板独占且可写的所属硬盘，无法恢复。共享、只读或归属不明的硬盘会保留；光驱介质不会删除。' : '关联硬盘会保留在存储仓库中。'}
            </p>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div role="alert" className="flex items-start gap-2 p-3 bg-danger-soft border border-danger/30 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />
            <p className="min-w-0 break-words text-sm text-danger">{error}</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-input bg-muted">
        <button
          onClick={handleClose}
          disabled={isDeleting}
          className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          {submitted ? '关闭' : '取消'}
        </button>
        <button
          onClick={handleDelete}
          disabled={submitted || isSystemTemplate}
          className="flex items-center gap-2 px-4 py-2 bg-danger-solid hover:bg-danger-solid disabled:bg-secondary disabled:text-subtle disabled:cursor-not-allowed text-on-solid text-sm font-medium rounded-lg transition-colors"
        >
          {isDeleting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              删除中...
            </>
          ) : (
            deleted ? '已删除' : '删除'
          )}
        </button>
      </div>
    </DesktopDialog>
  )
}
