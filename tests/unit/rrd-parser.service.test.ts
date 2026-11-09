/**
 * Unit tests for rrd-parser.service.ts
 */
import { describe, it, expect } from 'vitest'
import {
  parseHostRrdXml,
  parseVmRrdXml,
  parseRrdUpdatesXml,
  rrdDataToMetricDataPoints,
  rrdDataToVmMetricDataPoints,
  RrdParseError,
  classifyMetric,
} from '../../src/main/xapi/services/rrd-parser.service'
import { readFileSync } from 'fs'
import { join } from 'path'

const FIXTURES_DIR = join(__dirname, '../fixtures/rrd')

// ============================================================================
// classifyMetric
// ============================================================================

describe('classifyMetric', () => {
  it('classifies cpu_avg as cpu', () => {
    expect(classifyMetric('cpu_avg')).toBe('cpu')
  })

  it('classifies cpu0, cpu1 as cpu', () => {
    expect(classifyMetric('cpu0')).toBe('cpu')
    expect(classifyMetric('cpu1')).toBe('cpu')
  })

  it('classifies memory metrics', () => {
    expect(classifyMetric('memory_free_kib')).toBe('memoryFree')
    expect(classifyMetric('memory_total_kib')).toBe('memoryTotal')
    expect(classifyMetric('memory')).toBe('vmMemory')
  })

  it('classifies PIF network metrics (host)', () => {
    expect(classifyMetric('pif_aaa-bbb_rx')).toBe('networkRx')
    expect(classifyMetric('pif_aaa-bbb_tx')).toBe('networkTx')
  })

  it('classifies VIF network metrics (VM)', () => {
    expect(classifyMetric('vif_xxx-yyy_rx')).toBe('networkRx')
    expect(classifyMetric('vif_xxx-yyy_tx')).toBe('networkTx')
  })

  it('classifies PBD disk metrics (host)', () => {
    expect(classifyMetric('pbd_ccc-ddd_read')).toBe('diskRead')
    expect(classifyMetric('pbd_ccc-ddd_write')).toBe('diskWrite')
  })

  it('classifies SR disk metrics (host)', () => {
    expect(classifyMetric('sr_eee-fff_read')).toBe('diskRead')
    expect(classifyMetric('sr_eee-fff_write')).toBe('diskWrite')
  })

  it('classifies VBD disk metrics (VM)', () => {
    expect(classifyMetric('vbd_ggg-hhh_read')).toBe('diskRead')
    expect(classifyMetric('vbd_ggg-hhh_write')).toBe('diskWrite')
  })

  it('classifies unknown metrics as other', () => {
    expect(classifyMetric('some_random_metric')).toBe('other')
    expect(classifyMetric('loadavg')).toBe('other')
  })

  it('classifies XCP-ng host disk metrics (read_<uuid>, write_<uuid>)', () => {
    expect(classifyMetric('read_6f6c528d')).toBe('diskRead')
    expect(classifyMetric('write_6f6c528d')).toBe('diskWrite')
    expect(classifyMetric('read_fd074088')).toBe('diskRead')
    expect(classifyMetric('write_fd074088')).toBe('diskWrite')
  })
})

// ============================================================================
// parseHostRrdXml
// ============================================================================

