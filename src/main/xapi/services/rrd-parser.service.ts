/**
 * RRD Parser service — parses RRD XML from XenServer into structured metric data.
 *
 * XenServer's RRD (Round Robin Database) HTTP endpoints return XML in the standard
 * RRDtool dump format. The structure is:
 *
 *   <rrd>
 *     <version>0003</version>
 *     <step>5</step>
 *     <lastupdate>1213616574</lastupdate>
 *     <ds>
 *       <name>memory_total_kib</name>
 *       <type>GAUGE</type>
 *       ...
 *     </ds>
 *     <ds>
 *       <name>memory_free_kib</name>
 *       ...
 *     </ds>
 *     <rra>
 *       <cf>AVERAGE</cf>
 *       <pdp_per_row>1</pdp_per_row>
 *       <database>
 *         <row><v>2070172.0000</v><v>1756408.0000</v>...</row>
 *       </database>
 *     </rra>
 *   </rrd>
 *
 * Key aspects:
 *   - <ds> elements define data sources (name, type) but do NOT contain <database>
 *   - <rra> (Round Robin Archive) elements contain <database> with data rows
 *   - Each <row> has multiple <v> values, one per <ds>, in the same order
 *   - Rows may or may not include <t> (timestamp) elements
 *   - When <t> is absent, timestamps are calculated from step/lastupdate/position
 *   - Values may be in scientific notation (e.g., 4.5500000000e+01)
 *   - Values may be "NaN" for missing data
 *
 * Data source naming conventions:
 *   Host: cpu_avg, cpu0-cpuN (DERIVE, 0-1 fractions), memory_free_kib, memory_total_kib,
 *         pif_<uuid>_rx, pif_<uuid>_tx,
 *         pbd_<uuid>_read, pbd_<uuid>_write, sr_<uuid>_read, sr_<uuid>_write (legacy),
 *         read_<uuid>, write_<uuid> (XCP-ng actual pattern)
 *   VM:   cpu0-cpuN (DERIVE, 0-1 fractions), memory, vif_<uuid>_rx, vif_<uuid>_tx,
 *         vbd_<uuid>_read, vbd_<uuid>_write
 */
import { XMLParser } from 'fast-xml-parser'
import { createLogger } from '../../logger'
import type { MetricDataPoint, VmMetricDataPoint } from '../../../shared/types/xapi'

// ============================================================================
// Debug logging — RRD parser troubleshooting (controlled via LOG_LEVEL env)
// ============================================================================

const log = createLogger('RrdParser')

const RRD_PARSER_DEBUG = false

function logParser(event: string, context?: Record<string, unknown>): void {
  if (!RRD_PARSER_DEBUG) return
  if (context) {
    log.debug(event, context)
  } else {
    log.debug(event)
  }
}

// ============================================================================
// Parser configuration
// ============================================================================

const parser = new XMLParser({
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  isArray: (_name, jpath) => {
    if (typeof jpath !== 'string') return false
    // Ensure these elements are always arrays even if there's only one
    if (
      jpath.endsWith('.ds') ||
      jpath.endsWith('.row') ||
      jpath.endsWith('.database') ||
      jpath.endsWith('.rra') ||
      jpath.endsWith('.v')
    ) {
      return true
    }
    return false
  },
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
})

// ============================================================================
// Error types
// ============================================================================

export class RrdParseError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message)
    this.name = 'RrdParseError'
  }
}

// ============================================================================
// Parsed RRD types
// ============================================================================

export interface RrdDataPoint {
  timestamp: number // Unix timestamp in milliseconds
  values: Map<string, number> // metric name -> value
}

export interface RrdHostData {
  uuid: string
  dataPoints: RrdDataPoint[]
}

export interface RrdVmData {
  uuid: string
  dataPoints: RrdDataPoint[]
}

export interface RrdUpdateResult {
  hostData: RrdHostData[]
  vmData: RrdVmData[]
}

// ============================================================================
// Metric classification helpers
// ============================================================================

export type MetricCategory = 'cpu' | 'memoryFree' | 'memoryTotal' | 'networkRx' | 'networkTx' | 'diskRead' | 'diskWrite' | 'vmMemory' | 'other'

