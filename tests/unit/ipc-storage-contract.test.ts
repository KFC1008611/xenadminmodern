import { describe, expect, it } from 'vitest'
import {
  isoDeleteContract,
  isoListAllContract,
  isoListContract,
  pbdCreateContract,
  pbdDestroyContract,
  pbdListContract,
  pbdPlugContract,
  pbdUnplugContract,
  srCreateContract,
  srDestroyContract,
  srDetachContract,
  srForgetContract,
  srGetThinStatsContract,
  srIntroduceContract,
  srListContract,
  srProbeIscsiContract,
  srProbeNfsContract,
  srScanContract,
  srUpdateIdentityContract,
  srSetDefaultContract,
  srSetSharedContract,
  storageContracts,
  vdiAddTagContract,
  vdiAttachExistingContract,
  vdiCloneContract,
  vdiCopyContract,
  vdiCreateContract,
  vdiCreateForVmContract,
  vdiDestroyContract,
  vdiGetAllowedOperationsContract,
  vdiListAttachableContract,
  vdiListContract,
  vdiMoveContract,
  vdiRemoveTagContract,
  vdiResizeContract,
  vdiSetNameDescriptionContract,
  vdiSetNameLabelContract,
  vdiSnapshotContract,
} from '../../src/shared/ipc-contracts/storage'

const connectedSr = {
  ref: 'OpaqueRef:sr',
  uuid: 'sr-uuid',
  name_label: 'Shared storage',
  name_description: '',
  type: 'nfs',
  physical_size: 1_000,
  physical_utilisation: 200,
  virtual_allocation: 400,
  VDIs: ['OpaqueRef:vdi'],
  PBDs: ['OpaqueRef:pbd'],
  shared: true,
  connectionId: 'pool-1',
  poolName: 'Lab Pool',
  xapi_extension: { generation: 7 },
}

const connectedVdi = {
  ref: 'OpaqueRef:vdi',
  uuid: 'vdi-uuid',
  name_label: 'Workload disk',
  virtual_size: 100,
  physical_utilisation: 80,
  type: 'user',
  SR: 'OpaqueRef:sr',
  VBDs: ['OpaqueRef:vbd'],
  read_only: false,
  connectionId: 'pool-1',
  poolName: 'Lab Pool',
  xapi_extension: true,
}

function expectRejected(schema: { parse(value: unknown): unknown }, values: readonly unknown[]): void {
  for (const value of values) expect(() => schema.parse(value)).toThrow()
}

