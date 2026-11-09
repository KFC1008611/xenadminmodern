/** Convert XML-RPC dateTime values to the string DTO used across IPC. */
export function toIpcDateTime(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  throw new TypeError('Invalid XAPI dateTime value')
}