describe('parseHostRrdXml', () => {
  it('parses valid host RRD XML from simplified-format fixture', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'vm-rrd.xml'), 'utf-8')
    // vm-rrd.xml uses the simplified RRD <ds><database> format which also works for host parsing
    const result = parseHostRrdXml(xml)

    expect(result.dataPoints.length).toBeGreaterThan(0)

    // Check first data point
    const firstDp = result.dataPoints[0]
    expect(firstDp.timestamp).toBe(1700000000000) // converted to ms
    expect(firstDp.values.has('cpuPercent')).toBe(true)
    expect(firstDp.values.has('memoryPercent')).toBe(true)
    expect(firstDp.values.has('networkRxBytes')).toBe(true)
    expect(firstDp.values.has('networkTxBytes')).toBe(true)
    expect(firstDp.values.has('diskReadBytes')).toBe(true)
    expect(firstDp.values.has('diskWriteBytes')).toBe(true)
  })

  it('parses standard RRDtool dump format (real XenServer format)', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'host-rrd.xml'), 'utf-8')
    const result = parseHostRrdXml(xml)

    expect(result.dataPoints.length).toBe(3)

    // First data point: lastupdate=1700000010, 3 rows, step=5, pdp_per_row=1
    // Row 0 (oldest): ts = lastupdate - (3-0-1)*5 = 1700000010 - 10 = 1700000000
    const firstDp = result.dataPoints[0]
    expect(firstDp.timestamp).toBe(1700000000000) // converted to ms

    // cpu_avg = 4.55e-01 = 0.455, scaled by 100 = 45.5%
    expect(firstDp.values.get('cpuPercent')).toBe(45.5)

    // memory_total_kib = 1.6777216e+07, memory_free_kib = 8.388608e+06
    // memoryPercent = (16777216 - 8388608) / 16777216 * 100 = 50
    expect(firstDp.values.get('memoryPercent')).toBe(50)

    // pif_aaa-bbb_rx = 1.25e+06
    expect(firstDp.values.get('networkRxBytes')).toBe(1250000)
    // pif_aaa-bbb_tx = 2.5e+06
    expect(firstDp.values.get('networkTxBytes')).toBe(2500000)
    // pbd_ccc-ddd_read = 5.0e+06
    expect(firstDp.values.get('diskReadBytes')).toBe(5000000)
    // pbd_ccc-ddd_write = 3.0e+06
    expect(firstDp.values.get('diskWriteBytes')).toBe(3000000)
  })

  it('calculates memory percentage from free and total', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'vm-rrd.xml'), 'utf-8')
    const result = parseHostRrdXml(xml)
    const firstDp = result.dataPoints[0]

    // memory_total_kib = 16777216, memory_free_kib = 8388608
    // memoryPercent = (16777216 - 8388608) / 16777216 * 100 = 50
    expect(firstDp.values.get('memoryPercent')).toBe(50)
  })

  it('aggregates network metrics by summing PIFs', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'vm-rrd.xml'), 'utf-8')
    const result = parseHostRrdXml(xml)

    const firstDp = result.dataPoints[0]
    expect(firstDp.values.get('networkRxBytes')).toBe(1250000)
    expect(firstDp.values.get('networkTxBytes')).toBe(2500000)
  })

  it('aggregates disk metrics by summing PBDs', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'vm-rrd.xml'), 'utf-8')
    const result = parseHostRrdXml(xml)

    const firstDp = result.dataPoints[0]
    expect(firstDp.values.get('diskReadBytes')).toBe(5000000)
    expect(firstDp.values.get('diskWriteBytes')).toBe(3000000)
  })

  it('returns empty data points for invalid XML', () => {
    expect(() => parseHostRrdXml('')).toThrow(RrdParseError)
  })

  it('returns empty data points for XML without ds elements', () => {
    const xml = '<?xml version="1.0"?><rrd><version>1</version></rrd>'
    const result = parseHostRrdXml(xml)
    expect(result.dataPoints).toHaveLength(0)
  })

  it('sorts data points by timestamp', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'vm-rrd.xml'), 'utf-8')
    const result = parseHostRrdXml(xml)

    for (let i = 1; i < result.dataPoints.length; i++) {
      expect(result.dataPoints[i].timestamp).toBeGreaterThanOrEqual(
        result.dataPoints[i - 1].timestamp
      )
    }
  })
})

// ============================================================================
// parseVmRrdXml
// ============================================================================

