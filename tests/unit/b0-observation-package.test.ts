import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  assertObservationComplete,
  buildObservationManifest,
  findSingle,
  inventoryTree,
} = require('../../scripts/b0-observation.cjs') as {
  assertObservationComplete(manifest: Record<string, unknown>): void
  buildObservationManifest(input: Record<string, unknown>): Record<string, any>
  findSingle(root: string, predicate: (path: string, entry: { isDirectory(): boolean }) => boolean): string
  inventoryTree(root: string): Array<{ path: string; size: number; sha256: string }>
}

function completeInput(): Record<string, unknown> {
  const sourceCommit = 'a'.repeat(40)
  const appAsarSha256 = 'e'.repeat(64)
  const featureEvidence = Array.from({ length: 22 }, (_, index) => ({
    id: `feature-${index}`,
    guardReason: `guard-${index}`,
    sourceCommit,
    artifactIdentity: `app.asar:sha256:${appAsarSha256}`,
    rendererObserved: true,
    ipcZeroSubmissionVerified: true,
  }))
  return {
    sourceCommit,
    lockfileSha256: 'b'.repeat(64),
    builtAt: '2026-07-27T02:00:00.000Z',
    platform: 'darwin',
    arch: 'arm64',
    osVersion: 'macOS 26.5.2',
    nodeVersion: 'v24.22.0',
    npmVersion: '11.19.1',
    toolchainReport: {
      schemaVersion: 1,
      ok: true,
      expected: { nodeVersion: '24.22.0', npmVersion: '11.19.1', lockfileVersion: 3 },
      actual: { nodeVersion: '24.22.0', npmVersion: '11.19.1', lockfileVersion: 3 },
      errors: [],
    },
    artifacts: [{ format: 'app', path: 'xenadmin-modern.app', size: 123, sha256: 'c'.repeat(64) }],
    appInventory: [{ path: 'Contents/Resources/app.asar', size: 123, sha256: 'd'.repeat(64) }],
    packageAudit: {
      violations: [],
      unpackedEntries: [],
      inventoryPath: 'package-audit/darwin-arm64.json',
      appAsarSha256,
    },
    gateVerification: {
      auditedFeatureCount: 22,
      expectedFeatureCount: 22,
      passed: true,
      testFiles: ['guard.test.ts'],
      featureEvidence,
    },
    runtime: {
      rendererLoaded: true,
      cleanProfile: true,
      cleanExit: true,
      readyState: 'complete',
      preloadApiAvailable: true,
      title: 'XCP-ng Center',
      visibleTextLength: 42,
    },
    trust: {
      developerIdSigned: false,
      notarized: false,
      gatekeeperAccepted: false,
      installed: false,
      windowsRealHostVerified: false,
      linuxRealHostVerified: false,
    },
  }
}

describe('B0 internal observation package', () => {
  it('records a clean fixed-lockfile candidate without promoting release trust', () => {
    const manifest = buildObservationManifest(completeInput())

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      classification: 'b0-internal-observation-only',
      source: { method: 'git-archive', cleanCheckout: true },
      dependencyInstall: { command: 'npm ci', fixedLockfile: true },
      trust: {
        developerIdSigned: false,
        notarized: false,
        gatekeeperAccepted: false,
        installed: false,
        formalRelease: false,
      },
      claims: {
        serverCompatibilityVerified: false,
        mutationVerified: false,
        b1MayStart: true,
        b0ToB8FormalReleaseComplete: false,
      },
    })
    expect(() => assertObservationComplete(manifest)).not.toThrow()
  })

  it.each([
    ['toolchain mismatch', { toolchainReport: { ok: false, errors: ['version mismatch'] } }],
    ['package violations', { packageAudit: { violations: ['secret'], unpackedEntries: [] } }],
    ['missing gate', { gateVerification: { auditedFeatureCount: 21, expectedFeatureCount: 22, passed: true } }],
    ['missing per-feature identity', {
      gateVerification: { ...completeInput().gateVerification as object, featureEvidence: [] },
    }],
    ['renderer failure', { runtime: { ...completeInput().runtime as object, rendererLoaded: false } }],
    ['preload failure', { runtime: { ...completeInput().runtime as object, preloadApiAvailable: false } }],
    ['unclean exit', { runtime: { ...completeInput().runtime as object, cleanExit: false } }],
  ])('fails closed for %s', (_label, override) => {
    const manifest = buildObservationManifest({ ...completeInput(), ...override })
    expect(() => assertObservationComplete(manifest)).toThrow(/B0 observation candidate incomplete/)
  })

  it('writes a complete sorted content inventory with hashes', () => {
    const root = mkdtempSync(join(tmpdir(), 'xenadmin-b0-inventory-'))
    try {
      mkdirSync(join(root, 'nested'))
      writeFileSync(join(root, 'z.txt'), 'z')
      writeFileSync(join(root, 'nested', 'a.txt'), 'a')

      expect(inventoryTree(root)).toEqual([
        { path: 'nested/a.txt', size: 1, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
        { path: 'z.txt', size: 1, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('selects the outer application bundle without counting nested Electron helpers', () => {
    const root = mkdtempSync(join(tmpdir(), 'xenadmin-b0-app-'))
    const app = join(root, 'mac-arm64', 'xenadmin-modern.app')
    try {
      mkdirSync(join(app, 'Contents', 'Frameworks', 'xenadmin-modern Helper.app'), { recursive: true })

      expect(findSingle(root, (path, entry) => entry.isDirectory() && path.endsWith('.app'))).toBe(app)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('is exposed as the documented package command with a tracked lockfile', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    expect(packageJson.scripts['build:b0-observation']).toBe('node scripts/b0-observation.cjs')
    expect(readFileSync(join(process.cwd(), '.gitignore'), 'utf8')).not.toMatch(/^package-lock\.json$/m)
    expect(readFileSync(join(process.cwd(), 'package-lock.json'), 'utf8')).toContain('"lockfileVersion": 3')
  })
})