describe('storage IPC contracts', () => {
  it('keeps the complete 37-channel storage inventory in stable order', () => {
    expect(storageContracts.map(({ channel }) => channel)).toEqual([
      'sr:list',
      'sr:create',
      'sr:destroy',
      'sr:scan',
      'sr:detach',
      'sr:setDefault',
      'sr:probeNfs',
      'sr:probeIscsi',
      'sr:introduce',
      'sr:forget',
      'sr:setShared',
      'sr:getThinStats',
      'vdi:list',
      'vdi:create',
      'vdi:destroy',
      'vdi:resize',
      'vdi:createForVm',
      'vdi:getAllowedOperations',
      'vdi:listAttachable',
      'vdi:attachExisting',
      'vdi:move',
      'vdi:clone',
      'vdi:snapshot',
      'vdi:copy',
      'vdi:setNameLabel',
      'vdi:setNameDescription',
      'vdi:addTag',
      'vdi:removeTag',
      'pbd:list',
      'pbd:create',
      'pbd:plug',
      'pbd:unplug',
      'pbd:destroy',
      'iso:list',
      'iso:listAll',
      'iso:delete',
      'sr:updateIdentity',
    ])
  })

  it('declares the exact twelve SR invoke descriptors and redacts SR creation secrets', () => {
    const expected = [
      ['sr:list', srListContract, ['none']],
      ['sr:create', srCreateContract, ['storage-secret']],
      ['sr:destroy', srDestroyContract, ['none']],
      ['sr:scan', srScanContract, ['none']],
      ['sr:detach', srDetachContract, ['none']],
      ['sr:setDefault', srSetDefaultContract, ['none']],
      ['sr:probeNfs', srProbeNfsContract, ['none']],
      ['sr:probeIscsi', srProbeIscsiContract, ['storage-secret']],
      ['sr:introduce', srIntroduceContract, ['none']],
      ['sr:forget', srForgetContract, ['none']],
      ['sr:setShared', srSetSharedContract, ['none']],
      ['sr:getThinStats', srGetThinStatsContract, ['none']],
    ] as const

    expect(storageContracts.slice(0, 12)).toEqual(expected.map(([, contract]) => contract))
    for (const [channel, contract, redaction] of expected) {
      expect(contract).toMatchObject({
        channel,
        direction: 'invoke',
        errorShape: 'ipc-error-response-v1',
        callerPolicy: 'app-window-main-frame',
        redaction,
      })
    }
  })

  it('parses exact SR tuples with live references and no extra arguments', () => {
    expect(srListContract.argsSchema.parse(['pool-1'])).toEqual(['pool-1'])
    for (const contract of [
      srDestroyContract,
      srScanContract,
      srDetachContract,
      srForgetContract,
      srGetThinStatsContract,
    ]) {
      expect(contract.argsSchema.parse(['pool-1', 'OpaqueRef:sr']))
        .toEqual(['pool-1', 'OpaqueRef:sr'])
      expectRejected(contract.argsSchema, [
        ['pool-1'],
        ['pool-1', 'OpaqueRef:NULL'],
        ['pool-1', 'OpaqueRef:sr', 'extra'],
      ])
    }
    expect(srSetDefaultContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:pool', 'OpaqueRef:sr',
    ])).toEqual(['pool-1', 'OpaqueRef:pool', 'OpaqueRef:sr'])
    expect(srSetSharedContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:sr', false,
    ])).toEqual(['pool-1', 'OpaqueRef:sr', false])
    expectRejected(srSetSharedContract.argsSchema, [
      ['pool-1', 'OpaqueRef:sr', 'false'],
      ['pool-1', 'OpaqueRef:sr', false, 'extra'],
    ])
  })

  it('enforces the exact ext, hba, nfs, and iSCSI SR creation branches', () => {
    const common = { nameLabel: 'Storage', nameDescription: '' }
    const values = [
      { type: 'ext', ...common },
      { type: 'hba', ...common },
      { type: 'nfs', ...common, nfsServer: '192.0.2.10', nfsPath: '/exports/vm' },
      {
        type: 'iscsi',
        ...common,
        iscsiTarget: '192.0.2.20',
        iscsiIqn: '',
        iscsiLun: '',
      },
      {
        type: 'iscsi',
        ...common,
        iscsiTarget: '192.0.2.20',
        chapUser: 'storage-user',
        chapPassword: 'storage-password',
      },
    ]
    for (const params of values) {
      expect(srCreateContract.argsSchema.parse([
        'pool-1', 'OpaqueRef:host', params,
      ])).toEqual(['pool-1', 'OpaqueRef:host', params])
    }

    const invalidParams = [
      { type: 'ext', ...common, nfsServer: '192.0.2.10' },
      { type: 'hba', ...common, iscsiTarget: '192.0.2.20' },
      { type: 'nfs', ...common, nfsServer: '192.0.2.10' },
      { type: 'nfs', ...common, nfsServer: '', nfsPath: '/exports/vm' },
      { type: 'iscsi', ...common },
      { type: 'iscsi', ...common, iscsiTarget: '192.0.2.20', chapUser: 'user' },
      { type: 'iscsi', ...common, iscsiTarget: '192.0.2.20', chapPassword: 'secret' },
      { type: 'unknown', ...common },
      { type: 'ext', nameLabel: '', nameDescription: '' },
      { type: 'ext', ...common, unknown: true },
    ]
    for (const params of invalidParams) {
      expect(() => srCreateContract.argsSchema.parse([
        'pool-1', 'OpaqueRef:host', params,
      ])).toThrow()
    }
    expect(() => srCreateContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:host', values[0], 'extra',
    ])).toThrow()
  })

  it('validates SR probe and introduce payloads before delegation', () => {
    expect(srProbeNfsContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:host', '192.0.2.10',
    ])).toEqual(['pool-1', 'OpaqueRef:host', '192.0.2.10'])
    expect(srProbeIscsiContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:host', '192.0.2.20',
    ])).toEqual(['pool-1', 'OpaqueRef:host', '192.0.2.20'])
    for (const contract of [srProbeNfsContract, srProbeIscsiContract]) {
      expectRejected(contract.argsSchema, [
        ['pool-1', 'OpaqueRef:host', ''],
        ['pool-1', 'OpaqueRef:NULL', '192.0.2.10'],
        ['pool-1', 'OpaqueRef:host', '192.0.2.10', 'extra'],
      ])
    }

    const params = {
      uuid: 'sr-uuid',
      nameLabel: 'Imported SR',
      nameDescription: '',
      type: 'nfs',
      contentType: '',
      shared: true,
    }
    expect(srIntroduceContract.argsSchema.parse(['pool-1', params]))
      .toEqual(['pool-1', params])
    expectRejected(srIntroduceContract.argsSchema, [
      ['pool-1', { ...params, uuid: '' }],
      ['pool-1', { ...params, shared: 'true' }],
      ['pool-1', { ...params, unknown: true }],
      ['pool-1', params, 'extra'],
    ])
  })

  it('validates normalized SR records, probes, references, thin stats, and void results', () => {
    expect(srListContract.resultSchema.parse([connectedSr])).toEqual([connectedSr])
    expectRejected(srListContract.resultSchema, [
      connectedSr,
      [{ ...connectedSr, physical_size: -2 }],
      [{ ...connectedSr, shared: 'true' }],
    ])

    expect(srProbeNfsContract.resultSchema.parse([
      { server: '192.0.2.10', path: '/exports/vm' },
    ])).toEqual([{ server: '192.0.2.10', path: '/exports/vm' }])
    expect(srProbeIscsiContract.resultSchema.parse([
      { iqn: 'iqn.2026-08.test:storage', address: '192.0.2.20', port: 3260 },
    ])).toHaveLength(1)
    expectRejected(srProbeIscsiContract.resultSchema, [
      [{ iqn: '', address: '192.0.2.20', port: 3260 }],
      [{ iqn: 'iqn.test', address: '192.0.2.20', port: 0 }],
      [{ iqn: 'iqn.test', address: '192.0.2.20', port: 65_536 }],
    ])

    const thinStats = {
      physicalSize: 1_000,
      physicalUtilisation: 200,
      virtualAllocation: 1_500,
      overprovisionRatio: 1.5,
    }
    expect(srGetThinStatsContract.resultSchema.parse(thinStats)).toEqual(thinStats)
    expect(() => srGetThinStatsContract.resultSchema.parse({ ...thinStats, extra: true }))
      .toThrow()

    for (const contract of [srCreateContract, srIntroduceContract]) {
      expect(contract.resultSchema.parse('OpaqueRef:new-sr')).toBe('OpaqueRef:new-sr')
      expectRejected(contract.resultSchema, ['', 'OpaqueRef:NULL', undefined])
    }
    for (const contract of [
      srDestroyContract,
      srScanContract,
      srDetachContract,
      srSetDefaultContract,
      srForgetContract,
      srSetSharedContract,
    ]) {
      expect(contract.resultSchema.parse(undefined)).toBeUndefined()
      expectRejected(contract.resultSchema, [null, false, {}])
    }
  })

  it('declares the exact sixteen VDI invoke descriptors', () => {
    const expected = [
      ['vdi:list', vdiListContract],
      ['vdi:create', vdiCreateContract],
      ['vdi:destroy', vdiDestroyContract],
      ['vdi:resize', vdiResizeContract],
      ['vdi:createForVm', vdiCreateForVmContract],
      ['vdi:getAllowedOperations', vdiGetAllowedOperationsContract],
      ['vdi:listAttachable', vdiListAttachableContract],
      ['vdi:attachExisting', vdiAttachExistingContract],
      ['vdi:move', vdiMoveContract],
      ['vdi:clone', vdiCloneContract],
      ['vdi:snapshot', vdiSnapshotContract],
      ['vdi:copy', vdiCopyContract],
      ['vdi:setNameLabel', vdiSetNameLabelContract],
      ['vdi:setNameDescription', vdiSetNameDescriptionContract],
      ['vdi:addTag', vdiAddTagContract],
      ['vdi:removeTag', vdiRemoveTagContract],
    ] as const

    expect(storageContracts.slice(12, 28)).toEqual(expected.map(([, contract]) => contract))
    for (const [channel, contract] of expected) {
      expect(contract).toMatchObject({
        channel,
        direction: 'invoke',
        errorShape: 'ipc-error-response-v1',
        callerPolicy: 'app-window-main-frame',
        redaction: ['none'],
      })
    }
  })

  it('accepts only live VDI references and positive safe-integer capacities', () => {
    expect(vdiListContract.argsSchema.parse(['pool-1', 'OpaqueRef:sr']))
      .toEqual(['pool-1', 'OpaqueRef:sr'])
    expect(vdiCreateContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:sr', 'Workload disk', 1_073_741_824,
    ])).toEqual(['pool-1', 'OpaqueRef:sr', 'Workload disk', 1_073_741_824])
    for (const size of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, '1024']) {
      expect(() => vdiCreateContract.argsSchema.parse([
        'pool-1', 'OpaqueRef:sr', 'Workload disk', size,
      ])).toThrow()
    }
    expectRejected(vdiCreateContract.argsSchema, [
      ['pool-1', 'OpaqueRef:NULL', 'Workload disk', 1],
      ['pool-1', 'OpaqueRef:sr', '', 1],
      ['pool-1', 'OpaqueRef:sr', 'Workload disk', 1, 'extra'],
    ])

    expect(vdiResizeContract.argsSchema.parse([
      'pool-1', { vdiRef: 'OpaqueRef:vdi', newSize: 2_147_483_648 },
    ])).toEqual(['pool-1', { vdiRef: 'OpaqueRef:vdi', newSize: 2_147_483_648 }])
    expectRejected(vdiResizeContract.argsSchema, [
      ['pool-1', { vdiRef: 'OpaqueRef:vdi', newSize: 0 }],
      ['pool-1', { vdiRef: 'OpaqueRef:NULL', newSize: 1 }],
      ['pool-1', { vdiRef: 'OpaqueRef:vdi', newSize: 1, extra: true }],
    ])
  })

  it('validates exact VDI creation, attach, and move payloads', () => {
    const createParams = {
      nameLabel: 'Workload disk',
      nameDescription: '',
      srRef: 'OpaqueRef:sr',
      size: 1_073_741_824,
      type: 'user' as const,
      sharable: false,
      readOnly: false,
    }
    expect(vdiCreateForVmContract.argsSchema.parse([
      'pool-1', createParams, 'OpaqueRef:vm',
    ])).toEqual(['pool-1', createParams, 'OpaqueRef:vm'])
    expectRejected(vdiCreateForVmContract.argsSchema, [
      ['pool-1', { ...createParams, type: 'invalid' }, 'OpaqueRef:vm'],
      ['pool-1', { ...createParams, size: 0 }, 'OpaqueRef:vm'],
      ['pool-1', { ...createParams, extra: true }, 'OpaqueRef:vm'],
      ['pool-1', createParams, 'OpaqueRef:NULL'],
    ])

    const attach = {
      vmRef: 'OpaqueRef:vm',
      vdiRef: 'OpaqueRef:vdi',
      readOnly: true,
      userdevice: '2',
    }
    expect(vdiAttachExistingContract.argsSchema.parse(['pool-1', attach]))
      .toEqual(['pool-1', attach])
    expectRejected(vdiAttachExistingContract.argsSchema, [
      ['pool-1', { ...attach, vmRef: 'OpaqueRef:NULL' }],
      ['pool-1', { ...attach, readOnly: 'true' }],
      ['pool-1', { ...attach, userdevice: '' }],
      ['pool-1', { ...attach, extra: true }],
    ])

    const move = { vdiRef: 'OpaqueRef:vdi', targetSrRef: 'OpaqueRef:target-sr', preferLive: false }
    expect(vdiMoveContract.argsSchema.parse(['pool-1', move])).toEqual(['pool-1', move])
    expectRejected(vdiMoveContract.argsSchema, [
      ['pool-1', { ...move, targetSrRef: 'OpaqueRef:NULL' }],
      ['pool-1', { ...move, preferLive: 'false' }],
      ['pool-1', { ...move, extra: true }],
    ])
  })

  it('validates VDI clone, snapshot, copy, metadata, and exact tuple arity', () => {
    const clone = { vdiRef: 'OpaqueRef:vdi', targetSrRef: 'OpaqueRef:sr', nameLabel: '' }
    const copy = { vdiRef: 'OpaqueRef:vdi', targetSrRef: 'OpaqueRef:sr', nameLabel: 'Copy' }
    expect(vdiCloneContract.argsSchema.parse(['pool-1', clone])).toEqual(['pool-1', clone])
    expect(vdiCopyContract.argsSchema.parse(['pool-1', copy])).toEqual(['pool-1', copy])
    expect(vdiSnapshotContract.argsSchema.parse(['pool-1', 'OpaqueRef:vdi']))
      .toEqual(['pool-1', 'OpaqueRef:vdi'])
    expect(vdiSnapshotContract.argsSchema.parse(['pool-1', 'OpaqueRef:vdi', '']))
      .toEqual(['pool-1', 'OpaqueRef:vdi', ''])
    expect(vdiSnapshotContract.argsSchema.parse(['pool-1', 'OpaqueRef:vdi', undefined]))
      .toEqual(['pool-1', 'OpaqueRef:vdi', undefined])
    expectRejected(vdiCloneContract.argsSchema, [
      ['pool-1', { vdiRef: 'OpaqueRef:NULL' }],
      ['pool-1', { ...clone, extra: true }],
    ])
    expectRejected(vdiCopyContract.argsSchema, [
      ['pool-1', { vdiRef: 'OpaqueRef:vdi' }],
      ['pool-1', { ...copy, targetSrRef: 'OpaqueRef:NULL' }],
    ])
    expectRejected(vdiSnapshotContract.argsSchema, [
      ['pool-1', 'OpaqueRef:NULL'],
      ['pool-1', 'OpaqueRef:vdi', 1],
      ['pool-1', 'OpaqueRef:vdi', 'name', 'extra'],
    ])

    expect(vdiSetNameLabelContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:vdi', 'New name',
    ])).toEqual(['pool-1', 'OpaqueRef:vdi', 'New name'])
    expect(vdiSetNameDescriptionContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:vdi', '',
    ])).toEqual(['pool-1', 'OpaqueRef:vdi', ''])
    for (const contract of [vdiAddTagContract, vdiRemoveTagContract]) {
      expect(contract.argsSchema.parse(['pool-1', 'OpaqueRef:vdi', 'production']))
        .toEqual(['pool-1', 'OpaqueRef:vdi', 'production'])
      expectRejected(contract.argsSchema, [
        ['pool-1', 'OpaqueRef:vdi', ''],
        ['pool-1', 'OpaqueRef:vdi', 'production', 'extra'],
      ])
    }
  })

  it('validates VDI results, including mutually exclusive move outcomes', () => {
    expect(vdiListContract.resultSchema.parse([connectedVdi])).toEqual([connectedVdi])
    expectRejected(vdiListContract.resultSchema, [
      connectedVdi,
      [{ ...connectedVdi, virtual_size: -1 }],
      [{ ...connectedVdi, read_only: 'false' }],
    ])

    const attachable = {
      ...connectedVdi,
      srName: 'Shared storage',
      forceReadOnly: false,
      attachedVmRefs: ['OpaqueRef:other-vm'],
    }
    expect(vdiListAttachableContract.resultSchema.parse([attachable])).toEqual([attachable])
    expect(vdiGetAllowedOperationsContract.resultSchema.parse({
      resize: true, create: true, destroy: false, onlineResize: false,
    })).toMatchObject({ resize: true })
    expect(vdiCreateForVmContract.resultSchema.parse({
      vdiRef: 'OpaqueRef:new-vdi', vbdRef: 'OpaqueRef:new-vbd', plugged: false,
    })).toEqual({ vdiRef: 'OpaqueRef:new-vdi', vbdRef: 'OpaqueRef:new-vbd', plugged: false })
    expect(vdiAttachExistingContract.resultSchema.parse({
      vbdRef: 'OpaqueRef:vbd', plugged: false, warning: 'Hot-plug failed',
    })).toMatchObject({ plugged: false })

    expect(vdiMoveContract.resultSchema.parse({ newVdiRef: 'OpaqueRef:new-vdi' }))
      .toEqual({ newVdiRef: 'OpaqueRef:new-vdi' })
    expectRejected(vdiMoveContract.resultSchema, [
      { taskRef: 'OpaqueRef:task' },
      {},
      { taskRef: 'OpaqueRef:task', newVdiRef: 'OpaqueRef:vdi' },
      { taskRef: 'OpaqueRef:NULL' },
      { newVdiRef: 'OpaqueRef:vdi', extra: true },
    ])

    for (const contract of [
      vdiCreateContract,
      vdiResizeContract,
      vdiCloneContract,
      vdiSnapshotContract,
      vdiCopyContract,
    ]) {
      expect(contract.resultSchema.parse('OpaqueRef:result')).toBe('OpaqueRef:result')
    }
    for (const contract of [
      vdiSetNameLabelContract,
      vdiSetNameDescriptionContract,
      vdiAddTagContract,
      vdiRemoveTagContract,
    ]) {
      expect(contract.resultSchema.parse(undefined)).toBeUndefined()
    }
    expect(vdiDestroyContract.resultSchema.parse({ vdiDeleted: false, detachedVbdRef: 'OpaqueRef:vbd', warning: 'still present' }))
      .toEqual({ vdiDeleted: false, detachedVbdRef: 'OpaqueRef:vbd', warning: 'still present' })
  })

  it('declares the exact five PBD invoke descriptors and redacts device configuration', () => {
    const expected = [
      ['pbd:list', pbdListContract, ['none']],
      ['pbd:create', pbdCreateContract, ['storage-secret']],
      ['pbd:plug', pbdPlugContract, ['none']],
      ['pbd:unplug', pbdUnplugContract, ['none']],
      ['pbd:destroy', pbdDestroyContract, ['none']],
    ] as const

    expect(storageContracts.slice(28, 33)).toEqual(expected.map(([, contract]) => contract))
    for (const [channel, contract, redaction] of expected) {
      expect(contract).toMatchObject({
        channel,
        direction: 'invoke',
        errorShape: 'ipc-error-response-v1',
        callerPolicy: 'app-window-main-frame',
        redaction,
      })
    }
  })

  it('validates exact PBD tuples, optional string device configuration, and void results', () => {
    expect(pbdListContract.argsSchema.parse(['pool-1'])).toEqual(['pool-1'])
    expect(pbdCreateContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:host', 'OpaqueRef:sr', { target: '192.0.2.20', password: '' },
    ])).toEqual([
      'pool-1', 'OpaqueRef:host', 'OpaqueRef:sr', { target: '192.0.2.20', password: '' },
    ])
    expect(pbdCreateContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:host', 'OpaqueRef:sr',
    ])).toEqual(['pool-1', 'OpaqueRef:host', 'OpaqueRef:sr'])
    expect(pbdCreateContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:host', 'OpaqueRef:sr', undefined,
    ])).toEqual(['pool-1', 'OpaqueRef:host', 'OpaqueRef:sr', undefined])
    expectRejected(pbdCreateContract.argsSchema, [
      ['pool-1', 'OpaqueRef:NULL', 'OpaqueRef:sr'],
      ['pool-1', 'OpaqueRef:host', 'OpaqueRef:NULL'],
      ['pool-1', 'OpaqueRef:host', 'OpaqueRef:sr', { port: 3260 }],
      ['pool-1', 'OpaqueRef:host', 'OpaqueRef:sr', {}, 'extra'],
    ])

    for (const contract of [pbdPlugContract, pbdUnplugContract, pbdDestroyContract]) {
      expect(contract.argsSchema.parse(['pool-1', 'OpaqueRef:pbd']))
        .toEqual(['pool-1', 'OpaqueRef:pbd'])
      expectRejected(contract.argsSchema, [
        ['pool-1', 'OpaqueRef:NULL'],
        ['pool-1', 'OpaqueRef:pbd', 'extra'],
      ])
      expect(contract.resultSchema.parse(undefined)).toBeUndefined()
    }
  })

  it('validates connected PBD records while preserving XAPI extension fields', () => {
    const connectedPbd = {
      ref: 'OpaqueRef:pbd',
      uuid: 'pbd-uuid',
      host: 'OpaqueRef:host',
      SR: 'OpaqueRef:sr',
      device_config: { target: '192.0.2.20', password: '' },
      currently_attached: true,
      connectionId: 'pool-1',
      poolName: 'Lab Pool',
      xapi_extension: 7,
    }
    expect(pbdListContract.resultSchema.parse([connectedPbd])).toEqual([connectedPbd])
    expectRejected(pbdListContract.resultSchema, [
      connectedPbd,
      [{ ...connectedPbd, host: 'OpaqueRef:NULL' }],
      [{ ...connectedPbd, device_config: { port: 3260 } }],
      [{ ...connectedPbd, currently_attached: 'true' }],
    ])
    expect(pbdCreateContract.resultSchema.parse('OpaqueRef:new-pbd'))
      .toBe('OpaqueRef:new-pbd')
  })

  it('declares the exact three ISO invoke descriptors', () => {
    const expected = [
      ['iso:list', isoListContract],
      ['iso:listAll', isoListAllContract],
      ['iso:delete', isoDeleteContract],
    ] as const

    expect(storageContracts.slice(33, 36)).toEqual(expected.map(([, contract]) => contract))
    for (const [channel, contract] of expected) {
      expect(contract).toMatchObject({
        channel,
        direction: 'invoke',
        errorShape: 'ipc-error-response-v1',
        callerPolicy: 'app-window-main-frame',
        redaction: ['none'],
      })
    }
  })

  it('validates ISO references, raw SR-scoped records, and exact normalized records', () => {
    expect(isoListContract.argsSchema.parse(['pool-1', 'OpaqueRef:iso-sr']))
      .toEqual(['pool-1', 'OpaqueRef:iso-sr'])
    expect(isoListAllContract.argsSchema.parse(['pool-1'])).toEqual(['pool-1'])
    expect(isoDeleteContract.argsSchema.parse(['pool-1', 'OpaqueRef:iso']))
      .toEqual(['pool-1', 'OpaqueRef:iso'])
    expectRejected(isoListContract.argsSchema, [
      ['pool-1', 'OpaqueRef:NULL'],
      ['pool-1', 'OpaqueRef:iso-sr', 'extra'],
    ])
    expectRejected(isoListAllContract.argsSchema, [[], ['pool-1', 'extra']])
    expectRejected(isoDeleteContract.argsSchema, [['pool-1', 'OpaqueRef:NULL']])

    expect(isoListContract.resultSchema.parse([connectedVdi])).toEqual([connectedVdi])
    const iso = {
      ref: 'OpaqueRef:iso',
      uuid: 'iso-uuid',
      name_label: 'XCP-ng installer',
      name_description: '',
      virtual_size: 1_073_741_824,
      physical_utilisation: 1_073_741_824,
      type: 'iso',
      SR: 'OpaqueRef:iso-sr',
      srName: 'ISO library',
      read_only: true,
      connectionId: 'pool-1',
      poolName: 'Lab Pool',
    }
    expect(isoListAllContract.resultSchema.parse([iso])).toEqual([iso])
    expectRejected(isoListAllContract.resultSchema, [
      iso,
      [{ ...iso, virtual_size: -1 }],
      [{ ...iso, SR: 'OpaqueRef:NULL' }],
      [{ ...iso, read_only: 'true' }],
      [{ ...iso, extension: true }],
    ])
    expect(isoDeleteContract.resultSchema.parse(undefined)).toBeUndefined()
    expect(() => isoDeleteContract.resultSchema.parse(null)).toThrow()
  })
})

