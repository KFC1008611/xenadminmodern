import type { IpcErrorResponse } from '../../shared/types/xapi'
import { normalizeUnknownError } from '../xapi/errors'

export function toIpcErrorResponse(error: unknown): IpcErrorResponse {
  const normalized = normalizeUnknownError(error)
  return {
    error: true,
    message: normalized.message,
    code: normalized.code,
    details: error && typeof error === 'object' && 'details' in error
      ? error.details : normalized.details,
  }
}
