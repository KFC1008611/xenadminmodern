import { describe, expect, it } from 'vitest'
import {
  batchCancelContract,
  batchGetStatusContract,
  batchListContract,
  batchProgressContract,
  batchRetryContract,
  batchSubmitContract,
  consoleCloseContract,
  consoleGetUrlContract,
  dialogShowOpenContract,
  dialogShowSaveContract,
  infrastructureContracts,
  infrastructureInvokeContracts,
  poolAddHostContract,
  poolGetContract,
  poolRemoveHostContract,
  poolTransferMasterContract,
  profileDeleteContract,
  profileHasPasswordContract,
  profileConnectContract,
  profileListContract,
  profileSaveContract,
  taskCancelContract,
  taskListContract,
  vmConsoleContract,
} from '../../src/shared/ipc-contracts/infrastructure'

const poolRecord = {
  ref: 'OpaqueRef:pool',
  uuid: 'pool-uuid',
  name_label: 'Lab Pool',
  name_description: '',
  master: 'OpaqueRef:host',
  default_SR: 'OpaqueRef:NULL',
  ha_enabled: false,
  connectionId: 'pool-1',
  xapi_extension: { generation: 3 },
}

const taskRecord = {
  ref: 'OpaqueRef:task',
  uuid: 'task-uuid',
  name_label: 'VM.start',
  name_description: 'Starting VM',
  status: 'pending' as const,
  progress: 0.5,
  created: '20260802T000000Z',
  finished: '',
  error_info: [],
  connectionId: 'pool-1',
  poolName: 'Lab Pool',
  xapi_extension: true,
}

