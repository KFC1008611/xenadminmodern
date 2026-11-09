import type { IpcErrorResponse } from './types/xapi'

// Errors lose custom properties across Electron contextBridge. Resolve an
// envelope across that last boundary and create the Error in the renderer.
export type IpcBridgeResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: IpcErrorResponse }

export type IpcBridgeApi<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R>
    ? (...args: A) => Promise<IpcBridgeResult<R>>
    : T[K] extends (...args: never[]) => unknown ? T[K]
      : T[K] extends object ? IpcBridgeApi<T[K]> : T[K]
}

export function unwrapIpcBridgeResult<T>(result: IpcBridgeResult<T>): T {
  if (result.ok) return result.value
  const { message, code, details } = result.failure
  throw Object.assign(new Error(message), { code, details })
}

export function createRendererApi<T extends object>(bridge: IpcBridgeApi<T>): T {
  function visit(value: unknown): unknown {
    if (typeof value === 'function') {
      return (...args: unknown[]) => {
        const result = value(...args)
        // Push subscriptions remain synchronous and return their unsubscribe.
        return result && typeof result.then === 'function'
          ? result.then(unwrapIpcBridgeResult)
          : result
      }
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]))
    }
    return value
  }
  return visit(bridge) as T
}
