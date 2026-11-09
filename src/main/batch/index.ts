/**
 * Batch Operations Module — 批量操作模块入口
 * 导出批量任务管理相关功能
 */

export {
  BatchTaskManager,
  getBatchTaskManager,
  initBatchTaskManager,
  type BatchProgressEvent,
  type BatchTaskManagerOptions,
} from './batch-task.manager'

export {
  type BatchOperationType,
  type BatchTaskStatus,
  type BatchItemStatus,
  type BatchTaskTarget,
  type BatchTaskOptions,
  type BatchTaskItem,
  type BatchTask,
  type BatchTaskWithItems,
  initBatchTaskDatabase,
  closeBatchTaskDatabase,
  createBatchTask,
  getBatchTaskById,
  getAllBatchTasks,
  getBatchTasksByStatus,
  updateBatchTaskStatus,
  deleteBatchTask,
  cleanupCompletedTasks,
  getBatchTaskItems,
  getBatchTaskItemsByStatus,
  updateBatchTaskItemStatus,
  getFailedTaskItems,
  resetTaskItemForRetry,
} from './batch-task.repository'

export {
  canRunOperation,
  precheckBatchOperation,
  executeBatchOperation,
  type PreCheckResult,
  type OperationResult,
  type BatchOperationContext,
} from './batch-command.service'