export function classifyMetric(dsName: string): MetricCategory {
  const lower = dsName.toLowerCase()

  // CPU
  if (lower === 'cpu_avg' || lower === 'cpu0' || /^cpu\d+$/.test(lower)) {
    return 'cpu'
  }

  // Memory
  if (lower === 'memory_free_kib') return 'memoryFree'
  if (lower === 'memory_total_kib') return 'memoryTotal'
  if (lower === 'memory') return 'vmMemory'

  // Network (PIF for hosts, VIF for VMs)
  if (/^pif_.*_rx$/.test(lower) || /^vif_.*_rx$/.test(lower)) return 'networkRx'
  if (/^pif_.*_tx$/.test(lower) || /^vif_.*_tx$/.test(lower)) return 'networkTx'

  // Disk (PBD/SR for hosts, VBD for VMs)
  // Legacy patterns: pbd_<uuid>_read, sr_<uuid>_read
  // XCP-ng actual patterns: read_<uuid>, write_<uuid>
  if (/^(pbd|sr)_.*_read$/.test(lower) || /^vbd_.*_read$/.test(lower)) return 'diskRead'
  if (/^(pbd|sr)_.*_write$/.test(lower) || /^vbd_.*_write$/.test(lower)) return 'diskWrite'
  // XCP-ng host disk metrics: read_<uuid>, write_<uuid>
  if (/^read_[0-9a-f]+$/.test(lower)) return 'diskRead'
  if (/^write_[0-9a-f]+$/.test(lower)) return 'diskWrite'

  return 'other'
}

// ============================================================================
// XML Parsing internals
// ============================================================================

interface ParsedDs {
  name: string
  rows: Array<{ timestamp: number; value: number }>
}

/**
 * Extract data sources from parsed RRD XML.
 * Handles two formats:
 *
 * 1. Standard RRDtool dump format (real XenServer):
 *    <rrd>
 *      <ds><name>...</name></ds>  (metadata only, no <database>)
 *      <rra><database><row><v>...</v></row></database></rra>
 *    </rrd>
 *
 * 2. Simplified format (test fixtures):
 *    <rrd>
 *      <ds><name>...</name><database><row><t>...</t><v>...</v></row></database></ds>
 *    </rrd>
 */
function extractDataSources(parsed: any): ParsedDs[] {
  const rrd = parsed.rrd || parsed
  if (!rrd || typeof rrd !== 'object') {
    logParser('extractDataSources:noRrdObject', {
      hasParsed: !!parsed,
      parsedType: typeof parsed,
      topKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [],
    })
    return []
  }

  // Log the top-level structure of the parsed XML
  const rrdKeys = Object.keys(rrd)
  logParser('extractDataSources:rrdStructure', {
    rrdKeys,
    hasDs: !!rrd.ds,
    hasRra: !!rrd.rra,
    step: rrd.step,
    lastupdate: rrd.lastupdate,
    version: rrd.version,
  })

  // Collect all top-level <ds> names (skip <cdp_prep><ds> which are internal)
  const dsList = Array.isArray(rrd.ds) ? rrd.ds : rrd.ds ? [rrd.ds] : []
  const dsNames: string[] = []

  logParser('extractDataSources:dsListLength', { dsListLength: dsList.length })

  for (const ds of dsList) {
    if (!ds || typeof ds !== 'object') continue
    // Skip cdp_prep internal ds entries (they don't have <name>)
    const name = String(ds.name ?? ds['@_name'] ?? '').trim()
    if (name) {
      dsNames.push(name)
    } else {
      logParser('extractDataSources:dsNoName', {
        dsKeys: Object.keys(ds),
        hasDatabase: !!ds.database,
        hasPrimaryValue: !!ds.primary_value,
      })
    }
  }

  logParser('extractDataSources:dsNames', { dsNames })

  // Check if any ds has a nested <database> (simplified format)
  let hasDsDatabase = false
  for (const ds of dsList) {
    if (ds && ds.database) {
      hasDsDatabase = true
      break
    }
  }

  logParser('extractDataSources:formatDetection', {
    hasDsDatabase,
    format: hasDsDatabase ? 'simplified (ds contains database)' : 'standard RRDtool (rra contains database)',
  })

  if (hasDsDatabase) {
    // Simplified format: <ds><name>...<database><row><t>...<v>...</row></database></ds>
    return extractSimplifiedFormat(dsList)
  }

  // Standard RRDtool dump format: <rra><database><row>...
  return extractRraFormat(rrd, dsNames)
}

/**
 * Extract data sources from the simplified format where <database> is inside <ds>.
 * Used for test fixtures and backward compatibility.
 */
