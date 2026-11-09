/**
 * VM Advanced IPC handlers.
 * v9: New handlers for VM advanced features (affinity, protection, VCPU hotplug, etc.).
 */
import { handleContract } from './utils'
import {
  vmAdvancedAddAntiAffinityContract,
  vmAdvancedAddTagContract,
  vmAdvancedDisableProtectionContract,
  vmAdvancedEnableProtectionContract,
  vmAdvancedGetAffinityContract,
  vmAdvancedGetAllConfigsContract,
  vmAdvancedGetConfigContract,
  vmAdvancedRemoveAntiAffinityContract,
  vmAdvancedRemoveTagContract,
  vmAdvancedSetAffinityContract,
  vmAdvancedSetAntiAffinityContract,
  vmAdvancedSetBootOrderContract,
  vmAdvancedSetHvmBootParamsContract,
  vmAdvancedSetOtherConfigContract,
  vmAdvancedSetPlatformParamContract,
  vmAdvancedSetStartDelayContract,
  vmAdvancedSetStartOrderContract,
  vmAdvancedSetVcpuHotplugContract,
  vmAdvancedSetVcpusNumberContract,
  vmAdvancedSetViridianContract,
} from '../../../shared/ipc-contracts/vm-advanced'
import {
  getVmAdvancedConfig,
  setVmAffinity,
  getVmAffinity,
  setVmAntiAffinity,
  addVmAntiAffinity,
  removeVmAntiAffinity,
  enableVmProtection,
  disableVmProtection,
  setVmVcpuHotplug,
  setVmVcpusNumber,
  setVmStartDelay,
  setVmBootOrder,
  setVmHvmBootParams,
  setVmPlatformParam,
  setVmViridian,
  setVmOtherConfig,
  addVmTag,
  removeVmTag,
  getAllVmAdvancedConfigs,
  setPoolVmStartOrder,
} from '../../xapi/services/vm-advanced.service'

export function registerVmAdvancedHandlers(): void {
  // VM advanced configuration
  handleContract(vmAdvancedGetConfigContract, getVmAdvancedConfig)
  handleContract(vmAdvancedGetAllConfigsContract, getAllVmAdvancedConfigs)
  handleContract(vmAdvancedGetAffinityContract, getVmAffinity)

  // VM affinity
  handleContract(vmAdvancedSetAffinityContract, setVmAffinity)

  // VM anti-affinity
  handleContract(vmAdvancedSetAntiAffinityContract, setVmAntiAffinity)
  handleContract(vmAdvancedAddAntiAffinityContract, addVmAntiAffinity)
  handleContract(vmAdvancedRemoveAntiAffinityContract, removeVmAntiAffinity)

  // VM protection
  handleContract(vmAdvancedEnableProtectionContract, enableVmProtection)
  handleContract(vmAdvancedDisableProtectionContract, disableVmProtection)

  // VCPU hotplug
  handleContract(vmAdvancedSetVcpuHotplugContract, setVmVcpuHotplug)
  handleContract(vmAdvancedSetVcpusNumberContract, setVmVcpusNumber)

  // VM start delay
  handleContract(vmAdvancedSetStartDelayContract, setVmStartDelay)

  // VM boot order
  handleContract(vmAdvancedSetBootOrderContract, setVmBootOrder)
  handleContract(vmAdvancedSetHvmBootParamsContract, setVmHvmBootParams)

  // VM platform
  handleContract(vmAdvancedSetPlatformParamContract, setVmPlatformParam)
  handleContract(vmAdvancedSetViridianContract, setVmViridian)

  // VM other config and tags
  handleContract(vmAdvancedSetOtherConfigContract, setVmOtherConfig)
  handleContract(vmAdvancedAddTagContract, addVmTag)
  handleContract(vmAdvancedRemoveTagContract, removeVmTag)

  // Pool VM start order
  handleContract(vmAdvancedSetStartOrderContract, setPoolVmStartOrder)
}
