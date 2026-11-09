import type { IpcPushContract } from '../../shared/ipc-contract'

export interface IpcPushTarget {
  send(channel: string, ...args: unknown[]): void
}

export function sendIpcContractPush<TArgs extends readonly unknown[]>(
  target: IpcPushTarget,
  contract: IpcPushContract<TArgs>,
  ...rawArgs: TArgs
): void {
  const args = contract.argsSchema.parse(rawArgs)
  target.send(contract.channel, ...args)
}
