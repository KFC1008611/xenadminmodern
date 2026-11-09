/**
 * Host IPC handlers.
 */
import { handleContract } from './utils'
import * as HostIpc from '../../../shared/ipc-contracts/host-governance'
import { assertAuditedFeatureAvailable } from '../../../shared/audited-features'
import {
  getAllHosts,
  getHostMetrics,
  enableHost,
  disableHost,
  rebootHost,
  shutdownHost,
  getMaintenanceStatus,
  enterMaintenanceMode,
  exitMaintenanceMode,
  evacuateHost,
} from '../../xapi/services/host.service'

export function registerHostHandlers(): void {
  handleContract(HostIpc.hostListContract, getAllHosts)

  handleContract(HostIpc.hostMetricsContract, getHostMetrics)

  handleContract(HostIpc.hostEnableContract, (connectionId, ref) => {
    assertAuditedFeatureAvailable('host.maintenance')
    return enableHost(connectionId, ref)
  })

  handleContract(HostIpc.hostDisableContract, (connectionId, ref) => {
    assertAuditedFeatureAvailable('host.maintenance')
    return disableHost(connectionId, ref)
  })

  handleContract(HostIpc.hostRebootContract, (connectionId, ref) => {
    assertAuditedFeatureAvailable('host.maintenance')
    return rebootHost(connectionId, ref)
  })

  handleContract(HostIpc.hostShutdownContract, (connectionId, ref) => {
    assertAuditedFeatureAvailable('host.maintenance')
    return shutdownHost(connectionId, ref)
  })

  handleContract(HostIpc.hostGetMaintenanceStatusContract, getMaintenanceStatus)

  handleContract(HostIpc.hostEnterMaintenanceContract, (connectionId, hostRef) => {
    assertAuditedFeatureAvailable('host.maintenance')
    return enterMaintenanceMode(connectionId, hostRef)
  })

  handleContract(HostIpc.hostExitMaintenanceContract, (connectionId, hostRef) => {
    assertAuditedFeatureAvailable('host.maintenance')
    return exitMaintenanceMode(connectionId, hostRef)
  })

  handleContract(HostIpc.hostEvacuateContract, (connectionId, hostRef) => {
    assertAuditedFeatureAvailable('host.maintenance')
    return evacuateHost(connectionId, hostRef)
  })
}
