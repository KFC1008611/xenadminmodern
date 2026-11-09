import type { IpcMainInvokeEvent } from 'electron'
import type { ScopedLogger } from '../logger'
import type { IpcErrorResponse } from '../../shared/types/xapi'
import type { IpcInvokeContract } from '../../shared/ipc-contract'
import type { IpcOwnerValidator } from './ipc-owner'
import { createIpcRedactionContext } from './ipc-redaction'
import { toIpcErrorResponse } from './ipc-error'
import { IpcValidationError } from '../../shared/ipc-contracts/runtime-schema'

class IpcContractBoundaryError extends Error {
  constructor(readonly code: 'IPC_SCHEMA_INVALID' | 'IPC_RESULT_INVALID', message: string, readonly details?: unknown) {
    super(message)
    this.name = 'IpcContractBoundaryError'
  }
}

export type IpcContractHandlerDependencies = {
  owner: Pick<IpcOwnerValidator, 'assertCurrent'>
  logger: Pick<ScopedLogger, 'debug' | 'error'>
}

export function createIpcContractHandler<TArgs extends readonly unknown[], TResult>(
  contract: IpcInvokeContract<TArgs, TResult>,
  service: (...args: TArgs) => TResult | Promise<TResult>,
  dependencies: IpcContractHandlerDependencies,
): (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<TResult | IpcErrorResponse> {
  return async (event, ...rawArgs) => {
    try {
      dependencies.owner.assertCurrent(event)
    } catch (error) {
      const response = toIpcErrorResponse(error)
      dependencies.logger.error(`${contract.channel} failed`, response)
      return response
    }

    let redaction
    try {
      redaction = createIpcRedactionContext(rawArgs, contract.redaction)
    } catch {
      const response = toIpcErrorResponse(new IpcContractBoundaryError(
        'IPC_SCHEMA_INVALID',
        'IPC payload does not match the channel contract',
      ))
      dependencies.logger.error(`${contract.channel} failed`, response)
      return response
    }
    dependencies.logger.debug(`${contract.channel} called`, redaction.payload)

    try {
      let args: TArgs
      try {
        args = contract.argsSchema.parse(rawArgs)
      } catch {
        throw new IpcContractBoundaryError(
          'IPC_SCHEMA_INVALID',
          'IPC payload does not match the channel contract',
        )
      }

      const serviceResult = await Promise.resolve(service(...args))
      let result: TResult
      try {
        result = contract.resultSchema.parse(serviceResult)
      } catch (cause) {
        throw new IpcContractBoundaryError(
          'IPC_RESULT_INVALID',
          'IPC result does not match the channel contract',
          { channel: contract.channel, ...(cause instanceof IpcValidationError
            ? { field: cause.field, recordIndex: cause.recordIndex } : {}) },
        )
      }

      dependencies.logger.debug(`${contract.channel} succeeded`)
      return result
    } catch (error) {
      const normalized = toIpcErrorResponse(error)
      const redacted = redaction.redact({
        message: normalized.message,
        details: normalized.details,
      }) as Pick<IpcErrorResponse, 'message' | 'details'>
      const response: IpcErrorResponse = {
        ...normalized,
        message: redacted.message,
        details: redacted.details,
      }
      dependencies.logger.error(`${contract.channel} failed`, response)
      return response
    }
  }
}
