/**
 * Storage, SR, VDI, Network, VIF, PIF IPC handlers.
 */
import { handleContract } from './utils'
import * as NetworkIpc from '../../../shared/ipc-contracts/network'
import * as StorageIpc from '../../../shared/ipc-contracts/storage'
import { assertAuditedFeatureAvailable } from '../../../shared/audited-features'
import {
  getAllSrs,
  getAllVdis,
  createVdi,
  destroyVdi,
  createSr,
  destroySr,
  scanSr,
  detachSr,
  setDefaultSr,
  updateSrIdentity,
  probeNfs,
  probeIscsi,
} from '../../xapi/services/sr.service'
import {
  resizeVdi,
  createVdiForVm,
  getAllowedVdiOperations,
  listAttachableVdis,
  attachExistingVdi,
  moveVdi,
} from '../../xapi/services/vdi.service'
import {
  getAllNetworks,
  getAllPifs,
  createNetwork,
  destroyNetwork,
  renameNetwork,
  createVif,
  destroyVif,
  plugVif,
  unplugVif,
  moveVif,
  // v9: Bond/VLAN/Tunnel/PIF advanced
  getAllBonds,
  createBond,
  destroyBond,
  destroyBondGroup,
  getBondRecord,
  getAllVlans,
  createVlan,
  destroyVlan,
  destroyVlanNetwork,
  getVlanRecord,
  getAllTunnels,
  createTunnel,
  destroyTunnel,
  reconfigurePifIp,
  scanPifs,
  getPifsForHost,
  setVifQos,
  clearVifQos,
  getNetworkAllowedOperations,
  addNetworkTag,
  removeNetworkTag,
  updateNetworkOtherConfig,
} from '../../xapi/services/network.service'
import {
  // v9: Storage advanced
  getAllPbds,
  createPbd,
  plugPbd,
  unplugPbd,
  destroyPbd,
  cloneVdi,
  snapshotVdi,
  copyVdi,
  introduceSr,
  forgetSr,
  setSrShared,
  setVdiNameLabel,
  setVdiNameDescription,
  addVdiTag,
  removeVdiTag,
  getIsos,
  deleteIso,
  getSrThinProvisioningStats,
} from '../../xapi/services/storage-advanced.service'

