import { updateGetStateContract, updateSetEnabledContract, updateCheckContract, updateDownloadContract, updateInstallContract } from '../shared/ipc-contracts/updates'
import { createIpcContractInvoker, type IpcInvokeTransport } from './ipc-contract-client'

export function createUpdateApi(transport: IpcInvokeTransport) {
  return {
    getState: createIpcContractInvoker(updateGetStateContract, transport),
    setEnabled: createIpcContractInvoker(updateSetEnabledContract, transport),
    check: createIpcContractInvoker(updateCheckContract, transport),
    download: createIpcContractInvoker(updateDownloadContract, transport),
    install: createIpcContractInvoker(updateInstallContract, transport),
  }
}
