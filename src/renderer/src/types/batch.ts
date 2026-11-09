/**
 * Batch operation types for v8
 */
import type {
  BatchOperationResult,
  BatchOperationType,
  BatchTaskProgress,
  BatchTaskTarget,
} from '../../../shared/types/xapi'

export type {
  BatchOperationInput,
  BatchOperationResult,
  BatchOperationType,
  BatchProgressEvent,
} from '../../../shared/types/xapi'

export type BatchTarget = BatchTaskTarget
export type BatchProgress = BatchTaskProgress

export interface BatchOperationTask {
  items?: import('../../../shared/types/xapi').BatchTaskItem[]
  id: string
  type: BatchOperationType
  targets: BatchTarget[]
  options?: import('../../../shared/types/xapi').BatchTaskOptions
  status: import('../../../shared/types/xapi').BatchTaskStatus
  progress: BatchProgress
  results: BatchOperationResult[]
  createdAt: number
  startedAt?: number
  completedAt?: number
}
