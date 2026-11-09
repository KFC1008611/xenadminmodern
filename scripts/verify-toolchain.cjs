const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { spawnSync } = require('node:child_process')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function normalizeVersion(version) {
  return String(version || '').trim().replace(/^v/, '')
}

function readContract(projectRoot) {
  const packageJson = readJson(resolve(projectRoot, 'package.json'))
  const packageLock = readJson(resolve(projectRoot, 'package-lock.json'))
  const nvmVersion = normalizeVersion(readFileSync(resolve(projectRoot, '.nvmrc'), 'utf8'))
  const packageManagerMatch = /^npm@(\d+\.\d+\.\d+)$/.exec(packageJson.packageManager || '')

  return {
    nodeVersion: normalizeVersion(packageJson.engines?.node),
    npmVersion: packageManagerMatch?.[1] || '',
    engineNpmVersion: normalizeVersion(packageJson.engines?.npm),
    nvmVersion,
    lockfileVersion: packageLock.lockfileVersion,
  }
}

function verifyToolchain(options = {}) {
  const projectRoot = options.projectRoot || resolve(__dirname, '..')
  const nodeVersion = options.nodeVersion || process.versions.node
  const npmVersion = options.npmVersion
  const expected = readContract(projectRoot)
  const actual = {
    nodeVersion: normalizeVersion(nodeVersion),
    npmVersion: normalizeVersion(npmVersion),
    lockfileVersion: expected.lockfileVersion,
  }
  const errors = []

  if (!/^24\.\d+\.\d+$/.test(expected.nodeVersion)) {
    errors.push(`Node contract is not an exact Node 24 version: ${expected.nodeVersion || 'missing'}`)
  }
  if (!expected.npmVersion) errors.push('packageManager must pin an exact npm version')
  if (expected.engineNpmVersion !== expected.npmVersion) {
    errors.push(`engines.npm ${expected.engineNpmVersion || 'missing'} does not match packageManager ${expected.npmVersion || 'missing'}`)
  }
  if (expected.nvmVersion !== expected.nodeVersion) {
    errors.push(`.nvmrc ${expected.nvmVersion || 'missing'} does not match engines.node ${expected.nodeVersion || 'missing'}`)
  }
  if (expected.lockfileVersion !== 3) {
    errors.push(`lockfileVersion ${String(expected.lockfileVersion)} does not match required 3`)
  }
  if (actual.nodeVersion !== expected.nodeVersion) {
    errors.push(`Node ${actual.nodeVersion || 'unknown'} does not match required ${expected.nodeVersion || 'missing'}`)
  }
  if (actual.npmVersion !== expected.npmVersion) {
    errors.push(`npm ${actual.npmVersion || 'unknown'} does not match required ${expected.npmVersion || 'missing'}`)
  }

  return {
    schemaVersion: 1,
    ok: errors.length === 0,
    expected: {
      nodeVersion: expected.nodeVersion,
      npmVersion: expected.npmVersion,
      lockfileVersion: 3,
    },
    actual,
    errors,
  }
}

function currentNpmVersion() {
  const userAgentMatch = /^npm\/([^\s]+)/.exec(process.env.npm_config_user_agent || '')
  if (userAgentMatch) return userAgentMatch[1]

  const result = spawnSync('npm', ['--version'], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

module.exports = { readContract, verifyToolchain }

if (require.main === module) {
  const report = verifyToolchain({ npmVersion: currentNpmVersion() })
  const output = `${JSON.stringify(report, null, 2)}\n`
  if (report.ok) process.stdout.write(output)
  else {
    process.stderr.write(output)
    process.exitCode = 1
  }
}
