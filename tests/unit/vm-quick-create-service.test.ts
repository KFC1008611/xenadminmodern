import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createXapiFailureError, describeTransportError } from '../../src/main/xapi/errors'
import { templateQuickCreateGuard } from '../../src/shared/template-quick-create'

const { call, client, getClient, info, journal } = vi.hoisted(() => {
  const call = vi.fn()
  const client = { callWithSession: call }
  return { call, client, getClient: vi.fn(() => client), info: { poolUuid: 'pool-a', epoch: 1 }, journal: { records: [] as any[] } }
})
vi.mock('../../src/main/xapi/connection-manager', () => ({ connectionManager: { getClient, getConnectionInfo: () => ({ ...info }) } }))
vi.mock('../../src/main/persistence/json-store', () => ({
  readJsonStore: () => structuredClone(journal.records),
  writeJsonStore: (_: string, value: any[]) => { journal.records = structuredClone(value) },
}))

const template = () => ({ uuid: 'template-uuid', name_label: 'Golden', is_a_template: true, is_a_snapshot: false,
  is_control_domain: false, is_default_template: false, power_state: 'Halted', current_operations: {},
  allowed_operations: ['clone'], other_config: { instant: 'true' } })
let source: any
let created: any
let tasks: Record<string, any>
let failMethod: string | undefined
let failError: any

beforeEach(() => {
  vi.resetModules()
  call.mockReset()
  getClient.mockReturnValue(client)
  info.poolUuid = 'pool-a'; info.epoch = 1
  journal.records = []
  source = template()
  created = { uuid: 'new-uuid', name_label: 'Golden', is_a_template: true, is_a_snapshot: false, is_control_domain: false,
    power_state: 'Halted', allowed_operations: ['start'], current_operations: {}, other_config: { instant: 'true' },
    VBDs: ['OpaqueRef:disk', 'OpaqueRef:cd'], VIFs: ['OpaqueRef:vif'], VCPUs_max: '4', memory_static_max: '4294967296' }
  tasks = {}
  failMethod = undefined; failError = undefined
  call.mockImplementation(async (method: string, params: any[]) => {
    if (method === failMethod) throw failError
    if (method === 'VM.get_record') return structuredClone(params[0] === 'OpaqueRef:template' ? source : created)
    if (method === 'VM.get_all_records') return { 'OpaqueRef:old': { name_label: 'Golden (1)' }, 'OpaqueRef:created': created }
    if (method === 'Async.VM.clone') {
      tasks['OpaqueRef:clone-task'] = { status: 'success', result: '<value><string>OpaqueRef:created</string></value>' }
      return 'OpaqueRef:clone-task'
    }
    if (method === 'Async.VM.provision') {
      created.is_a_template = false
      tasks['OpaqueRef:provision-task'] = { status: 'success' }
      return 'OpaqueRef:provision-task'
    }
    if (method === 'Async.VM.start') {
      created.power_state = 'Running'
      tasks['OpaqueRef:start-task'] = { status: 'success' }
      return 'OpaqueRef:start-task'
    }
    if (method === 'task.get_record') return tasks[params[0]]
    if (method === 'VM.set_name_label') created.name_label = params[1]
    if (method === 'VM.remove_from_other_config') delete created.other_config[params[1]]
    return undefined
  })
})
async function create(connectionId = 'conn') {
  const { quickCreateFromTemplate } = await import('../../src/main/xapi/services/vm-quick-create.service')
  return quickCreateFromTemplate(connectionId, 'OpaqueRef:template')
}
const mutations = () => call.mock.calls.filter(([method]) => method.startsWith('Async.') || method.startsWith('VM.set_') || method.startsWith('VM.remove_'))

