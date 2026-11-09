import {
  patchApplyBatchContract,
  patchApplyContract,
  patchApplyToHostContract,
  patchCleanContract,
  patchDestroyContract,
  patchDestroyFromHostContract,
  patchGetHostStatusContract,
  patchGetMissingContract,
  patchGetRecordContract,
  patchListContract,
  patchPrecheckContract,
  patchUploadContract,
} from '../shared/ipc-contracts/patch-governance'
import { createIpcContractInvoker, type IpcInvokeTransport } from './ipc-contract-client'

export function createPatchApi(transport: IpcInvokeTransport) {
  return {
    patch: {
      list: createIpcContractInvoker(patchListContract, transport),
      getRecord: createIpcContractInvoker(patchGetRecordContract, transport),
      getHostStatus: createIpcContractInvoker(patchGetHostStatusContract, transport),
      getMissing: createIpcContractInvoker(patchGetMissingContract, transport),
      upload: createIpcContractInvoker(patchUploadContract, transport),
      precheck: createIpcContractInvoker(patchPrecheckContract, transport),
      apply: createIpcContractInvoker(patchApplyContract, transport),
      applyToHost: createIpcContractInvoker(patchApplyToHostContract, transport),
      clean: createIpcContractInvoker(patchCleanContract, transport),
      destroy: createIpcContractInvoker(patchDestroyContract, transport),
      destroyFromHost: createIpcContractInvoker(patchDestroyFromHostContract, transport),
      applyBatch: createIpcContractInvoker(patchApplyBatchContract, transport),
    },
  }
}
