import type { VmRecord } from './types/xapi'

export const GIB = 1024 ** 3

export interface VmMemoryLimits {
  staticMin: number
  dynamicMin: number
  dynamicMax: number
  staticMax: number
}

export function validateVmMemoryLimits(limits: VmMemoryLimits): string | null {
  const { staticMin, dynamicMin, dynamicMax, staticMax } = limits
  if (!Object.values(limits).every((value) => Number.isSafeInteger(value) && value >= 0)
    || dynamicMin === 0 || dynamicMax === 0 || staticMax === 0) {
    return '请输入有效的内存容量，容量必须大于 0 且换算为整数 byte。'
  }
  if (!(staticMin <= dynamicMin && dynamicMin <= dynamicMax && dynamicMax <= staticMax)) {
    return '内存须满足：静态下限 ≤ 动态下限 ≤ 动态上限 ≤ 启动上限。'
  }
  return null
}

export function vmMemoryLimits(vm: VmRecord): VmMemoryLimits {
  return {
    staticMin: Number(vm.memory_static_min),
    dynamicMin: Number(vm.memory_dynamic_min),
    dynamicMax: Number(vm.memory_dynamic_max),
    staticMax: Number(vm.memory_static_max),
  }
}

export function vmMemoryEditReason(vm: VmRecord, limits?: VmMemoryLimits): string | null {
  if (vm.is_control_domain || vm.is_a_template || vm.is_a_snapshot) return '仅可修改普通虚拟机的内存。'
  if (vm.locked || vm.Locked || Object.keys(vm.current_operations ?? {}).length > 0) {
    return '虚拟机有进行中的操作，请稍后再试。'
  }
  if (vm.power_state !== 'Halted' && vm.power_state !== 'Running') {
    return '请先将虚拟机恢复运行或关机，再修改内存。'
  }
  const target = limits ?? vmMemoryLimits(vm)
  const staticChanged = target.staticMin !== Number(vm.memory_static_min)
    || target.staticMax !== Number(vm.memory_static_max)
  if (staticChanged && vm.power_state !== 'Halted') return '修改启动内存上限需要先关闭虚拟机。'
  const operations = !limits && vm.power_state === 'Halted'
    ? ['changing_dynamic_range', 'changing_memory_limits']
    : [staticChanged ? 'changing_memory_limits' : 'changing_dynamic_range']
  if (!operations.some((operation) => vm.allowed_operations?.includes(operation) && !vm.blocked_operations?.[operation])) {
    return 'XAPI 当前不允许此内存调整，请刷新或关机后重试。'
  }
  return null
}

export function sameVmMemory(a: VmMemoryLimits, b: VmMemoryLimits): boolean {
  return a.staticMin === b.staticMin && a.staticMax === b.staticMax
    && a.dynamicMin === b.dynamicMin && a.dynamicMax === b.dynamicMax
}
