import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const root = process.cwd()
const {
  compareCollection,
  validateSelectors,
} = require('../../scripts/test-gate.cjs') as {
  compareCollection: (
    actual: Array<{ path: string; tests: number }>,
    expected: Array<{ path: string; tests: number }>,
  ) => {
    missing: string[]
    unexpected: string[]
    countMismatches: Array<{ path: string; expected: number; actual: number }>
  }
  validateSelectors: (selectors: string[]) => string[]
}

function parseMachineReport(stdout: string): Record<string, any> {
  const lines = stdout.trim().split(/\r?\n/)
  return JSON.parse(lines[lines.length - 1])
}

function coveragePolicyFixtureSource(ok: boolean): string {
  return `
const { resolve } = require('node:path')
function evaluateCoverage(summary, projectRoot) {
  const files = Object.keys(summary || {}).filter((path) => path !== 'total')
  const total = summary?.total || {}
  const actual = Object.fromEntries(
    ['lines', 'functions', 'branches', 'statements'].map((metric) => [metric, total[metric]?.pct ?? 0]),
  )
  const thresholds = { lines: 90, functions: 90, branches: 90, statements: 90 }
  const errors = ${ok ? '[]' : "['Fixture lines coverage is below 101%']"}
  return {
    schemaVersion: 1,
    kind: 'xenadmin-coverage-evidence',
    ok: errors.length === 0,
    source: { include: ['src/**/*.ts'], exclude: [] },
    layers: [{
      id: 'fixture',
      label: 'Fixture',
      fileCount: files.length,
      totals: total,
      actual,
      thresholds,
      errors,
    }],
    errors,
    unverifiedBoundaries: ['Fixture coverage does not prove protocol behavior'],
    projectRoot: resolve(projectRoot),
  }
}
module.exports = { evaluateCoverage }
`
}

