import type { IpcContract, IpcInvokeContract, IpcPushContract } from '../shared/ipc-contract'
import type { IpcErrorResponse } from '../shared/types/xapi'

export interface IpcInvokeTransport {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}

type IpcPushListener = (_event: unknown, ...args: unknown[]) => void

export interface IpcPushTransport {
  on(channel: string, listener: IpcPushListener): unknown
  removeListener(channel: string, listener: IpcPushListener): unknown
}

const contractBindings = new WeakMap<Function, IpcContract>()

export function getIpcContractBinding(fn: Function): IpcContract | undefined {
  return contractBindings.get(fn)
}

export function bindIpcContractAlias<TFunction extends Function>(
  source: Function,
  alias: TFunction,
): TFunction {
  const contract = getIpcContractBinding(source)
  if (!contract) throw new Error('IPC contract alias source is not descriptor-backed')
  contractBindings.set(alias, contract)
  return alias
}

function isIpcErrorResponse(value: unknown): value is IpcErrorResponse {
  return (
    !!value
    && typeof value === 'object'
    && (value as IpcErrorResponse).error === true
    && typeof (value as IpcErrorResponse).message === 'string'
  )
}

function toRendererError(response: IpcErrorResponse): Error {
  const error = new Error(response.message) as Error & { code?: string; details?: unknown }
  error.code = response.code
  error.details = response.details
  return error
}

function toRendererBoundaryError(
  code: 'IPC_SCHEMA_INVALID' | 'IPC_RESULT_INVALID',
  message: string,
): Error {
  return Object.assign(new Error(message), { code })
}

export function createIpcContractInvoker<TArgs extends readonly unknown[], TResult>(
  contract: IpcInvokeContract<TArgs, TResult>,
  transport: IpcInvokeTransport,
): (...args: TArgs) => Promise<TResult> {
  const invoke = async (...rawArgs: TArgs) => {
    let args: TArgs
    try {
      args = contract.argsSchema.parse(rawArgs)
    } catch {
      throw toRendererBoundaryError(
        'IPC_SCHEMA_INVALID',
        'IPC payload does not match the channel contract',
      )
    }
    const response = await transport.invoke(contract.channel, ...args)
    if (isIpcErrorResponse(response)) throw toRendererError(response)
    try {
      return contract.resultSchema.parse(response)
    } catch {
      throw toRendererBoundaryError(
        'IPC_RESULT_INVALID',
        'IPC result does not match the channel contract',
      )
    }
  }
  contractBindings.set(invoke, contract as IpcContract)
  return invoke
}

export function createIpcContractSubscriber<TArgs extends readonly unknown[]>(
  contract: IpcPushContract<TArgs>,
  transport: IpcPushTransport,
): (callback: (...args: TArgs) => void) => () => void {
  const subscribe = (callback: (...args: TArgs) => void) => {
    const listener: IpcPushListener = (_event, ...rawArgs) => {
      let args: TArgs
      try {
        args = contract.argsSchema.parse(rawArgs)
      } catch {
        // Fail closed: malformed main-process events must not reach renderer callbacks.
        return
      }
      callback(...args)
    }
    transport.on(contract.channel, listener)
    return () => transport.removeListener(contract.channel, listener)
  }
  contractBindings.set(subscribe, contract as IpcContract)
  return subscribe
}
