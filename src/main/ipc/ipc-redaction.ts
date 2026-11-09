import type { IpcRedactionCategory } from '../../shared/ipc-contract'

export const IPC_REDACTED_VALUE = '[REDACTED]'

const CIRCULAR_VALUE = '[Circular]'
const SENSITIVE_KEY_PARTS = new Set([
  'credential',
  'pass',
  'passphrase',
  'password',
  'secret',
  'session',
  'token',
])

export type IpcRedactionContext = {
  payload: unknown
  redact: (value: unknown) => unknown
}

function isSensitiveKey(key: string): boolean {
  const parts = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  return parts.some((part) => SENSITIVE_KEY_PARTS.has(part))
}

function collectSecretStrings(value: unknown, secrets: Set<string>, seen: WeakSet<object>): void {
  if (typeof value === 'string') {
    if (value.length > 0) secrets.add(value)
    return
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  for (const child of Object.values(value)) collectSecretStrings(child, secrets, seen)
}

function collectPayloadSecrets(value: unknown, secrets: Set<string>, seen: WeakSet<object>): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const child of value) collectPayloadSecrets(child, secrets, seen)
    return
  }
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key)) collectSecretStrings(child, secrets, new WeakSet())
    else collectPayloadSecrets(child, secrets, seen)
  }
}

function replaceSecrets(value: string, secrets: readonly string[]): string {
  let redacted = value
  for (const secret of secrets) redacted = redacted.replaceAll(secret, IPC_REDACTED_VALUE)
  return redacted
}

function redactValue(
  value: unknown,
  secrets: Set<string>,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === 'string') return replaceSecrets(value, [...secrets])
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || value === undefined) {
    return value
  }
  if (typeof value !== 'object') return '[Unserializable]'
  if (seen.has(value)) return CIRCULAR_VALUE
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, secrets, seen))
  }

  const redacted: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      redacted[key] = IPC_REDACTED_VALUE
      continue
    }
    redacted[key] = redactValue(child, secrets, seen)
  }
  return redacted
}

export function createIpcRedactionContext(
  payload: unknown,
  categories: readonly IpcRedactionCategory[] = ['none'],
): IpcRedactionContext {
  const secrets = new Set<string>()
  collectPayloadSecrets(payload, secrets, new WeakSet())
  if (categories.some((category) => category !== 'none')) {
    collectSecretStrings(payload, secrets, new WeakSet())
  }
  const orderedSecrets = [...secrets].sort((left, right) => right.length - left.length)
  const redactedPayload = redactValue(payload, new Set(orderedSecrets), new WeakSet())

  return {
    payload: redactedPayload,
    redact: (value: unknown) => redactValue(
      value,
      new Set(orderedSecrets),
      new WeakSet(),
    ),
  }
}
