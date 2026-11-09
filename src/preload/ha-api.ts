import {
  haComputeToleranceContract,
  haDisableContract,
  haEmergencyMasterContract,
  haEnableContract,
  haGetConfigContract,
  haGetFailoverPlanContract,
  haGetVmAlwaysRunContract,
  haGetVmConfigsContract,
  haPreventRestartsContract,
  haRecoverSlavesContract,
  haSetVmAlwaysRunContract,
  haSetVmPriorityContract,
} from '../shared/ipc-contracts/ha-governance'
import { createIpcContractInvoker, type IpcInvokeTransport } from './ipc-contract-client'

export function createHaApi(transport: IpcInvokeTransport) {
  return {
    ha: {
      getConfig: createIpcContractInvoker(haGetConfigContract, transport),
      enable: createIpcContractInvoker(haEnableContract, transport),
      disable: createIpcContractInvoker(haDisableContract, transport),
      computeTolerance: createIpcContractInvoker(haComputeToleranceContract, transport),
      preventRestarts: createIpcContractInvoker(haPreventRestartsContract, transport),
      getVmConfigs: createIpcContractInvoker(haGetVmConfigsContract, transport),
      setVmPriority: createIpcContractInvoker(haSetVmPriorityContract, transport),
      setVmAlwaysRun: createIpcContractInvoker(haSetVmAlwaysRunContract, transport),
      getVmAlwaysRun: createIpcContractInvoker(haGetVmAlwaysRunContract, transport),
      emergencyMaster: createIpcContractInvoker(haEmergencyMasterContract, transport),
      recoverSlaves: createIpcContractInvoker(haRecoverSlavesContract, transport),
      getFailoverPlan: createIpcContractInvoker(haGetFailoverPlanContract, transport),
    },
  }
}
