const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, relative, resolve, sep } = require('node:path')
const { spawnSync } = require('node:child_process')

const TEST_FILE_SELECTOR = /^tests\/(?:unit\/.+\.test\.ts|components\/.+\.test\.tsx)$/

function validateSelectors(selectors) {
  return selectors.filter((selector) => (
    !TEST_FILE_SELECTOR.test(selector.replaceAll('\\', '/'))
  ))
}

function compareCollection(actual, expected) {
  const actualByPath = new Map(actual.map((entry) => [entry.path, entry.tests]))
  const expectedByPath = new Map(expected.map((entry) => [entry.path, entry.tests]))
  const missing = expected
    .filter((entry) => !actualByPath.has(entry.path))
    .map((entry) => entry.path)
    .sort()
  const unexpected = actual
    .filter((entry) => !expectedByPath.has(entry.path))
    .map((entry) => entry.path)
    .sort()
  const countMismatches = expected
    .filter((entry) => actualByPath.has(entry.path) && actualByPath.get(entry.path) !== entry.tests)
    .map((entry) => ({
      path: entry.path,
      expected: entry.tests,
      actual: actualByPath.get(entry.path),
    }))
    .sort((a, b) => a.path.localeCompare(b.path))

  return { missing, unexpected, countMismatches }
}

