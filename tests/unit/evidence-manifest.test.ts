import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_STATUS_LABELS,
  evaluateClaimStatus,
  getAllCapabilityClaims,
  getCapabilityClaim,
  getCapabilityClaimSafely,
  type CapabilityClaim,
} from '../../src/shared/evidence-manifest'

const verifiedClaim: CapabilityClaim = {
  id: 'test.verified-capability',
  title: '已验证能力',
  declaredStatus: 'verified',
  supportedScope: '测试范围',
  batch: 'B0',
  retainedGate: null,
  sourceCommit: '74d04556e74afc61ce4c71f3a5cc530d5af377a6',
  artifactIdentity: null,
  environmentFingerprint: 'macOS arm64; Node v20.x',
  evidenceAt: '2026-07-25T00:00:00+08:00',
  evidenceExpiresAt: '2026-08-25T00:00:00+08:00',
  passedGates: ['G0'],
  unverifiedBoundaries: [],
  evidenceResult: 'passed',
}

describe('capability evidence manifest', () => {
  it('does not promote failed, missing, or expired evidence to verified', () => {
    const now = new Date('2026-07-27T00:00:00+08:00')

    expect(evaluateClaimStatus(verifiedClaim, now)).toBe('verified')
    expect(evaluateClaimStatus({ ...verifiedClaim, evidenceResult: 'failed' }, now)).toBe('experimental')
    expect(evaluateClaimStatus({ ...verifiedClaim, evidenceResult: 'missing' }, now)).toBe('experimental')
    expect(evaluateClaimStatus({ ...verifiedClaim, passedGates: [] }, now)).toBe('experimental')
    expect(
      evaluateClaimStatus({ ...verifiedClaim, unverifiedBoundaries: ['范围不足'] }, now),
    ).toBe('experimental')
    expect(
      evaluateClaimStatus(
        { ...verifiedClaim, evidenceExpiresAt: '2026-07-26T00:00:00+08:00' },
        now,
      ),
    ).toBe('experimental')
    expect(
      evaluateClaimStatus({ ...verifiedClaim, declaredStatus: 'broken' } as unknown as CapabilityClaim, now),
    ).toBe('guarded')
  })

  it('records every current product and release claim with an auditable evidence boundary', () => {
    const claims = getAllCapabilityClaims()
    const claimIds = claims.map((claim) => claim.id).sort()
    const expectedClaimIds = [
      'alerts.center',
      'alerts.persistence',
      'batch.tasks',
      'batch.vm-delete',
      'build.application-bundle',
      'connection.auto-restore',
      'connection.health',
      'connection.manual-multi-pool',
      'dashboard.overview',
      'desktop.window-lifecycle',
      'feedback.operations',
      'ha.governance',
      'host.inventory',
      'host.maintenance',
      'inventory.unified-view',
      'metrics.monitoring',
      'network.bond-vlan',
      'network.lifecycle',
      'patch.management',
      'patch.mutate',
      'platform.cross-platform-runtime',
      'pool.eject',
      'pool.governance',
      'pool.join',
      'rbac.external-auth',
      'rbac.management',
      'rbac.subject-create',
      'release.formal-distribution',
      'sr.ext-create',
      'sr.hba-create',
      'storage.lifecycle',
      'storage.pbd-iso',
      'storage.vdi',
      'tasks.xapi',
      'template.management',
      'ui.dark-theme',
      'vdi.move',
      'vdi.resize',
      'vm.advanced-settings',
      'vm.configuration',
      'vm.console',
      'vm.copy',
      'vm.cross-pool-copy',
      'vm.cross-pool-migrate',
      'vm.cross-pool-mutations',
      'vm.creation',
      'vm.devices.network',
      'vm.devices.storage',
      'vm.inventory',
      'vm.high-impact-power',
      'vm.pool-migrate',
      'vm.power',
      'vm.relocation',
      'vm.snapshots',
      'vm.storage-move',
      'vm.template-snapshot-delete',
      'xva.transfer',
    ].sort()

    expect(claimIds).toEqual(expectedClaimIds)

    for (const claim of claims) {
      expect(claim.supportedScope).not.toBe('')
      expect(claim.batch).toMatch(/^B[0-8]$/)
      expect(claim.sourceCommit).toMatch(/^[0-9a-f]{40}$/)
      expect(claim.environmentFingerprint).not.toBe('')
      expect(claim.evidenceAt).not.toBe('')
      expect(claim.unverifiedBoundaries.length).toBeGreaterThan(0)
    }

    expect(getCapabilityClaim('build.application-bundle').declaredStatus).toBe('implemented')
    expect(getCapabilityClaim('release.formal-distribution').declaredStatus).toBe('guarded')
    expect(getCapabilityClaim('platform.cross-platform-runtime').artifactIdentity).toBe(
      'app.asar:sha256:49a17b157b0afa73a2317d985b80c8a47c61c72e590e1b5a768810cca39ab4a1',
    )
  })

  it('fails closed on malformed claims and refuses verification without an expiry', () => {
    expect(evaluateClaimStatus(null as unknown as CapabilityClaim)).toBe('guarded')
    expect(evaluateClaimStatus({ ...verifiedClaim, evidenceExpiresAt: null })).toBe('experimental')
    expect(() => getCapabilityClaim('unknown' as never)).toThrow('Unknown capability claim')
  })

  it('fails closed when a claim is missing', () => {
    const fallback = getCapabilityClaimSafely('missing.capability')

    expect(fallback.declaredStatus).toBe('guarded')
    expect(fallback.guardReason).toContain('无法确认此操作的支持情况')
    expect(CAPABILITY_STATUS_LABELS[fallback.declaredStatus]).toBe('受保护')
  })

  it('records bounded Ticket 21 HTTP loopback evidence without promoting capabilities', () => {
    const expected = [
      ['metrics.monitoring', 'experimental', 'G2-published-http-rrd-loopback'],
      ['xva.transfer', 'experimental', 'G2-published-http-xva-loopback'],
      ['vm.console', 'experimental', 'G2-published-console-loopback'],
    ] as const

    for (const [id, status, gate] of expected) {
      const claim = getCapabilityClaim(id)
      expect(claim.declaredStatus).toBe(status)
      expect(claim.passedGates).toContain(gate)
      expect(claim.evidenceResult).toBe('failed')
      expect(claim.unverifiedBoundaries.join('；')).toMatch(/真实|实机|打包/)
    }

    const patch = getCapabilityClaim('patch.mutate')
    expect(patch.declaredStatus).toBe('guarded')
    expect(patch.passedGates).toEqual(['G1-renderer-guard', 'G2-ipc-guard'])
    expect(patch.guardReason).toContain('暂不可用')
  })
})