describe('iSCSI portal port contract', () => {
  it('retains a non-default port for probe and creation', () => {
    expect(srProbeIscsiContract.argsSchema.parse(['pool-1', 'OpaqueRef:host', '10.0.0.2', { iqn: 'iqn.test', port: 3261 }])[3])
      .toEqual({ iqn: 'iqn.test', port: 3261 })
    expect(srCreateContract.argsSchema.parse(['pool-1', 'OpaqueRef:host', {
      type: 'iscsi', nameLabel: 'Storage', nameDescription: '', iscsiTarget: '10.0.0.2', iscsiPort: 3261,
      iscsiIqn: 'iqn.test', iscsiLun: '3600abc',
    }])[2]).toMatchObject({ iscsiPort: 3261 })
  })

  it('rejects invalid portal ports before an IPC mutation', () => {
    for (const port of [0, 65536, 1.5, '3260']) {
      expect(() => srProbeIscsiContract.argsSchema.parse(['pool-1', 'OpaqueRef:host', '10.0.0.2', { port }])).toThrow()
      expect(() => srCreateContract.argsSchema.parse(['pool-1', 'OpaqueRef:host', {
        type: 'iscsi', nameLabel: 'Storage', nameDescription: '', iscsiTarget: '10.0.0.2', iscsiPort: port,
      }])).toThrow()
    }
  })
})