function normalizeReportCollection(vitestReport, projectRoot) {
  if (!Array.isArray(vitestReport?.testResults)) return []

  return vitestReport.testResults
    .map((file) => ({
      path: relative(projectRoot, file.name).split(sep).join('/'),
      tests: Array.isArray(file.assertionResults) ? file.assertionResults.length : 0,
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

function lineCount(value) {
  const trimmed = value.trim()
  return trimmed ? trimmed.split(/\r?\n/).length : 0
}

function warningCount(stderr) {
  return stderr
    .split(/\r?\n/)
    .filter((line) => /\bwarning\b|\bdeprecated\b|\bdeprecation\b/i.test(line))
    .length
}

function evaluateTestRun({
  exitCode,
  stdout,
  stderr,
  vitestReport,
  expectedCollection,
  focused,
  projectRoot,
  toolchain,
}) {
  const actualCollection = normalizeReportCollection(vitestReport, projectRoot)
  const assertions = Array.isArray(vitestReport?.testResults)
    ? vitestReport.testResults.flatMap((file) => (
      Array.isArray(file.assertionResults) ? file.assertionResults : []
    ))
    : []
  const drift = focused
    ? { missing: [], unexpected: [], countMismatches: [] }
    : compareCollection(actualCollection, expectedCollection)
  const countStatus = (status) => assertions.filter((assertion) => assertion.status === status).length
  const failed = Math.max(countStatus('failed'), Number(vitestReport?.numFailedTests || 0))
  const skipped = Math.max(
    countStatus('skipped') + countStatus('pending'),
    Number(vitestReport?.numPendingTests || 0),
  )
  const todo = Math.max(countStatus('todo'), Number(vitestReport?.numTodoTests || 0))
  const passed = countStatus('passed')
  const onlyDetected = /Unexpected \.only modifier/.test(
    `${stdout}\n${stderr}\n${JSON.stringify(vitestReport || {})}`,
  )
  const stderrLines = lineCount(stderr)
  const errors = []

  if (exitCode !== 0) errors.push(`Vitest exited with status ${exitCode ?? 'unknown'}`)
  if (!vitestReport) errors.push('Vitest did not produce its JSON result')
  if (vitestReport && vitestReport.success !== true && exitCode === 0) {
    errors.push('Vitest JSON result did not report success')
  }
  if (skipped > 0) errors.push(`${skipped} skipped test${skipped === 1 ? '' : 's'} is not permitted`)
  if (todo > 0) errors.push(`${todo} todo test${todo === 1 ? '' : 's'} is not permitted`)
  if (onlyDetected) errors.push('An accidental .only modifier was detected')
  if (stderrLines > 0) errors.push(`Vitest wrote ${stderrLines} stderr lines`)
  if (
    !focused
    && (drift.missing.length > 0 || drift.unexpected.length > 0 || drift.countMismatches.length > 0)
  ) {
    errors.push('Full test collection does not match tests/test-collection.json')
  }

  return {
    schemaVersion: 1,
    kind: 'xenadmin-test-gate',
    ok: errors.length === 0,
    toolchain,
    collection: {
      mode: focused ? 'focused' : 'full',
      manifestChecked: !focused,
      fileCount: actualCollection.length,
      testCount: actualCollection.reduce((sum, entry) => sum + entry.tests, 0),
      expectedFileCount: focused ? null : expectedCollection.length,
      expectedTestCount: focused
        ? null
        : expectedCollection.reduce((sum, entry) => sum + entry.tests, 0),
      drift,
    },
    tests: {
      passed,
      failed,
      skipped,
      todo,
      onlyDetected,
    },
    diagnostics: {
      warningCount: warningCount(stderr),
      stderr: {
        bytes: Buffer.byteLength(stderr),
        lineCount: stderrLines,
      },
    },
    errors,
  }
}

function currentNpmVersion() {
  return /^npm\/([^\s]+)/.exec(process.env.npm_config_user_agent || '')?.[1] || ''
}

function invalidInvocationReport(projectRoot, errors) {
  return {
    schemaVersion: 1,
    kind: 'xenadmin-test-gate',
    ok: false,
    toolchain: {
      nodeVersion: process.versions.node,
      npmVersion: currentNpmVersion(),
      lockfileVersion: JSON.parse(
        readFileSync(resolve(projectRoot, 'package-lock.json'), 'utf8'),
      ).lockfileVersion,
    },
    collection: null,
    tests: null,
    diagnostics: { warningCount: 0, stderr: { bytes: 0, lineCount: 0 } },
    errors,
  }
}

function run() {
  const projectRoot = resolve(__dirname, '..')
  const invocationArguments = process.argv.slice(2)
  const coverage = invocationArguments.length === 1 && invocationArguments[0] === '--coverage'
  if (invocationArguments.includes('--coverage') && !coverage) {
    process.stdout.write(`${JSON.stringify(invalidInvocationReport(
      projectRoot,
      ['Coverage mode must be invoked exactly as --coverage'],
    ))}\n`)
    process.exitCode = 1
    return
  }

  const selectors = coverage ? [] : invocationArguments
  const forbidden = validateSelectors(selectors)

  if (forbidden.length > 0) {
    const report = invalidInvocationReport(
      projectRoot,
      forbidden.map((selector) => (
        `Focused selector is not an allowed test file: ${selector}`
      )),
    )
    process.stdout.write(`${JSON.stringify(report)}\n`)
    process.exitCode = 1
    return
  }

  const tempDirectory = mkdtempSync(join(tmpdir(), 'xenadmin-test-gate-'))
  const reportPath = resolve(tempDirectory, 'vitest.json')
  const vitestPath = resolve(projectRoot, 'node_modules/vitest/vitest.mjs')
  const coverageDirectory = resolve(projectRoot, 'coverage')
  let child
  let vitestReport = null

  try {
    if (coverage) rmSync(coverageDirectory, { recursive: true, force: true })
    child = spawnSync(
      process.execPath,
      [
        vitestPath,
        'run',
        ...(coverage ? ['--coverage', '--coverage.ignoreEmptyLines=true'] : []),
        ...selectors,
        '--config',
        resolve(projectRoot, 'vitest.config.mts'),
        '--reporter=default',
        '--reporter=json',
        `--outputFile.json=${reportPath}`,
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: process.env,
        maxBuffer: 64 * 1024 * 1024,
      },
    )
    if (child.stdout) process.stdout.write(child.stdout)
    if (child.stderr) process.stderr.write(child.stderr)
    try {
      vitestReport = JSON.parse(readFileSync(reportPath, 'utf8'))
    } catch {
      vitestReport = null
    }

    const manifest = JSON.parse(
      readFileSync(resolve(projectRoot, 'tests/test-collection.json'), 'utf8'),
    )
    const executionError = child.error ? `${child.error.stack || child.error}\n` : ''
    const testReport = evaluateTestRun({
      exitCode: child.status,
      stdout: child.stdout || '',
      stderr: `${child.stderr || ''}${executionError}`,
      vitestReport,
      expectedCollection: manifest.files,
      focused: selectors.length > 0,
      projectRoot,
      toolchain: {
        nodeVersion: process.versions.node,
        npmVersion: currentNpmVersion(),
        lockfileVersion: JSON.parse(
          readFileSync(resolve(projectRoot, 'package-lock.json'), 'utf8'),
        ).lockfileVersion,
      },
    })
    let coverageEvidence = null
    const coverageErrors = []
    if (coverage) {
      try {
        const coverageSummary = JSON.parse(
          readFileSync(resolve(coverageDirectory, 'coverage-summary.json'), 'utf8'),
        )
        const { evaluateCoverage } = require(resolve(projectRoot, 'scripts/coverage-policy.cjs'))
        coverageEvidence = evaluateCoverage(coverageSummary, projectRoot)
        mkdirSync(coverageDirectory, { recursive: true })
        writeFileSync(
          resolve(coverageDirectory, 'coverage-evidence.json'),
          `${JSON.stringify(coverageEvidence, null, 2)}\n`,
        )
        if (coverageEvidence.ok !== true) {
          coverageErrors.push(...coverageEvidence.errors.map((error) => (
            `Coverage policy failed: ${error}`
          )))
        }
      } catch (error) {
        coverageErrors.push(`Coverage evidence failed: ${error.message || error}`)
      }
    }
    const report = {
      ...testReport,
      ...(coverage ? { coverage: coverageEvidence } : {}),
      ok: testReport.ok && coverageErrors.length === 0,
      errors: [...testReport.errors, ...coverageErrors],
    }
    process.stdout.write(`${JSON.stringify(report)}\n`)
    process.exitCode = report.ok ? 0 : 1
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true })
  }
}

module.exports = {
  compareCollection,
  validateSelectors,
}

if (require.main === module) run()
