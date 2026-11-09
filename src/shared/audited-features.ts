import { getCapabilityClaim } from './evidence-manifest'

export const AUDITED_FEATURE_IDS = [
  'pool.join',
  'pool.eject',
  'patch.mutate',
  'rbac.subject-create',
  'rbac.external-auth',
  'sr.ext-create',
  'sr.hba-create',
  'vm.storage-move',
  'batch.vm-delete',
  'host.maintenance',
  'pool.governance',
  'ha.governance',
  'rbac.management',
  'storage.lifecycle',
  'storage.pbd-iso',
  'network.lifecycle',
  'network.bond-vlan',
  'vm.pool-migrate',
  'vm.cross-pool-migrate',
] as const

export type AuditedFeatureId = (typeof AUDITED_FEATURE_IDS)[number]

export function getAuditedFeatureBlockReason(featureId: AuditedFeatureId): string {
  try {
    const claim = getCapabilityClaim(featureId)
    if (claim.declaredStatus === 'guarded' && claim.guardReason) return claim.guardReason
  } catch {
    // A missing or invalid evidence entry must never open a mutation.
  }
  return '无法确认此操作的支持情况，暂不可用'
}

export function assertAuditedFeatureAvailable(featureId: AuditedFeatureId): never {
  throw new Error(getAuditedFeatureBlockReason(featureId))
}
