/** Recover short read failures inside the original operation; never replay a write. */
export class ReadScopeChangedError extends Error {
  constructor() {
    super('操作对象或管理连接已变化，无法从当前连接获取原操作结果。')
  }
}

export async function readOperationResult<T>(
  read: () => Promise<T>,
  options: { attempts?: number; delayMs?: number; isCurrent?: () => boolean } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3
  const assertCurrent = () => {
    if (options.isCurrent && !options.isCurrent()) throw new ReadScopeChangedError()
  }
  for (let attempt = 1; ; attempt++) {
    assertCurrent()
    try {
      const result = await read()
      assertCurrent()
      return result
    } catch (error) {
      assertCurrent()
      if (error instanceof ReadScopeChangedError || attempt >= attempts) throw error
      await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 500))
    }
  }
}