function extractSimplifiedFormat(dsList: any[]): ParsedDs[] {
  const result: ParsedDs[] = []

  logParser('extractSimplifiedFormat:start', { dsCount: dsList.length })

  for (const ds of dsList) {
    if (!ds || typeof ds !== 'object') continue

    const name = String(ds.name ?? ds['@_name'] ?? '').trim()
    if (!name) continue

    const rows: Array<{ timestamp: number; value: number }> = []

    const databases = Array.isArray(ds.database) ? ds.database : ds.database ? [ds.database] : []

    for (const db of databases) {
      if (!db || typeof db !== 'object') continue

      const rowList = Array.isArray(db.row) ? db.row : db.row ? [db.row] : []

      for (const row of rowList) {
        if (!row || typeof row !== 'object') continue

        const t = Number(row.t ?? row.timestamp ?? 0)
        const v = Number(row.v ?? row.value ?? NaN)

        if (Number.isFinite(t) && Number.isFinite(v) && t > 0) {
          rows.push({ timestamp: t * 1000, value: v })
        } else {
          logParser('extractSimplifiedFormat:rowSkipped', {
            dsName: name,
            rawT: row.t,
            rawV: row.v,
            parsedT: t,
            parsedV: v,
            tFinite: Number.isFinite(t),
            vFinite: Number.isFinite(v),
          })
        }
      }
    }

    logParser('extractSimplifiedFormat:dsResult', { dsName: name, rowCount: rows.length })

    if (rows.length > 0) {
      result.push({ name, rows })
    }
  }

  logParser('extractSimplifiedFormat:done', { dsWithRows: result.length })
  return result
}

/**
 * Extract data sources from the standard RRDtool dump format.
 * In this format, <rra> elements contain <database> with rows, and each row has
 * multiple <v> values that correspond to <ds> entries by position.
 *
 * Rows may or may not include <t> (timestamp) elements:
 * - If <t> is present, use it directly
 * - If not, calculate from step, lastupdate, and row position
 */
