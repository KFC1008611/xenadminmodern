import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSrWizardStore } from '../../src/renderer/src/store/srWizard.store'

const probeIscsi = vi.fn()
const createSr = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  ;(globalThis as any).window = { xapi: { sr: { probeIscsi, create: createSr } } }
  useSrWizardStore.getState().reset()
})

describe('SR wizard discovery and submission', () => {
  it('uses the selected portal address and port for LUN discovery and creation', async () => {
    useSrWizardStore.getState().setSrType('iscsi')
    useSrWizardStore.getState().setField('iscsiTarget', '10.0.0.1')
    useSrWizardStore.getState().selectIscsiTarget({ address: '10.0.0.2', port: 3261, iqn: 'iqn.test' })
    probeIscsi.mockResolvedValueOnce([{ luns: [{ id: '3600abc' }] }])
    await useSrWizardStore.getState().scanIscsiLuns('pool-a', 'OpaqueRef:host2')
    expect(probeIscsi).toHaveBeenCalledWith('pool-a', 'OpaqueRef:host2', '10.0.0.2', expect.objectContaining({ iqn: 'iqn.test', port: 3261 }))
    useSrWizardStore.getState().setField('iscsiLun', '3600abc')
    createSr.mockResolvedValueOnce('OpaqueRef:new-sr')
    await useSrWizardStore.getState().createSr('pool-a', 'OpaqueRef:host2')
    expect(createSr).toHaveBeenCalledWith('pool-a', 'OpaqueRef:host2', expect.objectContaining({ iscsiTarget: '10.0.0.2', iscsiPort: 3261, iscsiIqn: 'iqn.test', iscsiLun: '3600abc' }))
  })

  it('discards discovery from the prior host and clears a spinner when switching type', async () => {
    let resolve!: (value: any[]) => void
    useSrWizardStore.getState().setSrType('iscsi')
    probeIscsi.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const read = useSrWizardStore.getState().scanIscsi('pool-a', 'OpaqueRef:host1')
    useSrWizardStore.getState().invalidateDiscovery()
    resolve([{ iqn: 'old-host-iqn' }]); await read
    expect(useSrWizardStore.getState().availableIscsiTargets).toEqual([])
    useSrWizardStore.setState({ scanning: true })
    useSrWizardStore.getState().setSrType('nfs')
    expect(useSrWizardStore.getState().scanning).toBe(false)
  })

  it('submits a creation only once while the first request is in flight', async () => {
    let resolve!: (value: string) => void
    useSrWizardStore.getState().setSrType('nfs')
    createSr.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const first = useSrWizardStore.getState().createSr('pool-a', 'OpaqueRef:host')
    await expect(useSrWizardStore.getState().createSr('pool-a', 'OpaqueRef:host')).rejects.toThrow('正在提交')
    expect(createSr).toHaveBeenCalledTimes(1)
    resolve('OpaqueRef:created'); await first
  })

  it('keeps an unknown creation blocked when navigating back to edit', async () => {
    createSr.mockRejectedValueOnce(Object.assign(new Error('response lost'), { code: 'SR_CREATE_OUTCOME_UNKNOWN' }))
    await expect(useSrWizardStore.getState().createSr('pool-a', 'OpaqueRef:host')).rejects.toThrow('response lost')
    useSrWizardStore.getState().setStep(2)
    useSrWizardStore.getState().setField('nameLabel', 'renamed')
    await expect(useSrWizardStore.getState().createSr('pool-a', 'OpaqueRef:host')).rejects.toThrow('已阻止重复提交')
    expect(createSr).toHaveBeenCalledTimes(1)
  })
})

describe('existing storage choices', () => {
  it('requires an explicit existing SR choice and discards it when the LUN changes', async () => {
    useSrWizardStore.getState().setSrType('iscsi')
    createSr.mockRejectedValueOnce(Object.assign(new Error('existing storage'), { code: 'SR_ALREADY_EXISTS_ON_DEVICE', details: { srUuids: ['original-uuid'] } }))
    await expect(useSrWizardStore.getState().createSr('pool', 'OpaqueRef:host')).rejects.toThrow('existing storage')
    expect(useSrWizardStore.getState()).toMatchObject({ existingSrUuids: ['original-uuid'], existingSrUuid: '' })
    useSrWizardStore.getState().setField('existingSrUuid', 'original-uuid')
    createSr.mockResolvedValueOnce('OpaqueRef:existing')
    await useSrWizardStore.getState().createSr('pool', 'OpaqueRef:host')
    expect(createSr).toHaveBeenLastCalledWith('pool', 'OpaqueRef:host', expect.objectContaining({ existingSrUuid: 'original-uuid' }))
    useSrWizardStore.getState().setField('iscsiLun', 'different-scsi-id')
    expect(useSrWizardStore.getState()).toMatchObject({ existingSrUuids: [], existingSrUuid: '' })
  })
})
