import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const projectRoot = process.cwd()
const asar = require('@electron/asar') as {
  createPackage(source: string, destination: string): Promise<void>
}
const { auditPackagedApplication } = require('../../scripts/package-audit.cjs') as {
  auditPackagedApplication(options: {
    appOutDir: string
    platform: string
    arch: string
    outputDir: string
  }): Promise<unknown>
}

describe('coverage report package boundary', () => {
  it('keeps the coverage report directory ignored by Git', () => {
    const result = spawnSync('git', ['check-ignore', '--no-index', 'coverage/index.html'], {
      cwd: projectRoot,
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('coverage/index.html')
  })

  it('keeps electron-builder inputs limited to compiled output and package metadata', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(projectRoot, 'package.json'), 'utf8'),
    ) as { build?: { files?: string[] } }
    const positiveInputs = (packageJson.build?.files ?? []).filter((entry) => !entry.startsWith('!'))

    expect(positiveInputs).toEqual(['out/**/*', 'package.json'])
    expect(packageJson.build?.files?.some((entry) => entry.includes('coverage'))).toBe(false)
  })

  it('rejects a coverage report even when it is nested under an approved package root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xenadmin-coverage-package-boundary-'))
    const source = join(root, 'source')
    const appOutDir = join(root, 'app')

    try {
      mkdirSync(join(source, 'out', 'coverage'), { recursive: true })
      mkdirSync(appOutDir, { recursive: true })
      writeFileSync(join(source, 'out', 'coverage', 'index.html'), '<html>coverage</html>')
      writeFileSync(join(source, 'package.json'), '{"name":"xenadmin-modern"}')
      await asar.createPackage(source, join(appOutDir, 'app.asar'))

      await expect(auditPackagedApplication({
        appOutDir,
        platform: 'linux',
        arch: 'x64',
        outputDir: join(root, 'audit'),
      })).rejects.toThrow('forbidden path: /out/coverage/index.html')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
