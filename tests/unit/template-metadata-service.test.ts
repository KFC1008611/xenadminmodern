import { beforeEach, describe, expect, it, vi } from 'vitest'

const callWithSession = vi.fn()
const getClient = vi.fn(() => ({ callWithSession }))

vi.mock('../../src/main/xapi/connection-manager', () => ({
  connectionManager: { getClient },
}))

describe('template metadata', () => {
  beforeEach(() => vi.clearAllMocks())

  it('converts a halted VM and marks it for XenAdmin-compatible Quick Create', async () => {
    callWithSession
      .mockResolvedValueOnce({ is_a_template: false, power_state: 'Halted', current_operations: {} })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ is_a_template: true, other_config: { instant: 'true' } })
    const { convertVmToTemplate } = await import('../../src/main/xapi/services/template-metadata.service')
    await convertVmToTemplate({ callWithSession }, 'OpaqueRef:vm')
    expect(callWithSession.mock.calls.map(([method]) => method)).toEqual([
      'VM.get_record', 'VM.remove_from_other_config', 'VM.add_to_other_config', 'VM.set_is_a_template', 'VM.get_record',
    ])
  })

  it('refuses conversion while a VM is running or belongs to a vApp', async () => {
    const { convertVmToTemplate } = await import('../../src/main/xapi/services/template-metadata.service')
    await expect(convertVmToTemplate({ callWithSession }, 'OpaqueRef:running', {
      is_a_template: false, power_state: 'Running',
    })).rejects.toThrow('请先关闭虚拟机')
    await expect(convertVmToTemplate({ callWithSession }, 'OpaqueRef:vapp', {
      is_a_template: false, power_state: 'Halted', appliance: 'OpaqueRef:vapp',
    })).rejects.toThrow('vApp')
    expect(callWithSession).not.toHaveBeenCalled()
  })

  it('sets instant before converting a VM to a template and verifies the result', async () => {
    callWithSession
      .mockResolvedValueOnce({ is_a_template: false, is_a_snapshot: false, is_default_template: false, other_config: {} })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ is_a_template: true, other_config: { instant: 'true' } })
    const { ensureInstantTemplateMetadata } = await import('../../src/main/xapi/services/template-metadata.service')

    await ensureInstantTemplateMetadata({ callWithSession }, 'OpaqueRef:vm')

    expect(callWithSession.mock.calls.map(([method]) => method)).toEqual([
      'VM.get_record',
      'VM.remove_from_other_config',
      'VM.add_to_other_config',
      'VM.set_is_a_template',
      'VM.get_record',
    ])
    expect(callWithSession).toHaveBeenCalledWith('VM.add_to_other_config', ['OpaqueRef:vm', 'instant', 'true'])
  })

  it('does not write metadata that is already correct', async () => {
    const current = { is_a_template: true, other_config: { instant: 'true', keep: 'value' } }
    const { ensureInstantTemplateMetadata } = await import('../../src/main/xapi/services/template-metadata.service')

    expect(await ensureInstantTemplateMetadata({ callWithSession }, 'OpaqueRef:template', current)).toBe(current)
    expect(callWithSession).not.toHaveBeenCalled()
  })

  it('rejects direct metadata repair for system templates before mutation', async () => {
    const current = { is_a_template: true, is_default_template: true, other_config: {} }
    const { ensureInstantTemplateMetadata } = await import('../../src/main/xapi/services/template-metadata.service')

    await expect(ensureInstantTemplateMetadata({ callWithSession }, 'OpaqueRef:template', current))
      .rejects.toThrow('不能修改系统默认模板')
    expect(callWithSession).not.toHaveBeenCalled()
  })

  it('rejects snapshots at the shared metadata write boundary before mutation', async () => {
    const current = {
      is_a_template: true,
      is_a_snapshot: true,
      is_default_template: false,
      other_config: { instant: 'true' },
    }
    const { ensureInstantTemplateMetadata } = await import('../../src/main/xapi/services/template-metadata.service')

    await expect(ensureInstantTemplateMetadata({ callWithSession }, 'OpaqueRef:snapshot', current))
      .rejects.toThrow('快照模板不能启用快速创建')
    expect(callWithSession).not.toHaveBeenCalled()
  })

  it('rejects existing-template repair for non-templates, system templates, and snapshots', async () => {
    const { enableTemplateInstantCreate } = await import('../../src/main/xapi/services/template-metadata.service')
    for (const record of [
      { is_a_template: false, is_a_snapshot: false, is_default_template: false, other_config: {} },
      { is_a_template: true, is_a_snapshot: false, is_default_template: true, other_config: {} },
      { is_a_template: true, is_a_snapshot: true, is_default_template: false, other_config: {} },
    ]) {
      callWithSession.mockResolvedValueOnce(record)
      await expect(enableTemplateInstantCreate('conn', 'OpaqueRef:template')).rejects.toThrow()
    }
    expect(callWithSession).not.toHaveBeenCalledWith('VM.add_to_other_config', expect.anything())
  })

  it.each([
    { Locked: true }, { current_operations: { task: 'clone' } },
    { power_state: 'Running' }, { allowed_operations: [] },
    { blocked_operations: { clone: '禁止' } },
  ])('refuses enabling an ineligible existing template before metadata writes: %j', async (state) => {
    callWithSession.mockResolvedValueOnce({
      is_a_template: true, power_state: 'Halted', allowed_operations: ['clone'], other_config: {}, ...state,
    })
    const { enableTemplateInstantCreate } = await import('../../src/main/xapi/services/template-metadata.service')
    await expect(enableTemplateInstantCreate('conn', 'OpaqueRef:template')).rejects.toThrow()
    expect(callWithSession.mock.calls.map(([method]) => method)).toEqual(['VM.get_record'])
  })

  it('fails when the server read-back does not contain both required fields', async () => {
    callWithSession
      .mockResolvedValueOnce({ is_a_template: true, other_config: {} })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ is_a_template: true, other_config: {} })
    const { ensureInstantTemplateMetadata } = await import('../../src/main/xapi/services/template-metadata.service')
    await expect(ensureInstantTemplateMetadata({ callWithSession }, 'OpaqueRef:template'))
      .rejects.toThrow('即时模板元数据验证失败')
  })

  it('enables instant create through the public service and verifies the result', async () => {
    callWithSession
      .mockResolvedValueOnce({
        is_a_template: true,
        is_a_snapshot: false,
        is_default_template: false,
        power_state: 'Halted',
        allowed_operations: ['clone'],
        other_config: {},
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ is_a_template: true, other_config: { instant: 'true' } })
    const { enableTemplateInstantCreate } = await import('../../src/main/xapi/services/template-metadata.service')

    await expect(enableTemplateInstantCreate('conn', 'OpaqueRef:template')).resolves.toBeUndefined()

    expect(getClient).toHaveBeenCalledWith('conn')
    expect(callWithSession.mock.calls.map(([method]) => method)).toEqual([
      'VM.get_record',
      'VM.remove_from_other_config',
      'VM.add_to_other_config',
      'VM.get_record',
    ])
  })

  it('does not report public repair success when the read-back is missing instant metadata', async () => {
    callWithSession
      .mockResolvedValueOnce({
        is_a_template: true,
        is_a_snapshot: false,
        is_default_template: false,
        power_state: 'Halted',
        allowed_operations: ['clone'],
        other_config: {},
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ is_a_template: true, other_config: {} })
    const { enableTemplateInstantCreate } = await import('../../src/main/xapi/services/template-metadata.service')

    await expect(enableTemplateInstantCreate('conn', 'OpaqueRef:template'))
      .rejects.toThrow('即时模板元数据验证失败')
    expect(callWithSession.mock.calls.map(([method]) => method)).toEqual([
      'VM.get_record',
      'VM.remove_from_other_config',
      'VM.add_to_other_config',
      'VM.get_record',
    ])
  })
})
