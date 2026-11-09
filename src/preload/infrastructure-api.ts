import {
  batchCancelContract,
  batchGetStatusContract,
  batchListContract,
  batchProgressContract,
  batchRetryContract,
  batchSubmitContract,
  consoleCloseContract,
  consoleGetUrlContract,
  dialogShowOpenContract,
  dialogShowSaveContract,
  poolAddHostContract,
  poolGetContract,
  poolRemoveHostContract,
  poolTransferMasterContract,
  profileDeleteContract,
  profileHasPasswordContract,
  profileConnectContract,
  profileListContract,
  profileSaveContract,
  taskCancelContract,
  taskListContract,
  vmConsoleContract,
} from '../shared/ipc-contracts/infrastructure'
import {
  createIpcContractInvoker,
  createIpcContractSubscriber,
  type IpcInvokeTransport,
  type IpcPushTransport,
} from './ipc-contract-client'

export function createInfrastructureApi(
  transport: IpcInvokeTransport & IpcPushTransport,
) {
  return {
    pool: {
      get: createIpcContractInvoker(poolGetContract, transport),
      addHost: createIpcContractInvoker(poolAddHostContract, transport),
      removeHost: createIpcContractInvoker(poolRemoveHostContract, transport),
      transferMaster: createIpcContractInvoker(poolTransferMasterContract, transport),
    },
    tasks: {
      list: createIpcContractInvoker(taskListContract, transport),
      cancel: createIpcContractInvoker(taskCancelContract, transport),
    },
    profiles: {
      list: createIpcContractInvoker(profileListContract, transport),
      save: createIpcContractInvoker(profileSaveContract, transport),
      delete: createIpcContractInvoker(profileDeleteContract, transport),
      hasPassword: createIpcContractInvoker(profileHasPasswordContract, transport),
      connect: createIpcContractInvoker(profileConnectContract, transport),
    },
    vm: {
      console: createIpcContractInvoker(vmConsoleContract, transport),
    },
    console: {
      getUrl: createIpcContractInvoker(consoleGetUrlContract, transport),
      close: createIpcContractInvoker(consoleCloseContract, transport),
    },
    dialog: {
      showOpenDialog: createIpcContractInvoker(dialogShowOpenContract, transport),
      showSaveDialog: createIpcContractInvoker(dialogShowSaveContract, transport),
    },
    batch: {
      submit: createIpcContractInvoker(batchSubmitContract, transport),
      cancel: createIpcContractInvoker(batchCancelContract, transport),
      getStatus: createIpcContractInvoker(batchGetStatusContract, transport),
      list: createIpcContractInvoker(batchListContract, transport),
      retry: createIpcContractInvoker(batchRetryContract, transport),
    },
    onBatchProgress: createIpcContractSubscriber(batchProgressContract, transport),
  }
}