function runGateFixture(
  source: string,
  options: {
    focused?: boolean
    expectedTests?: number
    coverage?: boolean
    coveragePolicyOk?: boolean
  } = {},
) {
  const projectRoot = mkdtempSync(resolve(tmpdir(), 'xenadmin-test-gate-fixture-'))
  const relativePath = 'tests/unit/fixture.test.ts'
  mkdirSync(resolve(projectRoot, 'scripts'), { recursive: true })
  mkdirSync(resolve(projectRoot, 'tests/unit'), { recursive: true })
  mkdirSync(resolve(projectRoot, 'src'), { recursive: true })
  copyFileSync(
    resolve(root, 'scripts/test-gate.cjs'),
    resolve(projectRoot, 'scripts/test-gate.cjs'),
  )
  symlinkSync(resolve(root, 'node_modules'), resolve(projectRoot, 'node_modules'), 'junction')
  writeFileSync(
    resolve(projectRoot, 'package-lock.json'),
    `${JSON.stringify({ lockfileVersion: 3 })}\n`,
  )
  writeFileSync(
    resolve(projectRoot, 'vitest.config.mts'),
    [
      `import { defineConfig } from 'vitest/config'`,
      `export default defineConfig({ test: {`,
      `  allowOnly: false,`,
      `  include: ['tests/unit/**/*.test.ts'],`,
      `  coverage: {`,
      `    provider: 'v8',`,
      `    all: true,`,
      `    include: ['src/**/*.ts'],`,
      `    reporter: ['json-summary'],`,
      `    reportsDirectory: 'coverage',`,
      `    reportOnFailure: true,`,
      `  },`,
      `} })`,
      '',
    ].join('\n'),
  )
  writeFileSync(
    resolve(projectRoot, 'scripts/coverage-policy.cjs'),
    coveragePolicyFixtureSource(options.coveragePolicyOk !== false),
  )
  writeFileSync(
    resolve(projectRoot, 'tests/test-collection.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      files: [{ path: relativePath, tests: options.expectedTests ?? 1 }],
    })}\n`,
  )
  writeFileSync(resolve(projectRoot, 'src/fixture.ts'), 'export const covered = () => 1\n')
  writeFileSync(resolve(projectRoot, relativePath), source)

  try {
    const result = spawnSync(
      process.execPath,
      [
        resolve(projectRoot, 'scripts/test-gate.cjs'),
        ...(options.coverage
          ? ['--coverage']
          : options.focused === false ? [] : [relativePath]),
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          npm_config_user_agent: process.env.npm_config_user_agent
            || 'npm/11.19.1 node/v24.22.0 darwin arm64 workspaces/false',
        },
      },
    )
    const evidencePath = resolve(projectRoot, 'coverage/coverage-evidence.json')
    return {
      ...result,
      report: parseMachineReport(result.stdout),
      evidence: existsSync(evidencePath)
        ? JSON.parse(readFileSync(evidencePath, 'utf8'))
        : null,
    }
  } finally {
    rmSync(projectRoot, { recursive: true, force: true })
  }
}

describe('strict test gate', () => {
  it('binds npm test to the gate, ESM Vitest config, and an exact collection manifest', () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    const manifest = JSON.parse(readFileSync(resolve(root, 'tests/test-collection.json'), 'utf8'))

    expect(packageJson.scripts.pretest).toBe('npm run verify:toolchain')
    expect(packageJson.scripts.test).toBe('node scripts/test-gate.cjs')
    expect(packageJson.scripts.coverage).toBe('node scripts/test-gate.cjs --coverage')
    expect(existsSync(resolve(root, 'vitest.config.ts'))).toBe(false)
    expect(readFileSync(resolve(root, 'vitest.config.mts'), 'utf8')).toContain('allowOnly: false')
    expect(manifest).toMatchObject({ schemaVersion: 1 })
    expect(manifest.files).toEqual([...manifest.files].sort((a, b) => a.path.localeCompare(b.path)))
  })

  it('accepts only explicit managed test files as focused selectors', () => {
    expect(validateSelectors([
      'tests/unit/example.test.ts',
      'tests/components/example.test.tsx',
    ])).toEqual([])
    expect(validateSelectors([
      '--exclude=tests/unit/**',
      '--changed',
      '--shard=1/2',
      'tests/unit',
      '../outside.test.ts',
    ])).toEqual([
      '--exclude=tests/unit/**',
      '--changed',
      '--shard=1/2',
      'tests/unit',
      '../outside.test.ts',
    ])
  })

  it('rejects collection-shaping flags before Vitest starts', () => {
    const result = spawnSync(
      process.execPath,
      [resolve(root, 'scripts/test-gate.cjs'), '--exclude=tests/unit/**'],
      { cwd: root, encoding: 'utf8' },
    )
    const report = parseMachineReport(result.stdout)

    expect(result.status).toBe(1)
    expect(report).toMatchObject({
      ok: false,
      collection: null,
      errors: [
        'Focused selector is not an allowed test file: --exclude=tests/unit/**',
      ],
    })
  })

  it('reserves coverage for an unfiltered full run', () => {
    for (const args of [
      ['--coverage', 'tests/unit/example.test.ts'],
      ['--coverage', '--changed'],
      ['tests/unit/example.test.ts', '--coverage'],
    ]) {
      const result = spawnSync(
        process.execPath,
        [resolve(root, 'scripts/test-gate.cjs'), ...args],
        { cwd: root, encoding: 'utf8' },
      )
      const report = parseMachineReport(result.stdout)

      expect(result.status).toBe(1)
      expect(report).toMatchObject({ ok: false, collection: null })
    }
  })

  it('runs full coverage through the strict CLI and writes matching evidence', () => {
    const result = runGateFixture(
      [
        `import { expect, it } from 'vitest'`,
        `import { covered } from '../../src/fixture'`,
        `it('covers source', () => expect(covered()).toBe(1))`,
        '',
      ].join('\n'),
      { coverage: true },
    )

    expect(result.status).toBe(0)
    expect(result.report).toMatchObject({
      ok: true,
      collection: { mode: 'full', manifestChecked: true, fileCount: 1, testCount: 1 },
      coverage: {
        schemaVersion: 1,
        kind: 'xenadmin-coverage-evidence',
        ok: true,
        layers: [{
          id: 'fixture',
          fileCount: 1,
          actual: { lines: 100, functions: 100, branches: 100, statements: 100 },
          thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
        }],
        unverifiedBoundaries: ['Fixture coverage does not prove protocol behavior'],
      },
    })
    expect(result.evidence).toEqual(result.report.coverage)
  })

  it('fails coverage mode when the policy threshold fails and preserves evidence', () => {
    const result = runGateFixture(
      [
        `import { expect, it } from 'vitest'`,
        `import { covered } from '../../src/fixture'`,
        `it('covers source', () => expect(covered()).toBe(1))`,
        '',
      ].join('\n'),
      { coverage: true, coveragePolicyOk: false },
    )

    expect(result.status).toBe(1)
    expect(result.report).toMatchObject({
      ok: false,
      coverage: {
        ok: false,
        errors: ['Fixture lines coverage is below 101%'],
      },
      errors: ['Coverage policy failed: Fixture lines coverage is below 101%'],
    })
    expect(result.evidence).toEqual(result.report.coverage)
  })

  it.each([
    [
      'a test failure',
      `import { expect, it } from 'vitest'\nit('fails', () => expect(1).toBe(2))\n`,
      { expectedTests: 1 },
      'Vitest exited with status 1',
    ],
    [
      'collection drift',
      `import { expect, it } from 'vitest'\nit('passes', () => expect(true).toBe(true))\n`,
      { expectedTests: 2 },
      'Full test collection does not match tests/test-collection.json',
    ],
    [
      'stderr',
      `import { expect, it } from 'vitest'\nit('warns', () => { console.warn('coverage warning'); expect(true).toBe(true) })\n`,
      { expectedTests: 1 },
      expect.stringMatching(/^Vitest wrote \d+ stderr lines$/),
    ],
  ])('keeps the strict %s gate active in coverage mode', (_label, source, options, error) => {
    const result = runGateFixture(source, { ...options, coverage: true })

    expect(result.status).toBe(1)
    expect(result.report.errors).toContainEqual(error)
  })

  it('rejects a real accidental only through the CLI seam', () => {
    const result = runGateFixture(
      `import { expect, it } from 'vitest'\nit.only('must fail', () => expect(true).toBe(true))\n`,
    )

    expect(result.status).toBe(1)
    expect(result.report).toMatchObject({
      ok: false,
      tests: { onlyDetected: true },
    })
  })

  it('rejects real skip, todo, and stderr through the CLI seam', () => {
    const result = runGateFixture(
      [
        `import { expect, it } from 'vitest'`,
        `it('writes stderr', () => { console.warn('fixture warning'); expect(true).toBe(true) })`,
        `it.skip('must fail', () => {})`,
        `it.todo('must fail')`,
        '',
      ].join('\n'),
    )

    expect(result.status).toBe(1)
    expect(result.report).toMatchObject({
      ok: false,
      tests: { skipped: 1, todo: 1 },
      diagnostics: { warningCount: 1 },
    })
    expect(result.report.diagnostics.stderr.lineCount).toBeGreaterThan(0)
  })

  it('accepts a clean focused run through the CLI seam', () => {
    const result = runGateFixture(
      `import { expect, it } from 'vitest'\nit('passes', () => expect(true).toBe(true))\n`,
    )

    expect(result.status).toBe(0)
    expect(result.report).toMatchObject({
      ok: true,
      collection: {
        mode: 'focused',
        manifestChecked: false,
        fileCount: 1,
        testCount: 1,
      },
      tests: { passed: 1, failed: 0, skipped: 0, todo: 0, onlyDetected: false },
      diagnostics: { warningCount: 0, stderr: { bytes: 0, lineCount: 0 } },
    })
  })

  it('rejects real collection drift through the full CLI seam', () => {
    const result = runGateFixture(
      `import { expect, it } from 'vitest'\nit('passes', () => expect(true).toBe(true))\n`,
      { focused: false, expectedTests: 2 },
    )

    expect(result.status).toBe(1)
    expect(result.report).toMatchObject({
      ok: false,
      collection: {
        mode: 'full',
        manifestChecked: true,
        drift: {
          missing: [],
          unexpected: [],
          countMismatches: [{ path: 'tests/unit/fixture.test.ts', expected: 2, actual: 1 }],
        },
      },
      errors: ['Full test collection does not match tests/test-collection.json'],
    })
  })

  it('reports missing, unexpected, and changed per-file test counts', () => {
    expect(compareCollection(
      [
        { path: 'tests/a.test.ts', tests: 2 },
        { path: 'tests/c.test.ts', tests: 1 },
      ],
      [
        { path: 'tests/a.test.ts', tests: 3 },
        { path: 'tests/b.test.ts', tests: 1 },
      ],
    )).toEqual({
      missing: ['tests/b.test.ts'],
      unexpected: ['tests/c.test.ts'],
      countMismatches: [{ path: 'tests/a.test.ts', expected: 3, actual: 2 }],
    })
  })

})