describe('template Quick Create', () => {
  it('observes clone, provision and start tasks, names after provisioning and preserves template devices', async () => {
    const devices = structuredClone({ VBDs: created.VBDs, VIFs: created.VIFs, VCPUs_max: created.VCPUs_max, memory_static_max: created.memory_static_max })
    await expect(create()).resolves.toBe('OpaqueRef:created')
    expect(mutations().map(([method]) => method)).toEqual([
      'Async.VM.clone', 'Async.VM.provision', 'VM.set_name_label', 'VM.remove_from_other_config', 'Async.VM.start',
    ])
    expect(call).toHaveBeenCalledWith('Async.VM.start', ['OpaqueRef:created', false, false])
    expect(created).toMatchObject({ ...devices, name_label: 'Golden (2)', power_state: 'Running', is_a_template: false })
    expect(journal.records).toEqual([])
  })

  it.each([
    { other_config: {} }, { other_config: { instant: 'True' } }, { is_a_snapshot: true },
    { is_a_template: false }, { is_control_domain: true }, { is_default_template: true },
    { other_config: { instant: 'true', default_template: 'true' } }, { Locked: true },
    { current_operations: { task: 'copy' } }, { power_state: 'Running' },
    { allowed_operations: [] }, { allowed_operations: undefined }, { blocked_operations: { clone: '禁止' } },
  ])('rejects ineligible or stale template state before mutation: %j', async (changes) => {
    source = { ...source, ...changes }
    expect(templateQuickCreateGuard(source).canRun).toBe(false)
    await expect(create()).rejects.toMatchObject({ code: 'VM_QUICK_CREATE_PRECHECK_FAILED' })
    expect(mutations()).toEqual([])
    expect(journal.records).toEqual([])
  })

  it('checks eligibility without instant when explicitly enabling an existing template', () => {
    expect(templateQuickCreateGuard({ ...source, other_config: {} }, false)).toEqual({ canRun: true })
  })

  it('keeps the VM and reports creation separately when start is rejected', async () => {
    failMethod = 'Async.VM.start'; failError = createXapiFailureError(['HOST_NOT_ENOUGH_FREE_MEMORY'])
    await expect(create()).rejects.toMatchObject({ code: 'VM_CREATED_START_INCOMPLETE', details: { vmRef: 'OpaqueRef:created', creationComplete: true, outcome: 'partial' } })
    expect(created.power_state).toBe('Halted')
    expect(call).not.toHaveBeenCalledWith('VM.destroy', expect.anything())
    expect(journal.records).toEqual([])
  })

  it('retains a provisioned VM if starting is no longer allowed', async () => {
    created.allowed_operations = []
    await expect(create()).rejects.toMatchObject({ code: 'VM_CREATED_START_INCOMPLETE', details: { creationComplete: true, outcome: 'partial' } })
    expect(call).not.toHaveBeenCalledWith('Async.VM.start', expect.anything())
    expect(journal.records).toEqual([])
  })

  it('retains the clone on a definite provision task failure without starting or destroying it', async () => {
    const defaultCall = call.getMockImplementation()!
    call.mockImplementation(async (method, params) => {
      const result = await defaultCall(method, params)
      if (method === 'Async.VM.provision') tasks['OpaqueRef:provision-task'] = { status: 'failure', error_info: ['SR_FULL'] }
      return result
    })
    await expect(create()).rejects.toMatchObject({ code: 'VM_QUICK_CREATE_FAILED', details: { vmRef: 'OpaqueRef:created', outcome: 'failed' } })
    expect(call).not.toHaveBeenCalledWith('Async.VM.start', expect.anything())
    expect(call).not.toHaveBeenCalledWith('VM.destroy', expect.anything())
    expect(journal.records).toEqual([])
  })

  it('persists before submission and blocks a lost clone response across a service reload', async () => {
    failMethod = 'Async.VM.clone'; failError = describeTransportError({ code: 'ECONNRESET' })
    await expect(create()).rejects.toMatchObject({ code: 'VM_QUICK_CREATE_OUTCOME_UNKNOWN', details: { stage: 'clone', outcome: 'unknown' } })
    expect(journal.records).toMatchObject([{ poolUuid: 'pool-a', templateUuid: source.uuid, stage: 'clone' }])
    vi.resetModules()
    await expect(create()).rejects.toMatchObject({ code: 'VM_QUICK_CREATE_OUTCOME_UNKNOWN' })
    expect(call.mock.calls.filter(([method]) => method === 'Async.VM.clone')).toHaveLength(1)
  })

  it('reconciles the original successful start task after observation failure without resubmitting', async () => {
    const defaultCall = call.getMockImplementation()!
    call.mockImplementation(async (method, params) => {
      if (method === 'task.get_record' && params[0] === 'OpaqueRef:start-task') return { status: 'invalid' }
      return defaultCall(method, params)
    })
    await expect(create()).rejects.toMatchObject({ code: 'VM_CREATED_START_INCOMPLETE', details: { outcome: 'unknown', taskRef: 'OpaqueRef:start-task' } })
    call.mockImplementation(defaultCall)
    const mutationCount = mutations().length
    vi.resetModules()
    await expect(create()).resolves.toBe('OpaqueRef:created')
    expect(mutations()).toHaveLength(mutationCount)
    expect(journal.records).toEqual([])
  })

  it('resolves an uncertain clone into the existing retained template, without provision or a second clone', async () => {
    const defaultCall = call.getMockImplementation()!
    call.mockImplementation(async (method, params) => {
      if (method === 'task.get_record' && params[0] === 'OpaqueRef:clone-task') return { status: 'invalid' }
      return defaultCall(method, params)
    })
    await expect(create()).rejects.toMatchObject({ code: 'VM_QUICK_CREATE_OUTCOME_UNKNOWN' })
    call.mockImplementation(defaultCall)
    await expect(create()).rejects.toMatchObject({ code: 'VM_QUICK_CREATE_INCOMPLETE', details: { vmRef: 'OpaqueRef:created' } })
    expect(call.mock.calls.filter(([method]) => method.startsWith('Async.'))).toHaveLength(1)
    expect(journal.records).toEqual([])
  })

  it('rejects duplicate submissions across two connections to the same pool', async () => {
    let finish!: () => void
    const defaultCall = call.getMockImplementation()!
    call.mockImplementation(async (method, params) => {
      if (method === 'Async.VM.clone') await new Promise<void>((resolve) => { finish = resolve })
      return defaultCall(method, params)
    })
    const first = create('conn-a')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await expect(create('conn-b')).rejects.toMatchObject({ code: 'VM_QUICK_CREATE_IN_PROGRESS' })
    finish()
    await first
    expect(call.mock.calls.filter(([method]) => method === 'Async.VM.clone')).toHaveLength(1)
  })

  it('stops before any mutation when connection generation changes during preflight', async () => {
    const defaultCall = call.getMockImplementation()!
    call.mockImplementation(async (method, params) => {
      if (method === 'VM.get_record') info.epoch++
      return defaultCall(method, params)
    })
    await expect(create()).rejects.toThrow('管理连接已变化')
    expect(mutations()).toEqual([])
  })

  it('refuses a clone result that aliases the source template', async () => {
    const defaultCall = call.getMockImplementation()!
    call.mockImplementation(async (method, params) => {
      const result = await defaultCall(method, params)
      if (method === 'Async.VM.clone') tasks['OpaqueRef:clone-task'].result = 'OpaqueRef:template'
      return result
    })
    await expect(create()).rejects.toMatchObject({ code: 'VM_QUICK_CREATE_OUTCOME_UNKNOWN' })
    expect(call).not.toHaveBeenCalledWith('Async.VM.provision', expect.anything())
    expect(call).not.toHaveBeenCalledWith('VM.destroy', expect.anything())
  })

  it.each(['OpaqueRef:NULL', 'OpaqueRef:created OpaqueRef:other', '<value>no reference</value>'])(
    'retains an uncertain clone task with an invalid result, without follow-up writes: %s', async (result) => {
      const defaultCall = call.getMockImplementation()!
      call.mockImplementation(async (method, params) => {
        const value = await defaultCall(method, params)
        if (method === 'Async.VM.clone') tasks['OpaqueRef:clone-task'].result = result
        return value
      })
      await expect(create()).rejects.toMatchObject({ code: 'VM_QUICK_CREATE_OUTCOME_UNKNOWN', details: { taskRef: 'OpaqueRef:clone-task' } })
      await expect(create()).rejects.toMatchObject({ code: 'VM_QUICK_CREATE_OUTCOME_UNKNOWN' })
      expect(mutations().map(([method]) => method)).toEqual(['Async.VM.clone'])
    },
  )

  it('observes a provision completed after a lost response without resubmitting or starting it', async () => {
    const defaultCall = call.getMockImplementation()!
    call.mockImplementation(async (method, params) => {
      const result = await defaultCall(method, params)
      if (method === 'Async.VM.provision') throw describeTransportError({ code: 'ECONNRESET' })
      return result
    })
    await expect(create()).rejects.toMatchObject({ code: 'VM_QUICK_CREATE_OUTCOME_UNKNOWN', details: { stage: 'provision', vmRef: 'OpaqueRef:created' } })
    call.mockImplementation(defaultCall)
    vi.resetModules()
    await expect(create()).rejects.toMatchObject({ code: 'VM_QUICK_CREATE_INCOMPLETE', details: { outcome: 'partial' } })
    expect(mutations().map(([method]) => method)).toEqual(['Async.VM.clone', 'Async.VM.provision'])
    expect(journal.records).toEqual([])
  })

  it('does not claim completed Quick Create when an unfinished clone was manually provisioned and started', async () => {
    journal.records = [{ poolUuid: info.poolUuid, templateUuid: source.uuid, stage: 'clone', vmRef: 'OpaqueRef:created' }]
    created.is_a_template = false
    created.power_state = 'Running'
    await expect(create()).rejects.toMatchObject({ code: 'VM_QUICK_CREATE_INCOMPLETE' })
    expect(mutations()).toEqual([])
  })

  it('blocks invalid persisted VM identities before any mutation', async () => {
    journal.records = [{ poolUuid: info.poolUuid, templateUuid: source.uuid, stage: 'start', creationComplete: true, vmRef: 'OpaqueRef:created' }]
    await expect(create()).rejects.toThrow('快速创建记录无效')
    expect(mutations()).toEqual([])
  })

  it('stops after clone submission when connection identity changes and retains the task for the original pool', async () => {
    const defaultCall = call.getMockImplementation()!
    call.mockImplementation(async (method, params) => {
      const result = await defaultCall(method, params)
      if (method === 'Async.VM.clone') info.epoch++
      return result
    })
    await expect(create()).rejects.toMatchObject({ code: 'VM_QUICK_CREATE_OUTCOME_UNKNOWN', details: { poolUuid: 'pool-a', taskRef: 'OpaqueRef:clone-task' } })
    expect(mutations().map(([method]) => method)).toEqual(['Async.VM.clone'])
  })
})
