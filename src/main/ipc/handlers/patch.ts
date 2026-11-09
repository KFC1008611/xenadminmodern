/**
 * Patch management IPC handlers.
 * v9: New handlers for patch upload, apply, and management.
 */
import { handleContract } from './utils'
import * as PatchIpc from '../../../shared/ipc-contracts/patch-governance'
import { assertAuditedFeatureAvailable } from '../../../shared/audited-features'
import {
  getAllPatches,
  getPatchRecord,
  getHostPatchStatus,
  getMissingPatchesForHost,
  uploadPatch,
  precheckPatch,
  applyPatch,
  applyPatchToHost,
  cleanPatch,
  destroyPatch,
  destroyPatchFromHost,
  applyPatchesBatch,
} from '../../xapi/services/patch.service'

export function registerPatchHandlers(): void {
  // Patch listing
  handleContract(PatchIpc.patchListContract, getAllPatches)

  handleContract(PatchIpc.patchGetRecordContract, getPatchRecord)

  // Host patch status
  handleContract(PatchIpc.patchGetHostStatusContract, getHostPatchStatus)

  handleContract(PatchIpc.patchGetMissingContract, getMissingPatchesForHost)

  // Patch upload
  handleContract(PatchIpc.patchUploadContract, (connectionId, filePath) => {
    assertAuditedFeatureAvailable('patch.mutate')
    return uploadPatch(connectionId, filePath)
  })

  // Patch precheck
  handleContract(PatchIpc.patchPrecheckContract, (connectionId, patchRef) => {
    assertAuditedFeatureAvailable('patch.mutate')
    return precheckPatch(connectionId, patchRef)
  })

  // Patch application
  handleContract(PatchIpc.patchApplyContract, (connectionId, patchRef) => {
    assertAuditedFeatureAvailable('patch.mutate')
    return applyPatch(connectionId, patchRef)
  })

  handleContract(PatchIpc.patchApplyToHostContract, (connectionId, hostRef, patchRef) => {
    assertAuditedFeatureAvailable('patch.mutate')
    return applyPatchToHost(connectionId, hostRef, patchRef)
  })

  // Patch cleanup
  handleContract(PatchIpc.patchCleanContract, (connectionId, patchRef) => {
    assertAuditedFeatureAvailable('patch.mutate')
    return cleanPatch(connectionId, patchRef)
  })

  // Patch removal
  handleContract(PatchIpc.patchDestroyContract, (connectionId, patchRef) => {
    assertAuditedFeatureAvailable('patch.mutate')
    return destroyPatch(connectionId, patchRef)
  })

  handleContract(PatchIpc.patchDestroyFromHostContract, (connectionId, hostRef, patchRef) => {
    assertAuditedFeatureAvailable('patch.mutate')
    return destroyPatchFromHost(connectionId, hostRef, patchRef)
  })

  // Batch operations
  handleContract(PatchIpc.patchApplyBatchContract, (connectionId, patchRefs) => {
    assertAuditedFeatureAvailable('patch.mutate')
    return applyPatchesBatch(connectionId, patchRefs)
  })
}