function extractRraFormat(rrd: any, dsNames: string[]): ParsedDs[] {
  if (dsNames.length === 0) {
    logParser('extractRraFormat:noDsNames', {})
    return []
  }

  const result: ParsedDs[] = []

  // Initialize result for each data source
  for (const name of dsNames) {
    result.push({ name, rows: [] })
  }

  // Parse step and lastupdate for timestamp calculation
  const step = Number(rrd.step ?? 5)
  const lastupdate = Number(rrd.lastupdate ?? 0)

  // Parse <rra> sections
  const rraList = Array.isArray(rrd.rra) ? rrd.rra : rrd.rra ? [rrd.rra] : []

  logParser('extractRraFormat:rraInfo', {
    step,
    lastupdate,
    rraCount: rraList.length,
    dsCount: dsNames.length,
    rraDetails: rraList.map((rra: any, i: number) => ({
      index: i,
      cf: rra?.cf,
      pdpPerRow: rra?.pdp_per_row ?? rra?.['pdp-per-row'],
      hasDatabase: !!rra?.database,
      databaseKeys: rra?.database ? Object.keys(rra.database) : [],
    })),
  })

  // Prefer the RRA with the finest granularity (smallest pdp_per_row)
  // Sort by pdp_per_row ascending so we process finest first
  const sortedRras = rraList
    .filter((rra: any) => rra && typeof rra === 'object' && rra.database)
    .map((rra: any) => ({
      rra,
      pdpPerRow: Number(rra.pdp_per_row ?? rra['pdp-per-row'] ?? 1),
    }))
    .sort((a: any, b: any) => a.pdpPerRow - b.pdpPerRow)

  // Use only the finest-granularity RRA to avoid duplicating data
  if (sortedRras.length === 0) {
    logParser('extractRraFormat:noRraWithDatabase', {
      rraCount: rraList.length,
      rraHasDatabase: rraList.map((r: any) => !!r?.database),
    })
    return result
  }

  const finestRra = sortedRras[0]
  const effectiveStep = step * finestRra.pdpPerRow

  logParser('extractRraFormat:finestRra', {
    pdpPerRow: finestRra.pdpPerRow,
    effectiveStep,
    sortedRraCount: sortedRras.length,
  })

  const databases = Array.isArray(finestRra.rra.database)
    ? finestRra.rra.database
    : finestRra.rra.database
      ? [finestRra.rra.database]
      : []

  logParser('extractRraFormat:databaseCount', { databaseCount: databases.length })

  let totalRowsProcessed = 0
  let totalValuesExtracted = 0
  let totalValuesSkippedNaN = 0

  for (const db of databases) {
    if (!db || typeof db !== 'object') continue

    const rowList = Array.isArray(db.row) ? db.row : db.row ? [db.row] : []

    logParser('extractRraFormat:rowListInfo', { rowCount: rowList.length })

    // Log first row structure for debugging
    if (rowList.length > 0) {
      const firstRow = rowList[0]
      const firstRowKeys = firstRow && typeof firstRow === 'object' ? Object.keys(firstRow) : []
      const firstRowVCount = firstRow?.v ? (Array.isArray(firstRow.v) ? firstRow.v.length : 1) : 0
      logParser('extractRraFormat:firstRowStructure', {
        firstRowKeys,
        firstRowVCount,
        hasT: firstRow?.t != null,
        firstRowSample: JSON.stringify(firstRow).substring(0, 500),
      })
    }

    for (let rowIdx = 0; rowIdx < rowList.length; rowIdx++) {
      const row = rowList[rowIdx]
      if (!row || typeof row !== 'object') continue

      // Extract timestamp: prefer <t> element, otherwise calculate from position
      let timestamp: number
      if (row.t != null && String(row.t).trim() !== '') {
        timestamp = Number(row.t)
      } else {
        // Calculate: lastupdate - (totalRows - rowIdx - 1) * effectiveStep
        // Rows are ordered oldest to newest
        const rowsBeforeEnd = rowList.length - rowIdx - 1
        timestamp = lastupdate - rowsBeforeEnd * effectiveStep
      }

      if (!Number.isFinite(timestamp) || timestamp <= 0) {
        logParser('extractRraFormat:invalidTimestamp', {
          rowIdx,
          rawT: row.t,
          calculatedTs: timestamp,
          lastupdate,
          effectiveStep,
        })
        continue
      }

      const tsMs = timestamp * 1000 // Convert to milliseconds

      // Extract values: <v> elements correspond to <ds> entries by position
      const values = Array.isArray(row.v) ? row.v : row.v != null ? [row.v] : []

      for (let dsIdx = 0; dsIdx < Math.min(values.length, dsNames.length); dsIdx++) {
        const rawValue = String(values[dsIdx]).trim()
        const numValue = Number(rawValue)

        // Skip NaN values (missing data)
        if (!Number.isFinite(numValue)) {
          totalValuesSkippedNaN++
          continue
        }

        // Add to the corresponding data source
        if (result[dsIdx]) {
          result[dsIdx].rows.push({ timestamp: tsMs, value: numValue })
          totalValuesExtracted++
        }
      }

      totalRowsProcessed++
    }
  }

  logParser('extractRraFormat:summary', {
    totalRowsProcessed,
    totalValuesExtracted,
    totalValuesSkippedNaN,
    dsWithRows: result.filter(ds => ds.rows.length > 0).map(ds => ({
      name: ds.name,
      rowCount: ds.rows.length,
      sampleValues: ds.rows.slice(0, 2),
    })),
  })

  // Filter out data sources with no rows
  return result.filter(ds => ds.rows.length > 0)
}

function aggregateDataSources(
  dataSources: ParsedDs[]
): Map<number, Map<MetricCategory, number[]>> {
  // timestamp -> category -> values[]
  const timeSeries = new Map<number, Map<MetricCategory, number[]>>()

  logParser('aggregateDataSources:start', {
    dsCount: dataSources.length,
    dsNames: dataSources.map(ds => `${ds.name}(${ds.rows.length}rows)`),
  })

  for (const ds of dataSources) {
    const category = classifyMetric(ds.name)
    if (category === 'other') {
      logParser('aggregateDataSources:skippedOther', { dsName: ds.name })
      continue
    }

    for (const row of ds.rows) {
      if (!timeSeries.has(row.timestamp)) {
        timeSeries.set(row.timestamp, new Map())
      }
      const bucket = timeSeries.get(row.timestamp)!
      if (!bucket.has(category)) {
        bucket.set(category, [])
      }
      bucket.get(category)!.push(row.value)
    }
  }

  logParser('aggregateDataSources:done', {
    timestampCount: timeSeries.size,
    categories: [...timeSeries.values()].flatMap(m => [...m.keys()]),
  })

  return timeSeries
}

