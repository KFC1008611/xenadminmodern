import {
  hostDisableContract,
  hostEnableContract,
  hostEnterMaintenanceContract,
  hostEvacuateContract,
  hostExitMaintenanceContract,
  hostGetMaintenanceStatusContract,
  hostListContract,
  hostMetricsContract,
  hostRebootContract,
  hostShutdownContract,
} from '../shared/ipc-contracts/host-governance'
import {
  createIpcContractInvoker,
  type IpcInvokeTransport,
} from './ipc-contract-client'

export function createHostApi(transport: IpcInvokeTransport) {
  return {
    host: {
      list: createIpcContractInvoker(hostListContract, transport),
      metrics: createIpcContractInvoker(hostMetricsContract, transport),
      enable: createIpcContractInvoker(hostEnableContract, transport),
      disable: createIpcContractInvoker(hostDisableContract, transport),
      reboot: createIpcContractInvoker(hostRebootContract, transport),
      shutdown: createIpcContractInvoker(hostShutdownContract, transport),
      getMaintenanceStatus: createIpcContractInvoker(
        hostGetMaintenanceStatusContract,
        transport,
      ),
      enterMaintenance: createIpcContractInvoker(hostEnterMaintenanceContract, transport),
      exitMaintenance: createIpcContractInvoker(hostExitMaintenanceContract, transport),
      evacuate: createIpcContractInvoker(hostEvacuateContract, transport),
    },
  }
}
