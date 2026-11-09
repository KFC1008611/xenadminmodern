import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_STATUS_LABELS,
  evaluateClaimStatus,
  getCapabilityClaim,
  type CapabilityClaimId,
} from '../../src/shared/evidence-manifest'

const readme = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8')
const packageJson = JSON.parse(
  readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
) as { description?: string; private?: boolean }

describe('public product claims', () => {
  it('labels evidence-limited capabilities instead of claiming verified support', () => {
    const readmeClaimIds = [
      'connection.manual-multi-pool',
      'inventory.unified-view',
      'connection.health',
      'connection.auto-restore',
      'vm.cross-pool-mutations',
      'vm.copy',
      'vm.cross-pool-copy',
      'vm.creation',
      'vm.console',
      'xva.transfer',
      'metrics.monitoring',
      'patch.mutate',
      'storage.lifecycle',
      'network.lifecycle',
      'host.maintenance',
      'ha.governance',
      'alerts.center',
      'platform.cross-platform-runtime',
      'release.formal-distribution',
    ] as const satisfies readonly CapabilityClaimId[]

    for (const id of readmeClaimIds) {
      const claim = getCapabilityClaim(id)
      const status = CAPABILITY_STATUS_LABELS[evaluateClaimStatus(claim)]
      const summary = `${claim.supportedScope}；未验证：${claim.unverifiedBoundaries[0]}`
      expect(readme).toContain(`| \`${id}\` | ${claim.title} | ${status} | ${summary} |`)
    }
    expect(readme).not.toContain('重启后自动恢复上次的连接状态')
    expect(readme).toContain('Published HTTP 数据面契约可通过受控 loopback 测试聚焦验证')
    expect(readme).toContain('tests/unit/xva-http-data-plane.test.ts')
    expect(readme).toContain('真实 XCP-ng/XenServer HTTP/TLS 版本矩阵')
  })

  it('describes build as bundle generation, not a production release', () => {
    expect(readme).toContain('### 构建应用 bundle')
    expect(readme).toContain('不生成正式发布物')
    expect(readme).not.toContain('### 构建生产版本')
    expect(packageJson.description).toBe('Evidence-gated Electron desktop client for XCP-ng management')
    expect(packageJson.private).toBe(true)
  })

  it('documents the fail-closed B0 observation candidate boundary', () => {
    expect(readme).toContain('npm run build:b0-observation')
    expect(readme).toContain('`git archive`')
    expect(readme).toContain('`package-lock.json`')
    expect(readme).toContain('没有 Developer ID 签名')
    expect(readme).toContain('不通过 Gatekeeper')
    expect(readme).toContain('只能称为 B0 内部观察包')
    expect(readme).toContain('B0 完成也不构成 B0–B8 首个正式发布')
  })
})
