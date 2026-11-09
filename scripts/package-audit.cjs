const { createHash } = require('node:crypto')
const { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } = require('node:fs')
const { basename, join, relative, resolve, sep } = require('node:path')
const asar = require('@electron/asar')

const APPROVED_ROOTS = ['out', 'package.json']
const FORBIDDEN_SEGMENTS = new Set([
  '.scratch',
  'coverage',
  'docs',
  'refs',
  'src',
  'tests',
])
const FORBIDDEN_FILE_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /(?:^|[-_.])profile(?:[-_.]|$)/i,
  /(?:^|[-_.])password(?:[-_.]|$)/i,
  /\.(?:cer|crt|key|log|p12|pem|pfx)$/i,
]
const SECRET_PATTERNS = [
  { label: 'private key', pattern: /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/ },
  {
    label: 'embedded credential',
    pattern: /\b(?:password|passwd|secret|token)\s*[:=]\s*["'][^"'\s]{8,}["']/i,
  },
]

function findFiles(root, wantedName, found = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      findFiles(path, wantedName, found)
    } else if (entry.name === wantedName) {
      found.push(path)
    }
  }
  return found
}

function isForbiddenPath(path) {
  const segments = path.replace(/^\//, '').split('/')
  const root = segments[0]
  if (!APPROVED_ROOTS.includes(root)) return `unapproved root: ${path}`
  if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) return `forbidden path: ${path}`
  if (segments.some((segment) => FORBIDDEN_FILE_PATTERNS.some((pattern) => pattern.test(segment)))) {
    return `forbidden path: ${path}`
  }
  return null
}

function scanContent(path, content) {
  const violations = []
  for (const { label, pattern } of SECRET_PATTERNS) {
    if (pattern.test(content)) violations.push(`${label}: ${path}`)
  }
  return violations
}

function listUnpackedFiles(root) {
  if (!existsSync(root)) return []
  const files = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...listUnpackedFiles(path))
    else files.push(path)
  }
  return files
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

async function auditPackagedApplication({ appOutDir, platform, arch, outputDir }) {
  const asarPaths = findFiles(resolve(appOutDir), 'app.asar')
  if (asarPaths.length !== 1) {
    throw new Error(`Package audit expected one app.asar, found ${asarPaths.length}`)
  }

  const asarPath = asarPaths[0]
  const entries = asar.listPackage(asarPath)
    .filter((entry) => !asar.statFile(asarPath, entry.slice(1)).files)
    .sort()
  const violations = []
  const entryDetails = []

  for (const entry of entries) {
    const pathViolation = isForbiddenPath(entry)
    if (pathViolation) violations.push(pathViolation)
    const content = asar.extractFile(asarPath, entry.slice(1))
    violations.push(...scanContent(entry, content.toString('utf8')))
    entryDetails.push({
      path: entry,
      size: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
    })
  }

  const unpackedRoot = `${asarPath}.unpacked`
  const unpackedFiles = listUnpackedFiles(unpackedRoot)
  for (const file of unpackedFiles) {
    violations.push(`unexpected unpacked file: /${relative(unpackedRoot, file).split(sep).join('/')}`)
  }

  const auditDir = resolve(outputDir)
  mkdirSync(auditDir, { recursive: true })
  const inventoryPath = join(auditDir, `${platform}-${arch}.json`)
  const inventory = {
    schemaVersion: 2,
    platform,
    arch,
    approvedRoots: APPROVED_ROOTS,
    appAsarSha256: sha256(asarPath),
    entries,
    entryDetails,
    unpackedEntries: unpackedFiles.map((file) => `/${relative(unpackedRoot, file).split(sep).join('/')}`).sort(),
    violations,
  }
  writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`)

  if (violations.length > 0) {
    throw new Error(`Package audit failed:\n${violations.join('\n')}`)
  }

  return { inventoryPath, entries, violations }
}

function archName(arch) {
  return ['ia32', 'x64', 'armv7l', 'arm64', 'universal'][arch] || String(arch || process.arch)
}

async function afterPack(context) {
  return auditPackagedApplication({
    appOutDir: context.appOutDir,
    platform: context.electronPlatformName || context.packager.platform.nodeName,
    arch: archName(context.arch),
    outputDir: join(context.outDir, 'package-audit'),
  })
}

module.exports = afterPack
module.exports.auditPackagedApplication = auditPackagedApplication

if (require.main === module) {
  const appOutDir = process.argv[2]
  if (!appOutDir) {
    process.stderr.write('Usage: npm run package:audit -- <app-output-directory> [audit-output-directory]\n')
    process.exitCode = 2
  } else {
    auditPackagedApplication({
      appOutDir,
      platform: process.platform,
      arch: process.arch,
      outputDir: process.argv[3] || join(resolve(appOutDir, '..'), 'package-audit'),
    }).then(
      ({ inventoryPath }) => process.stdout.write(`${inventoryPath}\n`),
      (error) => {
        process.stderr.write(`${error.stack || error}\n`)
        process.exitCode = 1
      },
    )
  }
}
