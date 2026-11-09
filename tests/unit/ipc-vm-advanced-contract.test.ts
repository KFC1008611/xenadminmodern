import { describe, expect, it } from 'vitest'
import * as Ch from '../../src/shared/channels'
import {
  vmAdvancedAddAntiAffinityContract,
  vmAdvancedAddTagContract,
  vmAdvancedDisableProtectionContract,
  vmAdvancedEnableProtectionContract,
  vmAdvancedGetAffinityContract,
  vmAdvancedGetAllConfigsContract,
  vmAdvancedGetConfigContract,
  vmAdvancedRemoveAntiAffinityContract,
  vmAdvancedRemoveTagContract,
  vmAdvancedSetAffinityContract,
  vmAdvancedSetAntiAffinityContract,
  vmAdvancedSetBootOrderContract,
  vmAdvancedSetHvmBootParamsContract,
  vmAdvancedSetOtherConfigContract,
  vmAdvancedSetPlatformParamContract,
  vmAdvancedSetStartDelayContract,
  vmAdvancedSetStartOrderContract,
  vmAdvancedSetVcpuHotplugContract,
  vmAdvancedSetVcpusNumberContract,
  vmAdvancedSetViridianContract,
  vmAdvancedContracts,
} from '../../src/shared/ipc-contracts/vm-advanced'

const advancedConfig = {
  vmRef: 'OpaqueRef:vm',
  vmName: 'Workload VM',
  affinity: 'OpaqueRef:host' as string | null,
  antiAffinity: ['OpaqueRef:anti-affinity-vm'],
  isProtected: true,
  vcpusHotplug: true,
  startDelay: 15,
  bootOrder: 'cdn',
  hvmBootParams: { order: 'cdn' },
  otherConfig: { owner: 'platform-team' },
  platform: { viridian: 'true' },
}

const affinityConfig = {
  vmRef: 'OpaqueRef:vm',
  hostRef: null,
  antiAffinityRefs: ['OpaqueRef:anti-affinity-vm'],
}

function expectRejected(schema: { parse(value: unknown): unknown }, values: readonly unknown[]): void {
  for (const value of values) expect(() => schema.parse(value)).toThrow()
}