describe('parseVmRrdXml', () => {
  it('parses VM RRD XML with CPU, memory, VIF and VBD metrics (simplified format)', () => {
    const xml = `<?xml version="1.0"?>
    <rrd>
      <ds>
        <name>cpu_avg</name>
        <type>GAUGE</type>
        <database>
          <row><t>1700000000</t><v>0.25</v></row>
          <row><t>1700000005</t><v>0.30</v></row>
        </database>
      </ds>
      <ds>
        <name>memory</name>
        <type>GAUGE</type>
        <database>
          <row><t>1700000000</t><v>1073741824</v></row>
          <row><t>1700000005</t><v>1107296256</v></row>
        </database>
      </ds>
      <ds>
        <name>vif_aaa_rx</name>
        <type>DERIVE</type>
        <database>
          <row><t>1700000000</t><v>500000</v></row>
          <row><t>1700000005</t><v>550000</v></row>
        </database>
      </ds>
      <ds>
        <name>vif_aaa_tx</name>
        <type>DERIVE</type>
        <database>
          <row><t>1700000000</t><v>800000</v></row>
          <row><t>1700000005</t><v>850000</v></row>
        </database>
      </ds>
      <ds>
        <name>vbd_bbb_read</name>
        <type>DERIVE</type>
        <database>
          <row><t>1700000000</t><v>2000000</v></row>
          <row><t>1700000005</t><v>2200000</v></row>
        </database>
      </ds>
      <ds>
        <name>vbd_bbb_write</name>
        <type>DERIVE</type>
        <database>
          <row><t>1700000000</t><v>1000000</v></row>
          <row><t>1700000005</t><v>1100000</v></row>
        </database>
      </ds>
    </rrd>`

    const result = parseVmRrdXml(xml)

    expect(result.dataPoints).toHaveLength(2)

    const firstDp = result.dataPoints[0]
    // 0.25 * 100 = 25%
    expect(firstDp.values.get('cpuPercent')).toBe(25)
    expect(firstDp.values.get('memoryBytes')).toBe(1073741824)
    expect(firstDp.values.get('networkRxBytes')).toBe(500000)
    expect(firstDp.values.get('networkTxBytes')).toBe(800000)
    expect(firstDp.values.get('diskReadBytes')).toBe(2000000)
    expect(firstDp.values.get('diskWriteBytes')).toBe(1000000)
  })

  it('sums multiple VIF and VBD data sources', () => {
    const xml = `<?xml version="1.0"?>
    <rrd>
      <ds>
        <name>cpu_avg</name>
        <type>GAUGE</type>
        <database>
          <row><t>1700000000</t><v>0.10</v></row>
        </database>
      </ds>
      <ds>
        <name>vif_aaa_rx</name>
        <type>DERIVE</type>
        <database>
          <row><t>1700000000</t><v>100000</v></row>
        </database>
      </ds>
      <ds>
        <name>vif_bbb_rx</name>
        <type>DERIVE</type>
        <database>
          <row><t>1700000000</t><v>200000</v></row>
        </database>
      </ds>
    </rrd>`

    const result = parseVmRrdXml(xml)
    expect(result.dataPoints).toHaveLength(1)
    // Should sum both VIF rx values
    expect(result.dataPoints[0].values.get('networkRxBytes')).toBe(300000)
  })

  it('parses standard RRDtool dump format (real XenServer format)', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'vm-rrd-standard.xml'), 'utf-8')
    const result = parseVmRrdXml(xml)

    expect(result.dataPoints).toHaveLength(2)

    // First data point: lastupdate=1700000010, 2 rows, step=5, pdp_per_row=1
    // Row 0 (oldest): ts = 1700000010 - (2-0-1)*5 = 1700000010 - 5 = 1700000005
    const firstDp = result.dataPoints[0]
    expect(firstDp.timestamp).toBe(1700000005000) // converted to ms

    // cpu_avg = 2.5e-01 = 0.25, scaled by 100 = 25%
    expect(firstDp.values.get('cpuPercent')).toBe(25)
    // memory = 1.073741824e+09
    expect(firstDp.values.get('memoryBytes')).toBe(1073741824)
    // vif_aaa_rx = 5.0e+05
    expect(firstDp.values.get('networkRxBytes')).toBe(500000)
    // vif_aaa_tx = 8.0e+05
    expect(firstDp.values.get('networkTxBytes')).toBe(800000)
    // vbd_bbb_read = 2.0e+06
    expect(firstDp.values.get('diskReadBytes')).toBe(2000000)
    // vbd_bbb_write = 1.0e+06
    expect(firstDp.values.get('diskWriteBytes')).toBe(1000000)
  })
})

