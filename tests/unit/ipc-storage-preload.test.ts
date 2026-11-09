import { describe, expect, it, vi } from 'vitest'
import { createStorageApi } from '../../src/preload/storage-api'

const connectedSr = {
  ref: 'OpaqueRef:sr',
  uuid: 'sr-uuid',
  name_label: 'Shared storage',
  type: 'nfs',
  physical_size: 1_000,
  physical_utilisation: 200,
  virtual_allocation: 400,
  VDIs: [],
  shared: true,
  connectionId: 'pool-1',
  poolName: 'Lab Pool',
}

describe('storage preload IPC contracts', () => {
  it('exposes the complete storage API in the established groups', () => {
    const api = createStorageApi({ invoke: vi.fn() })

    expect(Object.keys(api.storage)).toEqual([
      'listSrs',
      'listVdis',
      'createVdi',
      'destroyVdi',
      'resizeVdi',
      'createForVm',
      'getAllowedOperations',
      'listAttachableVdis',
      'attachExistingVdi',
      'moveVdi',
      'cloneVdi',
      'snapshotVdi',
      'copyVdi',
      'setVdiNameLabel',
      'setVdiNameDescription',
      'addVdiTag',
      'removeVdiTag',
    ])
    expect(Object.keys(api.sr)).toEqual([
      'create',
      'destroy',
      'scan',
      'detach',
      'setDefault',
      'probeNfs',
      'probeIscsi',
      'introduce',
      'forget',
      'setShared',
      'getThinStats',
      'updateIdentity',
    ])
    expect(Object.keys(api.pbd)).toEqual(['list', 'create', 'plug', 'unplug', 'destroy'])
    expect(Object.keys(api.iso)).toEqual(['list', 'listAll', 'delete'])
  })

  it('routes the twelve SR APIs through descriptor-backed invokers', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce([connectedSr])
      .mockResolvedValueOnce('OpaqueRef:new-sr')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ server: '192.0.2.10', path: '/exports/vm' }])
      .mockResolvedValueOnce([{ iqn: 'iqn.test', address: '192.0.2.20', port: 3260 }])
      .mockResolvedValueOnce('OpaqueRef:introduced-sr')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        physicalSize: 1_000,
        physicalUtilisation: 200,
        virtualAllocation: 1_500,
        overprovisionRatio: 1.5,
      })
    const api = createStorageApi({ invoke })
    const createParams = {
      type: 'nfs' as const,
      nameLabel: 'Shared storage',
      nameDescription: '',
      nfsServer: '192.0.2.10',
      nfsPath: '/exports/vm',
    }
    const introduceParams = {
      uuid: 'sr-uuid', nameLabel: 'Imported', nameDescription: '', type: 'nfs',
    }

    await expect(api.storage.listSrs('pool-1')).resolves.toEqual([connectedSr])
    await expect(api.sr.create('pool-1', 'OpaqueRef:host', createParams))
      .resolves.toBe('OpaqueRef:new-sr')
    await expect(api.sr.destroy('pool-1', 'OpaqueRef:sr')).resolves.toBeUndefined()
    await expect(api.sr.scan('pool-1', 'OpaqueRef:sr')).resolves.toBeUndefined()
    await expect(api.sr.detach('pool-1', 'OpaqueRef:sr')).resolves.toBeUndefined()
    await expect(api.sr.setDefault('pool-1', 'OpaqueRef:pool', 'OpaqueRef:sr'))
      .resolves.toBeUndefined()
    await expect(api.sr.probeNfs('pool-1', 'OpaqueRef:host', '192.0.2.10'))
      .resolves.toHaveLength(1)
    await expect(api.sr.probeIscsi('pool-1', 'OpaqueRef:host', '192.0.2.20'))
      .resolves.toHaveLength(1)
    await expect(api.sr.introduce('pool-1', introduceParams))
      .resolves.toBe('OpaqueRef:introduced-sr')
    await expect(api.sr.forget('pool-1', 'OpaqueRef:sr')).resolves.toBeUndefined()
    await expect(api.sr.setShared('pool-1', 'OpaqueRef:sr', true)).resolves.toBeUndefined()
    await expect(api.sr.getThinStats('pool-1', 'OpaqueRef:sr'))
      .resolves.toMatchObject({ overprovisionRatio: 1.5 })

    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      'sr:list', 'sr:create', 'sr:destroy', 'sr:scan', 'sr:detach', 'sr:setDefault',
      'sr:probeNfs', 'sr:probeIscsi', 'sr:introduce', 'sr:forget', 'sr:setShared',
      'sr:getThinStats',
    ])
  })

  it('rejects malformed SR values and results before crossing the opposite boundary', async () => {
    const invoke = vi.fn()
    const api = createStorageApi({ invoke })

    await expect(api.sr.create('pool-1', 'OpaqueRef:host', {
      type: 'nfs',
      nameLabel: 'Storage',
      nameDescription: '',
      nfsServer: '192.0.2.10',
    } as never)).rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    await expect(api.sr.setShared('pool-1', 'OpaqueRef:NULL', true))
      .rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    expect(invoke).not.toHaveBeenCalled()

    invoke.mockResolvedValueOnce([{ ...connectedSr, physical_size: -2 }])
    await expect(api.storage.listSrs('pool-1'))
      .rejects.toMatchObject({ code: 'IPC_RESULT_INVALID' })
  })

  it('routes all sixteen VDI APIs and validates payloads before transport', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    const api = createStorageApi({ invoke })
    const createParams = {
      nameLabel: 'Disk', nameDescription: '', srRef: 'OpaqueRef:sr', size: 1024,
    }

    invoke
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce('OpaqueRef:new-vdi')
      .mockResolvedValueOnce({ vdiDeleted: true })
      .mockResolvedValueOnce('OpaqueRef:task')
      .mockResolvedValueOnce({ vdiRef: 'OpaqueRef:new-vdi', vbdRef: 'OpaqueRef:new-vbd', plugged: true })
      .mockResolvedValueOnce({ resize: true, create: true, destroy: false, onlineResize: false })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ vbdRef: 'OpaqueRef:vbd', plugged: true })
      .mockResolvedValueOnce({ newVdiRef: 'OpaqueRef:moved-vdi' })
      .mockResolvedValueOnce('OpaqueRef:clone')
      .mockResolvedValueOnce('OpaqueRef:snapshot')
      .mockResolvedValueOnce('OpaqueRef:copy')

    await expect(api.storage.listVdis('pool-1', 'OpaqueRef:sr')).resolves.toEqual([])
    await expect(api.storage.createVdi('pool-1', 'OpaqueRef:sr', 'Disk', 1024))
      .resolves.toBe('OpaqueRef:new-vdi')
    await expect(api.storage.destroyVdi('pool-1', 'OpaqueRef:vdi')).resolves.toEqual({ vdiDeleted: true })
    await expect(api.storage.resizeVdi(
      'pool-1', { vdiRef: 'OpaqueRef:vdi', newSize: 2048 },
    )).resolves.toBe('OpaqueRef:task')
    await expect(api.storage.createForVm('pool-1', createParams, 'OpaqueRef:vm'))
      .resolves.toEqual({ vdiRef: 'OpaqueRef:new-vdi', vbdRef: 'OpaqueRef:new-vbd', plugged: true })
    await expect(api.storage.getAllowedOperations(
      'pool-1', 'OpaqueRef:vdi', 'OpaqueRef:vm',
    )).resolves.toMatchObject({ resize: true })
    await expect(api.storage.listAttachableVdis('pool-1', 'OpaqueRef:vm')).resolves.toEqual([])
    await expect(api.storage.attachExistingVdi('pool-1', {
      vmRef: 'OpaqueRef:vm', vdiRef: 'OpaqueRef:vdi',
    })).resolves.toMatchObject({ plugged: true })
    await expect(api.storage.moveVdi('pool-1', {
      vdiRef: 'OpaqueRef:vdi', targetSrRef: 'OpaqueRef:target-sr',
    })).resolves.toEqual({ newVdiRef: 'OpaqueRef:moved-vdi' })
    await expect(api.storage.cloneVdi('pool-1', { vdiRef: 'OpaqueRef:vdi' }))
      .resolves.toBe('OpaqueRef:clone')
    await expect(api.storage.snapshotVdi('pool-1', 'OpaqueRef:vdi'))
      .resolves.toBe('OpaqueRef:snapshot')
    await expect(api.storage.copyVdi('pool-1', {
      vdiRef: 'OpaqueRef:vdi', targetSrRef: 'OpaqueRef:target-sr',
    })).resolves.toBe('OpaqueRef:copy')
    await expect(api.storage.setVdiNameLabel(
      'pool-1', 'OpaqueRef:vdi', 'New name',
    )).resolves.toBeUndefined()
    await expect(api.storage.setVdiNameDescription(
      'pool-1', 'OpaqueRef:vdi', '',
    )).resolves.toBeUndefined()
    await expect(api.storage.addVdiTag(
      'pool-1', 'OpaqueRef:vdi', 'production',
    )).resolves.toBeUndefined()
    await expect(api.storage.removeVdiTag(
      'pool-1', 'OpaqueRef:vdi', 'legacy',
    )).resolves.toBeUndefined()

    expect(invoke.mock.calls.slice(0, 16).map(([channel]) => channel)).toEqual([
      'vdi:list', 'vdi:create', 'vdi:destroy', 'vdi:resize', 'vdi:createForVm',
      'vdi:getAllowedOperations', 'vdi:listAttachable', 'vdi:attachExisting', 'vdi:move',
      'vdi:clone', 'vdi:snapshot', 'vdi:copy', 'vdi:setNameLabel',
      'vdi:setNameDescription', 'vdi:addTag', 'vdi:removeTag',
    ])

    await expect(api.storage.createVdi('pool-1', 'OpaqueRef:sr', 'Disk', 0))
      .rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    await expect(api.storage.moveVdi('pool-1', {
      vdiRef: 'OpaqueRef:vdi', targetSrRef: 'OpaqueRef:NULL',
    })).rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    expect(invoke).toHaveBeenCalledTimes(16)
  })

  it('preserves the existing explicit-undefined VDI snapshot call shape', async () => {
    const invoke = vi.fn().mockResolvedValue('OpaqueRef:snapshot')
    const api = createStorageApi({ invoke })

    await expect(api.storage.snapshotVdi('pool-1', 'OpaqueRef:vdi', undefined))
      .resolves.toBe('OpaqueRef:snapshot')
    expect(invoke).toHaveBeenCalledWith(
      'vdi:snapshot',
      'pool-1',
      'OpaqueRef:vdi',
      undefined,
    )
  })

  it('routes all five PBD APIs and validates device configuration before transport', async () => {
    const pbd = {
      ref: 'OpaqueRef:pbd',
      uuid: 'pbd-uuid',
      host: 'OpaqueRef:host',
      SR: 'OpaqueRef:sr',
      device_config: {},
      currently_attached: true,
      connectionId: 'pool-1',
      poolName: 'Lab Pool',
    }
    const invoke = vi.fn()
      .mockResolvedValueOnce([pbd])
      .mockResolvedValueOnce('OpaqueRef:new-pbd')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
    const api = createStorageApi({ invoke })

    await expect(api.pbd.list('pool-1')).resolves.toEqual([pbd])
    await expect(api.pbd.create(
      'pool-1', 'OpaqueRef:host', 'OpaqueRef:sr', { target: '192.0.2.20' },
    )).resolves.toBe('OpaqueRef:new-pbd')
    await expect(api.pbd.plug('pool-1', 'OpaqueRef:pbd')).resolves.toBeUndefined()
    await expect(api.pbd.unplug('pool-1', 'OpaqueRef:pbd')).resolves.toBeUndefined()
    await expect(api.pbd.destroy('pool-1', 'OpaqueRef:pbd')).resolves.toBeUndefined()

    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      'pbd:list', 'pbd:create', 'pbd:plug', 'pbd:unplug', 'pbd:destroy',
    ])

    await expect(api.pbd.create(
      'pool-1', 'OpaqueRef:host', 'OpaqueRef:sr', { port: 3260 } as never,
    )).rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    await expect(api.pbd.unplug('pool-1', 'OpaqueRef:NULL'))
      .rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    expect(invoke).toHaveBeenCalledTimes(5)
  })

  it('routes all three ISO APIs and validates normalized list results', async () => {
    const iso = {
      ref: 'OpaqueRef:iso',
      uuid: 'iso-uuid',
      name_label: 'XCP-ng installer',
      name_description: '',
      virtual_size: 1024,
      physical_utilisation: 1024,
      type: 'iso',
      SR: 'OpaqueRef:iso-sr',
      srName: 'ISO library',
      read_only: true,
      connectionId: 'pool-1',
      poolName: 'Lab Pool',
    }
    const invoke = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([iso])
      .mockResolvedValueOnce(undefined)
    const api = createStorageApi({ invoke })

    await expect(api.iso.list('pool-1', 'OpaqueRef:iso-sr')).resolves.toEqual([])
    await expect(api.iso.listAll('pool-1')).resolves.toEqual([iso])
    await expect(api.iso.delete('pool-1', 'OpaqueRef:iso')).resolves.toBeUndefined()
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      'iso:list', 'iso:listAll', 'iso:delete',
    ])

    await expect(api.iso.delete('pool-1', 'OpaqueRef:NULL'))
      .rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    expect(invoke).toHaveBeenCalledTimes(3)

    invoke.mockResolvedValueOnce([{ ...iso, extension: true }])
    await expect(api.iso.listAll('pool-1'))
      .rejects.toMatchObject({ code: 'IPC_RESULT_INVALID' })
  })
})


it('routes SR identity through its validated descriptor and verifies the result', async () => {
  const invoke = vi.fn().mockResolvedValue({ nameLabel: 'New', nameDescription: '' })
  const api = createStorageApi({ invoke })
  const payload = { nameLabel: 'New', nameDescription: '', expectedNameLabel: 'Old', expectedNameDescription: 'old' }
  await expect(api.sr.updateIdentity('pool-1', 'OpaqueRef:sr', payload)).resolves.toEqual({ nameLabel: 'New', nameDescription: '' })
  expect(invoke).toHaveBeenCalledWith('sr:updateIdentity', 'pool-1', 'OpaqueRef:sr', payload)
  await expect(api.sr.updateIdentity('pool-1', 'OpaqueRef:NULL', payload)).rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
  expect(invoke).toHaveBeenCalledTimes(1)
})
