import { describe, expect, it } from 'vitest'
import {
  classifyTemplate,
  deriveWizardSteps,
  getSupportedInstallModes,
  resetForTemplate,
  validateWizardStep,
} from '../../src/renderer/src/components/wizard/vmWizardModel'

describe('vmWizardModel', () => {
  it('adds installation media only for system templates', () => {
    expect(deriveWizardSteps({ templateKind: 'system', installMode: 'iso' } as any)).toEqual([
      'template',
      'name',
      'install',
      'placement',
      'compute',
      'storage',
      'network',
      'review',
    ])
    expect(deriveWizardSteps({ templateKind: 'custom', installMode: 'none' } as any)).toEqual([
      'template',
      'name',
      'placement',
      'compute',
      'storage',
      'network',
      'review',
    ])
  })

  it('classifies the default_template marker consistently with the service', () => {
    expect(classifyTemplate({
      is_default_template: false,
      other_config: { default_template: 'true' },
    } as any)).toBe('system')
    expect(classifyTemplate({ is_default_template: false, other_config: {} } as any)).toBe('custom')
  })

  it('derives ISO and PXE support from template install methods', () => {
    expect(getSupportedInstallModes({
      other_config: { 'install-methods': 'cdrom,nfs,http' },
      HVM_boot_policy: 'BIOS order',
    } as any)).toEqual(['iso', 'pxe'])
    expect(getSupportedInstallModes({
      other_config: { 'install-methods': 'cdrom' },
      HVM_boot_policy: '',
    } as any)).toEqual(['iso'])
  })

  it('blocks incomplete install, storage, and network steps', () => {
    expect(validateWizardStep('install', {
      templateKind: 'system',
      installMode: 'iso',
      isoRef: '',
    } as any)).toEqual(expect.objectContaining({ valid: false }))
    expect(validateWizardStep('storage', {
      templateKind: 'custom',
      targetSrRef: '',
      resourceStatus: { storage: 'ready' },
    } as any)).toEqual(expect.objectContaining({ valid: false }))
    expect(validateWizardStep('storage', {
      templateKind: 'system',
      installMode: 'iso',
      disks: [{ sizeBytes: 1024, srRef: 'OpaqueRef:sr' }],
      resourceStatus: { storage: 'loading' },
    } as any)).toEqual(expect.objectContaining({ valid: false }))
    expect(validateWizardStep('network', {
      vifs: [{ device: '0', networkRef: '' }],
      resourceStatus: { network: 'ready' },
    } as any)).toEqual(expect.objectContaining({ valid: false }))
  })

  it('resets derived choices and preserves only a user-edited name', () => {
    const next = resetForTemplate({
      vmName: 'hand-edited',
      nameEdited: true,
      isoRef: 'OpaqueRef:iso',
      targetHostRef: 'OpaqueRef:host',
      targetSrRef: 'OpaqueRef:sr',
      disks: [{ srRef: 'OpaqueRef:sr', sizeBytes: 1024 }],
      vifs: [{ device: '0', networkRef: 'OpaqueRef:network' }],
      startAfter: true,
    } as any, {
      ref: 'OpaqueRef:new-template',
      name_label: 'Ubuntu',
      is_default_template: true,
      other_config: { 'install-methods': 'cdrom' },
    } as any)

    expect(next).toMatchObject({
      templateRef: 'OpaqueRef:new-template',
      templateKind: 'system',
      vmName: 'hand-edited',
      nameEdited: true,
      isoRef: '',
      targetHostRef: '',
      targetSrRef: '',
      disks: [],
      vifs: [],
      startAfter: false,
    })
  })

  it('replaces an automatic name when the template changes', () => {
    const next = resetForTemplate({ vmName: 'Old Template', nameEdited: false } as any, {
      ref: 'OpaqueRef:new-template',
      name_label: 'New Template',
      is_default_template: false,
      other_config: {},
    } as any)

    expect(next.vmName).toBe('New Template')
    expect(next.nameEdited).toBe(false)
  })
  it('separates PV URL installs from PXE and offers a no-media fallback', () => {
    expect(getSupportedInstallModes({ HVM_boot_policy: 'BIOS order', other_config: {} })).toEqual(['none', 'iso', 'pxe'])
    expect(getSupportedInstallModes({ PV_bootloader: 'eliloader', other_config: { 'install-methods': 'cdrom,http,nfs' } })).toEqual(['iso', 'url'])
    expect(getSupportedInstallModes({ other_config: {} })).toEqual(['none'])
    expect(validateWizardStep('install', { installMode: 'none' }).valid).toBe(true)
    expect(validateWizardStep('install', { installMode: 'url', installUrl: 'nfs://server/path', installMethods: 'http' }).valid).toBe(false)
    expect(validateWizardStep('install', { installMode: 'url', installUrl: 'https://server/path', installMethods: 'http' }).valid).toBe(true)
    expect(validateWizardStep('install', { installMode: 'url', installUrl: 'http://user:pass@server/path', installMethods: 'http' }).valid).toBe(false)
  })
  it('requires network adapters for network installation and safe integer capacity', () => {
    expect(validateWizardStep('network', { installMode: 'pxe', vifs: [], resourceStatus: { network: 'ready' } }).valid).toBe(false)
    expect(validateWizardStep('network', { installMode: 'url', vifs: [], resourceStatus: { network: 'ready' } }).valid).toBe(false)
    expect(validateWizardStep('compute', { vcpus: 2, memoryBytes: 1.5 }).valid).toBe(false)
    expect(validateWizardStep('storage', { templateKind: 'system', installMode: 'iso', disks: [{ templateVdiRef: '', sizeBytes: 1.5, srRef: 'OpaqueRef:sr' }] }).valid).toBe(false)
  })

})
