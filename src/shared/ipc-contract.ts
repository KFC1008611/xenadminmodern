export type IpcDirection = 'invoke' | 'push'

export interface IpcRuntimeSchema<T> {
  parse(value: unknown): T
}

export type IpcCallerPolicy = 'app-window-main-frame' | 'main-process'

export type IpcRedactionCategory =
  | 'none'
  | 'credentials'
  | 'session'
  | 'notification-secret'
  | 'storage-secret'

export type IpcErrorShape = 'ipc-error-response-v1'

interface IpcContractBase<TArgs extends readonly unknown[]> {
  readonly channel: string
  readonly direction: IpcDirection
  readonly argsSchema: IpcRuntimeSchema<TArgs>
  readonly callerPolicy: IpcCallerPolicy
  readonly redaction: readonly IpcRedactionCategory[]
}

export interface IpcInvokeContract<TArgs extends readonly unknown[], TResult>
  extends IpcContractBase<TArgs> {
  readonly direction: 'invoke'
  readonly resultSchema: IpcRuntimeSchema<TResult>
  readonly errorShape: IpcErrorShape
}

export interface IpcPushContract<TArgs extends readonly unknown[]>
  extends IpcContractBase<TArgs> {
  readonly direction: 'push'
  readonly resultSchema: null
  readonly errorShape: null
}

export type IpcContract =
  | IpcInvokeContract<readonly unknown[], unknown>
  | IpcPushContract<readonly unknown[]>

export interface IpcContractInventory {
  readonly contracts: readonly IpcContract[]
}

type InvokeContractDefinition<TArgs extends readonly unknown[], TResult> = Omit<
  IpcInvokeContract<TArgs, TResult>,
  'direction'
>

type PushContractDefinition<TArgs extends readonly unknown[]> = Omit<
  IpcPushContract<TArgs>,
  'direction' | 'resultSchema' | 'errorShape'
>

function validateChannel(channel: string): void {
  if (channel.trim().length === 0) {
    throw new Error('IPC channel must be a non-empty string')
  }
}

function validateRedaction(redaction: readonly IpcRedactionCategory[]): void {
  if (redaction.includes('none') && redaction.length > 1) {
    throw new Error('IPC redaction category "none" must be exclusive')
  }
}

function snapshotRedaction(
  redaction: readonly IpcRedactionCategory[],
): readonly IpcRedactionCategory[] {
  return Object.freeze([...redaction])
}

export function defineInvokeContract<TArgs extends readonly unknown[], TResult>(
  definition: InvokeContractDefinition<TArgs, TResult>,
): IpcInvokeContract<TArgs, TResult> {
  validateChannel(definition.channel)
  validateRedaction(definition.redaction)
  return Object.freeze({
    ...definition,
    direction: 'invoke',
    redaction: snapshotRedaction(definition.redaction),
  })
}

export function definePushContract<TArgs extends readonly unknown[]>(
  definition: PushContractDefinition<TArgs>,
): IpcPushContract<TArgs> {
  validateChannel(definition.channel)
  validateRedaction(definition.redaction)
  return Object.freeze({
    ...definition,
    direction: 'push',
    resultSchema: null,
    errorShape: null,
    redaction: snapshotRedaction(definition.redaction),
  })
}

function recordChannel(
  seen: Map<string, IpcDirection>,
  channel: string,
  direction: IpcDirection,
): void {
  validateChannel(channel)
  const previousDirection = seen.get(channel)
  if (!previousDirection) {
    seen.set(channel, direction)
    return
  }
  if (previousDirection !== direction) {
    throw new Error(`IPC channel has multiple directions: ${channel}`)
  }
  throw new Error(`Duplicate IPC channel: ${channel}`)
}

export function createIpcContractInventory(input: {
  contracts: readonly IpcContract[]
}): IpcContractInventory {
  const contractChannels = new Map<string, IpcDirection>()
  for (const contract of input.contracts) {
    recordChannel(contractChannels, contract.channel, contract.direction)
  }

  const contracts = input.contracts.map((contract) => Object.freeze({
    ...contract,
    redaction: snapshotRedaction(contract.redaction),
  }))

  return Object.freeze({
    contracts: Object.freeze(contracts),
  })
}
