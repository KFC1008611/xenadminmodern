import type { IpcRuntimeSchema } from '../ipc-contract'

export type UnknownRecord = Record<string, unknown>

export class IpcValidationError extends Error {
  recordIndex?: number
  constructor(readonly field: string) { super(`Invalid ${field}`) }
}

export function hasOwn(value: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

export function invalid(label: string): never {
  throw new IpcValidationError(label)
}

export function requirePlainObject(value: unknown, label: string): UnknownRecord {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) invalid(label)
  return value as UnknownRecord
}

export function requireExactKeys(
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = [],
  label: string,
): void {
  const allowed = new Set([...required, ...optional])
  if (
    required.some((key) => !hasOwn(value, key))
    || Object.keys(value).some((key) => !allowed.has(key))
  ) invalid(label)
}

export function requireTuple(
  value: unknown,
  requiredLength: number,
  label: string,
  optionalTrailingLength = 0,
): unknown[] {
  if (
    !Array.isArray(value)
    || value.length < requiredLength
    || value.length > requiredLength + optionalTrailingLength
  ) invalid(label)
  return value
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') invalid(label)
  return value
}

export function requireNonBlankString(value: unknown, label: string): string {
  const result = requireString(value, label)
  if (result.trim().length === 0) invalid(label)
  return result
}

export function requireRef(value: unknown, label: string): string {
  const result = requireNonBlankString(value, label)
  if (result === 'OpaqueRef:NULL') invalid(label)
  return result
}

export function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') invalid(label)
  return value
}

export function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(label)
  return value
}

export function requireNonNegativeNumber(value: unknown, label: string): number {
  const result = requireFiniteNumber(value, label)
  if (result < 0) invalid(label)
  return result
}

export function requireSrCapacity(value: unknown, label: string): number {
  const result = requireFiniteNumber(value, label)
  if (result < 0 && result !== -1) invalid(label)
  return result
}

export function requirePositiveInteger(value: unknown, label: string): number {
  const result = requireFiniteNumber(value, label)
  if (!Number.isInteger(result) || result <= 0) invalid(label)
  return result
}

export function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) invalid(label)
  return value
}

export function requireStringArray(value: unknown, label: string): string[] {
  const result = requireArray(value, label)
  if (result.some((entry) => typeof entry !== 'string')) invalid(label)
  return result as string[]
}

export function requireOpenStringRecord(value: unknown, label: string): Record<string, string> {
  const result = requirePlainObject(value, label)
  if (Object.values(result).some((entry) => typeof entry !== 'string')) invalid(label)
  return result as Record<string, string>
}

export function requireEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) invalid(label)
  return value as T
}

export const voidResultSchema: IpcRuntimeSchema<void> = {
  parse(value: unknown): void {
    if (value !== undefined) invalid('void result')
  },
}

export const noArgsSchema: IpcRuntimeSchema<[]> = {
  parse(value: unknown): [] {
    requireTuple(value, 0, 'empty arguments')
    return []
  },
}

export const identifierArgsSchema: IpcRuntimeSchema<[string]> = {
  parse(value: unknown): [string] {
    const [identifier] = requireTuple(value, 1, 'identifier arguments')
    return [requireNonBlankString(identifier, 'identifier')]
  },
}

export const nullableStringResultSchema: IpcRuntimeSchema<string | null> = {
  parse(value: unknown): string | null {
    return value === null ? null : requireString(value, 'nullable string result')
  },
}
