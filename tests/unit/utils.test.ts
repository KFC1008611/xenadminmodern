/**
 * Unit tests for renderer utility functions.
 */
import { describe, it, expect } from 'vitest'

// Import directly from source to avoid renderer environment dependencies
import { formatBytes, formatPercent, getVmStateBadge } from '../../src/renderer/src/lib/utils'

describe('formatBytes', () => {
  it('returns "0 B" for zero', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('formats bytes less than 1 KB', () => {
    expect(formatBytes(512)).toBe('512 B')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1 KB')
  })

  it('formats megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1 MB')
  })

  it('formats gigabytes', () => {
    expect(formatBytes(1073741824)).toBe('1 GB')
  })

  it('formats terabytes', () => {
    expect(formatBytes(1099511627776)).toBe('1 TB')
  })

  it('rounds to two decimal places', () => {
    expect(formatBytes(1536)).toBe('1.5 KB')
  })
})

describe('formatPercent', () => {
  it('returns "0%" when total is 0', () => {
    expect(formatPercent(0, 0)).toBe('0%')
  })

  it('returns "0%" when used is 0', () => {
    expect(formatPercent(0, 1024)).toBe('0%')
  })

  it('calculates 50% correctly', () => {
    expect(formatPercent(512, 1024)).toBe('50%')
  })

  it('calculates 100% correctly', () => {
    expect(formatPercent(1024, 1024)).toBe('100%')
  })

  it('rounds to nearest integer', () => {
    expect(formatPercent(1, 3)).toBe('33%')
  })
})

describe('getVmStateBadge', () => {
  it('returns success classes for Running', () => {
    const result = getVmStateBadge('Running')
    expect(result).toContain('success')
  })

  it('returns muted classes for Halted', () => {
    const result = getVmStateBadge('Halted')
    expect(result).toContain('muted')
  })

  it('returns warning classes for Suspended', () => {
    const result = getVmStateBadge('Suspended')
    expect(result).toContain('warning')
  })

  it('returns warning classes for Paused', () => {
    const result = getVmStateBadge('Paused')
    expect(result).toContain('warning')
  })

  it('returns muted classes for unknown state', () => {
    const result = getVmStateBadge('Unknown')
    expect(result).toContain('muted')
  })
})
