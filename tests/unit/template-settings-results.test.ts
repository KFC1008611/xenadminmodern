import { beforeEach, describe, expect, it, vi } from 'vitest'
import { updateTemplateSettings } from '../../src/main/xapi/services/vm.service'
import { toIpcErrorResponse } from '../../src/main/ipc/ipc-error'

const mocks = vi.hoisted(() => {
  const callWithSession = vi.fn()
  const client = { callWithSession }
  return { callWithSession, client, getClient: vi.fn(() => client) }
})
vi.mock('../../src/main/xapi/connection-manager', () => ({ connectionManager: {
  getClient: mocks.getClient, getConnectionInfo: () => ({ poolUuid: 'pool-uuid', epoch: 1 }),
} }))
vi.mock('../../src/main/xapi/services/vm-copy.service', () => ({ startVmCopy: vi.fn() }))

const GIB = 1024 ** 3
let record: Record<string, any>
let afterWrite: ((method: string) => void) | undefined
let readFailure: Error | undefined

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getClient.mockReturnValue(mocks.client)
  record = { uuid: 'template-uuid', is_a_template: true, is_a_snapshot: false, power_state: 'Halted',
    name_label: 'Original', name_description: '', VCPUs_max: '8', VCPUs_at_startup: '8', current_operations: {},
    memory_static_min: GIB, memory_dynamic_min: GIB, memory_dynamic_max: 4 * GIB, memory_static_max: 4 * GIB }
  afterWrite = undefined
  readFailure = undefined
  mocks.callWithSession.mockImplementation(async (method: string, args: any[]) => {
    if (method === 'VM.get_record') {
      if (readFailure) throw readFailure
      return { ...record }
    }
    if (method === 'VM.set_VCPUs_max') {
      if (args[1] < Number(record.VCPUs_at_startup)) throw new Error('VCPUs_max must be >= VCPUs_at_startup')
      record.VCPUs_max = args[1]
    } else if (method === 'VM.set_VCPUs_at_startup') {
      if (args[1] > Number(record.VCPUs_max)) throw new Error('VCPUs_at_startup must be <= VCPUs_max')
      record.VCPUs_at_startup = args[1]
    } else if (method === 'VM.set_name_label') record.name_label = args[1]
    else if (method === 'VM.set_name_description') record.name_description = args[1]
    else if (method === 'VM.set_memory_limits') {
      ;[record.memory_static_min, record.memory_static_max, record.memory_dynamic_min, record.memory_dynamic_max] = args.slice(1).map(Number)
    } else throw new Error(`Unexpected method ${method}`)
    afterWrite?.(method)
    return null
  })
})