export function registerStorageHandlers(): void {
  // Storage / SR
  handleContract(StorageIpc.srListContract, getAllSrs)
  handleContract(StorageIpc.vdiListContract, getAllVdis)
  handleContract(StorageIpc.vdiCreateContract, createVdi)

  handleContract(StorageIpc.vdiDestroyContract, destroyVdi)

  handleContract(StorageIpc.srCreateContract, (connectionId, hostRef, params) => {
    if (params?.type === 'ext') assertAuditedFeatureAvailable('sr.ext-create')
    if (params?.type === 'hba') assertAuditedFeatureAvailable('sr.hba-create')
    return createSr(connectionId, hostRef, params)
  })

  handleContract(StorageIpc.srDestroyContract, (connectionId, srRef) => {
    assertAuditedFeatureAvailable('storage.lifecycle')
    return destroySr(connectionId, srRef)
  })

  handleContract(StorageIpc.srScanContract, scanSr)
  handleContract(StorageIpc.srUpdateIdentityContract, updateSrIdentity)

  handleContract(StorageIpc.srDetachContract, (connectionId, srRef) => {
    assertAuditedFeatureAvailable('storage.lifecycle')
    return detachSr(connectionId, srRef)
  })

  handleContract(StorageIpc.srSetDefaultContract, setDefaultSr)
  handleContract(StorageIpc.srProbeNfsContract, probeNfs)
  handleContract(StorageIpc.srProbeIscsiContract, probeIscsi)

  // VDI management
  handleContract(StorageIpc.vdiResizeContract, resizeVdi)

  handleContract(StorageIpc.vdiCreateForVmContract, createVdiForVm)
  handleContract(StorageIpc.vdiGetAllowedOperationsContract, getAllowedVdiOperations)
  handleContract(StorageIpc.vdiListAttachableContract, listAttachableVdis)
  handleContract(StorageIpc.vdiAttachExistingContract, attachExistingVdi)

  handleContract(StorageIpc.vdiMoveContract, moveVdi)

  // Network
  handleContract(NetworkIpc.networkListContract, getAllNetworks)
  handleContract(NetworkIpc.pifListContract, getAllPifs)

  handleContract(NetworkIpc.networkCreateContract, createNetwork)

  handleContract(NetworkIpc.networkDestroyContract, destroyNetwork)

  handleContract(NetworkIpc.networkRenameContract, renameNetwork)

  // VIF management
  handleContract(NetworkIpc.vifCreateContract, createVif)

  handleContract(NetworkIpc.vifDestroyContract, destroyVif)

  handleContract(NetworkIpc.vifPlugContract, plugVif)

  handleContract(NetworkIpc.vifUnplugContract, unplugVif)
  handleContract(NetworkIpc.vifMoveContract, moveVif)

  // v9: VIF QoS
  handleContract(NetworkIpc.vifSetQosContract, setVifQos)
  handleContract(NetworkIpc.vifClearQosContract, clearVifQos)

  // v9: Bond management
  handleContract(NetworkIpc.bondListContract, getAllBonds)

  handleContract(NetworkIpc.bondCreateContract, (connectionId, params) => {
    assertAuditedFeatureAvailable('network.bond-vlan')
    return createBond(connectionId, params)
  })

  handleContract(NetworkIpc.bondDestroyContract, (connectionId, bondRef) => {
    assertAuditedFeatureAvailable('network.bond-vlan')
    return destroyBond(connectionId, bondRef)
  })

  handleContract(NetworkIpc.bondDestroyGroupContract, (...args) => {
    assertAuditedFeatureAvailable('network.bond-vlan')
    return destroyBondGroup(...args)
  })

  handleContract(NetworkIpc.bondGetRecordContract, getBondRecord)

  // v9: VLAN management
  handleContract(NetworkIpc.vlanListContract, getAllVlans)

  handleContract(NetworkIpc.vlanCreateContract, (connectionId, params) => {
    assertAuditedFeatureAvailable('network.bond-vlan')
    return createVlan(connectionId, params)
  })

  handleContract(NetworkIpc.vlanDestroyContract, (connectionId, vlanRef) => {
    assertAuditedFeatureAvailable('network.bond-vlan')
    return destroyVlan(connectionId, vlanRef)
  })

  handleContract(NetworkIpc.vlanDestroyNetworkContract, (...args) => {
    assertAuditedFeatureAvailable('network.bond-vlan')
    return destroyVlanNetwork(...args)
  })

  handleContract(NetworkIpc.vlanGetRecordContract, getVlanRecord)

  // v9: Tunnel management
  handleContract(NetworkIpc.tunnelListContract, getAllTunnels)

  handleContract(NetworkIpc.tunnelCreateContract, (connectionId, accessPifRef, networkRef) => {
    assertAuditedFeatureAvailable('network.lifecycle')
    return createTunnel(connectionId, accessPifRef, networkRef)
  })

  handleContract(NetworkIpc.tunnelDestroyContract, (connectionId, tunnelRef) => {
    assertAuditedFeatureAvailable('network.lifecycle')
    return destroyTunnel(connectionId, tunnelRef)
  })

  // v9: PIF advanced
  handleContract(NetworkIpc.pifReconfigureIpContract, (connectionId, pifRef, config) => {
    assertAuditedFeatureAvailable('network.lifecycle')
    return reconfigurePifIp(connectionId, pifRef, config)
  })

  handleContract(NetworkIpc.pifScanContract, scanPifs)
  handleContract(NetworkIpc.pifGetForHostContract, getPifsForHost)

  // v9: Network advanced
  handleContract(NetworkIpc.networkGetAllowedOpsContract, getNetworkAllowedOperations)
  handleContract(NetworkIpc.networkAddTagContract, addNetworkTag)
  handleContract(NetworkIpc.networkRemoveTagContract, removeNetworkTag)
  handleContract(NetworkIpc.networkUpdateOtherConfigContract, updateNetworkOtherConfig)

  // v9: Storage advanced - PBD management
  handleContract(StorageIpc.pbdListContract, getAllPbds)
  handleContract(StorageIpc.pbdCreateContract, createPbd)
  handleContract(StorageIpc.pbdPlugContract, plugPbd)

  handleContract(StorageIpc.pbdUnplugContract, (connectionId, pbdRef) => {
    assertAuditedFeatureAvailable('storage.pbd-iso')
    return unplugPbd(connectionId, pbdRef)
  })

  handleContract(StorageIpc.pbdDestroyContract, (connectionId, pbdRef) => {
    assertAuditedFeatureAvailable('storage.pbd-iso')
    return destroyPbd(connectionId, pbdRef)
  })

  // v9: Storage advanced - VDI clone/snapshot/copy
  handleContract(StorageIpc.vdiCloneContract, cloneVdi)
  handleContract(StorageIpc.vdiSnapshotContract, snapshotVdi)
  handleContract(StorageIpc.vdiCopyContract, copyVdi)

  // v9: Storage advanced - VDI metadata
  handleContract(StorageIpc.vdiSetNameLabelContract, setVdiNameLabel)
  handleContract(StorageIpc.vdiSetNameDescriptionContract, setVdiNameDescription)
  handleContract(StorageIpc.vdiAddTagContract, addVdiTag)
  handleContract(StorageIpc.vdiRemoveTagContract, removeVdiTag)

  // v9: Storage advanced - SR introduce/forget/shared
  handleContract(StorageIpc.srIntroduceContract, (connectionId, params) => {
    assertAuditedFeatureAvailable('storage.lifecycle')
    return introduceSr(connectionId, params)
  })

  handleContract(StorageIpc.srForgetContract, (connectionId, srRef) => {
    assertAuditedFeatureAvailable('storage.lifecycle')
    return forgetSr(connectionId, srRef)
  })

  handleContract(StorageIpc.srSetSharedContract, (connectionId, srRef, shared) => {
    assertAuditedFeatureAvailable('storage.lifecycle')
    return setSrShared(connectionId, srRef, shared)
  })

  handleContract(StorageIpc.srGetThinStatsContract, getSrThinProvisioningStats)

  // v9: Storage advanced - ISO management
  handleContract(StorageIpc.isoListContract, getIsos)

  handleContract(StorageIpc.isoDeleteContract, (connectionId, vdiRef) => {
    assertAuditedFeatureAvailable('storage.pbd-iso')
    return deleteIso(connectionId, vdiRef)
  })
}
