import type { VmRecord } from './types/xapi'

export type VmPowerAction = 'start' | 'shutdown' | 'reboot' | 'forceShutdown' | 'pause' | 'unpause' | 'suspend' | 'resume'
export type VmAction = VmPowerAction | 'snapshot' | 'export' | 'copy' | 'delete'
export type VmExportMode = 'shutdown' | 'snapshot' | 'force'
export interface VmActionGuardResult { canRun: boolean; reason?: string }
export type VmActionRecord = Pick<VmRecord,
  'is_a_template' | 'is_a_snapshot' | 'is_control_domain' | 'allowed_operations' |
  'current_operations' | 'blocked_operations' | 'locked' | 'Locked'
> & { power_state?: string }

export const VM_POWER_OPERATIONS: Record<VmPowerAction, { operation: string; state: string; label: string }> = {
  start: { operation: 'start', state: 'Running', label: '启动' },
  shutdown: { operation: 'clean_shutdown', state: 'Halted', label: '正常关闭' },
  reboot: { operation: 'clean_reboot', state: 'Running', label: '重启' },
  forceShutdown: { operation: 'hard_shutdown', state: 'Halted', label: '强制关闭' },
  pause: { operation: 'pause', state: 'Paused', label: '暂停' },
  unpause: { operation: 'unpause', state: 'Running', label: '继续运行' },
  suspend: { operation: 'suspend', state: 'Suspended', label: '挂起' },
  resume: { operation: 'resume', state: 'Running', label: '从挂起恢复' },
}

function operationGuard(vm: VmActionRecord, operation: string): VmActionGuardResult {
  if (Object.hasOwn(vm.blocked_operations ?? {}, operation)) {
    return { canRun: false, reason: vm.blocked_operations?.[operation] || '管理员已禁止该操作' }
  }
  if (!Array.isArray(vm.allowed_operations)) return { canRun: false, reason: '尚未读取到可用操作，请刷新 VM 状态' }
  if (!vm.allowed_operations.includes(operation)) {
    const reason = operation === 'clean_shutdown' || operation === 'clean_reboot'
      ? 'XAPI 当前未允许客户机正常关机或重启，请检查 Guest Tools 与客户机电源能力'
      : 'XAPI 当前不允许该操作，请刷新状态并检查客户机能力'
    return { canRun: false, reason }
  }
  return { canRun: true }
}

function objectGuard(vm: VmActionRecord, allowTemplate = false, allowSnapshot = false): VmActionGuardResult | null {
  if (vm.is_a_template && !allowTemplate) return { canRun: false, reason: '模板不能执行该 VM 操作' }
  if (vm.is_a_snapshot && !allowSnapshot) return { canRun: false, reason: '请从快照管理中操作该快照' }
  if (vm.is_control_domain) return { canRun: false, reason: '控制域不能执行该操作' }
  if (vm.locked || vm.Locked) return { canRun: false, reason: 'VM 已锁定，当前不能操作' }
  return null
}

export function canRunVmExport(vm: VmActionRecord, mode: VmExportMode): VmActionGuardResult {
  const blocked = objectGuard(vm, true, true)
  if (blocked) return blocked
  if (Object.keys(vm.current_operations ?? {}).length) return { canRun: false, reason: 'VM 正在执行其他操作，请等待完成后刷新' }
  if (vm.power_state === 'Running') {
    if (mode === 'force') return { canRun: false, reason: '运行中的 VM 请使用关机后导出或导出快照' }
    // A live VM does not advertise export; prepare an exportable target first.
    return operationGuard(vm, mode === 'shutdown' ? 'clean_shutdown' : 'checkpoint')
  }
  if (mode !== 'force' || !['Halted', 'Suspended'].includes(vm.power_state ?? '')) {
    return { canRun: false, reason: '请先关闭、挂起或恢复虚拟机，再选择导出方式' }
  }
  return operationGuard(vm, 'export')
}

export function canRunVmAction(vm: VmActionRecord, action: VmAction): VmActionGuardResult {
  const blocked = objectGuard(vm)
  if (blocked) return blocked
  // XAPI may permit hard_shutdown during a stuck operation; retain this recovery path.
  if (Object.keys(vm.current_operations ?? {}).length && action !== 'forceShutdown') {
    return { canRun: false, reason: 'VM 正在执行其他操作，请等待完成后刷新' }
  }
  const states: Record<VmAction, string[]> = {
    start: ['Halted'], shutdown: ['Running'], reboot: ['Running'],
    forceShutdown: ['Running', 'Paused', 'Suspended'], pause: ['Running'], unpause: ['Paused'],
    suspend: ['Running'], resume: ['Suspended'], snapshot: ['Running', 'Halted', 'Paused', 'Suspended'],
    export: ['Running', 'Halted', 'Suspended'], copy: ['Halted'], delete: ['Halted'],
  }
  if (!states[action].includes(vm.power_state ?? '')) {
    const reasons: Partial<Record<VmAction, string>> = {
      start: '虚拟机已启动；只有已停止的 VM 可以启动',
      unpause: '只有已暂停的 VM 可以继续运行', resume: '只有已挂起的 VM 可以从挂起恢复',
      copy: '请先正常关闭虚拟机，再执行复制', delete: '只有已停止的 VM 可以删除',
      forceShutdown: '虚拟机已经关闭，无需强制关闭',
    }
    return { canRun: false, reason: reasons[action] || '当前电源状态不支持该操作' }
  }
  if (action === 'export') {
    if (vm.power_state !== 'Running') return canRunVmExport(vm, 'force')
    return canRunVmExport(vm, 'shutdown').canRun || canRunVmExport(vm, 'snapshot').canRun ? { canRun: true }
      : { canRun: false, reason: '当前不支持关机后导出或导出快照，请检查正常关机与 checkpoint 能力' }
  }
  if (action === 'copy') {
    const guards = ['clone', 'copy'].map((operation) => operationGuard(vm, operation))
    return guards.some((guard) => guard.canRun) ? { canRun: true } : guards[0]
  }
  const operation = action === 'snapshot' ? 'snapshot' : action === 'delete' ? 'destroy' : VM_POWER_OPERATIONS[action].operation
  return operationGuard(vm, operation)
}
