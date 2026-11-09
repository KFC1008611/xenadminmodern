import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  COVERAGE_POLICY,
  VITEST_COVERAGE_CONFIG,
  classifyCoveragePath,
  evaluateCoverage,
  summarizeCoverage,
} = require('../../scripts/coverage-policy.cjs') as {
  COVERAGE_POLICY: Record<string, any>
  VITEST_COVERAGE_CONFIG: Record<string, any>
  classifyCoveragePath(path: string, projectRoot?: string): string | null
  summarizeCoverage(summary: Record<string, any>, projectRoot?: string): Record<string, any>
  evaluateCoverage(summary: Record<string, any>, projectRoot?: string): Record<string, any>
}

const metric = (covered: number, total = 100) => ({
  total,
  covered,
  skipped: 0,
  pct: covered,
})

function fileCoverage(lines: number, functions: number, branches: number, statements: number) {
  return {
    lines: metric(lines),
    functions: metric(functions),
    branches: metric(branches),
    statements: metric(statements),
  }
}

function passingSummary() {
  return {
    total: fileCoverage(68, 61, 71, 68),
    '/workspace/src/shared/evidence-manifest.ts': fileCoverage(97, 90, 89, 97),
    '/workspace/src/main/xapi/client.ts': fileCoverage(80, 86, 73, 80),
    '/workspace/src/renderer/src/App.tsx': fileCoverage(50, 35, 68, 50),
    '/workspace/src/main/index.ts': fileCoverage(50, 45, 65, 50),
  }
}

describe('source-scoped coverage policy', () => {
  it('publishes one serializable source scope and layered Vitest configuration', () => {
    expect(JSON.parse(JSON.stringify(COVERAGE_POLICY))).toEqual(COVERAGE_POLICY)
    expect(COVERAGE_POLICY).toMatchObject({
      schemaVersion: 1,
      source: {
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/**/*.d.ts',
          'src/shared/types/**',
          'src/renderer/src/types/**',
        ],
      },
      reporters: ['text', 'html', 'json-summary'],
      layers: {
        safety: { thresholds: { lines: 90, functions: 85, branches: 80, statements: 90 } },
        protocol: { thresholds: { lines: 75, functions: 80, branches: 70, statements: 75 } },
        rendererUi: { thresholds: { lines: 45, functions: 30, branches: 60, statements: 45 } },
        other: { thresholds: { lines: 45, functions: 40, branches: 60, statements: 45 } },
      },
    })
    expect(VITEST_COVERAGE_CONFIG).toMatchObject({
      provider: 'v8',
      all: true,
      ignoreEmptyLines: true,
      reportOnFailure: true,
      include: COVERAGE_POLICY.source.include,
      exclude: COVERAGE_POLICY.source.exclude,
      reporter: COVERAGE_POLICY.reporters,
    })
    expect(VITEST_COVERAGE_CONFIG).not.toHaveProperty('thresholds')
  })

  it('classifies each managed file once with safety taking first-match precedence', () => {
    expect(classifyCoveragePath('/workspace/src/renderer/src/lib/vmActionGuard.ts', '/workspace'))
      .toBe('safety')
    expect(classifyCoveragePath('/workspace/src/main/ipc/handlers/utils.ts', '/workspace'))
      .toBe('safety')
    expect(classifyCoveragePath('/workspace/src/main/xapi/client.ts', '/workspace'))
      .toBe('protocol')
    expect(classifyCoveragePath('/workspace/src/renderer/src/App.tsx', '/workspace'))
      .toBe('rendererUi')
    expect(classifyCoveragePath('/workspace/src/main/index.ts', '/workspace')).toBe('other')
    expect(classifyCoveragePath('/workspace/tests/unit/example.test.ts', '/workspace')).toBeNull()
  })

  it('aggregates per-file coverage by layer and accepts every passing threshold', () => {
    const actual = summarizeCoverage(passingSummary(), '/workspace')
    const result = evaluateCoverage(passingSummary(), '/workspace')

    expect(actual).toMatchObject({
      safety: { fileCount: 1, actual: { lines: 97, functions: 90, branches: 89, statements: 97 } },
      protocol: { fileCount: 1, actual: { lines: 80, functions: 86, branches: 73, statements: 80 } },
      rendererUi: { fileCount: 1, actual: { lines: 50, functions: 35, branches: 68, statements: 50 } },
      other: { fileCount: 1, actual: { lines: 50, functions: 45, branches: 65, statements: 50 } },
    })
    expect(result).toMatchObject({
      schemaVersion: 1,
      kind: 'xenadmin-coverage-evidence',
      ok: true,
      errors: [],
    })
    expect(result.layers.every((layer: { errors: string[] }) => layer.errors.length === 0)).toBe(true)
    expect(result.unverifiedBoundaries).toEqual([
      '覆盖率不替代 Published XML-RPC 或 HTTP 协议契约证据',
      '覆盖率不替代真实 Electron 与打包应用运行证据',
      '覆盖率不替代参考服务器或实机 mutation 验证',
    ])
  })

  it('fails with layer, metric, actual, and threshold when coverage is insufficient', () => {
    const summary = passingSummary()
    summary['/workspace/src/main/xapi/client.ts'].branches = metric(69)

    const result = evaluateCoverage(summary, '/workspace')

    expect(result.ok).toBe(false)
    expect(result.layers.find((layer: { id: string }) => layer.id === 'protocol')).toMatchObject({
      actual: { branches: 69 },
      thresholds: { branches: 70 },
      errors: ['Protocol branches coverage 69% is below 70%'],
    })
    expect(result.errors).toContain('Protocol branches coverage 69% is below 70%')
  })
})
