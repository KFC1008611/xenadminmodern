import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('scoped logger type contract', () => {
  it('accepts message and optional data after the module is bound', () => {
    const root = process.cwd()
    const result = spawnSync(process.execPath, [
      resolve(root, 'node_modules/typescript/bin/tsc'),
      '--pretty', 'false',
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--target', 'ES2022',
      '--module', 'NodeNext',
      '--moduleResolution', 'NodeNext',
      '--types', 'node',
      resolve(root, 'tests/fixtures/types/scoped-logger.ts'),
    ], {
      cwd: root,
      encoding: 'utf8',
    })

    const output = `${result.stdout}${result.stderr}`
    expect(result.status, output).toBe(0)
  })
})