describe('infrastructure IPC contracts', () => {
  it('declares the literal 21 invoke channels plus the one-way batch push', () => {
    expect(infrastructureInvokeContracts.map(({ channel }) => channel)).toEqual([
      'pool:get',
      'pool:addHost',
      'pool:removeHost',
      'pool:transferMaster',
      'task:list',
      'task:cancel',
      'profile:list',
      'profile:save',
      'profile:delete',
      'profile:hasPassword',
      'profile:connect',
      'vm:console',
      'console:getUrl',
      'console:close',
      'dialog:showOpenDialog',
      'dialog:showSaveDialog',
      'batch:submit',
      'batch:cancel',
      'batch:getStatus',
      'batch:list',
      'batch:retry',
    ])
    expect(infrastructureContracts).toEqual([
      ...infrastructureInvokeContracts,
      batchProgressContract,
    ])
    expect(new Set(infrastructureContracts.map(({ channel }) => channel))).toHaveLength(22)
    for (const contract of infrastructureInvokeContracts) {
      expect(contract).toMatchObject({
        direction: 'invoke',
        callerPolicy: 'app-window-main-frame',
        errorShape: 'ipc-error-response-v1',
      })
    }
    expect(batchProgressContract).toMatchObject({
      channel: 'batch:progress',
      direction: 'push',
      callerPolicy: 'main-process',
      resultSchema: null,
      errorShape: null,
      redaction: ['none'],
    })
    expect(profileSaveContract.redaction).toEqual(['credentials'])
    expect(consoleCloseContract.redaction).toEqual(['session'])
  })

  it('defines strict pool and resource-pool task invokes without changing raw results', () => {
    expect([
      poolGetContract,
      poolAddHostContract,
      poolRemoveHostContract,
      poolTransferMasterContract,
      taskListContract,
      taskCancelContract,
    ].map(({ channel, direction }) => [channel, direction])).toEqual([
      ['pool:get', 'invoke'],
      ['pool:addHost', 'invoke'],
      ['pool:removeHost', 'invoke'],
      ['pool:transferMaster', 'invoke'],
      ['task:list', 'invoke'],
      ['task:cancel', 'invoke'],
    ])

    expect(poolGetContract.argsSchema.parse(['pool-1'])).toEqual(['pool-1'])
    expect(poolGetContract.resultSchema.parse(poolRecord)).toBe(poolRecord)
    expect(poolGetContract.resultSchema.parse(null)).toBeNull()
    expect(taskListContract.resultSchema.parse([taskRecord])).toEqual([taskRecord])
    expect(taskCancelContract.resultSchema.parse({ status: 'cancelled', message: '任务已取消' })).toEqual({ status: 'cancelled', message: '任务已取消' })
    expect(() => taskCancelContract.resultSchema.parse(undefined)).toThrow()
    expect(() => taskCancelContract.resultSchema.parse({ status: 'pending', message: '等待' })).toThrow()

    expect(() => poolGetContract.argsSchema.parse(['pool-1', 'extra'])).toThrow()
    expect(() => poolGetContract.resultSchema.parse({ ref: 'OpaqueRef:pool' })).toThrow()
    expect(() => poolGetContract.resultSchema.parse({
      ...poolRecord,
      ha_enabled: undefined,
      HA_enabled: false,
    })).toThrow()
    expect(() => taskListContract.resultSchema.parse([{ ...taskRecord, status: 'unknown' }])).toThrow()
    expect(() => taskCancelContract.argsSchema.parse(['pool-1', 'OpaqueRef:NULL'])).toThrow()
  })

  it('validates pool mutations and classifies only join credentials as secret', () => {
    const join = {
      targetHost: '192.0.2.20',
      username: 'root',
      password: 'pool-password',
      masterAddress: '192.0.2.10',
      forceJoin: undefined,
    }
    expect(poolAddHostContract.argsSchema.parse(['pool-1', join])).toEqual(['pool-1', join])
    expect(poolAddHostContract.resultSchema.parse('OpaqueRef:task')).toBe('OpaqueRef:task')
    expect(poolRemoveHostContract.resultSchema.parse('OpaqueRef:eject-task')).toBe('OpaqueRef:eject-task')
    expect(poolTransferMasterContract.resultSchema.parse('OpaqueRef:transfer-task')).toBe('OpaqueRef:transfer-task')
    expect(poolAddHostContract.redaction).toEqual(['credentials'])
    expect(poolRemoveHostContract.redaction).toEqual(['none'])

    expect(() => poolAddHostContract.argsSchema.parse([
      'pool-1',
      { ...join, unexpected: true },
    ])).toThrow()
    expect(() => poolAddHostContract.argsSchema.parse([
      'pool-1',
      { ...join, forceJoin: 'yes' },
    ])).toThrow()
    expect(() => poolRemoveHostContract.resultSchema.parse({ taskRef: 'OpaqueRef:task' })).toThrow()
  })

  it('validates saved server profiles and VM console records', () => {
    const profile = {
      id: 'profile-1',
      name: 'Lab',
      host: '192.0.2.10',
      port: 443,
      scheme: 'https:' as const,
      username: 'root',
      lastConnected: null,
      autoConnect: undefined,
      allowSelfSigned: true,
    }
    const consoleRecord = {
      ref: 'OpaqueRef:console',
      location: 'https://192.0.2.10/console?ref=vm',
      protocol: 'rfb',
      xapi_extension: 'preserved',
    }

    expect(profileListContract.resultSchema.parse([profile])).toEqual([profile])
    expect(profileSaveContract.argsSchema.parse([profile, ''])).toEqual([profile, ''])
    expect(profileHasPasswordContract.resultSchema.parse(false)).toBe(false)
    expect(() => profileHasPasswordContract.resultSchema.parse('secret')).toThrow()
    expect(profileConnectContract.resultSchema.parse({ id: 'profile-1' })).toEqual({ id: 'profile-1' })
    expect(() => profileConnectContract.resultSchema.parse({ id: 'profile-1', password: 'secret' })).toThrow()
    expect(profileDeleteContract.resultSchema.parse(undefined)).toBeUndefined()
    expect(vmConsoleContract.resultSchema.parse([consoleRecord])).toEqual([consoleRecord])
    expect(consoleGetUrlContract.resultSchema.parse({
      wsUrl: 'ws://127.0.0.1:1234/console',
      sessionId: 'session-1',
    })).toEqual({ wsUrl: 'ws://127.0.0.1:1234/console', sessionId: 'session-1' })

    expect(() => profileSaveContract.argsSchema.parse([
      { ...profile, password: 'must-not-be-stored-here' },
      'secret',
    ])).toThrow()
    expect(() => profileListContract.resultSchema.parse([
      { ...profile, port: 70_000 },
    ])).toThrow()
    expect(() => vmConsoleContract.resultSchema.parse([
      { ref: 'OpaqueRef:console', location: '', protocol: 'rfb' },
    ])).toThrow()
    expect(() => consoleGetUrlContract.resultSchema.parse({
      wsUrl: 'ws://127.0.0.1:1234/console',
      sessionId: 'session-1',
      credential: 'leak',
    })).toThrow()
  })

  it('accepts omitted desktop dialog options and validates exact options and results', () => {
    const openOptions = {
      title: undefined,
      defaultPath: '/tmp',
      properties: ['openFile', 'multiSelections'] as const,
      filters: [{ name: 'XVA', extensions: ['xva'] }],
    }
    const saveOptions = {
      title: 'Export VM',
      defaultPath: '/tmp/vm.xva',
      filters: [{ name: 'XVA', extensions: ['xva'] }],
    }

    expect(dialogShowOpenContract.argsSchema.parse([])).toEqual([undefined])
    expect(dialogShowOpenContract.argsSchema.parse([undefined])).toEqual([undefined])
    expect(dialogShowOpenContract.argsSchema.parse([openOptions])).toEqual([openOptions])
    expect(dialogShowSaveContract.argsSchema.parse([saveOptions])).toEqual([saveOptions])
    expect(dialogShowOpenContract.resultSchema.parse({
      canceled: false,
      filePaths: ['/tmp/a.xva'],
      bookmarks: undefined,
    })).toEqual({ canceled: false, filePaths: ['/tmp/a.xva'], bookmarks: undefined })
    expect(dialogShowSaveContract.resultSchema.parse({
      canceled: true,
      filePath: '',
      bookmark: undefined,
    })).toEqual({ canceled: true, filePath: '', bookmark: undefined })

    expect(() => dialogShowOpenContract.argsSchema.parse([null])).toThrow()
    expect(() => dialogShowOpenContract.argsSchema.parse([
      { ...openOptions, unexpected: true },
    ])).toThrow()
    expect(() => dialogShowOpenContract.argsSchema.parse([
      { properties: ['openFile', 'recursive'] },
    ])).toThrow()
    expect(() => dialogShowSaveContract.resultSchema.parse({ canceled: true })).toThrow()
    expect(() => dialogShowSaveContract.resultSchema.parse({
      canceled: false,
      filePath: '/tmp/vm.xva',
      extra: true,
    })).toThrow()
  })

  it('validates batch discriminators, stored task shapes, and progress pushes', () => {
    const target = {
      connectionId: 'pool-1',
      vmRef: 'OpaqueRef:vm',
      vmName: 'VM 1',
      intent: { vmUuid: 'vm', poolUuid: 'pool', epoch: 1 },
    }
    const input = {
      requestId: 'submit-1',
      type: 'stop' as const,
      targets: [target],
      options: { force: undefined },
    }
    const task = {
      id: 'task-1',
      type: 'stop' as const,
      targets: [target],
      options: { force: true },
      status: 'running' as const,
      progress: {
        total: 1,
        completed: 0,
        failed: 0,
        currentItem: undefined,
      },
      createdAt: 100,
      startedAt: 101,
    }
    const item = {
      id: 'item-1',
      taskId: 'task-1',
      connectionId: 'pool-1',
      vmRef: 'OpaqueRef:vm',
      vmName: 'VM 1',
      status: 'failed' as const,
      error: undefined,
      retryCount: 1,
    }
    const event = {
      taskId: 'task-1',
      status: 'running' as const,
      progress: task.progress,
      currentResult: {
        vmRef: 'OpaqueRef:vm',
        vmName: 'VM 1',
        success: false,
        error: undefined,
      },
    }

    expect(batchSubmitContract.argsSchema.parse([{ ...input, type: 'snapshot', options: { snapshotName: 'before-update' } }])[0].type).toBe('snapshot')
    expect(batchSubmitContract.argsSchema.parse([{ ...input, type: 'delete', options: { deleteDisks: true } }])[0].options).toEqual({ deleteDisks: true })
    for (const type of ['pause', 'unpause']) expect(batchSubmitContract.argsSchema.parse([{ ...input, type, options: undefined }])[0].type).toBe(type)
    expect(() => batchSubmitContract.argsSchema.parse([{ ...input, options: { deleteDisks: true } }])).toThrow()
    expect(batchGetStatusContract.resultSchema.parse({ ...task, status: 'unknown', items: [{ ...item, status: 'unknown' }] }).status).toBe('unknown')
    expect(batchProgressContract.argsSchema.parse([{ ...event, status: 'cancel-requested' }])[0].status).toBe('cancel-requested')
    expect(batchSubmitContract.argsSchema.parse([input])).toEqual([input])
    expect(batchSubmitContract.resultSchema.parse({ taskId: 'task-1' }))
      .toEqual({ taskId: 'task-1' })
    expect(batchListContract.resultSchema.parse([task])).toEqual([task])
    expect(batchGetStatusContract.resultSchema.parse({ ...task, items: [item] }))
      .toEqual({ ...task, items: [item] })
    expect(batchProgressContract.argsSchema.parse([event])).toEqual([event])
    expect(batchCancelContract.resultSchema.parse(undefined)).toBeUndefined()
    expect(batchRetryContract.resultSchema.parse(undefined)).toBeUndefined()

    expect(() => batchSubmitContract.argsSchema.parse([{
      requestId: 'submit-1',
      type: 'migrate',
      targets: [target],
      options: { force: undefined, targetHostRef: 'OpaqueRef:host' },
    }])).toThrow(/不支持批量/)
    expect(() => batchSubmitContract.argsSchema.parse([{
      type: 'migrate', targets: [target], options: undefined,
    }])).toThrow()
    expect(() => batchSubmitContract.argsSchema.parse([{
      type: 'start', targets: [target], options: { force: true },
    }])).toThrow()
    expect(() => batchSubmitContract.argsSchema.parse([{
      type: 'stop', targets: [], options: { force: false },
    }])).toThrow()
    expect(() => batchSubmitContract.argsSchema.parse([{
      type: 'delete', targets: [target], options: { targetHostRef: 'OpaqueRef:host' },
    }])).toThrow()
    expect(() => batchGetStatusContract.resultSchema.parse({
      ...task,
      items: [{ ...item, status: 'invalid-status' }],
    })).toThrow()
    expect(() => batchProgressContract.argsSchema.parse([{
      ...event,
      status: 'pending',
    }])).toThrow()
  })

  it('requires a request identity and complete VM intent for new batch submissions', () => {
    const target = { connectionId: 'pool-1', vmRef: 'OpaqueRef:vm', vmName: 'VM' }
    expect(() => batchSubmitContract.argsSchema.parse([{ type: 'start', targets: [target] }])).toThrow()
    expect(() => batchSubmitContract.argsSchema.parse([{ requestId: 'new', type: 'start', targets: [target] }])).toThrow(/完整身份/)
    const input = { requestId: 'new', type: 'stop', targets: [{ ...target, intent: { vmUuid: 'vm', poolUuid: 'pool', epoch: 1 } }] }
    expect(() => batchSubmitContract.argsSchema.parse([{ ...input, options: { force: true } }])).toThrow(/不支持强制断电/)
    expect(batchSubmitContract.argsSchema.parse([input])).toEqual([input])
  })

  it('requires exact reviewed retry attempts and rejects missing or repeated item identities', () => {
    expect(() => batchRetryContract.argsSchema.parse(['task'])).toThrow()
    const confirmation = { requestId: 'retry', items: [{ id: 'item', retryCount: 1 }] }
    expect(batchRetryContract.argsSchema.parse(['task', confirmation])).toEqual(['task', confirmation])
    expect(() => batchRetryContract.argsSchema.parse(['task', { ...confirmation, items: [] }])).toThrow()
    expect(() => batchRetryContract.argsSchema.parse(['task', { ...confirmation, items: [confirmation.items[0], confirmation.items[0]] }])).toThrow()
  })
})
