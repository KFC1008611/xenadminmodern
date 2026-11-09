const { isAbsolute, relative, resolve, sep } = require('node:path')

const METRICS = ['lines', 'functions', 'branches', 'statements']

const COVERAGE_POLICY = {
  schemaVersion: 1,
  source: {
    include: ['src/**/*.{ts,tsx}'],
    exclude: [
      'src/**/*.d.ts',
      'src/shared/types/**',
      'src/renderer/src/types/**',
    ],
  },
  reporters: ['text', 'html', 'json-summary'],
  layerOrder: ['safety', 'protocol', 'rendererUi', 'other'],
  layers: {
    safety: {
      label: 'Safety',
      thresholds: { lines: 90, functions: 85, branches: 80, statements: 90 },
    },
    protocol: {
      label: 'Protocol',
      thresholds: { lines: 75, functions: 80, branches: 70, statements: 75 },
    },
    rendererUi: {
      label: 'Renderer UI',
      thresholds: { lines: 45, functions: 30, branches: 60, statements: 45 },
    },
    other: {
      label: 'Other',
      thresholds: { lines: 45, functions: 40, branches: 60, statements: 45 },
    },
  },
  unverifiedBoundaries: [
    '覆盖率不替代 Published XML-RPC 或 HTTP 协议契约证据',
    '覆盖率不替代真实 Electron 与打包应用运行证据',
    '覆盖率不替代参考服务器或实机 mutation 验证',
  ],
}

const VITEST_COVERAGE_CONFIG = {
  provider: 'v8',
  all: true,
  ignoreEmptyLines: true,
  reportOnFailure: true,
  include: COVERAGE_POLICY.source.include,
  exclude: COVERAGE_POLICY.source.exclude,
  reporter: COVERAGE_POLICY.reporters,
}

function normalizeCoveragePath(filePath, projectRoot = process.cwd()) {
  const normalizedPath = filePath.replaceAll('\\', '/')
  const normalizedRoot = resolve(projectRoot).split(sep).join('/')
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }
  if (isAbsolute(filePath)) return relative(projectRoot, filePath).split(sep).join('/')
  return normalizedPath.replace(/^\.\//, '')
}

function isManagedSource(path) {
  return path.startsWith('src/')
    && /\.(?:ts|tsx)$/.test(path)
    && !path.endsWith('.d.ts')
    && !path.startsWith('src/shared/types/')
    && !path.startsWith('src/renderer/src/types/')
}

function classifyCoveragePath(filePath, projectRoot = process.cwd()) {
  const path = normalizeCoveragePath(filePath, projectRoot)
  if (!isManagedSource(path)) return null

  if (
    path === 'src/shared/audited-features.ts'
    || path === 'src/shared/evidence-manifest.ts'
    || path === 'src/renderer/src/lib/vmActionGuard.ts'
    || path === 'src/main/ipc/handlers/utils.ts'
  ) return 'safety'

  if (
    path.startsWith('src/main/console/')
    || path.startsWith('src/main/ipc/')
    || path.startsWith('src/main/xapi/')
    || path.startsWith('src/preload/')
    || path === 'src/shared/channels.ts'
  ) return 'protocol'

  if (path.startsWith('src/renderer/src/')) return 'rendererUi'
  return 'other'
}

function percentage(covered, total) {
  if (total === 0) return 100
  return Math.floor((10000 * covered) / total) / 100
}

function emptyLayer(id) {
  const layer = COVERAGE_POLICY.layers[id]
  return {
    id,
    label: layer.label,
    fileCount: 0,
    totals: Object.fromEntries(METRICS.map((metric) => [metric, { covered: 0, total: 0 }])),
    actual: Object.fromEntries(METRICS.map((metric) => [metric, 100])),
  }
}

function summarizeCoverage(coverageSummary, projectRoot = process.cwd()) {
  const layers = Object.fromEntries(
    COVERAGE_POLICY.layerOrder.map((id) => [id, emptyLayer(id)]),
  )

  for (const [filePath, fileSummary] of Object.entries(coverageSummary || {})) {
    if (filePath === 'total') continue
    const layerId = classifyCoveragePath(filePath, projectRoot)
    if (!layerId) continue

    const layer = layers[layerId]
    layer.fileCount += 1
    for (const metric of METRICS) {
      const entry = fileSummary?.[metric]
      if (!entry || !Number.isFinite(entry.covered) || !Number.isFinite(entry.total)) continue
      layer.totals[metric].covered += entry.covered
      layer.totals[metric].total += entry.total
    }
  }

  for (const layer of Object.values(layers)) {
    for (const metric of METRICS) {
      const { covered, total } = layer.totals[metric]
      layer.actual[metric] = percentage(covered, total)
    }
  }

  return layers
}

function evaluateCoverage(coverageSummary, projectRoot = process.cwd()) {
  const summary = summarizeCoverage(coverageSummary, projectRoot)
  const layers = COVERAGE_POLICY.layerOrder.map((id) => {
    const layer = summary[id]
    const thresholds = COVERAGE_POLICY.layers[id].thresholds
    const errors = []

    if (layer.fileCount === 0) errors.push(`${layer.label} coverage contains no managed source files`)
    for (const metric of METRICS) {
      if (layer.actual[metric] < thresholds[metric]) {
        errors.push(
          `${layer.label} ${metric} coverage ${layer.actual[metric]}% is below ${thresholds[metric]}%`,
        )
      }
    }

    return { ...layer, thresholds, errors }
  })
  const errors = layers.flatMap((layer) => layer.errors)

  return {
    schemaVersion: 1,
    kind: 'xenadmin-coverage-evidence',
    ok: errors.length === 0,
    source: COVERAGE_POLICY.source,
    layers,
    errors,
    unverifiedBoundaries: COVERAGE_POLICY.unverifiedBoundaries,
  }
}

module.exports = {
  COVERAGE_POLICY,
  VITEST_COVERAGE_CONFIG,
  classifyCoveragePath,
  evaluateCoverage,
  summarizeCoverage,
}