// ============================================================================
// parseRrdUpdatesXml
// ============================================================================

describe('parseRrdUpdatesXml', () => {
  it('parses published xport legend columns per entity, ignores MIN/MAX, and preserves unknown samples', () => {
    const result = parseRrdUpdatesXml(`<xport><meta><legend>
      <entry>AVERAGE:host:host-a:cpu_avg</entry><entry>AVERAGE:host:host-b:cpu_avg</entry>
      <entry>AVERAGE:vm:vm-a:cpu0</entry><entry>AVERAGE:vm:vm-a:memory</entry>
      <entry>MIN:vm:vm-a:cpu0</entry><entry>MAX:vm:vm-a:cpu0</entry>
      </legend></meta><data>
      <row><t>1700000020</t><v>0.1</v><v>0.9</v><v>0.3</v><v>1073741824</v><v>0.0</v><v>1.0</v></row>
      <row><t>1700000025</t><v>NaN</v><v>0.8</v><v>NaN</v><v>NaN</v><v>0.0</v><v>1.0</v></row>
      </data></xport>`)
    expect(result.hostData.map((host) => [host.uuid, host.dataPoints[0].values.get('cpuPercent')])).toEqual([['host-a', 10], ['host-b', 90]])
    expect(result.vmData[0].dataPoints[0].values.get('cpuPercent')).toBe(30)
    expect(result.vmData[0].dataPoints[0].values.get('memoryBytes')).toBe(1073741824)
    expect(result.hostData[0].dataPoints[1].values.has('cpuPercent')).toBe(false)
    expect(result.vmData[0].dataPoints[1].values.size).toBe(0)
  })

  it('rejects unrelated documents and truncated column rows instead of returning normal empty data', () => {
    expect(() => parseRrdUpdatesXml('<html>login</html>')).toThrow(RrdParseError)
    expect(() => parseRrdUpdatesXml('<xport><meta><legend><entry>AVERAGE:host:h:cpu_avg</entry></legend></meta><data><row><t>1700000020</t></row></data></xport>')).toThrow(RrdParseError)
  })

  it('parses incremental update XML', () => {
    const xml = `<?xml version="1.0"?>
    <rrd_updates>
      <rrd uuid="host-uuid-1234">
        <ds>
          <name>cpu_avg</name>
          <type>GAUGE</type>
          <database>
            <row><t>1700000020</t><v>0.60</v></row>
          </database>
        </ds>
      </rrd>
      <rrd uuid="vm-uuid-5678" vm="true">
        <ds>
          <name>cpu_avg</name>
          <type>GAUGE</type>
          <database>
            <row><t>1700000020</t><v>0.30</v></row>
          </database>
        </ds>
      </rrd>
    </rrd_updates>`

    const result = parseRrdUpdatesXml(xml)

    expect(result.hostData).toHaveLength(1)
    expect(result.vmData).toHaveLength(1)
    expect(result.hostData[0].uuid).toBe('host-uuid-1234')
    expect(result.vmData[0].uuid).toBe('vm-uuid-5678')
    // 0.60 * 100 = 60%
    expect(result.hostData[0].dataPoints[0].values.get('cpuPercent')).toBe(60)
    // 0.30 * 100 = 30%
    expect(result.vmData[0].dataPoints[0].values.get('cpuPercent')).toBe(30)
  })

  it('returns empty arrays for invalid XML', () => {
    expect(() => parseRrdUpdatesXml('')).toThrow(RrdParseError)
  })
})

// ============================================================================
// rrdDataToMetricDataPoints
// ============================================================================

