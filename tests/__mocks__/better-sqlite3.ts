/**
 * Mock for better-sqlite3 in test environment.
 * The real module is compiled for Electron's Node version and cannot load in Node.js test environment.
 */

type Row = Record<string, any>

function isRecord(value: unknown): value is Row {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseInsertColumns(sql: string): string[] {
  const match = sql.match(/into\s+\w+\s*\(([^)]+)\)/i)
  if (!match) return []
  return match[1].split(',').map(part => part.trim())
}

function parseSetAssignments(sql: string): Array<{ field: string; source: string }> {
  const match = sql.match(/set\s+([\s\S]+?)\s+where/i)
  if (!match) return []
  return match[1]
    .split(',')
    .map(part => part.trim())
    .map(part => {
      const [field, source] = part.split('=').map(p => p.trim())
      return { field, source }
    })
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

class MockStatement {
  private readonly sql: string
  private readonly lowerSql: string
  private readonly tableName: string
  private readonly operation: 'select' | 'insert' | 'update' | 'delete' | 'unknown'
  private readonly mockDb: MockDatabase

  constructor(sql: string, mockDb: MockDatabase) {
    this.sql = sql
    this.lowerSql = sql.toLowerCase().trim()
    this.mockDb = mockDb

    if (this.lowerSql.startsWith('select')) {
      this.operation = 'select'
      const match = this.lowerSql.match(/from\s+(\w+)/)
      this.tableName = match?.[1] ?? ''
      return
    }
    if (this.lowerSql.startsWith('insert')) {
      this.operation = 'insert'
      const match = this.lowerSql.match(/into\s+(\w+)/)
      this.tableName = match?.[1] ?? ''
      return
    }
    if (this.lowerSql.startsWith('update')) {
      this.operation = 'update'
      const match = this.lowerSql.match(/update\s+(\w+)/)
      this.tableName = match?.[1] ?? ''
      return
    }
    if (this.lowerSql.startsWith('delete')) {
      this.operation = 'delete'
      const match = this.lowerSql.match(/from\s+(\w+)/)
      this.tableName = match?.[1] ?? ''
      return
    }

    this.operation = 'unknown'
    this.tableName = ''
  }

  run(...params: any[]): { changes: number; lastInsertRowid: number } {
    if (this.operation === 'insert') {
      return this.insertRow(params)
    }
    if (this.operation === 'update') {
      const changes = this.updateRows(params)
      return { changes, lastInsertRowid: 0 }
    }
    if (this.operation === 'delete') {
      const changes = this.deleteRows(params)
      return { changes, lastInsertRowid: 0 }
    }
    return { changes: 0, lastInsertRowid: 0 }
  }

  get(...params: any[]): any {
    const rows = this.selectRows(params)
    return rows[0] ?? null
  }

  all(...params: any[]): any[] {
    return this.selectRows(params)
  }

  private normalizeParams(params: any[]): { named: Row | null; positional: any[] } {
    if (params.length === 1 && isRecord(params[0])) {
      return { named: params[0], positional: [] }
    }
    return { named: null, positional: params }
  }

  private cloneRows(rows: Row[]): Row[] {
    return rows.map(row => ({ ...row }))
  }

  private filterMetricRange(rows: Row[], params: any[], refKey: 'hostRef' | 'vmRef'): Row[] {
    if (params.length < 4) return this.cloneRows(rows)
    const [connectionId, ref, startTime, endTime] = params
    return rows.filter(row =>
      row.connectionId === connectionId &&
      row[refKey] === ref &&
      Number(row.timestamp) >= Number(startTime) &&
      Number(row.timestamp) <= Number(endTime)
    )
  }

  private applyOldRangeFilter(rows: Row[], params: any[]): Row[] {
    if (params.length < 2) return this.cloneRows(rows)
    const [upper, lower] = params
    return rows.filter(row => Number(row.timestamp) < Number(upper) && Number(row.timestamp) >= Number(lower))
  }

  private parseBucketInterval(): number {
    const match = this.lowerSql.match(/timestamp\s*\/\s*(\d+)/)
    return Number(match?.[1] ?? 1)
  }

  private aggregateRows(rows: Row[], intervalMs: number, fields: string[]): Row[] {
    const buckets = new Map<number, Row[]>()
    for (const row of rows) {
      const bucket = Math.floor(Number(row.timestamp) / intervalMs) * intervalMs
      if (!buckets.has(bucket)) buckets.set(bucket, [])
      buckets.get(bucket)!.push(row)
    }

    const result: Row[] = []
    for (const [bucket, bucketRows] of buckets.entries()) {
      const agg: Row = { bucket }
      for (const field of fields) {
        const values = bucketRows
          .map(row => Number(row[field]))
          .filter(value => Number.isFinite(value))
        agg[field] = avg(values)
      }
      result.push(agg)
    }

    result.sort((a, b) => Number(a.bucket) - Number(b.bucket))
    return result
  }

  private getColumnValue(row: Row, columnName: string): any {
    if (columnName in row) {
      return row[columnName]
    }
    const match = Object.keys(row).find(key => key.toLowerCase() === columnName.toLowerCase())
    return match ? row[match] : undefined
  }

  private selectMetricSamples(params: any[]): Row[] {
    const rows = this.mockDb.getTableData('metric_samples')

    if (this.lowerSql.includes('count(*)') && this.lowerSql.includes('as samplecount')) {
      const filtered = this.filterMetricRange(rows, params, 'hostRef')
      const timestamps = filtered.map(row => Number(row.timestamp)).filter(value => Number.isFinite(value))
      return [{
        sampleCount: filtered.length,
        firstTimestamp: timestamps.length > 0 ? Math.min(...timestamps) : null,
        lastTimestamp: timestamps.length > 0 ? Math.max(...timestamps) : null,
      }]
    }

    if (this.lowerSql.includes('count(*)')) {
      return [{ c: rows.length, count: rows.length }]
    }

    if (this.lowerSql.includes('avg(') && this.lowerSql.includes('as avgval')) {
      const columnMatch = this.lowerSql.match(/avg\((\w+)\)/)
      const column = columnMatch?.[1] ?? 'cpupercent'
      const filtered = this.filterMetricRange(rows, params, 'hostRef')
      const values = filtered
        .map(row => this.getColumnValue(row, column))
        .filter(value => value != null)
        .map(Number)
        .filter(value => Number.isFinite(value))

      return [{
        avgVal: avg(values),
        maxVal: values.length > 0 ? Math.max(...values) : null,
        minVal: values.length > 0 ? Math.min(...values) : null,
      }]
    }

    if (this.lowerSql.includes('as value') && this.lowerSql.includes('order by timestamp desc')) {
      const columnMatch = this.lowerSql.match(/select\s+(\w+)\s+as\s+value/i)
      const column = columnMatch?.[1] ?? 'cpuPercent'
      const filtered = this.filterMetricRange(rows, params, 'hostRef')
        .filter(row => this.getColumnValue(row, column) != null)
        .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))
      if (filtered.length === 0) return []
      return [{ value: this.getColumnValue(filtered[0], column) }]
    }

    if (this.lowerSql.includes('group by bucket')) {
      const intervalMs = this.parseBucketInterval()
      const filtered = this.filterMetricRange(rows, params, 'hostRef')
      return this.aggregateRows(filtered, intervalMs, [
        'cpuPercent',
        'memoryPercent',
        'networkRxBytes',
        'networkTxBytes',
        'diskReadBytes',
        'diskWriteBytes',
      ])
    }

    if (this.lowerSql.includes('where timestamp < ? and timestamp >= ?')) {
      return this.applyOldRangeFilter(rows, params)
    }

    if (this.lowerSql.includes('where connectionid = ? and hostref = ? and timestamp >= ? and timestamp <= ?')) {
      return this.filterMetricRange(rows, params, 'hostRef')
        .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
    }

    return this.cloneRows(rows)
  }

  private selectVmMetricSamples(params: any[]): Row[] {
    const rows = this.mockDb.getTableData('vm_metric_samples')

    if (this.lowerSql.includes('count(*)') && this.lowerSql.includes('as samplecount')) {
      const filtered = this.filterMetricRange(rows, params, 'vmRef')
      const timestamps = filtered.map(row => Number(row.timestamp)).filter(value => Number.isFinite(value))
      return [{
        sampleCount: filtered.length,
        firstTimestamp: timestamps.length > 0 ? Math.min(...timestamps) : null,
        lastTimestamp: timestamps.length > 0 ? Math.max(...timestamps) : null,
      }]
    }

    if (this.lowerSql.includes('group by bucket')) {
      const intervalMs = this.parseBucketInterval()
      const filtered = this.filterMetricRange(rows, params, 'vmRef')
      return this.aggregateRows(filtered, intervalMs, [
        'cpuPercent',
        'memoryPercent',
        'memoryUsed',
        'memoryTotal',
      ])
    }

    if (this.lowerSql.includes('where timestamp < ? and timestamp >= ?')) {
      return this.applyOldRangeFilter(rows, params)
    }

    if (this.lowerSql.includes('where connectionid = ? and vmref = ? and timestamp >= ? and timestamp <= ?')) {
      return this.filterMetricRange(rows, params, 'vmRef')
        .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
    }

    return this.cloneRows(rows)
  }

  private selectAlertRules(params: any[]): Row[] {
    const rows = this.mockDb.getTableData('alert_rules')
    if (this.lowerSql.includes('where id = ?')) {
      const id = params[0]
      return this.cloneRows(rows.filter(row => row.id === id))
    }
    if (this.lowerSql.includes('order by createdat desc')) {
      return this.cloneRows(rows).sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
    }
    return this.cloneRows(rows)
  }

  private selectAlertHistory(params: any[]): Row[] {
    const rows = this.mockDb.getTableData('alert_history')

    if (this.lowerSql.includes('select status, count(*) as count') && this.lowerSql.includes('group by status')) {
      const counts = new Map<string, number>()
      for (const row of rows) {
        const status = String(row.status)
        counts.set(status, (counts.get(status) ?? 0) + 1)
      }
      return Array.from(counts.entries()).map(([status, count]) => ({ status, count }))
    }

    if (this.lowerSql.includes('where id = ?')) {
      const id = params[0]
      return this.cloneRows(rows.filter(row => row.id === id))
    }

    let filtered = this.cloneRows(rows)
    let index = 0

    const statusInMatch = this.lowerSql.match(/status\s+in\s*\(([^)]+)\)/)
    if (statusInMatch) {
      const placeholderCount = statusInMatch[1].split(',').length
      const statuses = params.slice(index, index + placeholderCount)
      filtered = filtered.filter(row => statuses.includes(row.status))
      index += placeholderCount
    }

    const severityInMatch = this.lowerSql.match(/severity\s+in\s*\(([^)]+)\)/)
    if (severityInMatch) {
      const placeholderCount = severityInMatch[1].split(',').length
      const severities = params.slice(index, index + placeholderCount)
      filtered = filtered.filter(row => severities.includes(row.severity))
      index += placeholderCount
    }

    if (this.lowerSql.includes('triggeredat >= ?')) {
      const since = Number(params[index])
      filtered = filtered.filter(row => Number(row.triggeredAt) >= since)
      index += 1
    }

    if (this.lowerSql.includes('triggeredat <= ?')) {
      const until = Number(params[index])
      filtered = filtered.filter(row => Number(row.triggeredAt) <= until)
      index += 1
    }

    if (this.lowerSql.includes('connectionid = ?')) {
      const connectionId = params[index]
      filtered = filtered.filter(row => row.connectionId === connectionId)
      index += 1
    }

    if (this.lowerSql.includes('order by triggeredat desc')) {
      filtered.sort((a, b) => Number(b.triggeredAt) - Number(a.triggeredAt))
    }

    return filtered
  }

  private selectRows(params: any[]): Row[] {
    if (this.operation !== 'select') {
      return []
    }

    if (this.tableName === 'metric_samples') {
      return this.selectMetricSamples(params)
    }
    if (this.tableName === 'vm_metric_samples') {
      return this.selectVmMetricSamples(params)
    }
    if (this.tableName === 'alert_rules') {
      return this.selectAlertRules(params)
    }
    if (this.tableName === 'alert_history') {
      return this.selectAlertHistory(params)
    }

    return this.cloneRows(this.mockDb.getTableData(this.tableName))
  }

  private insertRow(params: any[]): { changes: number; lastInsertRowid: number } {
    const { named, positional } = this.normalizeParams(params)
    const columns = parseInsertColumns(this.sql)

    const row: Row = { id: this.mockDb.nextId() }
    if (named) {
      if (named.id != null) {
        row.id = named.id
      }
      for (const column of columns) {
        row[column] = named[column] ?? null
      }
    } else if (columns.length > 0) {
      columns.forEach((column, index) => {
        row[column] = positional[index] ?? null
      })
    } else {
      positional.forEach((value, index) => {
        row[`col${index}`] = value
      })
    }

    this.mockDb.insert(this.tableName, row)
    return { changes: 1, lastInsertRowid: Number(row.id) || 1 }
  }

  private updateRows(params: any[]): number {
    const rows = this.mockDb.getTableData(this.tableName)

    if (this.tableName === 'alert_history' && this.lowerSql.includes("set status = 'acknowledged'")) {
      const [acknowledgedAt, id] = params
      let changes = 0
      for (const row of rows) {
        if (row.id === id) {
          row.status = 'acknowledged'
          row.acknowledgedAt = acknowledgedAt
          changes += 1
        }
      }
      return changes
    }

    if (this.tableName === 'alert_history' && this.lowerSql.includes("set status = 'resolved'")) {
      if (this.lowerSql.includes('where id = ?')) {
        const [resolvedAt, id] = params
        let changes = 0
        for (const row of rows) {
          if (row.id === id) {
            row.status = 'resolved'
            row.resolvedAt = resolvedAt
            changes += 1
          }
        }
        return changes
      }

      if (this.lowerSql.includes('ruleid not in (select id from alert_rules)')) {
        const [resolvedAt] = params
        const ruleIds = new Set(this.mockDb.getTableData('alert_rules').map(rule => rule.id))
        let changes = 0
        for (const row of rows) {
          if ((row.status === 'active' || row.status === 'acknowledged') && !ruleIds.has(row.ruleId)) {
            row.status = 'resolved'
            row.resolvedAt = resolvedAt
            changes += 1
          }
        }
        return changes
      }
    }

    if (this.tableName === 'alert_rules') {
      const { named, positional } = this.normalizeParams(params)
      const id = named?.id ?? positional[0]
      if (id == null) return 0

      const assignments = parseSetAssignments(this.sql)
      let changes = 0
      for (const row of rows) {
        if (row.id !== id) continue
        for (const { field, source } of assignments) {
          if (source.startsWith('@') && named) {
            const key = source.slice(1)
            if (key in named) {
              row[field] = named[key]
            }
          } else if (source === '?') {
            // Not used by current alert rule updates.
          } else if (/^'.*'$/.test(source)) {
            row[field] = source.slice(1, -1)
          }
        }
        changes += 1
      }
      return changes
    }

    return 0
  }

  private deleteRows(params: any[]): number {
    const rows = this.mockDb.getTableData(this.tableName)
    const before = rows.length

    if (this.lowerSql.includes('where id = ?')) {
      const id = params[0]
      this.mockDb.setTableData(this.tableName, rows.filter(row => row.id !== id))
      return before - this.mockDb.getTableData(this.tableName).length
    }

    if (this.lowerSql.includes('where ruleid = ?')) {
      const ruleId = params[0]
      this.mockDb.setTableData(this.tableName, rows.filter(row => row.ruleId !== ruleId))
      return before - this.mockDb.getTableData(this.tableName).length
    }

    if (this.lowerSql.includes('where timestamp < ?')) {
      const cutoff = Number(params[0])
      this.mockDb.setTableData(this.tableName, rows.filter(row => Number(row.timestamp) >= cutoff))
      return before - this.mockDb.getTableData(this.tableName).length
    }

    this.mockDb.setTableData(this.tableName, [])
    return before
  }
}

