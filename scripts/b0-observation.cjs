const { createHash } = require('node:crypto')
const {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} = require('node:fs')
const { request } = require('node:http')
const { createServer } = require('node:net')
const { tmpdir } = require('node:os')
const { basename, join, relative, resolve, sep } = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const WebSocket = require('ws')
const { verifyToolchain } = require('./verify-toolchain.cjs')

const EXPECTED_AUDITED_FEATURE_COUNT = 22
const GATE_TEST_FILES = [
  'tests/components/AuditedPoolRbacGates.test.tsx',
  'tests/components/BatchVmDeleteGate.test.tsx',
  'tests/components/CopyVmSafetyGate.test.tsx',
  'tests/components/HaGovernanceGate.test.tsx',
  'tests/components/HostLifecycleGate.test.tsx',
  'tests/components/NetworkTopologyGates.test.tsx',
  'tests/components/PatchSafetyGates.test.tsx',
  'tests/components/SrLifecycleGate.test.tsx',
  'tests/components/SrTypeSafetyGates.test.tsx',
  'tests/components/StorageDeviceDataGates.test.tsx',
  'tests/components/TemplateSnapshotDeleteGate.test.tsx',
  'tests/components/VdiSafetyGates.test.tsx',
  'tests/components/VmRelocateSafetyGate.test.tsx',
  'tests/unit/audited-features.test.ts',
  'tests/unit/batch-command-relocation-gate.test.ts',
  'tests/unit/ipc-handlers.test.ts',
]

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function portablePath(path) {
  return path.split(sep).join('/')
}

function inventoryTree(root) {
  const files = []
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) {
        files.push({
          path: portablePath(relative(root, path)),
          size: statSync(path).size,
          sha256: sha256(path),
        })
      }
    }
  }
  visit(resolve(root))
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

function buildObservationManifest(input) {
  return {
    schemaVersion: 1,
    classification: 'b0-internal-observation-only',
    source: {
      commit: input.sourceCommit,
      method: 'git-archive',
      cleanCheckout: true,
    },
    dependencyInstall: {
      command: 'npm ci',
      fixedLockfile: true,
      lockfileSha256: input.lockfileSha256,
      toolchain: input.toolchainReport,
    },
    environment: {
      builtAt: input.builtAt,
      platform: input.platform,
      arch: input.arch,
      osVersion: input.osVersion,
      nodeVersion: input.nodeVersion,
      npmVersion: input.npmVersion,
    },
    artifacts: input.artifacts,
    appInventory: input.appInventory,
    packageAudit: input.packageAudit,
    gateVerification: input.gateVerification,
    runtime: input.runtime,
    trust: {
      ...input.trust,
      formalRelease: false,
    },
    claims: {
      packagedReadOnlyGuardObservationOnly: true,
      serverCompatibilityVerified: false,
      mutationVerified: false,
      installationVerified: false,
      b1MayStart: true,
      b0ToB8FormalReleaseComplete: false,
    },
    limitations: [
      '仅证明该 commit 的 macOS arm64 未签名内部观察包可从干净 profile 冷启动并正常退出。',
      '只读门禁观察页不证明管理连接、XAPI 或 HTTP 协议兼容，也不证明任何 mutation。',
      '未使用 Developer ID，未公证，未通过 Gatekeeper，未做安装验收。',
      'Windows 和 Linux 未在对应实机验证。',
      'B0 完成不开放受保护 mutation，也不构成 B0-B8 首个正式发布。',
    ],
  }
}

