import { describe, expect, it } from 'vitest'
import {
  AUDITED_FEATURE_IDS,
  assertAuditedFeatureAvailable,
  getAuditedFeatureBlockReason,
} from '../../src/shared/audited-features'
import { getCapabilityClaim } from '../../src/shared/evidence-manifest'

describe('audited feature safety gates', () => {
  it('keeps every renderer and IPC guard in the evidence manifest', () => {
    expect(AUDITED_FEATURE_IDS).toHaveLength(19)
    for (const featureId of AUDITED_FEATURE_IDS) {
      const claim = getCapabilityClaim(featureId)
      expect(claim.declaredStatus).toBe('guarded')
      expect(claim.guardReason).toBe(getAuditedFeatureBlockReason(featureId))
      expect(claim.guardReason).toContain(featureId === 'batch.vm-delete' ? '不受支持' : '暂不可用')
      expect(claim.guardReason).not.toMatch(/B[0-9]|D[0-9]{2}|backend|mutation|Task/)
    }
  })

  it('returns an actionable Chinese reason for every blocked mutation', () => {
    expect(getAuditedFeatureBlockReason('pool.join')).toContain('加入资源池')
    expect(getAuditedFeatureBlockReason('pool.eject')).toContain('移出资源池')
    expect(getAuditedFeatureBlockReason('patch.mutate')).toContain('补丁')
    expect(getAuditedFeatureBlockReason('rbac.subject-create')).toContain('添加用户')
    expect(getAuditedFeatureBlockReason('rbac.external-auth')).toContain('外部认证')
    expect(getAuditedFeatureBlockReason('sr.ext-create')).toContain('EXT')
    expect(getAuditedFeatureBlockReason('sr.hba-create')).toContain('HBA')
    expect(getAuditedFeatureBlockReason('vm.storage-move')).toContain('停机存储移动')
    expect(getAuditedFeatureBlockReason('batch.vm-delete')).toContain('批量删除虚拟机')
    expect(getAuditedFeatureBlockReason('host.maintenance')).toContain('主机维护')
    expect(getAuditedFeatureBlockReason('pool.governance')).toContain('主节点')
    expect(getAuditedFeatureBlockReason('ha.governance')).toContain('高可用')
    expect(getAuditedFeatureBlockReason('rbac.management')).toContain('角色变更')
    expect(getAuditedFeatureBlockReason('storage.lifecycle')).toContain('分离与销毁')
    expect(getAuditedFeatureBlockReason('storage.pbd-iso')).toContain('ISO 删除')
    expect(getAuditedFeatureBlockReason('network.lifecycle')).toContain('高级网络拓扑')
    expect(getAuditedFeatureBlockReason('network.bond-vlan')).toContain('网卡绑定与 VLAN')
    expect(getAuditedFeatureBlockReason('vm.pool-migrate')).toContain('同池主机迁移')
    expect(getAuditedFeatureBlockReason('vm.cross-pool-migrate')).toContain('跨池迁移')
  })

  it('throws the same reason before a blocked mutation reaches a service', () => {
    const reason = getAuditedFeatureBlockReason('pool.join')
    expect(() => assertAuditedFeatureAvailable('pool.join')).toThrow(reason ?? '')
  })
})
