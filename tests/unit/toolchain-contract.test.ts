import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const projectRoot = resolve(process.cwd())
const packageJson = JSON.parse(
  readFileSync(resolve(projectRoot, 'package.json'), 'utf8'),
) as {
  packageManager?: string
  engines?: Record<string, string>
  scripts?: Record<string, string>
  devDependencies?: Record<string, string>
}

describe('fixed toolchain contract', () => {
  it('publishes one exact Node and npm combination for clean installs and gates', () => {
    expect(packageJson.packageManager).toBe('npm@11.19.1')
    expect(packageJson.engines).toEqual({ node: '24.22.0', npm: '11.19.1' })
    expect(readFileSync(resolve(projectRoot, '.nvmrc'), 'utf8')).toBe('24.22.0\n')
    expect(readFileSync(resolve(projectRoot, '.npmrc'), 'utf8')).toBe('engine-strict=true\n')
    expect(packageJson.scripts?.['verify:toolchain']).toBe('node scripts/verify-toolchain.cjs')
    expect(packageJson.scripts?.preinstall).toBe('npm run verify:toolchain')
    expect(packageJson.scripts?.pretest).toBe('npm run verify:toolchain')
    expect(packageJson.scripts?.precoverage).toBe('npm run verify:toolchain')
    expect(packageJson.scripts?.prelint).toBe('npm run verify:toolchain')
    expect(packageJson.scripts?.['pretypecheck:node']).toBe('npm run verify:toolchain')
    expect(packageJson.scripts?.['typecheck:node']).toBe('tsc --noEmit -p tsconfig.node.json')
    expect(packageJson.scripts?.['pretypecheck:web']).toBe('npm run verify:toolchain')
    expect(packageJson.scripts?.['typecheck:web']).toBe('tsc --noEmit -p tsconfig.web.json')
    expect(packageJson.scripts?.prebuild).toBe('npm run verify:toolchain')
    expect(packageJson.scripts?.['prebuild:b0-observation']).toBe('npm run verify:toolchain')
    expect(packageJson.scripts?.['prepackage:audit']).toBe('npm run verify:toolchain')
    expect(packageJson.devDependencies).toMatchObject({
      'electron-vite': '5.0.0',
      vite: '6.0.0',
    })
  })

  it('accepts only the pinned runtime and lockfile version', () => {
    const { verifyToolchain } = require('../../scripts/verify-toolchain.cjs') as {
      verifyToolchain(options: {
        projectRoot: string
        nodeVersion: string
        npmVersion: string
      }): { ok: boolean; errors: string[] }
    }

    expect(verifyToolchain({
      projectRoot,
      nodeVersion: '24.22.0',
      npmVersion: '11.19.1',
    })).toMatchObject({ ok: true, errors: [] })

    const wrongRuntime = verifyToolchain({
      projectRoot,
      nodeVersion: '26.0.0',
      npmVersion: '11.12.1',
    })
    expect(wrongRuntime.ok).toBe(false)
    expect(wrongRuntime.errors).toEqual([
      'Node 26.0.0 does not match required 24.22.0',
      'npm 11.12.1 does not match required 11.19.1',
    ])
  })
})