// ============================================================================
// Host RRD parsing
// ============================================================================

/**
 * Parse host RRD XML into structured data.
 */
export function parseHostRrdXml(xml: string): RrdHostData {
  logParser('parseHostRrdXml:start', { xmlLength: xml?.length ?? 0 })

  if (!xml || !xml.trim()) {
    throw new RrdParseError('Empty XML input for host RRD')
  }

  let parsed: any
  try {
    parsed = parser.parse(xml)
  } catch (error) {
    throw new RrdParseError(
      `Failed to parse host RRD XML: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : undefined
    )
  }

  // Log the top-level parsed structure keys
  const parsedKeys = parsed && typeof parsed === 'object' ? Object.keys(parsed) : []
  logParser('parseHostRrdXml:parsedTopKeys', { parsedKeys })

  // Extract UUID from the RRD metadata if available
  let uuid = ''
  try {
    const rrd = parsed.rrd || parsed
    uuid = String(rrd['@_uuid'] ?? rrd.uuid ?? '').trim()
  } catch {
    // UUID extraction is best-effort
  }

  const dataSources = extractDataSources(parsed)
  const timeSeries = aggregateDataSources(dataSources)

  const dataPoints: RrdDataPoint[] = []

  // Sort timestamps
  const timestamps = [...timeSeries.keys()].sort((a, b) => a - b)

  for (const ts of timestamps) {
    const categories = timeSeries.get(ts)!
    const values = new Map<string, number>()

    // CPU: average of all CPU data sources
    // XCP-ng DERIVE type returns 0-1 fractions, multiply by 100 for percentage
    const cpuValues = categories.get('cpu')
    if (cpuValues && cpuValues.length > 0) {
      values.set('cpuPercent', (cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length) * 100)
    }

    // Memory: (total - free) / total * 100
    const memFreeValues = categories.get('memoryFree')
    const memTotalValues = categories.get('memoryTotal')
    if (memFreeValues && memTotalValues) {
      const totalKiB = memTotalValues.reduce((a, b) => a + b, 0) / memTotalValues.length
      const freeKiB = memFreeValues.reduce((a, b) => a + b, 0) / memFreeValues.length
      if (totalKiB > 0) {
        values.set('memoryPercent', Math.max(0, Math.min(100, ((totalKiB - freeKiB) / totalKiB) * 100)))
        values.set('memoryTotalKiB', totalKiB)
      }
    }

    // Network: sum across all PIFs
    const rxValues = categories.get('networkRx')
    if (rxValues) {
      values.set('networkRxBytes', rxValues.reduce((a, b) => a + b, 0))
    }

    const txValues = categories.get('networkTx')
    if (txValues) {
      values.set('networkTxBytes', txValues.reduce((a, b) => a + b, 0))
    }

    // Disk: sum across all PBDs/SRs
    const diskReadValues = categories.get('diskRead')
    if (diskReadValues) {
      values.set('diskReadBytes', diskReadValues.reduce((a, b) => a + b, 0))
    }

    const diskWriteValues = categories.get('diskWrite')
    if (diskWriteValues) {
      values.set('diskWriteBytes', diskWriteValues.reduce((a, b) => a + b, 0))
    }

    dataPoints.push({ timestamp: ts, values })
  }

  logParser('parseHostRrdXml:done', {
    uuid,
    dataPointCount: dataPoints.length,
    firstTs: dataPoints.length > 0 ? dataPoints[0].timestamp : null,
    lastTs: dataPoints.length > 0 ? dataPoints[dataPoints.length - 1].timestamp : null,
  })

  return { uuid, dataPoints }
}

// ============================================================================
// VM RRD parsing
// ============================================================================

/**
 * Parse VM RRD XML into structured data.
 */
export function parseVmRrdXml(xml: string): RrdVmData {
  logParser('parseVmRrdXml:start', { xmlLength: xml?.length ?? 0 })

  if (!xml || !xml.trim()) {
    throw new RrdParseError('Empty XML input for VM RRD')
  }

  let parsed: any
  try {
    parsed = parser.parse(xml)
  } catch (error) {
    throw new RrdParseError(
      `Failed to parse VM RRD XML: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : undefined
    )
  }

  // Log the top-level parsed structure keys
  const parsedKeys = parsed && typeof parsed === 'object' ? Object.keys(parsed) : []
  logParser('parseVmRrdXml:parsedTopKeys', { parsedKeys })

  // Extract UUID
  let uuid = ''
  try {
    const rrd = parsed.rrd || parsed
    uuid = String(rrd['@_uuid'] ?? rrd.uuid ?? '').trim()
  } catch {
    // UUID extraction is best-effort
  }

  const dataSources = extractDataSources(parsed)
  const timeSeries = aggregateDataSources(dataSources)

  const dataPoints: RrdDataPoint[] = []

  const timestamps = [...timeSeries.keys()].sort((a, b) => a - b)

  for (const ts of timestamps) {
    const categories = timeSeries.get(ts)!
    const values = new Map<string, number>()

    // CPU — XCP-ng DERIVE type returns 0-1 fractions, multiply by 100
    const cpuValues = categories.get('cpu')
    if (cpuValues && cpuValues.length > 0) {
      values.set('cpuPercent', (cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length) * 100)
    }

    // VM memory (in bytes)
    const memValues = categories.get('vmMemory')
    if (memValues && memValues.length > 0) {
      values.set('memoryBytes', memValues.reduce((a, b) => a + b, 0) / memValues.length)
    }

    // Network: sum across all VIFs
    const rxValues = categories.get('networkRx')
    if (rxValues) {
      values.set('networkRxBytes', rxValues.reduce((a, b) => a + b, 0))
    }

    const txValues = categories.get('networkTx')
    if (txValues) {
      values.set('networkTxBytes', txValues.reduce((a, b) => a + b, 0))
    }

    // Disk: sum across all VBDs
    const diskReadValues = categories.get('diskRead')
    if (diskReadValues) {
      values.set('diskReadBytes', diskReadValues.reduce((a, b) => a + b, 0))
    }

    const diskWriteValues = categories.get('diskWrite')
    if (diskWriteValues) {
      values.set('diskWriteBytes', diskWriteValues.reduce((a, b) => a + b, 0))
    }

    dataPoints.push({ timestamp: ts, values })
  }

  logParser('parseVmRrdXml:done', {
    uuid,
    dataPointCount: dataPoints.length,
    firstTs: dataPoints.length > 0 ? dataPoints[0].timestamp : null,
    lastTs: dataPoints.length > 0 ? dataPoints[dataPoints.length - 1].timestamp : null,
  })

  return { uuid, dataPoints }
}

