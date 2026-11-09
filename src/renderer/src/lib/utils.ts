/**
 * Shared utility functions for the renderer.
 */
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind class names, resolving conflicts via tailwind-merge. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format a byte count into a human-readable string (B, KB, MB, GB, TB). */
export function formatBytes(bytes: number | null, precision = 2): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '未知'
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(precision))} ${sizes[i]}`
}

/** Binary units explicitly used by VM memory configuration. */
export function formatMemoryBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '暂不可用'
  return formatBytes(bytes).replace('KB', 'KiB').replace('MB', 'MiB').replace('GB', 'GiB').replace('TB', 'TiB')
}

/** Express used/total as a percentage string. Returns "0%" when total is 0. */
export function formatPercent(used: number, total: number): string {
  if (total === 0) return '0%'
  return `${Math.round((used / total) * 100)}%`
}

/** Tailwind badge classes for a VM power state badge pill. */
export function getVmStateBadge(state: string): string {
  switch (state) {
    case 'Running':   return 'bg-success-soft text-success border-success/30'
    case 'Halted':    return 'bg-muted text-muted-foreground border-input'
    case 'Suspended': return 'bg-warning-soft text-warning border-warning/30'
    case 'Paused':    return 'bg-warning-soft text-warning border-warning/30'
    default:          return 'bg-muted text-muted-foreground border-input'
  }
}
