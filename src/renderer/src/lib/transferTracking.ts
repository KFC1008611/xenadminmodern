export const isTransferTerminal = (status: string | null | undefined): boolean =>
  status === 'completed' || status === 'failed' || status === 'cancelled'

export const missingTransferRecordMessage = (direction: 'import' | 'export'): string =>
  `本地${direction === 'import' ? '导入' : '导出'}记录已不存在，已停止自动读取。移除记录不会取消资源池任务。`
