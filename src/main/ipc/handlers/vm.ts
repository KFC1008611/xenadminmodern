import { getVmCopyPlan, getCopyOperations, cancelCopy } from '../../xapi/services/vm-copy.service'
import { vmCopyPlanContract, vmCopyOperationsContract, vmCancelCopyContract } from '../../../shared/ipc-contracts/vm-copy'
/**
 * VM IPC handlers — lifecycle, detail editing, snapshots, and import/export.
 */
import { handleContract } from './utils'
import * as InfrastructureIpc from '../../../shared/ipc-contracts/infrastructure'
import * as StorageIpc from '../../../shared/ipc-contracts/storage'
import * as VmIpc from '../../../shared/ipc-contracts/vm'
import { assertAuditedFeatureAvailable } from '../../../shared/audited-features'
import {
  getAllVms,
  startVm,
  shutdownVm,
  forceShutdownVm,
  rebootVm,
  pauseVm,
  unpauseVm,
  suspendVm,
  resumeVm,
  destroyVm,
  snapshotVm,
  copyVm,
  getVmConsole,
  getTemplates,
  getVmRecord,
  setVmNameLabel,
  setVmNameDescription,
  setVmVcpus,
  setVmMemoryLimits,
  getVmVBDs,
  plugVbd,
  unplugVbd,
  detachVbd,
  listIsoImages,
  getVmCdDrive,
  mountVmIso,
  ejectVmIso,
  getVmVIFs,
  getVmSnapshots,
  revertVmSnapshot,
  deleteVmSnapshot,
  renameVmSnapshot,
  cloneTemplate,
  deleteTemplate,
  updateTemplateSettings,
} from '../../xapi/services/vm.service'
import {
  exportVm,
  importVm,
  getImportPreview,
  cancelExport,
  getExportProgress,
  markAsTemplate,
  getImportProgress,
  cancelImport,
} from '../../xapi/services/vm-import.service'
import {
  getVmRelocationPlan,
  relocateVm,
} from '../../xapi/services/vm-relocation.service'
import { createFromWizard, getVmCreationResources, quickCreateFromTemplate } from '../../xapi/services/vm-creation.service'
import { enableTemplateInstantCreate } from '../../xapi/services/template-metadata.service'
import { createLogger } from '../../logger'

const log = createLogger('IpcVm')

export function registerVmHandlers(): void {
  // VM — list & lifecycle
  handleContract(VmIpc.vmListContract, (connectionId) => {
    log.info(`vm:list connectionId=${connectionId}`)
    return getAllVms(connectionId)
  })

  handleContract(VmIpc.vmStartContract, startVm)

  handleContract(VmIpc.vmShutdownContract, shutdownVm)

  handleContract(VmIpc.vmForceShutdownContract, forceShutdownVm)

  handleContract(VmIpc.vmRebootContract, rebootVm)

  handleContract(VmIpc.vmPauseContract, pauseVm)

  handleContract(VmIpc.vmUnpauseContract, unpauseVm)

  handleContract(VmIpc.vmSuspendContract, suspendVm)

  handleContract(VmIpc.vmResumeContract, resumeVm)

  handleContract(VmIpc.vmDestroyContract, destroyVm)

  handleContract(VmIpc.vmSnapshotContract, snapshotVm)

  handleContract(VmIpc.vmMigrateContract, (connectionId, vmRef, targetHostRef) => {
    return relocateVm({
      mode: 'pool-migrate',
      sourceConnectionId: connectionId,
      vmRef,
      targetHostRef,
    })
  })

  handleContract(VmIpc.vmGetRelocationPlanContract, getVmRelocationPlan)

  handleContract(VmIpc.vmRelocateContract, (payload) => {
    switch (payload.mode) {
      case 'pool-migrate':
        break
      case 'storage-move':
        assertAuditedFeatureAvailable('vm.storage-move')
        break
      case 'cross-pool-migrate':
        assertAuditedFeatureAvailable('vm.cross-pool-migrate')
        break
      case 'cross-pool-copy':
        break
      default:
        throw new Error('不支持的 VM 重定位方式，安全复核完成前暂不可用')
    }
    return relocateVm(payload)
  })

  handleContract(VmIpc.vmCopyContract, copyVm)
  handleContract(vmCopyPlanContract, getVmCopyPlan)
  handleContract(vmCopyOperationsContract, getCopyOperations)
  handleContract(vmCancelCopyContract, cancelCopy)

  handleContract(InfrastructureIpc.vmConsoleContract, getVmConsole)

  handleContract(VmIpc.vmTemplatesContract, getTemplates)

  handleContract(VmIpc.vmCreateFromTemplateContract, createFromWizard)

  handleContract(VmIpc.vmQuickCreateFromTemplateContract, quickCreateFromTemplate)

  handleContract(VmIpc.vmCreationResourcesContract, getVmCreationResources)

  // VM — detail & editing
  handleContract(VmIpc.vmGetRecordContract, getVmRecord)

  handleContract(VmIpc.vmSetNameLabelContract, setVmNameLabel)

  handleContract(VmIpc.vmSetNameDescriptionContract, setVmNameDescription)

  handleContract(VmIpc.vmSetVcpusContract, setVmVcpus)

  handleContract(VmIpc.vmSetMemoryLimitsContract, setVmMemoryLimits)

  handleContract(VmIpc.vmGetVbdsContract, getVmVBDs)

  handleContract(VmIpc.vmPlugVbdContract, plugVbd)

  handleContract(VmIpc.vmUnplugVbdContract, unplugVbd)

  handleContract(VmIpc.vmDetachVbdContract, detachVbd)

  handleContract(StorageIpc.isoListAllContract, listIsoImages)

  handleContract(VmIpc.vmGetCdDriveContract, getVmCdDrive)

  handleContract(VmIpc.vmMountIsoContract, mountVmIso)

  handleContract(VmIpc.vmEjectIsoContract, ejectVmIso)

  handleContract(VmIpc.vmGetVifsContract, getVmVIFs)

  // VM — snapshots
  handleContract(VmIpc.vmGetSnapshotsContract, getVmSnapshots)

  handleContract(VmIpc.vmRevertSnapshotContract, revertVmSnapshot)

  handleContract(VmIpc.vmDeleteSnapshotContract, deleteVmSnapshot)

  handleContract(VmIpc.vmRenameSnapshotContract, renameVmSnapshot)

  // VM — import/export
  handleContract(VmIpc.vmExportContract, exportVm)

  handleContract(VmIpc.vmImportContract, importVm)

  handleContract(VmIpc.vmImportGetPreviewContract, getImportPreview)

  handleContract(VmIpc.vmImportProgressContract, getImportProgress)

  handleContract(VmIpc.vmCancelImportContract, cancelImport)

  handleContract(VmIpc.vmCancelExportContract, cancelExport)

  handleContract(VmIpc.vmExportProgressContract, getExportProgress)

  handleContract(VmIpc.vmMarkAsTemplateContract, markAsTemplate)

  // Template management
  handleContract(VmIpc.templateCloneContract, cloneTemplate)

  handleContract(VmIpc.templateDeleteContract, deleteTemplate)

  handleContract(VmIpc.templateUpdateSettingsContract, updateTemplateSettings)

  handleContract(VmIpc.templateEnableInstantCreateContract, enableTemplateInstantCreate)
}