describe('rrdDataToMetricDataPoints', () => {
  it('converts RRD host data to MetricDataPoint[]', () => {
    const rrdData = {
      uuid: 'host-uuid',
      dataPoints: [
        {
          timestamp: 1700000000000,
          values: new Map([
            ['cpuPercent', 45.5],
            ['memoryPercent', 50.0],
            ['networkRxBytes', 1250000],
            ['networkTxBytes', 2500000],
            ['diskReadBytes', 5000000],
            ['diskWriteBytes', 3000000],
          ]),
        },
      ],
    }

    const result = rrdDataToMetricDataPoints(rrdData)

    expect(result).toHaveLength(1)
    expect(result[0].timestamp).toBe(1700000000000)
    expect(result[0].cpuPercent).toBe(45.5)
    expect(result[0].memoryPercent).toBe(50)
    expect(result[0].networkRxBytes).toBe(1250000)
    expect(result[0].networkTxBytes).toBe(2500000)
    expect(result[0].diskReadBytes).toBe(5000000)
    expect(result[0].diskWriteBytes).toBe(3000000)
  })

  it('handles missing optional fields', () => {
    const rrdData = {
      uuid: 'host-uuid',
      dataPoints: [
        {
          timestamp: 1700000000000,
          values: new Map([
            ['cpuPercent', 45.5],
            ['memoryPercent', 50.0],
          ]),
        },
      ],
    }

    const result = rrdDataToMetricDataPoints(rrdData)
    expect(result[0].networkRxBytes).toBeUndefined()
    expect(result[0].diskReadBytes).toBeUndefined()
    expect(result[0].availableMetrics).toEqual(['cpuPercent', 'memoryPercent'])
  })
  it('marks missing CPU and memory observations as unavailable despite legacy numeric slots', () => {
    const [point] = rrdDataToMetricDataPoints({ uuid: 'h', dataPoints: [{ timestamp: 1, values: new Map() }] })
    expect(point.availableMetrics).toEqual([])
    const [vm] = rrdDataToVmMetricDataPoints({ uuid: 'v', dataPoints: [{ timestamp: 1, values: new Map([['cpuPercent', 10], ['memoryBytes', 1024]]) }] })
    expect(vm.availableMetrics).not.toContain('memoryPercent')
  })
})

// ============================================================================
// rrdDataToVmMetricDataPoints
// ============================================================================

describe('rrdDataToVmMetricDataPoints', () => {
  it('converts VM RRD data with memoryDynamicMax', () => {
    const rrdData = {
      uuid: 'vm-uuid',
      dataPoints: [
        {
          timestamp: 1700000000000,
          values: new Map([
            ['cpuPercent', 25],
            ['memoryBytes', 1073741824], // 1 GiB
          ]),
        },
      ],
    }

    const result = rrdDataToVmMetricDataPoints(rrdData, 2147483648) // 2 GiB dynamic max

    expect(result).toHaveLength(1)
    expect(result[0].cpuPercent).toBe(25)
    expect(result[0].memoryPercent).toBe(50) // 1GB / 2GB * 100
    expect(result[0].memoryUsed).toBe(1073741824)
    expect(result[0].memoryTotal).toBe(2147483648)
  })

  it('includes I/O fields when present', () => {
    const rrdData = {
      uuid: 'vm-uuid',
      dataPoints: [
        {
          timestamp: 1700000000000,
          values: new Map([
            ['cpuPercent', 25],
            ['networkRxBytes', 500000],
            ['networkTxBytes', 800000],
            ['diskReadBytes', 2000000],
            ['diskWriteBytes', 1000000],
          ]),
        },
      ],
    }

    const result = rrdDataToVmMetricDataPoints(rrdData)

    expect(result[0].networkRxBytes).toBe(500000)
    expect(result[0].networkTxBytes).toBe(800000)
    expect(result[0].diskReadBytes).toBe(2000000)
    expect(result[0].diskWriteBytes).toBe(1000000)
  })
})