// ============================================================================
// Incremental updates parsing
// ============================================================================

/**
 * Parse rrd_updates XML response.
 * The format is similar to a full RRD dump but may contain data for
 * multiple hosts and VMs.
 */
export function parseRrdUpdatesXml(xml: string): RrdUpdateResult {
  if (!xml || !xml.trim()) {
    throw new RrdParseError('Empty XML input for rrd_updates')
  }

  let parsed: any
  try {
    parsed = parser.parse(xml)
  } catch (error) {
    throw new RrdParseError(
      `Failed to parse rrd_updates XML: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : undefined
    )
  }

  const hostData: RrdHostData[] = []
  const vmData: RrdVmData[] = []

  // rrd_updates returns a structure that may contain multiple <rrd> elements
  // each for a different host or VM
  try {
    const root = parsed.rrd_updates || parsed

    // Published /rrd_updates responses use xport columns identified by legend.
    // Keep the legacy embedded RRD shape for older servers and saved samples.
    if (!parsed.xport && !root.rrd && !parsed.rrd_updates) throw new Error('Unrecognized RRD updates document')
    const rrdEntries = parsed.xport
      ? extractXportEntries(parsed.xport)
      : Array.isArray(root.rrd) ? root.rrd : root.rrd ? [root.rrd] : []

    logParser('parseRrdUpdatesXml:entries', { entryCount: rrdEntries.length })

    for (const entry of rrdEntries) {
      if (!entry || typeof entry !== 'object') continue

      const uuid = String(entry['@_uuid'] ?? entry.uuid ?? '').trim()
      const vmFlag = entry['@_vm'] ?? entry.vm ?? false
      const isVm = vmFlag === true || vmFlag === 'true'

      logParser('parseRrdUpdatesXml:entry', { uuid, isVm, entryKeys: Object.keys(entry) })

      const dataSources = entry.dataSources ?? extractDataSourcesFromEntry(entry)
      const timeSeries = aggregateDataSources(dataSources)

      const dataPoints: RrdDataPoint[] = []
      const timestamps = [...new Set<number>([...timeSeries.keys(), ...(entry.timestamps ?? [])])].sort((a, b) => a - b)

      for (const ts of timestamps) {
        const categories = timeSeries.get(ts) ?? new Map<MetricCategory, number[]>()
        const values = new Map<string, number>()

        // CPU — XCP-ng DERIVE type returns 0-1 fractions, multiply by 100
        const cpuValues = categories.get('cpu')
        if (cpuValues && cpuValues.length > 0) {
          values.set('cpuPercent', (cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length) * 100)
        }

        // Memory
        const memFreeValues = categories.get('memoryFree')
        const memTotalValues = categories.get('memoryTotal')
        if (memFreeValues && memTotalValues) {
          const totalKiB = memTotalValues.reduce((a, b) => a + b, 0) / memTotalValues.length
          const freeKiB = memFreeValues.reduce((a, b) => a + b, 0) / memFreeValues.length
          if (totalKiB > 0) {
            values.set('memoryPercent', Math.max(0, Math.min(100, ((totalKiB - freeKiB) / totalKiB) * 100)))
            values.set('memoryTotalKiB', totalKiB)
          }
        }

        const memValues = categories.get('vmMemory')
        if (memValues && memValues.length > 0) {
          values.set('memoryBytes', memValues.reduce((a, b) => a + b, 0) / memValues.length)
        }

        // Network
        const rxValues = categories.get('networkRx')
        if (rxValues) {
          values.set('networkRxBytes', rxValues.reduce((a, b) => a + b, 0))
        }
        const txValues = categories.get('networkTx')
        if (txValues) {
          values.set('networkTxBytes', txValues.reduce((a, b) => a + b, 0))
        }

        // Disk
        const diskReadValues = categories.get('diskRead')
        if (diskReadValues) {
          values.set('diskReadBytes', diskReadValues.reduce((a, b) => a + b, 0))
        }
        const diskWriteValues = categories.get('diskWrite')
        if (diskWriteValues) {
          values.set('diskWriteBytes', diskWriteValues.reduce((a, b) => a + b, 0))
        }

        dataPoints.push({ timestamp: ts, values })
      }

      if (isVm) {
        vmData.push({ uuid, dataPoints })
      } else {
        hostData.push({ uuid, dataPoints })
      }
    }
  } catch (error) {
    throw new RrdParseError(
      `Failed to extract data from rrd_updates: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : undefined
    )
  }

  logParser('parseRrdUpdatesXml:done', {
    hostCount: hostData.length,
    vmCount: vmData.length,
  })

  return { hostData, vmData }
}

