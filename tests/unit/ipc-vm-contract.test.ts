import { describe, expect, it } from 'vitest'
import {
  vmDestroyContract,
  vmEjectIsoContract,
  vmLifecycleComputeDeviceContracts,
  vmCopyContract,
  vmCreateFromTemplateContract,
  vmContracts,
  vmGetRelocationPlanContract,
  vmMigrateContract,
  vmMountIsoContract,
  vmReadContracts,
  vmRelocateContract,
  vmRelocationCreationContracts,
  vmSetMemoryLimitsContract,
  vmSnapshotContract,
  vmSnapshotTemplateContracts,
  vmExportContract,
  vmExportProgressContract,
  vmImportContract,
  vmImportGetPreviewContract,
  vmImportProgressContract,
  vmXvaContracts,
  templateCloneContract,
  templateDeleteContract,
  templateUpdateSettingsContract,
  vmRenameSnapshotContract,
  vmCreationResourcesContract,
  vmGetCdDriveContract,
  vmGetRecordContract,
  vmGetSnapshotsContract,
  vmGetVbdsContract,
  vmGetVifsContract,
  vmListContract,
  vmChangedContract,
  vmTemplatesContract,
} from '../../src/shared/ipc-contracts/vm'

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

describe('VM list IPC contract', () => {
  it('declares a strict read boundary and preserves compatible XAPI result extensions', () => {
    expect(vmListContract).toMatchObject({
      channel: 'vm:list',
      direction: 'invoke',
      errorShape: 'ipc-error-response-v1',
      callerPolicy: 'app-window-main-frame',
      redaction: ['none'],
    })

    expect(vmListContract.argsSchema.parse(['pool-1'])).toEqual(['pool-1'])
    for (const args of [[], [''], ['   '], [1], ['pool-1', 'extra']]) {
      expect(() => vmListContract.argsSchema.parse(args)).toThrow()
    }

    expect(vmListContract.resultSchema.parse([connectedVm])).toEqual([connectedVm])
    expect(() => vmListContract.resultSchema.parse([{ ...connectedVm, VCPUs_max: '4' }]))
      .toThrow()
    expect(() => vmListContract.resultSchema.parse([{ ...connectedVm, uuid: undefined }]))
      .toThrow()

    const expectedChannels = [
      'vm:list', 'vm:templates', 'vm:creationResources', 'vm:getRecord', 'vm:getVBDs',
      'vm:getCdDrive', 'vm:getVIFs', 'vm:getSnapshots', 'vm:start', 'vm:shutdown',
      'vm:force-shutdown', 'vm:reboot', 'vm:pause', 'vm:unpause', 'vm:suspend',
      'vm:resume', 'vm:destroy', 'vm:snapshot', 'vm:setNameLabel',
      'vm:setNameDescription', 'vm:setVcpus', 'vm:setMemoryLimits', 'vm:plugVbd',
      'vm:unplugVbd', 'vm:detachVbd', 'vm:mountIso', 'vm:ejectIso', 'vm:migrate',
      'vm:getRelocationPlan', 'vm:relocate', 'vm:copy', 'vm:copyPlan', 'vm:copyOperations', 'vm:cancelCopy', 'vm:create-from-template', 'vm:quick-create-from-template',
      'vm:revertSnapshot', 'vm:deleteSnapshot', 'vm:renameSnapshot',
      'vm:markAsTemplate', 'template:clone', 'template:delete',
      'template:updateSettings', 'template:enableInstantCreate', 'vm:export', 'vm:import',
      'vm:importGetPreview', 'vm:importProgress', 'vm:cancelImport', 'vm:cancelExport',
      'vm:exportProgress', 'vm:changed',
    ]
    expect(vmContracts.map(({ channel }) => channel)).toEqual(expectedChannels)
    expect(new Set(vmContracts.map(({ channel }) => channel))).toHaveLength(52)
  })

  it('declares a strict VM change push envelope while preserving live snapshot extensions', () => {
    expect(vmChangedContract).toMatchObject({
      channel: 'vm:changed',
      direction: 'push',
      resultSchema: null,
      errorShape: null,
      callerPolicy: 'main-process',
      redaction: ['none'],
    })

    const event = {
      connectionId: 'pool-1',
      operation: 'mod' as const,
      ref: 'OpaqueRef:vm',
      snapshot: {
        name_label: 'Workload VM',
        future_xapi_field: { generation: 7 },
      },
      receivedAt: 1_700_000_000_000,
    }
    expect(vmChangedContract.argsSchema.parse([event])).toEqual([event])

    for (const args of [
      [],
      [event, 'extra'],
      [{ ...event, connectionId: '   ' }],
      [{ ...event, operation: 'replace' }],
      [{ ...event, ref: 'OpaqueRef:NULL' }],
      [{ ...event, snapshot: [] }],
      [{ ...event, receivedAt: -1 }],
      [{ ...event, receivedAt: Number.NaN }],
      [{ ...event, unexpected: true }],
    ]) {
      expect(() => vmChangedContract.argsSchema.parse(args)).toThrow()
    }
  })

  it('declares the literal base VM read inventory and validates normalized DTO results', () => {
    expect(vmReadContracts.map(({ channel }) => channel)).toEqual([
      'vm:list',
      'vm:templates',
      'vm:creationResources',
      'vm:getRecord',
      'vm:getVBDs',
      'vm:getCdDrive',
      'vm:getVIFs',
      'vm:getSnapshots',
    ])

    const vmRecord = {
      ...connectedVm,
      memory_static_min: 0,
      memory_dynamic_min: 1_073_741_824,
      os_version: { name: 'Linux' },
      networks: { '0/ip': '192.0.2.10' },
    }
    expect(vmTemplatesContract.resultSchema.parse({ user: [connectedVm], system: [] }))
      .toEqual({ user: [connectedVm], system: [] })
    expect(vmGetRecordContract.resultSchema.parse(vmRecord)).toEqual(vmRecord)
    expect(() => vmGetRecordContract.resultSchema.parse({ ...vmRecord, os_version: [] }))
      .toThrow()

    const resources = {
      hosts: [{ ref: 'OpaqueRef:host', name: 'host', enabled: true, memoryFree: 10, cpuCount: 4 }],
      srs: [{ ref: 'OpaqueRef:sr', name: 'sr', freeBytes: 20, shared: true, hostRefs: ['OpaqueRef:host'] }],
      networks: [{ ref: 'OpaqueRef:network', name: 'network', hostRefs: ['OpaqueRef:host'], autoPlug: true }],
      isos: [{ ref: 'OpaqueRef:iso', name: 'installer.iso', srRef: 'OpaqueRef:sr', hostRefs: ['OpaqueRef:host'] }],
    }
    expect(vmCreationResourcesContract.resultSchema.parse(resources)).toEqual(resources)

    expect(vmGetVbdsContract.resultSchema.parse([{
      ref: 'OpaqueRef:vbd', VDI: 'OpaqueRef:vdi', userdevice: '0', mode: 'RW', type: 'Disk',
      bootable: true, currently_attached: true, unpluggable: true, owner: true,
      vdiName: 'disk', vdiSize: 10, srRef: 'OpaqueRef:sr', xapi_extension: true,
    }])).toHaveLength(1)
    expect(vmGetCdDriveContract.resultSchema.parse({
      vbdRef: null, vdiRef: null, userdevice: null, empty: true,
      isoName: null, isoSize: null, srRef: null, srName: null,
    })).toMatchObject({ empty: true })
    expect(vmGetVifsContract.resultSchema.parse([{
      ref: 'OpaqueRef:vif', device: '0', MAC: '00:16:3e:00:00:01',
      network: 'OpaqueRef:network', networkName: 'LAN', MTU: 1500,
    }])).toHaveLength(1)
    expect(vmGetSnapshotsContract.resultSchema.parse([{
      ref: 'OpaqueRef:snapshot', uuid: 'snapshot-uuid', name_label: 'before-upgrade',
      name_description: '', snapshot_time: '2026-08-02T00:00:00.000Z', size: 10,
    }])).toHaveLength(1)

    const readCases = [
      [vmTemplatesContract, ['pool-1']],
      [vmCreationResourcesContract, ['pool-1']],
      [vmGetRecordContract, ['pool-1', 'OpaqueRef:vm']],
      [vmGetVbdsContract, ['pool-1', 'OpaqueRef:vm']],
      [vmGetCdDriveContract, ['pool-1', 'OpaqueRef:vm']],
      [vmGetVifsContract, ['pool-1', 'OpaqueRef:vm']],
      [vmGetSnapshotsContract, ['pool-1', 'OpaqueRef:vm']],
    ] as const
    for (const [contract, args] of readCases) {
      expect(contract.argsSchema.parse(args)).toEqual(args)
      expect(() => contract.argsSchema.parse(['pool-1', 'OpaqueRef:vm', 'extra']))
        .toThrow()
    }
  })

  it('declares strict lifecycle, compute, and VM-device mutation tuples', () => {
    expect(vmLifecycleComputeDeviceContracts.map(({ channel }) => channel)).toEqual([
      'vm:start',
      'vm:shutdown',
      'vm:force-shutdown',
      'vm:reboot',
      'vm:pause',
      'vm:unpause',
      'vm:suspend',
      'vm:resume',
      'vm:destroy',
      'vm:snapshot',
      'vm:setNameLabel',
      'vm:setNameDescription',
      'vm:setVcpus',
      'vm:setMemoryLimits',
      'vm:plugVbd',
      'vm:unplugVbd',
      'vm:detachVbd',
      'vm:mountIso',
      'vm:ejectIso',
    ])

    expect(vmDestroyContract.argsSchema.parse(['pool-1', 'OpaqueRef:vm']))
      .toEqual(['pool-1', 'OpaqueRef:vm'])
    expect(vmDestroyContract.argsSchema.parse(['pool-1', 'OpaqueRef:vm', undefined]))
      .toEqual(['pool-1', 'OpaqueRef:vm', undefined])
    expect(vmDestroyContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:vm', { vdiRefs: ['OpaqueRef:vdi'] },
    ])).toEqual(['pool-1', 'OpaqueRef:vm', { vdiRefs: ['OpaqueRef:vdi'] }])
    for (const args of [
      ['pool-1', 'OpaqueRef:vm', { vdiRefs: [], unexpected: true }],
      ['pool-1', 'OpaqueRef:NULL'],
      ['pool-1', 'OpaqueRef:vm', { vdiRefs: [''] }],
      ['pool-1', 'OpaqueRef:vm', undefined, 'extra'],
    ]) expect(() => vmDestroyContract.argsSchema.parse(args)).toThrow()

    expect(vmSnapshotContract.argsSchema.parse(['pool-1', 'OpaqueRef:vm', 'before-upgrade']))
      .toEqual(['pool-1', 'OpaqueRef:vm', 'before-upgrade'])
    expect(vmSnapshotContract.resultSchema.parse('OpaqueRef:snapshot')).toBe('OpaqueRef:snapshot')
    expect(() => vmSnapshotContract.resultSchema.parse('OpaqueRef:NULL')).toThrow()

    expect(vmSetMemoryLimitsContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:vm', 0, 1, 2, 3,
    ])).toEqual(['pool-1', 'OpaqueRef:vm', 0, 1, 2, 3])
    expect(() => vmSetMemoryLimitsContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:vm', 0, 3, 2, 4,
    ])).toThrow()
    expect(() => vmSetMemoryLimitsContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:vm', 0, 1, 2, Number.POSITIVE_INFINITY,
    ])).toThrow()
    for (const limits of [[0, 0, 0, 0], [0, 0.5, 2, 3], [0, 1, 2, Number.MAX_SAFE_INTEGER + 1]]) {
      expect(() => vmSetMemoryLimitsContract.argsSchema.parse(['pool-1', 'OpaqueRef:vm', ...limits])).toThrow()
    }

    expect(vmMountIsoContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:vm', 'OpaqueRef:iso',
    ])).toEqual(['pool-1', 'OpaqueRef:vm', 'OpaqueRef:iso'])
    expect(() => vmMountIsoContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:vm', 'OpaqueRef:NULL',
    ])).toThrow()
    expect(vmEjectIsoContract.resultSchema.parse(undefined)).toBeUndefined()
  })

  it('declares strict relocation, copy, and creation discriminators', () => {
    expect(vmRelocationCreationContracts.map(({ channel }) => channel)).toEqual([
      'vm:migrate',
      'vm:getRelocationPlan',
      'vm:relocate',
      'vm:copy',
      'vm:copyPlan',
      'vm:copyOperations',
      'vm:cancelCopy',
      'vm:create-from-template',
      'vm:quick-create-from-template',
    ])

    expect(vmMigrateContract.resultSchema.parse({ taskRef: 'OpaqueRef:task' }))
      .toEqual({ taskRef: 'OpaqueRef:task' })
    expect(vmGetRelocationPlanContract.argsSchema.parse(['pool-1', 'OpaqueRef:vm']))
      .toEqual(['pool-1', 'OpaqueRef:vm'])
    expect(vmGetRelocationPlanContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:vm', undefined,
    ])).toEqual(['pool-1', 'OpaqueRef:vm', undefined])
    expect(() => vmGetRelocationPlanContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:vm', '',
    ])).toThrow()

    const poolMigrate = {
      mode: 'pool-migrate',
      sourceConnectionId: 'pool-1',
      targetConnectionId: 'pool-1',
      vmRef: 'OpaqueRef:vm',
      targetHostRef: 'OpaqueRef:host',
      transferNetworkRef: undefined,
      storageMap: undefined,
      networkMap: undefined,
    }
    expect(vmRelocateContract.argsSchema.parse([poolMigrate])).toEqual([poolMigrate])
    expect(() => vmRelocateContract.argsSchema.parse([{
      ...poolMigrate,
      targetConnectionId: 'pool-2',
    }])).toThrow()
    expect(() => vmRelocateContract.argsSchema.parse([{
      ...poolMigrate,
      targetHostRef: undefined,
    }])).toThrow()
    expect(() => vmRelocateContract.argsSchema.parse([{
      ...poolMigrate,
      password: 'never-log-me',
    }])).toThrow()

    expect(vmRelocateContract.argsSchema.parse([{
      mode: 'storage-move',
      sourceConnectionId: 'pool-1',
      vmRef: 'OpaqueRef:vm',
      storageMap: { 'OpaqueRef:vdi': 'OpaqueRef:sr' },
    }])).toEqual([{
      mode: 'storage-move',
      sourceConnectionId: 'pool-1',
      vmRef: 'OpaqueRef:vm',
      storageMap: { 'OpaqueRef:vdi': 'OpaqueRef:sr' },
    }])
    expect(vmRelocateContract.argsSchema.parse([{
      mode: 'cross-pool-copy',
      sourceConnectionId: 'pool-1',
      targetConnectionId: 'pool-2',
      vmRef: 'OpaqueRef:vm',
      targetHostRef: 'OpaqueRef:host',
      transferNetworkRef: 'OpaqueRef:network',
      storageMap: { 'OpaqueRef:vdi': 'OpaqueRef:sr' },
      networkMap: { 'OpaqueRef:vif': 'OpaqueRef:network' },
    }])).toHaveLength(1)

    expect(vmCopyContract.argsSchema.parse(['pool-1', {
      vmRef: 'OpaqueRef:vm', newName: 'copy', mode: 'copy', targetSrRef: 'OpaqueRef:sr',
    }])).toHaveLength(2)
    expect(() => vmCopyContract.argsSchema.parse(['pool-1', {
      vmRef: 'OpaqueRef:vm', newName: 'copy', mode: 'copy',
    }])).toThrow()
    expect(() => vmCopyContract.argsSchema.parse(['pool-1', {
      vmRef: 'OpaqueRef:vm', newName: 'clone', mode: 'clone', targetSrRef: 'OpaqueRef:sr',
    }])).toThrow()

    const wizard = {
      templateRef: 'OpaqueRef:template', vmName: 'VM', vmDescription: '',
      vcpus: 2, memoryBytes: 2_147_483_648, installMode: 'iso',
      isoRef: 'OpaqueRef:iso', targetHostRef: undefined, targetSrRef: undefined,
      disks: [{ templateVdiRef: '', srRef: 'OpaqueRef:sr', sizeBytes: 10, device: '0' }],
      vifs: [{ device: '0', networkRef: 'OpaqueRef:network', networkName: 'LAN' }],
      startAfter: true,
    }
    expect(vmCreateFromTemplateContract.argsSchema.parse(['pool-1', wizard]))
      .toEqual(['pool-1', wizard])
    expect(() => vmCreateFromTemplateContract.argsSchema.parse(['pool-1', {
      ...wizard,
      installMode: 'pxe',
    }])).toThrow()
    expect(() => vmCreateFromTemplateContract.argsSchema.parse(['pool-1', {
      ...wizard,
      disks: [{ ...wizard.disks[0], extra: true }],
    }])).toThrow()
  })

  it('declares strict snapshot and template payload contracts', () => {
    expect(vmSnapshotTemplateContracts.map(({ channel }) => channel)).toEqual([
      'vm:revertSnapshot',
      'vm:deleteSnapshot',
      'vm:renameSnapshot',
      'vm:markAsTemplate',
      'template:clone',
      'template:delete',
      'template:updateSettings',
      'template:enableInstantCreate',
    ])

    expect(vmRenameSnapshotContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:snapshot', 'renamed',
    ])).toEqual(['pool-1', 'OpaqueRef:snapshot', 'renamed'])
    expect(() => vmRenameSnapshotContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:snapshot', '',
    ])).toThrow()

    expect(templateCloneContract.argsSchema.parse(['pool-1', {
      templateRef: 'OpaqueRef:template', newName: 'copy', targetSrRef: undefined,
    }])).toEqual(['pool-1', {
      templateRef: 'OpaqueRef:template', newName: 'copy', targetSrRef: undefined,
    }])
    expect(() => templateCloneContract.argsSchema.parse(['pool-1', {
      templateRef: 'OpaqueRef:template', newName: 'copy', unexpected: true,
    }])).toThrow()
    expect(templateDeleteContract.argsSchema.parse(['pool-1', {
      templateRef: 'OpaqueRef:template', deleteDisks: true,
    }])).toHaveLength(2)
    expect(() => templateDeleteContract.argsSchema.parse(['pool-1', {
      templateRef: 'OpaqueRef:template', deleteDisks: 'yes',
    }])).toThrow()

    expect(templateUpdateSettingsContract.argsSchema.parse(['pool-1', {
      templateRef: 'OpaqueRef:template', nameDescription: '', vcpusMax: 4,
      memoryStaticMin: 0, memoryDynamicMin: 1, memoryDynamicMax: 2, memoryStaticMax: 3,
    }])).toHaveLength(2)
    expect(() => templateUpdateSettingsContract.argsSchema.parse(['pool-1', {
      templateRef: 'OpaqueRef:template', vcpusMax: 1.5,
    }])).toThrow()
    expect(() => templateUpdateSettingsContract.argsSchema.parse(['pool-1', {
      templateRef: 'OpaqueRef:template', memoryDynamicMin: 4, memoryDynamicMax: 2,
    }])).toThrow()
  })

  it('declares strict XVA transfer and progress contracts without treating paths as secrets', () => {
    expect(vmXvaContracts.map(({ channel }) => channel)).toEqual([
      'vm:export',
      'vm:import',
      'vm:importGetPreview',
      'vm:importProgress',
      'vm:cancelImport',
      'vm:cancelExport',
      'vm:exportProgress',
    ])
    expect(vmXvaContracts.map(({ redaction }) => redaction)).toEqual([
      ['none'], ['none'], ['none'], ['none'], ['none'], ['none'], ['none'],
    ])

    const exportParams = {
      vmRef: 'OpaqueRef:vm',
      filePath: '/backups/workload.xva',
      powerState: 'Running',
      exportMode: 'snapshot',
      useCompression: true,
    }
    expect(vmExportContract.argsSchema.parse(['pool-1', exportParams]))
      .toEqual(['pool-1', exportParams])
    expect(vmExportContract.resultSchema.parse({ exportId: 'export-1', estimatedBytes: 10 }))
      .toEqual({ exportId: 'export-1', estimatedBytes: 10 })
    expect(() => vmExportContract.argsSchema.parse(['pool-1', {
      ...exportParams,
      password: 'never-log-me',
    }])).toThrow()

    const importParams = {
      filePath: '/backups/workload.xva', srRef: 'OpaqueRef:sr',
      vifMappings: { '0': 'OpaqueRef:network' }, homeServerRef: null,
    }
    expect(vmImportContract.argsSchema.parse(['pool-1', importParams]))
      .toEqual(['pool-1', importParams])
    expect(() => vmImportContract.argsSchema.parse(['pool-1', { ...importParams, importAsTemplate: true }])).toThrow()
    expect(vmImportContract.resultSchema.parse('operation-1')).toBe('operation-1')

    expect(vmImportGetPreviewContract.resultSchema.parse({
      vmName: 'Imported VM', originalSize: 10, diskCount: 1,
      exportTime: '2026-08-02T00:00:00.000Z',
      vifs: [{ device: '0', sourceNetworkName: 'LAN' }],
      isTemplate: false, vcpus: 2, memory: 10, isHvm: true, description: '',
      powerState: 'Suspended', suspendDiskSize: 4,
    })).toMatchObject({ vmName: 'Imported VM', diskCount: 1, powerState: 'Suspended', suspendDiskSize: 4 })
    expect(vmImportProgressContract.resultSchema.parse(null)).toBeNull()
    expect(vmImportProgressContract.resultSchema.parse({
      operationId: 'operation-1', taskRef: null, status: 'uploading',
      progress: 25, message: 'uploading', lastUpdatedAt: 1,
    })).toMatchObject({ operationId: 'operation-1', progress: 25 })
    expect(vmImportProgressContract.resultSchema.parse({
      operationId: 'operation-1', taskRef: null, status: 'unknown',
      progress: 25, message: 'waiting for reconciliation', lastUpdatedAt: 1,
    })).toMatchObject({ status: 'unknown' })
    const validating = {
      operationId: 'operation-1', taskRef: null, status: 'validating', progress: 0,
      message: 'checking local archive', lastUpdatedAt: 1,
      validation: { bytesChecked: 512, bytesTotal: 1024, elapsedMs: 65000.5 },
    }
    expect(vmImportProgressContract.resultSchema.parse(validating)).toEqual(validating)
    const transfer = { bytesTransferred: 512, bytesTotal: 1024, elapsedMs: 4 }
    expect(vmImportProgressContract.resultSchema.parse({ ...validating, status: 'uploading', transfer })).toMatchObject({ transfer })
    expect(vmImportProgressContract.resultSchema.parse({ ...validating, status: 'configuring', progress: -1 })).toMatchObject({ progress: -1 })
    for (const validation of [
      { ...validating.validation, bytesChecked: -1 },
      { ...validating.validation, bytesChecked: 2048 },
      { ...validating.validation, bytesChecked: 1.5 },
      { ...validating.validation, bytesTotal: 0 },
      { ...validating.validation, bytesTotal: Number.MAX_SAFE_INTEGER + 1 },
      { ...validating.validation, elapsedMs: Number.NaN },
      { ...validating.validation, elapsedMs: -1 },
      { ...validating.validation, unexpected: true },
    ]) expect(() => vmImportProgressContract.resultSchema.parse({ ...validating, validation })).toThrow()

    expect(vmExportProgressContract.resultSchema.parse({
      taskId: 'export-1', progress: 50, status: 'running', message: 'downloading',
      bytesTransferred: 5, bytesTotal: 10, lastUpdatedAt: 1,
    })).toMatchObject({ taskId: 'export-1', status: 'running' })
    expect(() => vmExportProgressContract.resultSchema.parse({
      taskId: 'export-1', progress: 50, status: 'running', message: 'downloading',
    })).toThrow()
    expect(vmExportProgressContract.resultSchema.parse(null)).toBeNull()
    const downloading = { taskId: 'export-1', progress: -1, status: 'running', phase: 'transferring', message: 'downloading', transfer: { ...transfer, bytesTotal: 0 }, lastUpdatedAt: 1 }
    expect(vmExportProgressContract.resultSchema.parse(downloading)).toEqual(downloading)
    expect(vmExportProgressContract.resultSchema.parse({ ...downloading, phase: 'validating', validation: validating.validation })).toMatchObject({ validation: validating.validation })
    for (const invalidTransfer of [{ ...transfer, bytesTransferred: -1 }, { ...transfer, bytesTotal: 1.5 }, { ...transfer, elapsedMs: Number.NaN }, { ...transfer, secret: 'no' }]) {
      expect(() => vmExportProgressContract.resultSchema.parse({ ...downloading, transfer: invalidTransfer })).toThrow()
      expect(() => vmImportProgressContract.resultSchema.parse({ ...validating, transfer: invalidTransfer })).toThrow()
    }
    for (const invalidProgress of [-2, -0.5, 101, Number.NaN]) expect(() => vmExportProgressContract.resultSchema.parse({ ...downloading, progress: invalidProgress })).toThrow()
  })
})


