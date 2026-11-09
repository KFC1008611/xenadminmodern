import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useImportWizardStore } from '../../src/renderer/src/store/importWizard.store'

const preview = { vmName: 'Archived VM', originalSize: 1024, diskCount: 0, exportTime: '', vifs: [], isTemplate: false, vcpus: 1, memory: 1024, isHvm: true, description: '' }
const operation = { operationId: 'old', taskRef: null, status: 'failed' as const, progress: 0, message: 'server rejected', lastUpdatedAt: 1 }

beforeEach(() => { useImportWizardStore.getState().reset(); localStorage.clear() })
afterEach(() => { useImportWizardStore.getState().reset(); localStorage.clear() })

it.each(['completed', 'failed', 'cancelled'] as const)('migrates a legacy %s wizard to history without locking a new import', async (status) => {
  localStorage.setItem('xenadmin-import-operation', JSON.stringify({ version: 0, state: {
    operationId: 'old', operationStatus: status, operationConnectionId: 'original', operationPoolUuid: 'pool-uuid',
    currentStep: 4, importing: true, filePath: '/tmp/original.xva', preview,
  } }))
  await useImportWizardStore.persist.rehydrate()
  expect(useImportWizardStore.getState()).toMatchObject({ operationId: null, operationStatus: null, importing: false, currentStep: 1,
    history: [expect.objectContaining({ connectionId: 'original', poolUuid: 'pool-uuid', filePath: '/tmp/original.xva', operation: expect.objectContaining({ operationId: 'old', status }) })] })
})

it('retains a legacy active operation and pool identity for observation without persisting a busy acceptance flag', async () => {
  localStorage.setItem('xenadmin-import-operation', JSON.stringify({ version: 0, state: {
    operationId: 'active', operationStatus: 'uploading', operationConnectionId: 'original', operationPoolUuid: 'pool-uuid',
    importing: true, dialogOpen: true, filePath: '/tmp/original.xva', preview,
  } }))
  await useImportWizardStore.persist.rehydrate()
  expect(useImportWizardStore.getState()).toMatchObject({ operationId: 'active', operationStatus: 'unknown', importing: false, dialogOpen: false, currentStep: 4 })
  expect(useImportWizardStore.getState().history[0]).toMatchObject({ poolUuid: 'pool-uuid', operation: { operationId: 'active', status: 'unknown' } })
  useImportWizardStore.getState().newDraft()
  expect(useImportWizardStore.getState().history).toHaveLength(1)
  expect(useImportWizardStore.getState().operationId).toBeNull()
})

it('cannot reset a draft before its import acceptance response returns', () => {
  useImportWizardStore.setState({ importing: true, operationId: null, filePath: '/tmp/accepted.xva' })
  useImportWizardStore.getState().newDraft()
  expect(useImportWizardStore.getState()).toMatchObject({ importing: true, operationId: null, filePath: '/tmp/accepted.xva' })
})

it('removing a different finished import preserves the current active operation and rejects removal of active rows', () => {
  const active = { ...operation, operationId: 'active', status: 'uploading' as const }
  useImportWizardStore.setState({ operationId: 'active', operationStatus: 'uploading', history: [
    { connectionId: 'pool', name: 'Old', isTemplate: false, operation },
    { connectionId: 'pool', name: 'Active', isTemplate: false, operation: active },
  ] })
  useImportWizardStore.getState().removeRecord('old')
  useImportWizardStore.getState().removeRecord('active')
  expect(useImportWizardStore.getState()).toMatchObject({ operationId: 'active', operationStatus: 'uploading', history: [expect.objectContaining({ operation: active })] })
})

it('keeps confirmed terminal results when an older progress response or missing-record callback arrives', () => {
  useImportWizardStore.setState({ operationId: 'old', operationStatus: 'failed', history: [{ connectionId: 'pool', name: 'VM', isTemplate: false, operation }] })
  useImportWizardStore.getState().applyOperation({ ...operation, status: 'uploading', message: 'stale upload' })
  useImportWizardStore.getState().markRecordMissing('old')
  expect(useImportWizardStore.getState().history[0].operation).toEqual(operation)
  expect(useImportWizardStore.getState().operationStatus).toBe('failed')
  expect(useImportWizardStore.getState().operationRecordMissing).toBe(false)
})

it.each(['resolve', 'reject'] as const)('ignores an obsolete preview %s after selecting the same file again', async (outcome) => {
  let resolve!: (value: typeof preview) => void
  let reject!: (error: Error) => void
  const old = new Promise<typeof preview>((done, fail) => { resolve = done; reject = fail })
  window.xapi = { vm: { importGetPreview: vi.fn().mockReturnValueOnce(old).mockResolvedValueOnce({ ...preview, vmName: 'Current VM' }) } } as any
  useImportWizardStore.getState().selectFile('/tmp/same.xva')
  useImportWizardStore.getState().selectFile('/tmp/same.xva')
  await Promise.resolve(); await Promise.resolve()
  if (outcome === 'resolve') resolve(preview)
  else reject(new Error('obsolete preview error'))
  await Promise.resolve(); await Promise.resolve()
  expect(useImportWizardStore.getState().preview?.vmName).toBe('Current VM')
  expect(useImportWizardStore.getState().importError).toBeNull()
})
