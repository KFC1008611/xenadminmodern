import { describe, expect, it } from 'vitest'
import {
  invalid,
  requireArray,
  requireBoolean,
  requireEnum,
  requireExactKeys,
  requireFiniteNumber,
  requireNonBlankString,
  requireNonNegativeNumber,
  requireOpenStringRecord,
  requirePlainObject,
  requirePositiveInteger,
  requireRef,
  requireString,
  requireStringArray,
  requireTuple,
  voidResultSchema,
} from '../../src/shared/ipc-contracts/runtime-schema'

describe('IPC runtime schema primitives', () => {
  it('requires plain objects and exact required/optional keys', () => {
    const value = { required: 1, optional: undefined }

    expect(requirePlainObject(value, 'payload')).toBe(value)
    expect(() => requireExactKeys(value, ['required'], ['optional'], 'payload')).not.toThrow()
    expect(() => requirePlainObject([], 'payload')).toThrow('Invalid payload')
    expect(() => requirePlainObject(new Date(), 'payload')).toThrow('Invalid payload')
    expect(() => requireExactKeys({ required: 1, extra: true }, ['required'], [], 'payload'))
      .toThrow('Invalid payload')
    expect(() => requireExactKeys({}, ['required'], [], 'payload')).toThrow('Invalid payload')
  })

  it('requires exact tuples or one explicitly allowed trailing argument', () => {
    const exact = ['pool-1']
    const omitted = ['pool-1', 'OpaqueRef:vm']
    const explicitUndefined = ['pool-1', 'OpaqueRef:vm', undefined]

    expect(requireTuple(exact, 1, 'arguments')).toBe(exact)
    expect(requireTuple(omitted, 2, 'arguments', 1)).toBe(omitted)
    expect(requireTuple(explicitUndefined, 2, 'arguments', 1)).toBe(explicitUndefined)
    expect(() => requireTuple([], 1, 'arguments')).toThrow('Invalid arguments')
    expect(() => requireTuple([...explicitUndefined, 'extra'], 2, 'arguments', 1))
      .toThrow('Invalid arguments')
  })

  it('distinguishes strings, nonblank strings, and live XAPI references', () => {
    expect(requireString('', 'description')).toBe('')
    expect(requireNonBlankString('  value  ', 'name')).toBe('  value  ')
    expect(requireRef('OpaqueRef:vm', 'VM reference')).toBe('OpaqueRef:vm')
    expect(() => requireString(1, 'description')).toThrow('Invalid description')
    expect(() => requireNonBlankString('   ', 'name')).toThrow('Invalid name')
    expect(() => requireRef('OpaqueRef:NULL', 'VM reference')).toThrow('Invalid VM reference')
  })

  it('validates booleans, finite numeric constraints, and literal enums', () => {
    expect(requireBoolean(false, 'flag')).toBe(false)
    expect(requireFiniteNumber(-1.5, 'number')).toBe(-1.5)
    expect(requireNonNegativeNumber(0, 'size')).toBe(0)
    expect(requirePositiveInteger(2, 'count')).toBe(2)
    expect(requireEnum('Running', new Set(['Running', 'Halted']), 'power state')).toBe('Running')

    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => requireFiniteNumber(value, 'number')).toThrow('Invalid number')
    }
    expect(() => requireBoolean('false', 'flag')).toThrow('Invalid flag')
    expect(() => requireNonNegativeNumber(-1, 'size')).toThrow('Invalid size')
    for (const value of [0, -1, 1.5]) {
      expect(() => requirePositiveInteger(value, 'count')).toThrow('Invalid count')
    }
    expect(() => requireEnum('Paused', new Set(['Running', 'Halted']), 'power state'))
      .toThrow('Invalid power state')
  })

  it('validates arrays, open string records, explicit invalid errors, and void results', () => {
    const values = ['a', 1]
    const strings = ['a', 'b']
    const record = { order: 'cdn', custom: '' }

    expect(requireArray(values, 'values')).toBe(values)
    expect(requireStringArray(strings, 'strings')).toBe(strings)
    expect(requireOpenStringRecord(record, 'record')).toBe(record)
    expect(voidResultSchema.parse(undefined)).toBeUndefined()

    expect(() => requireArray({}, 'values')).toThrow('Invalid values')
    expect(() => requireStringArray(['a', 1], 'strings')).toThrow('Invalid strings')
    expect(() => requireOpenStringRecord({ key: 1 }, 'record')).toThrow('Invalid record')
    expect(() => voidResultSchema.parse(null)).toThrow('Invalid void result')
    expect(() => invalid('sample')).toThrow('Invalid sample')
  })
})