describe('VM template creation plan IPC', () => {
  const disk = { templateVdiRef: '', srRef: 'OpaqueRef:sr', device: '0', sizeBytes: 10844792422, mode: 'RW' }
  const payload = { templateRef: 'OpaqueRef:template', vmName: 'VM', vmDescription: '', vcpus: 2,
    memoryBytes: 2147483648, installMode: 'url', installUrl: 'http://server/path', disks: [disk],
    vifs: [{ device: '0', networkRef: 'OpaqueRef:network', policy: { MTU: 9000, qos_algorithm_type: 'ratelimit',
      qos_algorithm_params: { kbps: '1024' }, locking_mode: 'locked', ipv4_allowed: ['192.0.2.1'], ipv6_allowed: [] } }], startAfter: false }
  it('accepts a selected template and validates plan and inherited policy DTOs', () => {
    expect(vmCreationResourcesContract.argsSchema.parse(['conn', 'OpaqueRef:template'])).toEqual(['conn', 'OpaqueRef:template'])
    expect(() => vmCreationResourcesContract.argsSchema.parse(['conn', undefined])).toThrow()
    const resources = { hosts: [], srs: [], networks: [], isos: [], templateDisks: [{ ...disk, srRef: '' }], templateCdCount: 1 }
    expect(vmCreationResourcesContract.resultSchema.parse(resources)).toEqual(resources)
    expect(vmCreateFromTemplateContract.argsSchema.parse(['conn', payload])[1]).toEqual(payload)
  })
  it('rejects fractional unsafe or nonpositive bytes before invoking the backend', () => {
    for (const value of [10844792422.4, Number.MAX_SAFE_INTEGER + 1, 0, -1]) {
      expect(() => vmCreateFromTemplateContract.argsSchema.parse(['conn', { ...payload, disks: [{ ...disk, sizeBytes: value }] }])).toThrow()
      expect(() => vmCreateFromTemplateContract.argsSchema.parse(['conn', { ...payload, memoryBytes: value }])).toThrow()
    }
    expect(() => vmCreateFromTemplateContract.argsSchema.parse(['conn', { ...payload, disks: [{ ...disk, srRef: 'OpaqueRef:NULL' }] }])).toThrow()
    expect(() => vmCreateFromTemplateContract.argsSchema.parse(['conn', { ...payload, vifs: [{ ...payload.vifs[0], policy: { ...payload.vifs[0].policy, locking_mode: 'unknown' } }] }])).toThrow()
    expect(() => vmCreateFromTemplateContract.argsSchema.parse(['conn', { ...payload, installMode: 'pxe' }])).toThrow()
  })
})