describe('SR identity IPC boundary', () => {
  const payload = { nameLabel: 'Storage', nameDescription: '', expectedNameLabel: 'Old', expectedNameDescription: 'Old description' }
  it('accepts the exact metadata fields and rejects invalid refs, blanks, and topology fields', () => {
    expect(srUpdateIdentityContract.argsSchema.parse(['pool', 'OpaqueRef:sr', payload])).toEqual(['pool', 'OpaqueRef:sr', payload])
    for (const values of [
      ['pool', 'OpaqueRef:NULL', payload], ['pool', 'OpaqueRef:sr', { ...payload, nameLabel: ' ' }],
      ['pool', 'OpaqueRef:sr', { ...payload, shared: true }], ['pool', 'OpaqueRef:sr', { ...payload, expectedNameLabel: undefined }],
    ]) expect(() => srUpdateIdentityContract.argsSchema.parse(values)).toThrow()
  })
  it('validates the authoritative readback result', () => {
    expect(srUpdateIdentityContract.resultSchema.parse({ nameLabel: 'Storage', nameDescription: '' })).toEqual({ nameLabel: 'Storage', nameDescription: '' })
    expect(() => srUpdateIdentityContract.resultSchema.parse({ nameLabel: 'Storage' })).toThrow()
  })
})
