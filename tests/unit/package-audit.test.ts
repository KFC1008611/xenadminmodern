import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar') as {
  createPackage(source: string, destination: string): Promise<void>
}

const packageJson = JSON.parse(
  readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
) as {
  build?: {
    files?: string[]
    afterPack?: string
  }
  scripts?: Record<string, string>
}

describe('packaged runtime boundary', () => {
  it('uses a positive application-file allowlist and a mandatory package audit hook', () => {
    expect(packageJson.build?.files).toEqual(['out/**/*', 'package.json', '!node_modules/**/*'])
    expect(packageJson.build?.afterPack).toBe('scripts/package-audit.cjs')
    expect(packageJson.scripts?.['package:audit']).toBe('node scripts/package-audit.cjs')
  })

  it('writes an inventory for an approved packaged application', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xenadmin-package-audit-'))
    const source = join(root, 'source')
    const appOutDir = join(root, 'XenAdmin Modern.app', 'Contents')
    const resourcesDir = join(appOutDir, 'Resources')
    const asarPath = join(resourcesDir, 'app.asar')

    try {
      mkdirSync(join(source, 'out', 'main'), { recursive: true })
      mkdirSync(resourcesDir, { recursive: true })
      writeFileSync(join(source, 'out', 'main', 'index.js'), 'console.log("runtime")')
      writeFileSync(join(source, 'package.json'), '{"name":"xenadmin-modern"}')
      await asar.createPackage(source, asarPath)

      const { auditPackagedApplication } = require('../../scripts/package-audit.cjs') as {
        auditPackagedApplication(options: {
          appOutDir: string
          platform: string
          arch: string
          outputDir: string
        }): Promise<{ inventoryPath: string; entries: string[]; violations: string[] }>
      }
      const result = await auditPackagedApplication({
        appOutDir,
        platform: 'darwin',
        arch: 'arm64',
        outputDir: join(root, 'audit'),
      })

      expect(result.entries).toEqual(['/out/main/index.js', '/package.json'])
      expect(result.violations).toEqual([])
      expect(JSON.parse(readFileSync(result.inventoryPath, 'utf8'))).toMatchObject({
        schemaVersion: 2,
        platform: 'darwin',
        arch: 'arm64',
        approvedRoots: ['out', 'package.json'],
        entryDetails: [
          expect.objectContaining({ path: '/out/main/index.js', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }),
          expect.objectContaining({ path: '/package.json', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }),
        ],
        violations: [],
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects forbidden paths and high-confidence secrets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xenadmin-package-audit-'))
    const source = join(root, 'source')
    const appOutDir = join(root, 'resources')

    try {
      mkdirSync(join(source, 'out'), { recursive: true })
      mkdirSync(join(source, 'tests'), { recursive: true })
      mkdirSync(appOutDir, { recursive: true })
      writeFileSync(join(source, 'out', 'index.js'), 'const password = "actual-secret"')
      writeFileSync(join(source, 'tests', 'fixture.ts'), 'not runtime')
      writeFileSync(join(source, '.env'), 'TOKEN=actual-secret')
      await asar.createPackage(source, join(appOutDir, 'app.asar'))

      const { auditPackagedApplication } = require('../../scripts/package-audit.cjs') as {
        auditPackagedApplication(options: {
          appOutDir: string
          platform: string
          arch: string
          outputDir: string
        }): Promise<unknown>
      }

      let message = ''
      try {
        await auditPackagedApplication({
          appOutDir,
          platform: 'linux',
          arch: 'x64',
          outputDir: join(root, 'audit'),
        })
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      expect(message).toContain('Package audit failed')
      expect(message).toContain('/.env')
      expect(message).toContain('/tests/fixture.ts')
      expect(message).toContain('embedded credential')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('scans secrets even when a bundled file is larger than two MiB', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xenadmin-package-audit-'))
    const source = join(root, 'source')
    const appOutDir = join(root, 'resources')

    try {
      mkdirSync(join(source, 'out'), { recursive: true })
      mkdirSync(appOutDir, { recursive: true })
      writeFileSync(
        join(source, 'out', 'large.js'),
        `${'x'.repeat(2 * 1024 * 1024)}\nconst token = "actual-secret-value"`,
      )
      writeFileSync(join(source, 'package.json'), '{"name":"xenadmin-modern"}')
      await asar.createPackage(source, join(appOutDir, 'app.asar'))

      const { auditPackagedApplication } = require('../../scripts/package-audit.cjs') as {
        auditPackagedApplication(options: {
          appOutDir: string
          platform: string
          arch: string
          outputDir: string
        }): Promise<unknown>
      }

      await expect(auditPackagedApplication({
        appOutDir,
        platform: 'darwin',
        arch: 'arm64',
        outputDir: join(root, 'audit'),
      })).rejects.toThrow(/embedded credential.*large\.js/s)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