function extractXportEntries(xport: any): Array<{ uuid: string; vm: boolean; dataSources: ParsedDs[]; timestamps: number[] }> {
  const entries = xport.meta?.legend?.entry
  const legend = entries === undefined ? [] : Array.isArray(entries) ? entries : [entries]
  const rows = xport.data?.row ?? []
  const timestamps: number[] = []
  if (!xport.meta || xport.data === undefined) throw new Error('RRD xport metadata or data is missing')
  const entities = new Map<string, { uuid: string; vm: boolean; sources: Map<string, ParsedDs> }>()
  const columns = legend.map((label: unknown) => {
    const match = typeof label === 'string' && /^(AVERAGE|MIN|MAX|LAST):(host|vm):([^:]+):(.+)$/.exec(label)
    if (!match) throw new Error('Invalid RRD legend column')
    if (match[1] !== 'AVERAGE') return null
    const [, , kind, uuid, name] = match
    const key = `${kind}:${uuid}`
    let entity = entities.get(key)
    if (!entity) { entity = { uuid, vm: kind === 'vm', sources: new Map() }; entities.set(key, entity) }
    if (entity.sources.has(name)) throw new Error('Duplicate average RRD legend column')
    const source: ParsedDs = { name, rows: [] }
    entity.sources.set(name, source)
    return source
  })
  for (const row of Array.isArray(rows) ? rows : [rows]) {
    const timestamp = Number(row.t) * 1000
    const values = row.v ?? []
    if (!Number.isFinite(timestamp) || timestamp <= 0 || values.length !== columns.length) throw new Error('Invalid RRD xport row')
    timestamps.push(timestamp)
    columns.forEach((source: ParsedDs | null, index: number) => {
      const value = Number(values[index])
      if (source && String(values[index]).trim() !== '' && Number.isFinite(value)) source.rows.push({ timestamp, value })
    })
  }
  return [...entities.values()].map(({ uuid, vm, sources }) => ({ uuid, vm, dataSources: [...sources.values()], timestamps }))
}