describe('template settings with XAPI constraints and result readback', () => {
  it('lowers startup vCPUs before lowering the maximum', async () => {
    await updateTemplateSettings('pool', { templateRef: 'template', vcpusMax: 2, vcpusAtStartup: 2 })
    expect(record).toMatchObject({ VCPUs_max: 2, VCPUs_at_startup: 2 })
    expect(mocks.callWithSession.mock.calls.filter(([method]) => method.startsWith('VM.set_')).map(([method]) => method))
      .toEqual(['VM.set_VCPUs_at_startup', 'VM.set_VCPUs_max'])
    expect(mocks.callWithSession.mock.calls.at(-1)?.[0]).toBe('VM.get_record')
  })

  it('rejects an invalid CPU target before changing the name', async () => {
    await expect(updateTemplateSettings('pool', { templateRef: 'template', nameLabel: 'Changed', vcpusMax: 2 }))
      .rejects.toThrow(/VCPU|vCPU/)
    expect(record.name_label).toBe('Original')
    expect(mocks.callWithSession.mock.calls.some(([method]) => method.startsWith('VM.set_'))).toBe(false)
  })

  it('validates memory bounds before applying any fields', async () => {
    await expect(updateTemplateSettings('pool', { templateRef: 'template', nameLabel: 'Changed', memoryDynamicMax: 8 * GIB }))
      .rejects.toThrow(/内存/)
    expect(record.name_label).toBe('Original')
  })

  it('continues after a lost acknowledgement only when the written field is read back', async () => {
    afterWrite = (method) => {
      if (method === 'VM.set_name_label') throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
    }
    await updateTemplateSettings('pool', { templateRef: 'template', nameLabel: 'Changed', nameDescription: 'Description' })
    expect(record).toMatchObject({ name_label: 'Changed', name_description: 'Description' })
    expect(mocks.callWithSession.mock.calls.filter(([method]) => method === 'VM.set_name_label')).toHaveLength(1)
  })

  it('does not report success when the readback differs from the submitted value', async () => {
    afterWrite = () => { record.name_label = 'Original' }
    await expect(updateTemplateSettings('pool', { templateRef: 'template', nameLabel: 'Changed' })).rejects.toThrow(/名称/)
  })

  it('rejects a VM that is no longer a template before writing', async () => {
    record.is_a_template = false
    await expect(updateTemplateSettings('pool', { templateRef: 'template', nameLabel: 'Changed' })).rejects.toThrow(/模板/)
    expect(record.name_label).toBe('Original')
  })

  it('does not accept a replacement object as the saved template', async () => {
    afterWrite = () => { record.uuid = 'replacement-uuid' }
    await expect(updateTemplateSettings('pool', { templateRef: 'template', nameLabel: 'Changed' })).rejects.toThrow(/身份|对象|连接/)
  })

  it('reports a partial save without replaying successful fields', async () => {
    afterWrite = (method) => {
      if (method === 'VM.set_name_description') {
        record.name_description = ''
        throw Object.assign(new Error('permission denied'), { code: 'RBAC_PERMISSION_DENIED' })
      }
    }
    await expect(updateTemplateSettings('pool', { templateRef: 'template', nameLabel: 'Changed', nameDescription: 'New description' }))
      .rejects.toMatchObject({ code: 'TEMPLATE_SETTINGS_PARTIAL', message: expect.stringContaining('简介') })
    expect(record.name_label).toBe('Changed')
    expect(mocks.callWithSession.mock.calls.filter(([method]) => method === 'VM.set_name_label')).toHaveLength(1)
  })

  it('preserves the result read failure code across IPC when the connection changes between writes', async () => {
    afterWrite = () => { mocks.getClient.mockReturnValue(undefined as any) }
    const failure = await updateTemplateSettings('pool', {
      templateRef: 'template', nameLabel: 'Changed', nameDescription: 'Description',
    }).then(() => { throw new Error('Expected the interrupted save to fail') }, toIpcErrorResponse)

    expect(failure).toMatchObject({
      error: true, code: 'RESOURCE_RESULT_READ_FAILED', message: expect.stringContaining('管理连接已变化'),
    })
    expect(record).toMatchObject({ name_label: 'Changed', name_description: '' })
    expect(mocks.callWithSession.mock.calls.filter(([method]) => method.startsWith('VM.set_')))
      .toEqual([['VM.set_name_label', ['template', 'Changed']]])
    expect(mocks.callWithSession.mock.calls.filter(([method]) => method === 'VM.get_record')).toHaveLength(1)
  })

  it('reports persistent read failure and never repeats the write', async () => {
    vi.useFakeTimers()
    try {
      afterWrite = () => { readFailure = new Error('read connection lost') }
      const assertion = expect(updateTemplateSettings('pool', { templateRef: 'template', nameLabel: 'Changed' }))
        .rejects.toMatchObject({ code: 'RESOURCE_RESULT_READ_FAILED', message: expect.stringContaining('read connection lost') })
      await vi.runAllTimersAsync()
      await assertion
      expect(mocks.callWithSession.mock.calls.filter(([method]) => method === 'VM.get_record')).toHaveLength(4)
      expect(mocks.callWithSession.mock.calls.filter(([method]) => method === 'VM.set_name_label')).toHaveLength(1)
    } finally { vi.useRealTimers() }
  })

  it('does not continue to the next field if a lost reply cannot be verified', async () => {
    afterWrite = () => {
      record.name_label = 'Original'
      throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
    }
    await expect(updateTemplateSettings('pool', { templateRef: 'template', nameLabel: 'Changed', nameDescription: 'Description' }))
      .rejects.toMatchObject({ code: 'TEMPLATE_SETTINGS_PARTIAL' })
    expect(mocks.callWithSession).not.toHaveBeenCalledWith('VM.set_name_description', expect.anything())
  })

  it('rejects a locked template before changing any fields', async () => {
    record.locked = true
    await expect(updateTemplateSettings('pool', { templateRef: 'template', nameLabel: 'Changed' })).rejects.toThrow('不能修改设置')
    expect(record.name_label).toBe('Original')
  })
})
