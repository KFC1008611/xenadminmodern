import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('governance IPC production preload assembly', () => {
  it('exposes only the contract-backed Host, HA, Patch, and RBAC builders', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/preload/index.ts'), 'utf8')

    for (const [builder, moduleName, variable] of [
      ['createHostApi', 'host-api', 'hostApi'],
      ['createHaApi', 'ha-api', 'haApi'],
      ['createPatchApi', 'patch-api', 'patchApi'],
      ['createRbacApi', 'rbac-api', 'rbacApi'],
    ]) {
      expect(source).toContain(`import { ${builder} } from './${moduleName}'`)
      expect(source).toContain(`const ${variable} = ${builder}(ipcRenderer)`)
    }

    for (const exposure of [
      'host: hostApi.host',
      'ha: haApi.ha',
      'patch: patchApi.patch',
      'rbac: rbacApi.rbac',
    ]) expect(source).toContain(exposure)

    expect(source).not.toMatch(
      /invoke(?:<[^>]+>)?\s*\(\s*Ch\.(?:HOST_|HA_|PATCH_|RBAC_)/m,
    )
  })
})
