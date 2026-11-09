import { connectionManager } from '../connection-manager'
import { templateQuickCreateGuard } from '../../../shared/template-quick-create'

interface TemplateMetadataClient {
  callWithSession(method: string, params: any[]): Promise<any>
}

function isSystemTemplate(record: any): boolean {
  return record?.is_default_template === true || record?.other_config?.default_template === 'true'
}

export async function ensureInstantTemplateMetadata(
  client: TemplateMetadataClient,
  vmRef: string,
  currentRecord?: any,
): Promise<any> {
  const record = currentRecord ?? await client.callWithSession('VM.get_record', [vmRef])
  if (record?.is_a_snapshot === true) throw new Error('快照模板不能启用快速创建')
  const alreadyTemplate = record?.is_a_template === true
  const alreadyInstant = record?.other_config?.instant === 'true'
  if (alreadyTemplate && alreadyInstant) return record
  if (isSystemTemplate(record)) throw new Error('不能修改系统默认模板')

  if (!alreadyInstant) {
    await client.callWithSession('VM.remove_from_other_config', [vmRef, 'instant'])
    await client.callWithSession('VM.add_to_other_config', [vmRef, 'instant', 'true'])
  }
  if (!alreadyTemplate) await client.callWithSession('VM.set_is_a_template', [vmRef, true])

  const verified = await client.callWithSession('VM.get_record', [vmRef])
  if (verified?.is_a_template !== true || verified?.other_config?.instant !== 'true') {
    throw new Error('即时模板元数据验证失败')
  }
  return verified
}

/** Convert an existing halted VM in place, as XenCenter does. */
export async function convertVmToTemplate(
  client: TemplateMetadataClient,
  vmRef: string,
  currentRecord?: any,
): Promise<void> {
  const record = currentRecord ?? await client.callWithSession('VM.get_record', [vmRef])
  if (record?.is_a_snapshot || record?.is_control_domain) {
    throw new Error('快照或控制域不能转换为模板')
  }
  if (record?.is_a_template) return
  if (record?.power_state !== 'Halted') {
    throw new Error('请先关闭虚拟机，再转换为模板')
  }
  if (record?.current_operations && Object.keys(record.current_operations).length > 0) {
    throw new Error('虚拟机正在执行其他操作')
  }
  if (record?.appliance && record.appliance !== 'OpaqueRef:NULL') {
    throw new Error('vApp 中的虚拟机不能转换为模板')
  }
  await ensureInstantTemplateMetadata(client, vmRef, record)
}

export async function enableTemplateInstantCreate(connectionId: string, templateRef: string): Promise<void> {
  const client = connectionManager.getClient(connectionId)
  if (!client) throw new Error(`No connection found for connectionId: ${connectionId}`)
  const record = await client.callWithSession('VM.get_record', [templateRef])
  if (record?.is_a_template !== true) throw new Error('所选对象不是模板')
  if (isSystemTemplate(record)) throw new Error('不能修改系统默认模板')
  const guard = templateQuickCreateGuard(record, false)
  if (!guard.canRun) throw new Error(guard.reason)
  await ensureInstantTemplateMetadata(client, templateRef, record)
}