function assertObservationComplete(manifest) {
  const failures = []
  if (manifest?.source?.method !== 'git-archive' || manifest?.source?.cleanCheckout !== true) {
    failures.push('source is not a clean git archive')
  }
  if (manifest?.dependencyInstall?.command !== 'npm ci' || manifest?.dependencyInstall?.fixedLockfile !== true) {
    failures.push('fixed lockfile installation is missing')
  }
  if (!/^[0-9a-f]{64}$/.test(manifest?.dependencyInstall?.lockfileSha256 || '')) {
    failures.push('lockfile hash is missing')
  }
  if (manifest?.dependencyInstall?.toolchain?.ok !== true) failures.push('fixed toolchain verification failed')
  if (!Array.isArray(manifest?.artifacts) || manifest.artifacts.length === 0) failures.push('artifacts are missing')
  if (!Array.isArray(manifest?.appInventory) || manifest.appInventory.length === 0) failures.push('app inventory is missing')
  if ((manifest?.packageAudit?.violations || []).length > 0) failures.push('package audit has violations')
  if ((manifest?.packageAudit?.unpackedEntries || []).length > 0) failures.push('unpacked allowlist is not empty')
  if (manifest?.gateVerification?.passed !== true) failures.push('guard verification did not pass')
  if (manifest?.gateVerification?.auditedFeatureCount !== manifest?.gateVerification?.expectedFeatureCount) {
    failures.push('not every audited feature was reconciled')
  }
  const featureEvidence = manifest?.gateVerification?.featureEvidence
  if (!Array.isArray(featureEvidence) || featureEvidence.length !== manifest?.gateVerification?.expectedFeatureCount) {
    failures.push('per-feature evidence is incomplete')
  } else {
    const expectedArtifactIdentity = `app.asar:sha256:${manifest?.packageAudit?.appAsarSha256}`
    const featureIds = new Set()
    for (const evidence of featureEvidence) {
      featureIds.add(evidence.id)
      if (!evidence.guardReason || evidence.sourceCommit !== manifest?.source?.commit) {
        failures.push(`feature identity is invalid: ${evidence.id || 'unknown'}`)
      }
      if (evidence.artifactIdentity !== expectedArtifactIdentity) {
        failures.push(`feature artifact identity is invalid: ${evidence.id || 'unknown'}`)
      }
      if (evidence.rendererObserved !== true || evidence.ipcZeroSubmissionVerified !== true) {
        failures.push(`feature gates are incomplete: ${evidence.id || 'unknown'}`)
      }
    }
    if (featureIds.size !== featureEvidence.length) failures.push('feature evidence contains duplicate ids')
  }
  if (manifest?.runtime?.cleanProfile !== true) failures.push('runtime profile was not isolated')
  if (manifest?.runtime?.rendererLoaded !== true) failures.push('packaged renderer did not load')
  if (manifest?.runtime?.readyState !== 'complete' || manifest?.runtime?.preloadApiAvailable !== true) {
    failures.push('renderer or preload did not finish loading')
  }
  if (!manifest?.runtime?.title || !(manifest?.runtime?.visibleTextLength > 0)) {
    failures.push('renderer did not expose a visible document')
  }
  if (manifest?.runtime?.cleanExit !== true) failures.push('packaged process did not exit cleanly')
  for (const key of ['developerIdSigned', 'notarized', 'gatekeeperAccepted', 'installed', 'formalRelease']) {
    if (manifest?.trust?.[key] !== false) failures.push(`trust.${key} must remain false`)
  }
  if (manifest?.claims?.b1MayStart !== true || manifest?.claims?.b0ToB8FormalReleaseComplete !== false) {
    failures.push('batch boundary is inconsistent')
  }
  if (failures.length > 0) throw new Error(`B0 observation candidate incomplete:\n${failures.join('\n')}`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  if (options.logPath) writeFileSync(options.logPath, output)
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status ?? 'spawn error'}):\n${output}`)
  }
  return output.trim()
}

function probe(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  return {
    passed: result.status === 0,
    exitCode: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
  }
}

function httpJson(url) {
  return new Promise((resolvePromise, reject) => {
    const req = request(url, { timeout: 1000 }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        try {
          resolvePromise(JSON.parse(body))
        } catch (error) {
          reject(error)
        }
      })
    })
    req.on('timeout', () => req.destroy(new Error('request timed out')))
    req.on('error', reject)
    req.end()
  })
}

function reserveFreePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close((error) => {
        if (error) reject(error)
        else if (!port) reject(new Error('Unable to reserve a debugging port'))
        else resolvePromise(port)
      })
    })
  })
}

async function waitForRenderer(port, child, timeoutMs = 30000) {
  const startedAt = Date.now()
  let lastError
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`packaged process exited before renderer load (${child.exitCode})`)
    try {
      const targets = await httpJson(`http://127.0.0.1:${port}/json/list`)
      const page = targets.find((target) => target.type === 'page' && target.url?.startsWith('file://'))
      if (page?.webSocketDebuggerUrl) {
        const state = await evaluatePage(page.webSocketDebuggerUrl)
        if (
          state.readyState === 'complete'
          && state.title
          && state.visibleTextLength > 0
          && state.preloadApiAvailable
          && state.guardEvidence.length === EXPECTED_AUDITED_FEATURE_COUNT
          && state.interactiveElementCount === 0
        ) {
          return { page, state, durationMs: Date.now() - startedAt }
        }
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200))
  }
  throw new Error(`renderer did not load within ${timeoutMs}ms: ${lastError || 'no page target'}`)
}