/**
 * Extract data sources from a single RRD entry (used by parseRrdUpdatesXml).
 * Handles both the simplified format and the standard RRDtool format.
 */
function extractDataSourcesFromEntry(entry: any): ParsedDs[] {
  // Try the standard extractDataSources logic first
  const result = extractDataSources({ rrd: entry })
  if (result.length > 0) return result

  // Fallback: simplified format with <ds> containing <database>
  const dsList = Array.isArray(entry.ds) ? entry.ds : entry.ds ? [entry.ds] : []
  const simplified = extractSimplifiedFormat(dsList)
  if (simplified.length > 0) return simplified

  return []
}

// ============================================================================
// Conversion to existing MetricDataPoint interface
// ============================================================================

/**
 * Convert parsed host RRD data to the existing MetricDataPoint[] interface.
 */
export function rrdDataToMetricDataPoints(rrdData: RrdHostData): MetricDataPoint[] {
  return rrdData.dataPoints.map((dp) => ({
    availableMetrics: [...dp.values.keys()],
    timestamp: dp.timestamp,
    cpuPercent: roundTo1(dp.values.get('cpuPercent') ?? 0),
    memoryPercent: roundTo1(dp.values.get('memoryPercent') ?? 0),
    networkRxBytes: dp.values.has('networkRxBytes')
      ? Math.max(0, Math.round(dp.values.get('networkRxBytes')!))
      : undefined,
    networkTxBytes: dp.values.has('networkTxBytes')
      ? Math.max(0, Math.round(dp.values.get('networkTxBytes')!))
      : undefined,
    diskReadBytes: dp.values.has('diskReadBytes')
      ? Math.max(0, Math.round(dp.values.get('diskReadBytes')!))
      : undefined,
    diskWriteBytes: dp.values.has('diskWriteBytes')
      ? Math.max(0, Math.round(dp.values.get('diskWriteBytes')!))
      : undefined,
  }))
}

/**
 * Convert parsed VM RRD data to the existing VmMetricDataPoint[] interface.
 * Requires memoryTotal from the VM record for memory percentage calculation.
 */
export function rrdDataToVmMetricDataPoints(
  rrdData: RrdVmData,
  memoryDynamicMax?: number
): VmMetricDataPoint[] {
  return rrdData.dataPoints.map((dp) => {
    const cpuPercent = roundTo1(dp.values.get('cpuPercent') ?? 0)
    const memoryBytes = dp.values.get('memoryBytes')
    const memoryUsed = memoryBytes != null ? Math.round(memoryBytes) : undefined
    const totalKiB = dp.values.get('memoryTotalKiB')
    const memTotal = memoryDynamicMax ?? (totalKiB === undefined ? undefined : totalKiB * 1024)

    let memoryPercent = 0
    if (memoryUsed != null && memTotal != null && memTotal > 0) {
      memoryPercent = roundTo1(Math.min(100, (memoryUsed / memTotal) * 100))
    }

    return {
      availableMetrics: [...dp.values.keys(), ...(memoryUsed != null && memTotal != null && memTotal > 0 ? ['memoryPercent'] : [])],
      timestamp: dp.timestamp,
      cpuPercent,
      memoryPercent,
      memoryUsed,
      memoryTotal: memTotal != null ? Math.round(memTotal) : undefined,
      networkRxBytes: dp.values.has('networkRxBytes')
        ? Math.max(0, Math.round(dp.values.get('networkRxBytes')!))
        : undefined,
      networkTxBytes: dp.values.has('networkTxBytes')
        ? Math.max(0, Math.round(dp.values.get('networkTxBytes')!))
        : undefined,
      diskReadBytes: dp.values.has('diskReadBytes')
        ? Math.max(0, Math.round(dp.values.get('diskReadBytes')!))
        : undefined,
      diskWriteBytes: dp.values.has('diskWriteBytes')
        ? Math.max(0, Math.round(dp.values.get('diskWriteBytes')!))
        : undefined,
    }
  })
}

// ============================================================================
// Utility
// ============================================================================

function roundTo1(value: number): number {
  return Math.round(value * 10) / 10
}
