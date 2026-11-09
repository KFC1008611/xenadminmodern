// XAPI uses -1 for SR capacity that has not been measured yet. Preserve the
// wire sentinel in records, but never perform arithmetic on unknown capacity.
export function knownCapacity(value: number): number | null {
  return Number.isFinite(value) && value >= 0 ? value : null
}

export function srFreeBytes(sr: { physical_size: number; physical_utilisation: number }): number | null {
  const total = knownCapacity(sr.physical_size)
  const used = knownCapacity(sr.physical_utilisation)
  return total === null || used === null ? null : Math.max(0, total - used)
}

export function srUsedPercent(sr: { physical_size: number; physical_utilisation: number }): number | null {
  if (srFreeBytes(sr) === null) return null
  return sr.physical_size > 0 ? Math.min(100, Math.round(sr.physical_utilisation / sr.physical_size * 100)) : 0
}

export function summarizeSrCapacity(srs: Array<{ type: string; physical_size: number; physical_utilisation: number }>): { total: number | null; used: number | null } {
  // ISO/udev repositories do not contribute disk capacity to pool statistics.
  const disks = srs.filter((sr) => sr.type !== 'iso' && sr.type !== 'udev')
  return {
    total: disks.some((sr) => knownCapacity(sr.physical_size) === null) ? null : disks.reduce((sum, sr) => sum + sr.physical_size, 0),
    used: disks.some((sr) => knownCapacity(sr.physical_utilisation) === null) ? null : disks.reduce((sum, sr) => sum + sr.physical_utilisation, 0),
  }
}
