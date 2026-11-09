/**
 * IPC handler utilities — shared helpers for all handler modules.
 */
import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import {
  createIpcContractInventory,
  type IpcContract,
  type IpcContractInventory,
  type IpcInvokeContract,
  type IpcPushContract,
} from '../../../shared/ipc-contract'
import { createLogger } from '../../logger'
import { createIpcContractHandler } from '../ipc-contract-handler'
import { IpcOwnerValidator } from '../ipc-owner'

const log = createLogger('IpcUtils')
const ipcOwner = new IpcOwnerValidator()
const registeredContracts: IpcContract[] = []

export type { IpcErrorResponse } from '../../../shared/types/xapi'

export { toIpcErrorResponse } from '../ipc-error'

export function rebindIpcOwner(owner: BrowserWindow | null, trustedDocumentUrl?: string): void {
  ipcOwner.rebind(owner, trustedDocumentUrl)
}

export function getIpcRegistrationInventory(): IpcContractInventory {
  return createIpcContractInventory({
    contracts: registeredContracts,
  })
}

export function handleContract<TArgs extends readonly unknown[], TResult>(
  contract: IpcInvokeContract<TArgs, TResult>,
  service: (...args: NoInfer<TArgs>) => NoInfer<TResult> | Promise<NoInfer<TResult>>,
): void {
  createIpcContractInventory({
    contracts: [...registeredContracts, contract],
  })

  ipcMain.handle(
    contract.channel,
    createIpcContractHandler(contract, service, { owner: ipcOwner, logger: log }),
  )
  registeredContracts.push(contract as IpcInvokeContract<readonly unknown[], unknown>)
}

export function registerPushContract<TArgs extends readonly unknown[]>(
  contract: IpcPushContract<TArgs>,
): void {
  createIpcContractInventory({
    contracts: [...registeredContracts, contract],
  })
  registeredContracts.push(contract as IpcPushContract<readonly unknown[]>)
}
