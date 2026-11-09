interface Entry<T> { sample: T; slot: number; key: string }

/** A timestamp min-heap evicts one oldest sample without scanning the cache.
 * Rows are unordered; readers already sort their selected time window. */
export class BoundedSamples<T extends { timestamp: number }> {
  readonly rows: T[] = []
  private readonly index = new Map<string, Entry<T>>()
  private readonly heap: Entry<T>[] = []

  constructor(private readonly limit: number, private readonly keyOf: (sample: T) => string) {}

  put(sample: T): void {
    if (!Number.isFinite(sample.timestamp)) return
    const key = this.keyOf(sample)
    const existing = this.index.get(key)
    if (existing) { Object.assign(existing.sample, sample); return }
    if (this.rows.length === this.limit) {
      if (sample.timestamp < this.heap[0].sample.timestamp) return
      this.removeOldest()
    }
    const entry = { sample, key, slot: this.rows.length }
    this.rows.push(sample)
    this.index.set(key, entry)
    let position = this.heap.length
    this.heap.push(entry)
    while (position > 0) {
      const parent = (position - 1) >>> 1
      if (this.heap[parent].sample.timestamp <= sample.timestamp) break
      this.heap[position] = this.heap[parent]
      position = parent
    }
    this.heap[position] = entry
  }

  prune(cutoff: number): void {
    while (this.heap.length && this.heap[0].sample.timestamp < cutoff) this.removeOldest()
  }

  /** Maintenance replaces rows after downsampling; rebuild only at that boundary. */
  rebuild(): void {
    const samples = this.rows.slice()
    this.clear()
    for (const sample of samples) this.put(sample)
  }

  clear(): void { this.rows.length = 0; this.index.clear(); this.heap.length = 0 }

  private removeOldest(): void {
    const oldest = this.heap[0]
    const last = this.heap.pop()!
    if (this.heap.length) {
      let position = 0
      while (position * 2 + 1 < this.heap.length) {
        let child = position * 2 + 1
        if (child + 1 < this.heap.length && this.heap[child + 1].sample.timestamp < this.heap[child].sample.timestamp) child++
        if (last.sample.timestamp <= this.heap[child].sample.timestamp) break
        this.heap[position] = this.heap[child]
        position = child
      }
      this.heap[position] = last
    }
    this.index.delete(oldest.key)
    const tail = this.rows.pop()!
    if (oldest.slot < this.rows.length) {
      this.rows[oldest.slot] = tail
      this.index.get(this.keyOf(tail))!.slot = oldest.slot
    }
  }
}
