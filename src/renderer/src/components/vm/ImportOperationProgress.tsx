import type { VmImportOperation } from '../../types/xapi'
import { TransferProgress } from '../transfer/TransferProgress'

type ProgressProps = Pick<VmImportOperation, 'status' | 'progress' | 'message' | 'validation' | 'transfer'>

export function ImportOperationProgress({ status, progress, message, validation, transfer }: ProgressProps) {
  if (status === 'unknown') return <p role="status" className="break-words text-sm text-warning">{message}</p>
  const validating = status === 'validating'
  const metrics = validating && validation ? { bytesTransferred: validation.bytesChecked, bytesTotal: validation.bytesTotal, elapsedMs: validation.elapsedMs }
    : status === 'uploading' ? transfer : undefined
  const indeterminate = ['pending', 'configuring'].includes(status)
  return <TransferProgress label={validating ? 'XVA 校验进度' : '导入进度'}
    message={status === 'waiting_for_task' ? `${message}（服务器进度）` : message}
    progress={indeterminate ? -1 : progress} metrics={metrics} bytesLabel={validating ? '已检查' : '已上传'} warning={['unknown', 'failed'].includes(status)} />
}
