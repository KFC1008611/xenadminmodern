import { copyOperation, copyPlan } from '../helpers/vm-copy-fixtures'
import { describe, expect, it, vi } from 'vitest'
import { createVmApi } from '../../src/preload/vm-api'

const connectedVm = {
  ref: 'OpaqueRef:vm',
  uuid: '11111111-2222-3333-4444-555555555555',
  name_label: 'Workload VM',
  name_description: 'Primary workload',
  power_state: 'Running' as const,
  resident_on: 'OpaqueRef:host',
  VCPUs_max: 4,
  VCPUs_at_startup: 2,
  memory_static_max: 8_589_934_592,
  memory_dynamic_max: 4_294_967_296,
  is_a_template: false,
  is_control_domain: false,
  VBDs: ['OpaqueRef:vbd'],
  VIFs: ['OpaqueRef:vif'],
  metrics: 'OpaqueRef:vm-metrics',
  guest_metrics: 'OpaqueRef:guest-metrics',
  consoles: ['OpaqueRef:console'],
  connectionId: 'pool-1',
  poolName: 'Lab Pool',
  xapi_extension: { generation: 7 },
}

describe('VM preload IPC contracts', () => {
  it('routes vm:list and enforces its argument, result, and business-error contract', async () => {
    const invoke = vi.fn().mockResolvedValueOnce([connectedVm])
    const api = createVmApi({ invoke })

    await expect(api.list('pool-1')).resolves.toEqual([connectedVm])
    expect(invoke).toHaveBeenLastCalledWith('vm:list', 'pool-1')

    await expect(api.list('   ')).rejects.toMatchObject({
      message: 'IPC payload does not match the channel contract',
      code: 'IPC_SCHEMA_INVALID',
    })
    expect(invoke).toHaveBeenCalledTimes(1)

    invoke.mockResolvedValueOnce([{ ref: 'incomplete' }])
    await expect(api.list('pool-1')).rejects.toMatchObject({
      message: 'IPC result does not match the channel contract',
      code: 'IPC_RESULT_INVALID',
    })

    invoke.mockResolvedValueOnce({
      error: true,
      message: 'VM list unavailable',
      code: 'VM_LIST_UNAVAILABLE',
      details: { retryable: true },
    })
    await expect(api.list('pool-1')).rejects.toMatchObject({
      message: 'VM list unavailable',
      code: 'VM_LIST_UNAVAILABLE',
      details: { retryable: true },
    })
  })

  it('pairs every literal base VM method with its channel and valid argument shape', async () => {
    const invoke = vi.fn()
    const api = createVmApi({ invoke })
    const vmDetail = {
      ...connectedVm,
      memory_static_min: 0,
      memory_dynamic_min: 0,
      os_version: {},
      networks: {},
    }
    const relocationPlan = {
      sourceConnectionId: 'pool-1', targetConnectionId: 'pool-1',
      vmRef: 'OpaqueRef:vm', vmName: 'Workload VM', powerState: 'Running',
      allowedModes: [], blockers: [], warnings: [], disks: [], vifs: [],
      sourceHosts: [], targetHosts: [], sourceSrs: [], targetSrs: [],
      sourceNetworks: [], targetNetworks: [],
    }
    const wizard = {
      templateRef: 'OpaqueRef:template', vmName: 'VM', vmDescription: '',
      vcpus: 2, memoryBytes: 10, installMode: 'pxe', disks: [], vifs: [],
      startAfter: false,
    }
    const exportParams = {
      vmRef: 'OpaqueRef:vm', filePath: '/backups/vm.xva',
      powerState: 'Running', exportMode: 'snapshot',
    }
    const importParams = {
      filePath: '/backups/vm.xva', srRef: 'OpaqueRef:sr', nameLabel: 'VM',
      nameDescription: '', vifMappings: {},
    }
    const preview = {
      vmName: 'VM', originalSize: 10, diskCount: 1, exportTime: '2026-08-01',
      vifs: [], isTemplate: false, vcpus: 2, memory: 10, isHvm: true,
      description: '',
    }
    const cases: Array<{
      method: keyof typeof api
      channel: string
      args: unknown[]
      result: unknown
    }> = [
      { method: 'list', channel: 'vm:list', args: ['pool-1'], result: [connectedVm] },
      { method: 'templates', channel: 'vm:templates', args: ['pool-1'], result: { user: [], system: [] } },
      { method: 'creationResources', channel: 'vm:creationResources', args: ['pool-1'], result: { hosts: [], srs: [], networks: [], isos: [] } },
      { method: 'getRecord', channel: 'vm:getRecord', args: ['pool-1', 'OpaqueRef:vm'], result: vmDetail },
      { method: 'getVBDs', channel: 'vm:getVBDs', args: ['pool-1', 'OpaqueRef:vm'], result: [] },
      { method: 'getCdDrive', channel: 'vm:getCdDrive', args: ['pool-1', 'OpaqueRef:vm'], result: { vbdRef: null, vdiRef: null, userdevice: null, empty: true, isoName: null, isoSize: null, srRef: null, srName: null } },
      { method: 'getVIFs', channel: 'vm:getVIFs', args: ['pool-1', 'OpaqueRef:vm'], result: [] },
      { method: 'getSnapshots', channel: 'vm:getSnapshots', args: ['pool-1', 'OpaqueRef:vm'], result: [] },
      { method: 'start', channel: 'vm:start', args: ['pool-1', 'OpaqueRef:vm'], result: undefined },
      { method: 'shutdown', channel: 'vm:shutdown', args: ['pool-1', 'OpaqueRef:vm'], result: undefined },
      { method: 'forceShutdown', channel: 'vm:force-shutdown', args: ['pool-1', 'OpaqueRef:vm'], result: undefined },
      { method: 'reboot', channel: 'vm:reboot', args: ['pool-1', 'OpaqueRef:vm'], result: undefined },
      { method: 'pause', channel: 'vm:pause', args: ['pool-1', 'OpaqueRef:vm'], result: undefined },
      { method: 'unpause', channel: 'vm:unpause', args: ['pool-1', 'OpaqueRef:vm'], result: undefined },
      { method: 'suspend', channel: 'vm:suspend', args: ['pool-1', 'OpaqueRef:vm'], result: undefined },
      { method: 'resume', channel: 'vm:resume', args: ['pool-1', 'OpaqueRef:vm'], result: undefined },
      { method: 'destroy', channel: 'vm:destroy', args: ['pool-1', 'OpaqueRef:vm'], result: { vmDeleted: true, failedVdiRefs: [] } },
      { method: 'snapshot', channel: 'vm:snapshot', args: ['pool-1', 'OpaqueRef:vm', 'before'], result: 'OpaqueRef:snapshot' },
      { method: 'setNameLabel', channel: 'vm:setNameLabel', args: ['pool-1', 'OpaqueRef:vm', 'Renamed'], result: undefined },
      { method: 'setNameDescription', channel: 'vm:setNameDescription', args: ['pool-1', 'OpaqueRef:vm', 'Description'], result: undefined },
      { method: 'setVcpus', channel: 'vm:setVcpus', args: ['pool-1', 'OpaqueRef:vm', 2], result: undefined },
      { method: 'setMemoryLimits', channel: 'vm:setMemoryLimits', args: ['pool-1', 'OpaqueRef:vm', 0, 1, 2, 3], result: undefined },
      { method: 'plugVbd', channel: 'vm:plugVbd', args: ['pool-1', 'OpaqueRef:vbd'], result: undefined },
      { method: 'unplugVbd', channel: 'vm:unplugVbd', args: ['pool-1', 'OpaqueRef:vbd'], result: undefined },
      { method: 'detachVbd', channel: 'vm:detachVbd', args: ['pool-1', 'OpaqueRef:vbd'], result: undefined },
      { method: 'mountIso', channel: 'vm:mountIso', args: ['pool-1', 'OpaqueRef:vm', 'OpaqueRef:iso'], result: undefined },
      { method: 'ejectIso', channel: 'vm:ejectIso', args: ['pool-1', 'OpaqueRef:vm'], result: undefined },
      { method: 'migrate', channel: 'vm:migrate', args: ['pool-1', 'OpaqueRef:vm', 'OpaqueRef:host'], result: { taskRef: 'OpaqueRef:task' } },
      { method: 'getRelocationPlan', channel: 'vm:getRelocationPlan', args: ['pool-1', 'OpaqueRef:vm'], result: relocationPlan },
      { method: 'relocate', channel: 'vm:relocate', args: [{ mode: 'pool-migrate', sourceConnectionId: 'pool-1', vmRef: 'OpaqueRef:vm', targetHostRef: 'OpaqueRef:host' }], result: { taskRef: 'OpaqueRef:task' } },
      { method: 'copy', channel: 'vm:copy', args: ['pool-1', { vmRef: 'OpaqueRef:vm', newName: 'copy' }], result: copyOperation },
      { method: 'copyPlan', channel: 'vm:copyPlan', args: ['pool-1', 'OpaqueRef:vm', 'pool-1'], result: copyPlan },
      { method: 'copyOperations', channel: 'vm:copyOperations', args: [], result: [copyOperation] },
      { method: 'cancelCopy', channel: 'vm:cancelCopy', args: ['copy-1'], result: copyOperation },
      { method: 'createFromTemplate', channel: 'vm:create-from-template', args: ['pool-1', wizard], result: 'OpaqueRef:created' },
      { method: 'quickCreateFromTemplate', channel: 'vm:quick-create-from-template', args: ['pool-1', 'OpaqueRef:template'], result: 'OpaqueRef:quick' },
      { method: 'revertSnapshot', channel: 'vm:revertSnapshot', args: ['pool-1', 'OpaqueRef:snapshot'], result: undefined },
      { method: 'deleteSnapshot', channel: 'vm:deleteSnapshot', args: ['pool-1', 'OpaqueRef:snapshot'], result: { vmDeleted: true, failedVdiRefs: [] } },
      { method: 'renameSnapshot', channel: 'vm:renameSnapshot', args: ['pool-1', 'OpaqueRef:snapshot', 'Renamed'], result: undefined },
      { method: 'markAsTemplate', channel: 'vm:markAsTemplate', args: ['pool-1', 'OpaqueRef:vm'], result: undefined },
      { method: 'templateClone', channel: 'template:clone', args: ['pool-1', { templateRef: 'OpaqueRef:template', newName: 'clone' }], result: copyOperation },
      { method: 'templateDelete', channel: 'template:delete', args: ['pool-1', { templateRef: 'OpaqueRef:template', deleteDisks: false }], result: { vmDeleted: true, failedVdiRefs: [] } },
      { method: 'templateUpdateSettings', channel: 'template:updateSettings', args: ['pool-1', { templateRef: 'OpaqueRef:template' }], result: undefined },
      { method: 'templateEnableInstantCreate', channel: 'template:enableInstantCreate', args: ['pool-1', 'OpaqueRef:template'], result: undefined },
      { method: 'export', channel: 'vm:export', args: ['pool-1', exportParams], result: { exportId: 'export-1', estimatedBytes: 10 } },
      { method: 'import', channel: 'vm:import', args: ['pool-1', importParams], result: 'import-1' },
      { method: 'importGetPreview', channel: 'vm:importGetPreview', args: ['/backups/vm.xva'], result: preview },
      { method: 'importProgress', channel: 'vm:importProgress', args: ['import-1'], result: null },
      { method: 'cancelImport', channel: 'vm:cancelImport', args: ['pool-1', 'import-1'], result: undefined },
      { method: 'cancelExport', channel: 'vm:cancelExport', args: ['pool-1', 'export-1'], result: undefined },
      { method: 'exportProgress', channel: 'vm:exportProgress', args: ['export-1'], result: null },
    ]

    for (const testCase of cases) {
      invoke.mockResolvedValueOnce(testCase.result)
      const method = api[testCase.method] as unknown as (...args: unknown[]) => Promise<unknown>
      await expect(method(...testCase.args)).resolves.toEqual(testCase.result)
    }
    expect(invoke.mock.calls).toEqual(cases.map(({ channel, args }) => [channel, ...args]))
  })

  it('exposes literal read, lifecycle, compute, and VM-device methods through descriptors', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ vmDeleted: true, failedVdiRefs: [] })
    const api = createVmApi({ invoke })

    expect(Object.keys(api)).toEqual([
      'list',
      'templates',
      'creationResources',
      'getRecord',
      'getVBDs',
      'getCdDrive',
      'getVIFs',
      'getSnapshots',
      'start',
      'shutdown',
      'forceShutdown',
      'reboot',
      'pause',
      'unpause',
      'suspend',
      'resume',
      'destroy',
      'snapshot',
      'setNameLabel',
      'setNameDescription',
      'setVcpus',
      'setMemoryLimits',
      'plugVbd',
      'unplugVbd',
      'detachVbd',
      'mountIso',
      'ejectIso',
      'migrate',
      'getRelocationPlan',
      'relocate',
      'copy',
      'copyPlan',
      'copyOperations',
      'cancelCopy',
      'createFromTemplate',
      'quickCreateFromTemplate',
      'revertSnapshot',
      'deleteSnapshot',
      'renameSnapshot',
      'markAsTemplate',
      'templateClone',
      'templateDelete',
      'templateUpdateSettings',
      'templateEnableInstantCreate',
      'export',
      'import',
      'importGetPreview',
      'importProgress',
      'cancelImport',
      'cancelExport',
      'exportProgress',
      'onVmChanged',
    ])

    await expect(api.start('pool-1', 'OpaqueRef:vm')).resolves.toBeUndefined()
    expect(invoke).toHaveBeenLastCalledWith('vm:start', 'pool-1', 'OpaqueRef:vm')

    await expect(api.destroy('pool-1', 'OpaqueRef:vm')).resolves.toEqual({ vmDeleted: true, failedVdiRefs: [] })
    expect(invoke).toHaveBeenLastCalledWith('vm:destroy', 'pool-1', 'OpaqueRef:vm')

    await expect(api.mountIso('pool-1', 'OpaqueRef:vm', 'OpaqueRef:NULL'))
      .rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('routes relocation, copy, and creation through strict descriptor payloads', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ taskRef: 'OpaqueRef:task' })
      .mockResolvedValueOnce(copyOperation)
      .mockResolvedValueOnce('OpaqueRef:created')
    const api = createVmApi({ invoke })

    await expect(api.migrate('pool-1', 'OpaqueRef:vm', 'OpaqueRef:host'))
      .resolves.toEqual({ taskRef: 'OpaqueRef:task' })
    await expect(api.copy('pool-1', {
      vmRef: 'OpaqueRef:vm', newName: 'copy', mode: 'copy', targetSrRef: 'OpaqueRef:sr',
    })).resolves.toEqual(copyOperation)
    await expect(api.createFromTemplate('pool-1', {
      templateRef: 'OpaqueRef:template', vmName: 'VM', vmDescription: '',
      vcpus: 2, memoryBytes: 10, installMode: 'pxe', disks: [], vifs: [], startAfter: false,
    })).resolves.toBe('OpaqueRef:created')
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      'vm:migrate',
      'vm:copy',
      'vm:create-from-template',
    ])
  })

  it('routes snapshot and template methods without legacy aliases', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    const api = createVmApi({ invoke })

    await expect(api.renameSnapshot('pool-1', 'OpaqueRef:snapshot', 'renamed'))
      .resolves.toBeUndefined()
    await expect(api.templateUpdateSettings('pool-1', {
      templateRef: 'OpaqueRef:template', nameDescription: '',
    })).resolves.toBeUndefined()
    expect(invoke.mock.calls).toEqual([
      ['vm:renameSnapshot', 'pool-1', 'OpaqueRef:snapshot', 'renamed'],
      ['template:updateSettings', 'pool-1', {
        templateRef: 'OpaqueRef:template', nameDescription: '',
      }],
    ])
  })

  it('routes XVA transfer methods and rejects secret-shaped extras before transport', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ exportId: 'export-1', estimatedBytes: 10 })
      .mockResolvedValueOnce({
        taskId: 'export-1', progress: 50, status: 'running', message: 'downloading',
        lastUpdatedAt: 1,
      })
    const api = createVmApi({ invoke })

    await expect(api.export('pool-1', {
      vmRef: 'OpaqueRef:vm', filePath: '/backups/vm.xva',
      powerState: 'Running', exportMode: 'snapshot',
    })).resolves.toEqual({ exportId: 'export-1', estimatedBytes: 10 })
    await expect(api.exportProgress('export-1')).resolves.toMatchObject({
      taskId: 'export-1', progress: 50,
    })
    await expect(api.export('pool-1', {
      vmRef: 'OpaqueRef:vm', filePath: '/backups/vm.xva',
      powerState: 'Running', exportMode: 'snapshot', password: 'never-log-me',
    } as never)).rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('subscribes to validated VM changes without exposing the push as an invoke', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const transport = {
      invoke: vi.fn(),
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        listeners.set(channel, listener)
      }),
      removeListener: vi.fn(),
    }
    const api = createVmApi(transport)
    const callback = vi.fn()
    const unsubscribe = api.onVmChanged(callback)
    const event = {
      connectionId: 'pool-1',
      operation: 'mod',
      ref: 'OpaqueRef:vm',
      snapshot: { name_label: 'Workload VM', future_xapi_field: true },
      receivedAt: 1_700_000_000_000,
    }

    expect(transport.on).toHaveBeenCalledWith('vm:changed', expect.any(Function))
    listeners.get('vm:changed')?.({}, event)
    listeners.get('vm:changed')?.({}, { ...event, unexpected: true })
    listeners.get('vm:changed')?.({}, { ...event, operation: 'replace' })

    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith(event)
    expect(transport.invoke).not.toHaveBeenCalled()

    unsubscribe()
    expect(transport.removeListener).toHaveBeenCalledWith(
      'vm:changed',
      listeners.get('vm:changed'),
    )
  })
})
