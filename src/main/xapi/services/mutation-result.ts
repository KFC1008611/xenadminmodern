import { readOperationResult } from '../../../shared/read-operation-result'

export function isLostMutationResponse(error: any): boolean {
  return ['transport', 'client'].includes(error?.details?.kind)
    || /^(E(CONN|PIPE|TIMEDOUT|HOST|NET)|XAPI_CONTRACT_MISMATCH)/.test(error?.code ?? '')
}

export function isMissingRecord(error: any): boolean {
  return error?.code === 'HANDLE_INVALID' || /\bHANDLE_INVALID\b/.test(error?.faultString ?? error?.message ?? '')
}

/** Only an explicit HANDLE_INVALID proves deletion; a disconnected reader does not. */
export async function recordExists(read: () => Promise<unknown>): Promise<boolean> {
  try {
    const record = await read()
    if (!record || typeof record !== 'object') throw new Error('服务器未返回有效对象记录')
    return true
  } catch (error) {
    if (isMissingRecord(error)) return false
    throw error
  }
}

export function resultReadFailed(label: string, cause: unknown): Error & { code: string } {
  return Object.assign(new Error(`${label}的状态读取失败：${cause instanceof Error ? cause.message : String(cause)}。请恢复连接后核对原操作，勿重新提交。`), {
    code: 'RESOURCE_RESULT_READ_FAILED',
  })
}

export async function readMutationResult<T>(label: string, read: () => Promise<T>, isCurrent: () => boolean): Promise<T> {
  try { return await readOperationResult(read, { isCurrent }) }
  catch (error) { throw resultReadFailed(label, error) }
}

export async function confirmRecordDeleted(label: string, read: () => Promise<unknown>, isCurrent: () => boolean): Promise<void> {
  await readMutationResult(label, async () => {
    if (await recordExists(read)) throw new Error('服务器仍返回原对象，删除状态仍在读取中')
  }, isCurrent)
}