class MockDatabase {
  private readonly tables: Map<string, Row[]> = new Map()
  private idCounter = 1

  constructor(_path: string, _options?: any) {
    this.tables.set('metric_samples', [])
    this.tables.set('vm_metric_samples', [])
    this.tables.set('alert_rules', [])
    this.tables.set('alert_history', [])
  }

  exec(sql: string): void {
    const tableRegex = /create\s+table\s+if\s+not\s+exists\s+(\w+)/ig
    let match = tableRegex.exec(sql)
    while (match) {
      const tableName = match[1]
      if (!this.tables.has(tableName)) {
        this.tables.set(tableName, [])
      }
      match = tableRegex.exec(sql)
    }
  }

  prepare(sql: string): MockStatement {
    return new MockStatement(sql, this)
  }

  pragma(pragma: string, _options?: any): any {
    if (pragma.includes('journal_mode')) return { journal_mode: 'wal' }
    if (pragma.includes('synchronous')) return { synchronous: 1 }
    return {}
  }

  transaction<T extends (...args: any[]) => any>(fn: T): T {
    return ((...args: any[]) => fn(...args)) as T
  }

  close(): void {
    this.tables.clear()
  }

  nextId(): number {
    const id = this.idCounter
    this.idCounter += 1
    return id
  }

  insert(tableName: string, row: Row): void {
    const data = this.tables.get(tableName) || []
    data.push({ ...row })
    this.tables.set(tableName, data)
  }

  getTableData(tableName: string): Row[] {
    return this.tables.get(tableName) || []
  }

  setTableData(tableName: string, rows: Row[]): void {
    this.tables.set(tableName, rows)
  }

  seedData(tableName: string, data: Row[]): void {
    this.tables.set(tableName, data.map(row => ({ ...row })))
  }
}

export = MockDatabase
