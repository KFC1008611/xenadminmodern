import type { VmRecord } from './types/xapi'

type TemplateRecord = Partial<Pick<VmRecord,
  'is_a_template' | 'is_a_snapshot' | 'is_control_domain' | 'is_default_template' |
  'power_state' | 'other_config' | 'allowed_operations' | 'blocked_operations' |
  'current_operations' | 'locked' | 'Locked'
>>

/** Shared by the menu and the fresh main-process preflight. */
export function templateQuickCreateGuard(template: TemplateRecord, requireInstant = true): { canRun: boolean; reason?: string } {
  const deny = (reason: string) => ({ canRun: false, reason })
  if (template.is_a_template !== true || template.is_a_snapshot || template.is_control_domain
    || template.is_default_template || template.other_config?.default_template === 'true') {
    return deny('快速创建只适用于用户模板')
  }
  if (template.locked || template.Locked) return deny('模板已锁定')
  if (Object.keys(template.current_operations ?? {}).length) return deny('模板正在执行其他操作')
  if (template.power_state !== 'Halted') return deny('模板必须处于已停止状态')
  if (Object.hasOwn(template.blocked_operations ?? {}, 'clone')) return deny(template.blocked_operations?.clone || '管理员已禁止克隆模板')
  if (!Array.isArray(template.allowed_operations)) return deny('尚未读取到模板可用操作，请刷新')
  if (!template.allowed_operations.includes('clone')) return deny('XAPI 当前不允许克隆此模板')
  if (requireInstant && template.other_config?.instant !== 'true') return deny('请先启用快速创建')
  return { canRun: true }
}