function evaluatePage(webSocketDebuggerUrl) {
  return new Promise((resolvePromise, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl)
    let settled = false
    const timer = setTimeout(() => {
      socket.terminate()
      reject(new Error('renderer evaluation timed out'))
    }, 3000)
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      if (error) reject(error)
      else resolvePromise(value)
    }
    socket.on('open', () => socket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: `(() => {
          const visibleText = document.body?.innerText || ''
          return {
            readyState: document.readyState,
            title: document.title,
            visibleText,
            visibleTextLength: visibleText.length,
            preloadApiAvailable: Boolean(window.xapi),
            interactiveElementCount: document.querySelectorAll('button, input, select, textarea, a[href]').length,
            guardEvidence: Array.from(document.querySelectorAll('[data-b0-feature-id]')).map((element) => ({
              id: element.getAttribute('data-b0-feature-id'),
              guardReason: element.getAttribute('data-b0-guard-reason'),
              sourceCommit: element.getAttribute('data-b0-source-commit'),
            })),
          }
        })()`,
        returnByValue: true,
      },
    })))
    socket.on('message', (message) => {
      const response = JSON.parse(message.toString())
      if (response.id !== 1) return
      if (response.error) finish(new Error(response.error.message))
      else if (response.result?.exceptionDetails) finish(new Error('renderer evaluation threw an exception'))
      else finish(null, response.result?.result?.value)
    })
    socket.on('error', (error) => finish(error))
  })
}

function closeBrowser(webSocketDebuggerUrl) {
  return new Promise((resolvePromise, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl)
    let commandSent = false
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolvePromise()
    }
    const timer = setTimeout(() => {
      finish(new Error('Browser.close timed out'))
      socket.terminate()
    }, 5000)
    socket.on('open', () => {
      commandSent = true
      socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
    })
    socket.on('message', (message) => {
      const response = JSON.parse(message.toString())
      if (response.id !== 1) return
      socket.close()
      finish(response.error ? new Error(response.error.message) : null)
    })
    socket.on('close', () => finish(commandSent ? null : new Error('debugging socket closed before Browser.close')))
    socket.on('error', finish)
  })
}

function waitForProcessExit(child, timeoutMs = 15000) {
  return new Promise((resolvePromise, reject) => {
    if (child.exitCode !== null) return resolvePromise(child.exitCode)
    const timer = setTimeout(() => reject(new Error('process exit timed out')), timeoutMs)
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolvePromise(code)
    })
  })
}

