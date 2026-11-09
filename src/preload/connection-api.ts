import {
  connectionConnectContract,
  connectionDisconnectContract,
  connectionGetInfoContract,
  connectionListContract,
  connectionReconnectContract,
  sessionConnectContract,
  sessionDisconnectContract,
  sessionStatusContract,
} from '../shared/ipc-contracts/connection'
import {
  createIpcContractInvoker,
  type IpcInvokeTransport,
} from './ipc-contract-client'

export function createConnectionSessionApi(transport: IpcInvokeTransport) {
  return {
    connection: {
      connect: createIpcContractInvoker(connectionConnectContract, transport),
      disconnect: createIpcContractInvoker(connectionDisconnectContract, transport),
      list: createIpcContractInvoker(connectionListContract, transport),
      reconnect: createIpcContractInvoker(connectionReconnectContract, transport),
      getInfo: createIpcContractInvoker(connectionGetInfoContract, transport),
    },
    session: {
      connect: createIpcContractInvoker(sessionConnectContract, transport),
      disconnect: createIpcContractInvoker(sessionDisconnectContract, transport),
      status: createIpcContractInvoker(sessionStatusContract, transport),
    },
  }
}