describe('VM Advanced IPC contracts', () => {
  it('exports the independent literal inventory of all twenty channels', () => {
    expect(vmAdvancedContracts.map(({ channel }) => channel)).toEqual([
      'vm:advGetConfig',
      'vm:advGetAllConfigs',
      'vm:advGetAffinity',
      'vm:advSetAffinity',
      'vm:advSetAntiAffinity',
      'vm:advAddAntiAffinity',
      'vm:advRemoveAntiAffinity',
      'vm:advEnableProtection',
      'vm:advDisableProtection',
      'vm:advSetVcpuHotplug',
      'vm:advSetVcpusNumber',
      'vm:advSetStartDelay',
      'vm:advSetBootOrder',
      'vm:advSetHvmBootParams',
      'vm:advSetPlatformParam',
      'vm:advSetViridian',
      'vm:advSetOtherConfig',
      'vm:advAddTag',
      'vm:advRemoveTag',
      'vm:advSetStartOrder',
    ])
    expect(new Set(vmAdvancedContracts.map(({ channel }) => channel))).toHaveLength(20)
  })

  it('declares the three read descriptors as strict app-window invokes', () => {
    const expected = [
      [vmAdvancedGetConfigContract, Ch.VM_ADV_GET_CONFIG],
      [vmAdvancedGetAllConfigsContract, Ch.VM_ADV_GET_ALL_CONFIGS],
      [vmAdvancedGetAffinityContract, Ch.VM_ADV_GET_AFFINITY],
    ] as const

    expect(vmAdvancedContracts.slice(0, 3)).toEqual(expected.map(([contract]) => contract))
    for (const [contract, channel] of expected) {
      expect(contract).toMatchObject({
        channel,
        direction: 'invoke',
        errorShape: 'ipc-error-response-v1',
        callerPolicy: 'app-window-main-frame',
        redaction: ['none'],
      })
    }
  })

  it('accepts only exact nonblank connection and live VM reference tuples', () => {
    expect(vmAdvancedGetAllConfigsContract.argsSchema.parse(['pool-1'])).toEqual(['pool-1'])
    expect(vmAdvancedGetConfigContract.argsSchema.parse(['pool-1', 'OpaqueRef:vm']))
      .toEqual(['pool-1', 'OpaqueRef:vm'])
    expect(vmAdvancedGetAffinityContract.argsSchema.parse(['pool-1', 'OpaqueRef:vm']))
      .toEqual(['pool-1', 'OpaqueRef:vm'])

    expectRejected(vmAdvancedGetAllConfigsContract.argsSchema, [
      [], [''], ['   '], [1], ['pool-1', 'extra'],
    ])
    for (const contract of [vmAdvancedGetConfigContract, vmAdvancedGetAffinityContract]) {
      expectRejected(contract.argsSchema, [
        [], ['pool-1'], ['', 'OpaqueRef:vm'], ['pool-1', ''], ['pool-1', 'OpaqueRef:NULL'],
        ['pool-1', 'OpaqueRef:vm', 'extra'],
      ])
    }
  })

  it('validates exact normalized advanced and affinity read results', () => {
    expect(vmAdvancedGetConfigContract.resultSchema.parse(advancedConfig)).toEqual(advancedConfig)
    expect(vmAdvancedGetAllConfigsContract.resultSchema.parse([advancedConfig])).toEqual([advancedConfig])
    expect(vmAdvancedGetAffinityContract.resultSchema.parse(affinityConfig)).toEqual(affinityConfig)

    expectRejected(vmAdvancedGetConfigContract.resultSchema, [
      { ...advancedConfig, startDelay: Number.NaN },
      { ...advancedConfig, startDelay: -1 },
      { ...advancedConfig, bootOrder: 'cc' },
      { ...advancedConfig, platform: [] },
      { ...advancedConfig, extra: true },
      { vmRef: 'OpaqueRef:vm' },
    ])
    expectRejected(vmAdvancedGetAllConfigsContract.resultSchema, [
      advancedConfig,
      [{ ...advancedConfig, antiAffinity: ['OpaqueRef:NULL'] }],
    ])
    expectRejected(vmAdvancedGetAffinityContract.resultSchema, [
      { ...affinityConfig, hostRef: 'OpaqueRef:NULL' },
      { ...affinityConfig, antiAffinityRefs: [''] },
      { ...affinityConfig, extra: true },
    ])
  })

  it('declares strict affinity, anti-affinity, and protection mutations', () => {
    const expected = [
      [vmAdvancedSetAffinityContract, Ch.VM_ADV_SET_AFFINITY],
      [vmAdvancedSetAntiAffinityContract, Ch.VM_ADV_SET_ANTI_AFFINITY],
      [vmAdvancedAddAntiAffinityContract, Ch.VM_ADV_ADD_ANTI_AFFINITY],
      [vmAdvancedRemoveAntiAffinityContract, Ch.VM_ADV_REMOVE_ANTI_AFFINITY],
      [vmAdvancedEnableProtectionContract, Ch.VM_ADV_ENABLE_PROTECTION],
      [vmAdvancedDisableProtectionContract, Ch.VM_ADV_DISABLE_PROTECTION],
    ] as const

    expect(vmAdvancedContracts.slice(3, 9)).toEqual(expected.map(([contract]) => contract))
    for (const [contract, channel] of expected) {
      expect(contract).toMatchObject({
        channel,
        direction: 'invoke',
        errorShape: 'ipc-error-response-v1',
        callerPolicy: 'app-window-main-frame',
        redaction: ['none'],
      })
      expect(contract.resultSchema.parse(undefined)).toBeUndefined()
      expectRejected(contract.resultSchema, [null, false, {}])
    }
  })

  it('validates nullable affinity and live anti-affinity references without extra arguments', () => {
    expect(vmAdvancedSetAffinityContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:vm', null,
    ])).toEqual(['pool-1', 'OpaqueRef:vm', null])
    expect(vmAdvancedSetAffinityContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:vm', 'OpaqueRef:host',
    ])).toEqual(['pool-1', 'OpaqueRef:vm', 'OpaqueRef:host'])
    expectRejected(vmAdvancedSetAffinityContract.argsSchema, [
      ['pool-1', 'OpaqueRef:vm'],
      ['pool-1', 'OpaqueRef:vm', ''],
      ['pool-1', 'OpaqueRef:vm', 'OpaqueRef:NULL'],
      ['pool-1', 'OpaqueRef:vm', null, 'extra'],
    ])

    expect(vmAdvancedSetAntiAffinityContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:vm', ['OpaqueRef:peer-1', 'OpaqueRef:peer-2'],
    ])).toEqual(['pool-1', 'OpaqueRef:vm', ['OpaqueRef:peer-1', 'OpaqueRef:peer-2']])
    expectRejected(vmAdvancedSetAntiAffinityContract.argsSchema, [
      ['pool-1', 'OpaqueRef:vm', 'OpaqueRef:peer'],
      ['pool-1', 'OpaqueRef:vm', ['OpaqueRef:NULL']],
      ['pool-1', 'OpaqueRef:vm', ['']],
      ['pool-1', 'OpaqueRef:vm', [], 'extra'],
    ])

    for (const contract of [
      vmAdvancedAddAntiAffinityContract,
      vmAdvancedRemoveAntiAffinityContract,
    ]) {
      expect(contract.argsSchema.parse([
        'pool-1', 'OpaqueRef:vm', 'OpaqueRef:peer',
      ])).toEqual(['pool-1', 'OpaqueRef:vm', 'OpaqueRef:peer'])
      expectRejected(contract.argsSchema, [
        ['pool-1', 'OpaqueRef:vm'],
        ['pool-1', 'OpaqueRef:vm', 'OpaqueRef:NULL'],
        ['pool-1', 'OpaqueRef:vm', 'OpaqueRef:peer', 'extra'],
      ])
    }

    for (const contract of [
      vmAdvancedEnableProtectionContract,
      vmAdvancedDisableProtectionContract,
    ]) {
      expect(contract.argsSchema.parse(['pool-1', 'OpaqueRef:vm']))
        .toEqual(['pool-1', 'OpaqueRef:vm'])
      expectRejected(contract.argsSchema, [
        ['pool-1'], ['pool-1', 'OpaqueRef:NULL'], ['pool-1', 'OpaqueRef:vm', 'extra'],
      ])
    }
  })

  it('declares strict VCPU, delay, and boot mutation descriptors', () => {
    const expected = [
      [vmAdvancedSetVcpuHotplugContract, Ch.VM_ADV_SET_VCPU_HOTPLUG],
      [vmAdvancedSetVcpusNumberContract, Ch.VM_ADV_SET_VCPUS_NUMBER],
      [vmAdvancedSetStartDelayContract, Ch.VM_ADV_SET_START_DELAY],
      [vmAdvancedSetBootOrderContract, Ch.VM_ADV_SET_BOOT_ORDER],
      [vmAdvancedSetHvmBootParamsContract, Ch.VM_ADV_SET_HVM_BOOT_PARAMS],
    ] as const

    expect(vmAdvancedContracts.slice(9, 14)).toEqual(expected.map(([contract]) => contract))
    for (const [contract, channel] of expected) {
      expect(contract).toMatchObject({
        channel,
        direction: 'invoke',
        callerPolicy: 'app-window-main-frame',
        redaction: ['none'],
      })
      expect(contract.resultSchema.parse(undefined)).toBeUndefined()
    }
  })

  it('accepts only positive integer VCPU values and nonnegative integer delays', () => {
    for (const contract of [
      vmAdvancedSetVcpuHotplugContract,
      vmAdvancedSetVcpusNumberContract,
    ]) {
      expect(contract.argsSchema.parse(['pool-1', 'OpaqueRef:vm', 4]))
        .toEqual(['pool-1', 'OpaqueRef:vm', 4])
      for (const invalidValue of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '4']) {
        expect(() => contract.argsSchema.parse(['pool-1', 'OpaqueRef:vm', invalidValue]))
          .toThrow()
      }
      expect(() => contract.argsSchema.parse(['pool-1', 'OpaqueRef:vm', 4, 'extra']))
        .toThrow()
    }

    for (const delay of [0, 15]) {
      expect(vmAdvancedSetStartDelayContract.argsSchema.parse([
        'pool-1', 'OpaqueRef:vm', delay,
      ])).toEqual(['pool-1', 'OpaqueRef:vm', delay])
    }
    for (const invalidDelay of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '15']) {
      expect(() => vmAdvancedSetStartDelayContract.argsSchema.parse([
        'pool-1', 'OpaqueRef:vm', invalidDelay,
      ])).toThrow()
    }
  })

  it('accepts only unique boot-device subsets in direct and HVM map inputs', () => {
    for (const order of ['', 'c', 'dn', 'cdn', 'ndc']) {
      expect(vmAdvancedSetBootOrderContract.argsSchema.parse([
        'pool-1', 'OpaqueRef:vm', order,
      ])).toEqual(['pool-1', 'OpaqueRef:vm', order])
    }
    for (const order of ['cc', 'cdnc', 'x', 'CDN', 'c,d,n']) {
      expect(() => vmAdvancedSetBootOrderContract.argsSchema.parse([
        'pool-1', 'OpaqueRef:vm', order,
      ])).toThrow()
    }

    expect(vmAdvancedSetHvmBootParamsContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:vm', { order: 'dnc', firmware: '' },
    ])).toEqual(['pool-1', 'OpaqueRef:vm', { order: 'dnc', firmware: '' }])
    expect(vmAdvancedSetHvmBootParamsContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:vm', { custom: 'value' },
    ])).toEqual(['pool-1', 'OpaqueRef:vm', { custom: 'value' }])
    expectRejected(vmAdvancedSetHvmBootParamsContract.argsSchema, [
      ['pool-1', 'OpaqueRef:vm', { order: 'cc' }],
      ['pool-1', 'OpaqueRef:vm', { key: 1 }],
      ['pool-1', 'OpaqueRef:vm', []],
      ['pool-1', 'OpaqueRef:vm', {}, 'extra'],
    ])
  })

  it('declares strict platform, configuration, tag, and start-order mutations', () => {
    const expected = [
      [vmAdvancedSetPlatformParamContract, Ch.VM_ADV_SET_PLATFORM_PARAM, ['credentials']],
      [vmAdvancedSetViridianContract, Ch.VM_ADV_SET_VIRIDIAN, ['none']],
      [vmAdvancedSetOtherConfigContract, Ch.VM_ADV_SET_OTHER_CONFIG, ['credentials']],
      [vmAdvancedAddTagContract, Ch.VM_ADV_ADD_TAG, ['none']],
      [vmAdvancedRemoveTagContract, Ch.VM_ADV_REMOVE_TAG, ['none']],
      [vmAdvancedSetStartOrderContract, Ch.VM_ADV_SET_START_ORDER, ['none']],
    ] as const

    expect(vmAdvancedContracts.slice(14, 20)).toEqual(expected.map(([contract]) => contract))
    for (const [contract, channel, redaction] of expected) {
      expect(contract).toMatchObject({
        channel,
        direction: 'invoke',
        errorShape: 'ipc-error-response-v1',
        callerPolicy: 'app-window-main-frame',
        redaction,
      })
      expect(contract.resultSchema.parse(undefined)).toBeUndefined()
    }
  })

  it('allows empty map values but requires nonblank keys, boolean Viridian, and nonblank tags', () => {
    for (const contract of [
      vmAdvancedSetPlatformParamContract,
      vmAdvancedSetOtherConfigContract,
    ]) {
      expect(contract.argsSchema.parse([
        'pool-1', 'OpaqueRef:vm', 'custom-key', '',
      ])).toEqual(['pool-1', 'OpaqueRef:vm', 'custom-key', ''])
      expectRejected(contract.argsSchema, [
        ['pool-1', 'OpaqueRef:vm', '', 'value'],
        ['pool-1', 'OpaqueRef:vm', '   ', 'value'],
        ['pool-1', 'OpaqueRef:vm', 'key', 1],
        ['pool-1', 'OpaqueRef:vm', 'key', 'value', 'extra'],
      ])
    }

    expect(vmAdvancedSetViridianContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:vm', false,
    ])).toEqual(['pool-1', 'OpaqueRef:vm', false])
    expectRejected(vmAdvancedSetViridianContract.argsSchema, [
      ['pool-1', 'OpaqueRef:vm', 'false'],
      ['pool-1', 'OpaqueRef:vm', false, 'extra'],
    ])

    for (const contract of [vmAdvancedAddTagContract, vmAdvancedRemoveTagContract]) {
      expect(contract.argsSchema.parse(['pool-1', 'OpaqueRef:vm', 'production']))
        .toEqual(['pool-1', 'OpaqueRef:vm', 'production'])
      expectRejected(contract.argsSchema, [
        ['pool-1', 'OpaqueRef:vm', ''],
        ['pool-1', 'OpaqueRef:vm', '   '],
        ['pool-1', 'OpaqueRef:vm', 'production', 'extra'],
      ])
    }
  })

  it('validates exact start-order entries and preserves the currently unused order value', () => {
    const configs = [
      { vmRef: 'OpaqueRef:vm-1', startDelay: 0, order: 2 },
      { vmRef: 'OpaqueRef:vm-2', startDelay: 10, order: 0 },
    ]
    expect(vmAdvancedSetStartOrderContract.argsSchema.parse(['pool-1', configs]))
      .toEqual(['pool-1', configs])
    expect(vmAdvancedSetStartOrderContract.argsSchema.parse(['pool-1', []]))
      .toEqual(['pool-1', []])

    expectRejected(vmAdvancedSetStartOrderContract.argsSchema, [
      ['pool-1'],
      ['pool-1', {}, 'extra'],
      ['pool-1', [{ vmRef: 'OpaqueRef:vm', startDelay: 0 }]],
      ['pool-1', [{ vmRef: 'OpaqueRef:vm', startDelay: 0, order: 0, extra: true }]],
      ['pool-1', [{ vmRef: 'OpaqueRef:NULL', startDelay: 0, order: 0 }]],
      ['pool-1', [{ vmRef: 'OpaqueRef:vm', startDelay: -1, order: 0 }]],
      ['pool-1', [{ vmRef: 'OpaqueRef:vm', startDelay: 1.5, order: 0 }]],
      ['pool-1', [{ vmRef: 'OpaqueRef:vm', startDelay: 0, order: -1 }]],
      ['pool-1', [{ vmRef: 'OpaqueRef:vm', startDelay: 0, order: 1.5 }]],
    ])
  })
})