async function observePackagedApp(appPath, profilePath, port) {
  mkdirSync(profilePath, { recursive: true })
  const executableName = basename(appPath, '.app')
  const executable = join(appPath, 'Contents', 'MacOS', executableName)
  const child = spawn(executable, [
    `--user-data-dir=${profilePath}`,
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--b0-observation',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  child.stdout.on('data', (chunk) => { logs += chunk.toString() })
  child.stderr.on('data', (chunk) => { logs += chunk.toString() })

  try {
    const { page, state, durationMs } = await waitForRenderer(port, child)
    const version = await httpJson(`http://127.0.0.1:${port}/json/version`)
    await closeBrowser(version.webSocketDebuggerUrl)
    const exitCode = await waitForProcessExit(child)
    return {
      cleanProfile: true,
      rendererLoaded: true,
      cleanExit: exitCode === 0,
      exitCode,
      title: state.title,
      url: page.url,
      readyState: state.readyState,
      preloadApiAvailable: state.preloadApiAvailable,
      interactiveElementCount: state.interactiveElementCount,
      guardEvidence: state.guardEvidence,
      visibleTextLength: state.visibleTextLength,
      visibleTextSha256: createHash('sha256').update(state.visibleText).digest('hex'),
      durationMs,
      logs,
    }
  } catch (error) {
    child.kill('SIGTERM')
    await waitForProcessExit(child, 5000).catch(() => child.kill('SIGKILL'))
    throw error
  }
}

function readAuditedFeatureIds(sourceRoot) {
  const source = readFileSync(join(sourceRoot, 'src/shared/audited-features.ts'), 'utf8')
  const list = source.match(/AUDITED_FEATURE_IDS\s*=\s*\[([\s\S]*?)\]\s*as const/)
  if (!list) throw new Error('Unable to read AUDITED_FEATURE_IDS')
  return [...list[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
}

function findSingle(root, predicate) {
  const matches = []
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (predicate(path, entry)) {
        matches.push(path)
      } else if (entry.isDirectory()) {
        visit(path)
      }
    }
  }
  visit(root)
  if (matches.length !== 1) throw new Error(`Expected one matching path, found ${matches.length}: ${matches.join(', ')}`)
  return matches[0]
}

function artifactRecord(path, root, format) {
  return {
    format,
    path: portablePath(relative(root, path)),
    size: statSync(path).size,
    sha256: sha256(path),
  }
}

function parseOutputArgument(args) {
  const index = args.indexOf('--output')
  if (index === -1) return null
  if (!args[index + 1]) throw new Error('--output requires a directory')
  return resolve(args[index + 1])
}

async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('B0 observation candidates must be built and observed on macOS arm64')
  }

  const repository = process.cwd()
  const npmVersion = run('npm', ['--version'])
  const toolchainReport = verifyToolchain({
    projectRoot: repository,
    nodeVersion: process.version,
    npmVersion,
  })
  if (!toolchainReport.ok) {
    throw new Error(`B0 observation requires the fixed toolchain:\n${toolchainReport.errors.join('\n')}`)
  }
  const sourceCommit = run('git', ['rev-parse', 'HEAD'], { cwd: repository })
  const trackedFiles = run('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: repository }).split('\n')
  if (!trackedFiles.includes('package-lock.json')) throw new Error('package-lock.json must be tracked before building a candidate')

  const outputDir = parseOutputArgument(process.argv.slice(2))
    || join(repository, 'dist', `b0-observation-${sourceCommit.slice(0, 12)}`)
  if (existsSync(outputDir)) throw new Error(`Refusing to overwrite existing candidate: ${outputDir}`)

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'xenadmin-b0-'))
  const sourceRoot = join(temporaryRoot, 'source')
  const staging = join(temporaryRoot, 'candidate')
  mkdirSync(sourceRoot)
  mkdirSync(staging)

  try {
    const archive = join(temporaryRoot, 'source.tar')
    run('git', ['archive', '--format=tar', `--output=${archive}`, sourceCommit], { cwd: repository })
    run('tar', ['-xf', archive, '-C', sourceRoot], { cwd: repository })

    const lockfileSha256 = sha256(join(sourceRoot, 'package-lock.json'))
    run('npm', ['ci'], { cwd: sourceRoot, logPath: join(staging, 'npm-ci.log') })
    run('npx', ['vitest', 'run', ...GATE_TEST_FILES], {
      cwd: sourceRoot,
      logPath: join(staging, 'b0-gate-tests.log'),
    })
    run('npm', ['run', 'build'], {
      cwd: sourceRoot,
      env: { ...process.env, XENADMIN_SOURCE_COMMIT: sourceCommit },
      logPath: join(staging, 'bundle-build.log'),
    })
    run('npx', ['electron-builder', '--mac', '--arm64', '--publish', 'never'], {
      cwd: sourceRoot,
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
      logPath: join(staging, 'package-build.log'),
    })

    const appPath = findSingle(join(sourceRoot, 'dist'), (path, entry) => entry.isDirectory() && path.endsWith('.app'))
    const packageAuditPath = join(sourceRoot, 'dist', 'package-audit', 'darwin-arm64.json')
    const packageAudit = JSON.parse(readFileSync(packageAuditPath, 'utf8'))
    const profilePath = join(temporaryRoot, 'clean-profile')
    const runtime = await observePackagedApp(appPath, profilePath, await reserveFreePort())
    writeFileSync(join(staging, 'runtime.log'), runtime.logs)
    delete runtime.logs

    const codesign = probe('codesign', ['-dv', '--verbose=4', appPath], sourceRoot)
    const strictSignature = probe('codesign', ['--verify', '--deep', '--strict', appPath], sourceRoot)
    const notarization = probe('xcrun', ['stapler', 'validate', appPath], sourceRoot)
    const gatekeeper = probe('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath], sourceRoot)
    const trust = {
      developerIdSigned: /Authority=Developer ID Application/.test(codesign.output),
      notarized: notarization.passed,
      gatekeeperAccepted: gatekeeper.passed,
      installed: false,
      windowsRealHostVerified: false,
      linuxRealHostVerified: false,
      observations: { codesign, strictSignature, notarization, gatekeeper },
    }

    const copiedApp = join(staging, basename(appPath))
    cpSync(appPath, copiedApp, { recursive: true })
    const distributablePaths = readdirSync(join(sourceRoot, 'dist'))
      .filter((name) => name.endsWith('.dmg') || name.endsWith('-mac.zip'))
      .map((name) => join(sourceRoot, 'dist', name))
    for (const path of distributablePaths) cpSync(path, join(staging, basename(path)))
    mkdirSync(join(staging, 'package-audit'))
    cpSync(packageAuditPath, join(staging, 'package-audit', basename(packageAuditPath)))

    const artifactPaths = distributablePaths.map((path) => join(staging, basename(path)))
    const appInventory = inventoryTree(copiedApp)
    const artifacts = [
      {
        format: 'app',
        path: basename(copiedApp),
        size: appInventory.reduce((sum, entry) => sum + entry.size, 0),
        sha256: createHash('sha256').update(JSON.stringify(appInventory)).digest('hex'),
      },
      ...artifactPaths.map((path) => artifactRecord(path, staging, path.endsWith('.dmg') ? 'dmg' : 'zip')),
    ]
    const auditedFeatureIds = readAuditedFeatureIds(sourceRoot)
    const observedFeatureIds = runtime.guardEvidence.map((entry) => entry.id)
    if (JSON.stringify(observedFeatureIds) !== JSON.stringify(auditedFeatureIds)) {
      throw new Error('Packaged renderer feature evidence does not match AUDITED_FEATURE_IDS')
    }
    if (runtime.guardEvidence.some((entry) => entry.sourceCommit !== sourceCommit || !entry.guardReason)) {
      throw new Error('Packaged renderer feature evidence has stale commit identity or a missing reason')
    }
    const artifactIdentity = `app.asar:sha256:${packageAudit.appAsarSha256}`
    const featureEvidence = runtime.guardEvidence.map((entry) => ({
      ...entry,
      artifactIdentity,
      rendererObserved: true,
      ipcZeroSubmissionVerified: true,
    }))
    const manifest = buildObservationManifest({
      sourceCommit,
      lockfileSha256,
      builtAt: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      osVersion: run('sw_vers', ['-productVersion']),
      nodeVersion: process.version,
      npmVersion,
      toolchainReport,
      artifacts,
      appInventory,
      packageAudit: {
        inventoryPath: 'package-audit/darwin-arm64.json',
        schemaVersion: packageAudit.schemaVersion,
        appAsarSha256: packageAudit.appAsarSha256,
        entries: packageAudit.entries,
        unpackedEntries: packageAudit.unpackedEntries,
        violations: packageAudit.violations,
        allowlistPassed: packageAudit.violations.length === 0,
        prohibitedContentScanPassed: packageAudit.violations.length === 0,
        secretScanPassed: packageAudit.violations.length === 0,
      },
      gateVerification: {
        passed: true,
        testFiles: GATE_TEST_FILES,
        auditedFeatureCount: auditedFeatureIds.length,
        expectedFeatureCount: EXPECTED_AUDITED_FEATURE_COUNT,
        featureEvidence,
        readOnlyObservationRetained: true,
        ipcZeroSubmissionVerified: true,
      },
      runtime,
      trust,
    })
    assertObservationComplete(manifest)
    writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    cpSync(staging, outputDir, { recursive: true, errorOnExist: true })
    process.stdout.write(`${outputDir}\n`)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

module.exports = {
  assertObservationComplete,
  buildObservationManifest,
  findSingle,
  inventoryTree,
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`)
    process.exitCode = 1
  })
}
