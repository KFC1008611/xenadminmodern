import { describe, expect, it } from 'vitest'
import { canRunVmAction, canRunVmExport, type VmActionRecord } from '../../src/renderer/src/lib/vmActionGuard'

function vm(overrides: Partial<VmActionRecord> = {}): VmActionRecord {
  return {
    power_state: 'Halted',
    is_a_template: false,
    is_control_domain: false,
    ...overrides,
  }
}

describe('canRunVmAction', () => {
  it('allows start for a halted VM with the required XAPI operation', () => {
    expect(canRunVmAction(vm({ allowed_operations: ['start'] }), 'start')).toEqual({ canRun: true })
  })

  it('blocks start for a running VM', () => {
    const result = canRunVmAction(vm({ power_state: 'Running', allowed_operations: ['start'] }), 'start')
    expect(result.canRun).toBe(false)
    expect(result.reason).toContain('已停止')
  })

  it('blocks actions on templates and control domains', () => {
    expect(canRunVmAction(vm({ is_a_template: true }), 'delete').canRun).toBe(false)
    expect(canRunVmAction(vm({ is_control_domain: true }), 'shutdown').canRun).toBe(false)
  })

  it('blocks when the required allowed operation is missing', () => {
    const result = canRunVmAction(vm({ allowed_operations: ['clean_shutdown'] }), 'delete')
    expect(result.canRun).toBe(false)
    expect(result.reason).toContain('XAPI')
  })

  it('blocks actions while allowed operations are missing or empty', () => {
    expect(canRunVmAction(vm(), 'start').canRun).toBe(false)
    expect(canRunVmAction(vm({ allowed_operations: [] }), 'start').canRun).toBe(false)
  })

  it('allows pause only for running VMs with pause operation', () => {
    expect(canRunVmAction(vm({ power_state: 'Running', allowed_operations: ['pause'] }), 'pause')).toEqual({ canRun: true })
    expect(canRunVmAction(vm({ power_state: 'Halted', allowed_operations: ['pause'] }), 'pause').canRun).toBe(false)
  })

  it('allows unpause only for paused VMs with unpause operation', () => {
    expect(canRunVmAction(vm({ power_state: 'Paused', allowed_operations: ['unpause'] }), 'unpause')).toEqual({ canRun: true })
    expect(canRunVmAction(vm({ power_state: 'Running', allowed_operations: ['unpause'] }), 'unpause').canRun).toBe(false)
  })

  it('requires a stopped source and follows XAPI copy capabilities', () => {
    expect(canRunVmAction(vm({ power_state: 'Halted', allowed_operations: ['clone'] }), 'copy')).toEqual({ canRun: true })
    expect(canRunVmAction(vm({ power_state: 'Halted', allowed_operations: ['copy'] }), 'copy')).toEqual({ canRun: true })
    expect(canRunVmAction(vm({ power_state: 'Running', allowed_operations: ['copy'] }), 'copy').canRun).toBe(false)
    expect(canRunVmAction(vm({ power_state: 'Running', allowed_operations: ['export'] }), 'copy').canRun).toBe(false)
    expect(canRunVmAction(vm({ power_state: 'Suspended', allowed_operations: ['copy'] }), 'copy').canRun).toBe(false)
  })

  it('blocks while another operation is running', () => {
    const result = canRunVmAction(vm({ current_operations: { 'OpaqueRef:task': 'start' } }), 'start')
    expect(result.canRun).toBe(false)
    expect(result.reason).toContain('正在执行')
  })

  it('uses XAPI blocked operation reasons when available', () => {
    const result = canRunVmAction(
      vm({
        allowed_operations: ['destroy'],
        blocked_operations: { destroy: 'VM is protected by HA' },
      }),
      'delete',
    )
    expect(result).toEqual({ canRun: false, reason: 'VM is protected by HA' })
  })

  it('enables reboot and force shutdown when the VM permits them', () => {
    for (const action of ['reboot', 'forceShutdown'] as const) {
      expect(canRunVmAction(vm({ power_state: 'Running', allowed_operations: ['clean_reboot', 'hard_shutdown'] }), action).canRun).toBe(true)
    }
  })
  it('opens running export through its preparation capabilities rather than direct export', () => {
    const live = vm({ power_state: 'Running', allowed_operations: ['checkpoint'] })
    expect(canRunVmAction(live, 'export').canRun).toBe(true)
    expect(canRunVmExport(live, 'shutdown').canRun).toBe(false)
    expect(canRunVmExport(live, 'snapshot').canRun).toBe(true)
    expect(canRunVmExport(live, 'force').canRun).toBe(false)
    expect(canRunVmAction({ ...live, allowed_operations: ['clean_shutdown'] }, 'export').canRun).toBe(true)
    expect(canRunVmAction({ ...live, allowed_operations: ['export'] }, 'export').canRun).toBe(false)
  })
  it('keeps force shutdown available for paused, suspended and busy VMs only when XAPI permits it', () => {
    for (const power_state of ['Paused', 'Suspended', 'Running']) {
      expect(canRunVmAction(vm({ power_state, current_operations: { task: 'start' }, allowed_operations: ['hard_shutdown'] }), 'forceShutdown').canRun).toBe(true)
      expect(canRunVmAction(vm({ power_state, allowed_operations: [] }), 'forceShutdown').canRun).toBe(false)
    }
  })
  it('requires snapshot itself and respects blockers on the chosen export mode', () => {
    const live = vm({ power_state: 'Running', allowed_operations: ['checkpoint', 'clean_shutdown'], blocked_operations: { checkpoint: '禁止检查点' } })
    expect(canRunVmAction(live, 'snapshot').canRun).toBe(false)
    expect(canRunVmAction(live, 'export').canRun).toBe(true)
    expect(canRunVmExport(live, 'snapshot')).toEqual({ canRun: false, reason: '禁止检查点' })
  })
})
