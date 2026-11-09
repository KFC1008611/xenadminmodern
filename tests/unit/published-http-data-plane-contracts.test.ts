import { describe, expect, it } from 'vitest'
import {
  assertAuditedFeatureAvailable,
  getAuditedFeatureBlockReason,
} from '../../src/shared/audited-features'
import matrix from '../contracts/published-http-data-plane-matrix.json'

const EXPECTED_ENDPOINT_IDENTITIES = [
  ['GET', '/export', 'published'],
  ['PUT', '/import', 'published'],
  ['GET', '/host_rrd', 'published'],
  ['GET', '/vm_rrd', 'published'],
  ['GET', '/rrd_updates', 'published'],
  ['CONNECT', '/console', 'published'],
  ['PUT', '/pool_patch_upload', 'guarded'],
]

const EXPECTED_QUERIES: Record<string, string[]> = {
  '/export': ['task_id', 'session_id', 'uuid', 'use_compression', 'preserve_power_state'],
  '/import': ['task_id', 'session_id', 'restore', 'force', 'sr_id'],
  '/host_rrd': ['task_id', 'session_id', 'json'],
  '/vm_rrd': ['task_id', 'session_id', 'uuid'],
  '/rrd_updates': ['task_id', 'session_id', 'start', 'cf', 'interval', 'host', 'uuid', 'json'],
  '/console': ['console-location-parameters-except-session_id'],
  '/pool_patch_upload': ['task_id', 'session_id', 'sr_id'],
}

const BOUNDED_REDIRECT_POLICY = {
  statusCodes: [302],
  maxHops: 10,
  scheme: 'same-or-stronger',
  authority: 'same-authority-only-pending-verified-pool-membership',
  preserve: ['method', 'body', 'query'],
  conflictingSessionOrTask: 'fail-closed',
}

describe('Published HTTP data-plane contract catalog', () => {
  it('pins endpoint identities and independent transport invariants without duplicating the catalog', () => {
    expect(matrix.schemaVersion).toBe(1)
    expect(matrix.authorities).toEqual([
      {
        repository: 'refs/xenadmin',
        commit: 'ba43130ffb30d05d1eb40187b8ef9f2de111468a',
        paths: [
          'XenModel/XenAPI/HTTP_actions.cs',
          'XenModel/XenAPI/HTTP.cs',
          'XenModel/Network/HTTPHelper.cs',
          'XenModel/XenSearch/MetricUpdater.cs',
          'XenAdmin/Controls/CustomDataGraph/ArchiveMaintainer.cs',
          'XenModel/Actions/VM/ImportVmAction.cs',
        ],
      },
      {
        repository: 'xapi-project/xen-api',
        commit: 'b59864f8ed40a99be4ef310859f6c6c803469e3f',
        paths: [
          'doc/content/xen-api/topics/importexport.md',
          'doc/content/xen-api/usage.md',
        ],
      },
    ])
    expect(matrix.endpoints.map(({ method, path, support }) => [method, path, support]))
      .toEqual(EXPECTED_ENDPOINT_IDENTITIES)

    for (const endpoint of matrix.endpoints) {
      expect(endpoint.queryParameters).toEqual(EXPECTED_QUERIES[endpoint.path])
      expect(endpoint.schemeSource).toBeTruthy()
      expect(endpoint.authoritySource).toBeTruthy()
      expect(endpoint.tlsPolicy).toBeTruthy()
      expect(endpoint.streamDirection).toBeTruthy()
      expect(endpoint.terminalSource).toBeTruthy()
      expect(endpoint.cancellation).toBeTruthy()
      expect(endpoint.timeoutPolicy.mode).toBeTruthy()
      expect(endpoint.timeoutPolicy.replay).toBe('forbid')
      expect(endpoint.backpressurePolicy).toBeTruthy()
    }

    for (const endpoint of matrix.endpoints.filter(({ path }) => path !== '/console')) {
      expect(endpoint.redirectPolicy).toEqual(BOUNDED_REDIRECT_POLICY)
    }
    expect(matrix.endpoints.find(({ path }) => path === '/console')?.redirectPolicy).toBe('forbid')
    expect(matrix.endpoints.find(({ path }) => path === '/rrd_updates')?.queryAliases).toEqual([
      {
        alias: 'vm_uuid',
        canonicalParameter: 'uuid',
        lifecycle: 'xenadmin-observed',
      },
    ])
  })

  it('records the implemented timeout modes while guarded upload remains fail closed', () => {
    for (const path of ['/export', '/import']) {
      expect(matrix.endpoints.find((endpoint) => endpoint.path === path)?.timeoutPolicy).toEqual({
        mode: 'disabled-pending-b5',
        reason: 'large-file-idle-timeout-unverified',
        replay: 'forbid',
      })
    }
    for (const path of ['/host_rrd', '/vm_rrd', '/rrd_updates']) {
      expect(matrix.endpoints.find((endpoint) => endpoint.path === path)?.timeoutPolicy).toEqual({
        mode: 'hard',
        milliseconds: 15_000,
        scope: 'dns-connect-tls-redirect-and-response-body',
        replay: 'forbid',
      })
    }
    expect(matrix.endpoints.find(({ path }) => path === '/console')?.timeoutPolicy).toEqual({
      mode: 'connect-header-deadline',
      milliseconds: 15_000,
      scope: 'tcp-tls-connect-and-http-connect-response-headers',
      replay: 'forbid',
    })
    expect(matrix.endpoints.find(({ path }) => path === '/pool_patch_upload'))
      .toMatchObject({ support: 'guarded', timeoutPolicy: { mode: 'required-before-ungating' } })

    const reason = getAuditedFeatureBlockReason('patch.mutate')
    expect(reason).toContain('暂不可用')
    expect(() => assertAuditedFeatureAvailable('patch.mutate')).toThrow(reason ?? '')
  })
})
