import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('production preload assembly', () => {
  it('wires both VM builders into the actual contextBridge surface without raw advanced invokes', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/preload/index.ts'), 'utf8')

    expect(source).toContain("import { createVmApi } from './vm-api'")
    expect(source).toContain("import { createVmAdvancedApi } from './vm-advanced-api'")
    expect(source).toContain('const vmApi = createVmApi(ipcRenderer)')
    expect(source).toContain('const vmAdvancedApi = createVmAdvancedApi(ipcRenderer)')
    expect(source).toContain('vmAdvanced: vmAdvancedApi,')
    expect(source).toContain('onVmChanged: vmApi.onVmChanged,')
    expect(source).not.toContain('invoke(Ch.VM_ADV_')
    expect(source).not.toContain('ipcRenderer.on(Ch.EVENT_VM_CHANGED')
    expect(source).not.toContain('ipcRenderer.removeListener(Ch.EVENT_VM_CHANGED')
  })

  it('wires storage and network builders without raw invokes or a duplicate PIF list', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/preload/index.ts'), 'utf8')

    expect(source).toContain("import { createNetworkApi } from './network-api'")
    expect(source).toContain("import { createStorageApi } from './storage-api'")
    expect(source).toContain('const networkApi = createNetworkApi(ipcRenderer)')
    expect(source).toContain('const storageApi = createStorageApi(ipcRenderer)')

    for (const exposure of [
      'storage: storageApi.storage',
      'sr: storageApi.sr',
      'pbd: storageApi.pbd',
      'iso: storageApi.iso',
      'network: networkApi.network',
      'pif: networkApi.pif',
      'vif: networkApi.vif',
      'bond: networkApi.bond',
      'vlan: networkApi.vlan',
      'tunnel: networkApi.tunnel',
    ]) {
      expect(source).toContain(exposure)
    }

    expect(source).not.toMatch(
      /invoke(?:<[^>]+>)?\s*\(\s*Ch\.(?:SR_|VDI_|PBD_|ISO_|NETWORK_|PIF_|VIF_|BOND_|VLAN_|TUNNEL_)/m,
    )
    expect(source).not.toContain('pif: {')
  })
})
