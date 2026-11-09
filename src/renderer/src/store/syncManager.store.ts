/**
 * SyncManager — centralized data synchronization with page visibility awareness.
 *
 * Replaces per-page setInterval polling with a single coordinated refresh system.
 *
 * Features:
 * - Page visibility detection: pauses polling when tab is hidden, resumes on visible
 * - Manual refresh doesn't reset auto-refresh timers
 * - Deduplication: concurrent refreshAll calls are coalesced
 * - Start/stop lifecycle tied to application mount/unmount
 *
 * Usage:
 *   syncManager.start()   // Call once on app mount
 *   syncManager.stop()    // Call once on app unmount
 *   syncManager.refreshNow() // Manual trigger (doesn't reset timer)
 */

import { useSyncExternalStore } from 'react'
import { useConnectionManagerStore } from './connectionManager.store'
import { useMultiDataStore } from './multiData.store'

// ============================================================================
// Types
// ============================================================================

export type SyncState = 'idle' | 'running' | 'paused'

export interface SyncManagerState {
  state: SyncState
  lastRefresh: number | null  // timestamp instead of Date for stable reference
  refreshCount: number
  activeTimers: number
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_INTERVAL_MS = 30_000   // 30s normal polling
const BACKGROUND_INTERVAL_MS = 120_000  // 2min when tab is hidden
const DEBOUNCE_MS = 2_000  // Coalesce concurrent refreshAll calls

// ============================================================================
// Stable snapshot for useSyncExternalStore
// ============================================================================

// Keep the same object only while values remain unchanged.
let _snapshot: SyncManagerState = {
  state: 'idle',
  lastRefresh: null,
  refreshCount: 0,
  activeTimers: 0,
}

// ============================================================================
// SyncManager singleton
// ============================================================================

class SyncManager {
  private timerId: ReturnType<typeof setInterval> | null = null
  private _state: SyncState = 'idle'
  private _lastRefresh: number | null = null
  private _refreshCount = 0
  private lifecycleGeneration = 0
  private isRefreshing = false
  private pendingRefresh = false
  private currentInterval = DEFAULT_INTERVAL_MS
  private visibilityHandler: (() => void) | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  /** Start the sync manager. Safe to call multiple times. */
  start(): void {
    if (this._state !== 'idle') return

    ++this.lifecycleGeneration
    this._state = document.hidden ? 'paused' : 'running'
    this.setupVisibilityListener()
    this.scheduleNext(document.hidden ? BACKGROUND_INTERVAL_MS : this.currentInterval)
    this._notifySnapshotChange()
    this.refreshNow()
  }

  /** Stop the sync manager and clean up all resources. */
  stop(): void {
    ++this.lifecycleGeneration
    this.pendingRefresh = false
    this._state = 'idle'
    this.clearTimer()
    this.removeVisibilityListener()
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this._notifySnapshotChange()
  }

  /** Trigger an immediate refresh. Does not reset the auto-refresh timer. */
  refreshNow(): void {
    if (this.isRefreshing) {
      this.pendingRefresh = true
      return
    }

    this.isRefreshing = true
    const generation = this.lifecycleGeneration

    useConnectionManagerStore.getState().refreshConnections()
      .then(() => generation === this.lifecycleGeneration ? useMultiDataStore.getState().refreshAll() : undefined)
      .then(() => {
        if (generation !== this.lifecycleGeneration) return
        this._lastRefresh = Date.now()
        this._refreshCount++
        this._notifySnapshotChange()
      })
      .catch((err) => {
        console.warn('[SyncManager] refreshAll failed:', err)
      })
      .finally(() => {
        this.isRefreshing = false
        if (this.pendingRefresh) {
          this.pendingRefresh = false
          if (this._state !== 'idle' && !this.debounceTimer) {
            this.debounceTimer = setTimeout(() => {
              this.debounceTimer = null
              if (this._state !== 'idle') this.refreshNow()
            }, DEBOUNCE_MS)
          }
        }
      })
  }

  /** Get current state — returns the SAME object reference when nothing changed. */
  getState(): SyncManagerState {
    // React compares snapshots by identity; replace only when values changed.
    const newState = this._state
    const newLastRefresh = this._lastRefresh
    const newRefreshCount = this._refreshCount
    const newActiveTimers = this.timerId ? 1 : 0

    if (
      _snapshot.state !== newState ||
      _snapshot.lastRefresh !== newLastRefresh ||
      _snapshot.refreshCount !== newRefreshCount ||
      _snapshot.activeTimers !== newActiveTimers
    ) {
      _snapshot = { state: newState, lastRefresh: newLastRefresh,
        refreshCount: newRefreshCount, activeTimers: newActiveTimers }
    }

    return _snapshot
  }

  /** Update the refresh interval. Takes effect on next cycle. */
  setInterval(ms: number): void {
    this.currentInterval = ms
    if (this._state === 'running') {
      this.clearTimer()
      this.scheduleNext(ms)
    }
  }

  // ---- Private methods ----

  private scheduleNext(intervalMs: number): void {
    this.clearTimer()
    this.timerId = setInterval(() => {
      if (this._state === 'running') {
        this.refreshNow()
      }
    }, intervalMs)
  }

  private clearTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId)
      this.timerId = null
    }
  }

  private setupVisibilityListener(): void {
    if (this.visibilityHandler) return

    this.visibilityHandler = () => {
      if (document.hidden) {
        this._state = 'paused'
        this.clearTimer()
        this.scheduleNext(BACKGROUND_INTERVAL_MS)
      } else {
        this._state = 'running'
        this.clearTimer()
        this.scheduleNext(this.currentInterval)
        this.refreshNow()
      }
      this._notifySnapshotChange()
    }

    document.addEventListener('visibilitychange', this.visibilityHandler)
  }

  private removeVisibilityListener(): void {
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler)
      this.visibilityHandler = null
    }
  }

  /** Notify React subscribers that snapshot data has changed. */
  private _notifySnapshotChange(): void {
    emitChange()
  }
}

// Export singleton
export const syncManager = new SyncManager()

// ============================================================================
// React hook — uses useSyncExternalStore with stable references
// ============================================================================

let listeners: Array<() => void> = []

function emitChange() {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners = [...listeners, listener]
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}

function getSnapshot(): SyncManagerState {
  return syncManager.getState()
}

function getServerSnapshot(): SyncManagerState {
  return _snapshot // same stable reference
}

/**
 * React hook to access SyncManager state in components.
 *
 * NOTE: Do NOT spread this into a new object — the returned reference
 * is stable and will not change unless the underlying values change.
 * Call syncManager.refreshNow() directly for manual refresh.
 */
export function useSyncManager(): SyncManagerState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

// NO auto-polling emitChange interval — only notify on actual state changes
// The syncManager.refreshNow() already calls _notifySnapshotChange() which triggers emitChange
