import { readJsonStore, writeJsonStore } from '../../persistence/json-store'
import type { VifCreateResult } from '../../../shared/types/xapi'

export interface VifCreationRecord {
  poolUuid: string
  vmUuid: string
  requestId: string
  networkRef: string
  device: string
  vifRef?: string
  result?: VifCreateResult
  deleted?: boolean
}
const store = 'vif-creations'
function records(): VifCreationRecord[] {
  const value = readJsonStore<VifCreationRecord[]>(store, [])
  if (!Array.isArray(value) || value.some((r) => !r || !r.poolUuid || !r.vmUuid || !r.requestId || !r.networkRef || !/^\d+$/.test(r.device))) {
    throw new Error('网卡创建记录损坏，已保留原文件，请先核对已有网卡')
  }
  return value
}
export function findVifCreation(poolUuid: string, vmUuid: string, requestId?: string): VifCreationRecord | undefined {
  const matching = records().filter((r) => r.poolUuid === poolUuid && r.vmUuid === vmUuid)
  return matching.find((r) => r.requestId === requestId) || matching.find((r) => !r.result && !r.deleted)
}
export function saveVifCreation(record: VifCreationRecord): void {
  const existing = records()
  if (existing.some((r) => r.poolUuid === record.poolUuid && r.vmUuid === record.vmUuid && r.requestId === record.requestId && r.deleted) && !record.deleted) {
    throw removedVifCreationError()
  }
  const all = existing.filter((r) => !(r.poolUuid === record.poolUuid && r.vmUuid === record.vmUuid && r.requestId === record.requestId))
  writeJsonStore(store, [...all, record], { flush: true })
}

export function removedVifCreationError(): Error & { code: string } {
  return Object.assign(new Error('原请求创建的网卡已删除，请重新添加网卡。'), { code: 'VIF_CREATION_REMOVED' })
}

/** Preserve consumed request IDs so a late retry cannot recreate a deleted VIF. */
export function markVifCreationsDeleted(poolUuid: string, vifRef: string): void {
  const all = records()
  const matches = (record: VifCreationRecord) => record.poolUuid === poolUuid && (record.vifRef === vifRef || record.result?.vifRef === vifRef) && !record.deleted
  if (!all.some(matches)) return
  writeJsonStore(store, all.map((record) => matches(record) ? { ...record, deleted: true } : record), { flush: true })
}
export function forgetVifCreation(record: VifCreationRecord): void {
  writeJsonStore(store, records().filter((r) => !(r.poolUuid === record.poolUuid && r.vmUuid === record.vmUuid && r.requestId === record.requestId)), { flush: true })
}
