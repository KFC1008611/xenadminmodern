/**
 * HA (High Availability) IPC handlers.
 * v9: New handlers for HA configuration and management.
 */
import { handleContract } from './utils'
import * as HaIpc from '../../../shared/ipc-contracts/ha-governance'
import { assertAuditedFeatureAvailable } from '../../../shared/audited-features'
import {
  getHaConfiguration,
  enableHa,
  disableHa,
  computeHaTolerance,
  preventHaRestarts,
  getHaVmConfigs,
  setHaVmRestartPriority,
  setHaVmAlwaysRun,
  getHaVmAlwaysRun,
  emergencyTransitionToMaster,
  recoverHaSlaves,
  getHaFailoverPlan,
} from '../../xapi/services/ha.service'

export function registerHaHandlers(): void {
  // HA Configuration
  handleContract(HaIpc.haGetConfigContract, getHaConfiguration)

  handleContract(HaIpc.haEnableContract, (connectionId, params) => {
    assertAuditedFeatureAvailable('ha.governance')
    return enableHa(connectionId, params)
  })

  handleContract(HaIpc.haDisableContract, (connectionId) => {
    assertAuditedFeatureAvailable('ha.governance')
    return disableHa(connectionId)
  })

  // HA Compute
  handleContract(HaIpc.haComputeToleranceContract, computeHaTolerance)

  handleContract(HaIpc.haPreventRestartsContract, (connectionId, seconds) => {
    assertAuditedFeatureAvailable('ha.governance')
    return preventHaRestarts(connectionId, seconds)
  })

  // VM HA Configuration
  handleContract(HaIpc.haGetVmConfigsContract, getHaVmConfigs)

  handleContract(HaIpc.haSetVmPriorityContract, (connectionId, vmRef, priority) => {
    assertAuditedFeatureAvailable('ha.governance')
    return setHaVmRestartPriority(connectionId, vmRef, priority)
  })

  handleContract(HaIpc.haSetVmAlwaysRunContract, (connectionId, vmRef, alwaysRun) => {
    assertAuditedFeatureAvailable('ha.governance')
    return setHaVmAlwaysRun(connectionId, vmRef, alwaysRun)
  })

  handleContract(HaIpc.haGetVmAlwaysRunContract, getHaVmAlwaysRun)

  // Emergency operations
  handleContract(HaIpc.haEmergencyMasterContract, (connectionId) => {
    assertAuditedFeatureAvailable('ha.governance')
    return emergencyTransitionToMaster(connectionId)
  })

  handleContract(HaIpc.haRecoverSlavesContract, (connectionId) => {
    assertAuditedFeatureAvailable('ha.governance')
    return recoverHaSlaves(connectionId)
  })

  handleContract(HaIpc.haGetFailoverPlanContract, getHaFailoverPlan)
}
