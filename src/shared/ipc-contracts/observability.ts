import * as Ch from '../channels'
import {
  defineInvokeContract,
  definePushContract,
  type IpcRuntimeSchema,
} from '../ipc-contract'
import type {
  AlertFilters,
  AlertHistoryCount,
  AlertHistoryFilters,
  AlertHistoryRecord,
  AlertNotificationPayload,
  AlertNotificationSendResult,
  AlertRule,
  AlertRuleInput,
  AlertRuleUpdate,
  ConnectedAlertRecord,
  DefaultNotificationConfig,
  EmailConfig,
  HostMetricsHistory,
  MetricDataPoint,
  MetricsCollectionOptions,
  MetricsRangeParams,
  MetricStats,
  MetricType,
  NotificationConfigSaveResult,
  NotificationHistoryFilters,
  NotificationRecord,
  NotificationTestArgs,
  VmMetricDataPoint,
  WebhookConfig,
} from '../types/xapi'
import {
  hasOwn,
  identifierArgsSchema,
  invalid,
  noArgsSchema,
  nullableStringResultSchema,
  requireArray,
  requireBoolean,
  requireEnum,
  requireExactKeys,
  requireFiniteNumber,
  requireNonBlankString,
  requireNonNegativeNumber,
  requireOpenStringRecord,
  requirePlainObject,
  requirePositiveInteger,
  requireRef,
  requireString,
  requireTuple,
  voidResultSchema,
  type UnknownRecord,
} from './runtime-schema'

const METRIC_TYPES = new Set<MetricType>([
  'cpu',
  'memory',
  'networkRx',
  'networkTx',
  'diskRead',
  'diskWrite',
])
const ALERT_SEVERITIES = new Set<AlertHistoryRecord['severity']>(['warning', 'error'])
const XAPI_ALERT_SEVERITIES = new Set<ConnectedAlertRecord['severity']>([
  'error',
  'warning',
  'info',
])
const NOTIFICATION_SEVERITIES = new Set<NotificationRecord['severity']>([
  'error',
  'warning',
  'info',
])
const ALERT_OPERATORS = new Set<AlertRule['operator']>(['>', '<', '>=', '<='])
const ALERT_TARGET_TYPES = new Set<NonNullable<AlertRule['targetType']>>(['host', 'vm'])
const ALERT_HISTORY_STATUSES = new Set<AlertHistoryRecord['status']>([
  'active',
  'acknowledged',
  'resolved',
])
const DOWNSAMPLE_INTERVALS = new Set<NonNullable<MetricsRangeParams['downsample']>>([
  'none',
  '1m',
  '5m',
  '1h',
])
const WEBHOOK_METHODS = new Set<NonNullable<WebhookConfig['method']>>(['POST', 'PUT'])

function requireNonNegativeSafeInteger(value: unknown, label: string): number {
  const result = requireNonNegativeNumber(value, label)
  if (!Number.isSafeInteger(result)) invalid(label)
  return result
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  const result = requirePositiveInteger(value, label)
  if (!Number.isSafeInteger(result)) invalid(label)
  return result
}

function parseTimestamp(value: unknown, label: string): number {
  return requireNonNegativeNumber(value, label)
}

function parseConnectionId(value: unknown): string {
  return requireNonBlankString(value, 'connection identity')
}

const connectionArgsSchema: IpcRuntimeSchema<[string]> = {
  parse(value: unknown): [string] {
    const [connectionId] = requireTuple(value, 1, 'metrics connection arguments')
    return [parseConnectionId(connectionId)]
  },
}

function parseMetricsCollectionOptions(value: unknown): MetricsCollectionOptions {
  const options = requirePlainObject(value, 'metrics collection options')
  requireExactKeys(
    options,
    [],
    ['interval', 'maxDataPoints'],
    'metrics collection options',
  )
  if (options.interval !== undefined) {
    requirePositiveSafeInteger(options.interval, 'metrics collection interval')
  }
  if (options.maxDataPoints !== undefined) {
    requirePositiveSafeInteger(options.maxDataPoints, 'metrics collection capacity')
  }
  return value as MetricsCollectionOptions
}

const metricsStartCollectionArgsSchema: IpcRuntimeSchema<[
  string,
  MetricsCollectionOptions?,
]> = {
  parse(value: unknown): [string, MetricsCollectionOptions?] {
    const args = requireTuple(value, 1, 'metrics collection arguments', 1)
    const connectionId = parseConnectionId(args[0])
    if (args.length === 1) return [connectionId]
    return [
      connectionId,
      args[1] === undefined ? undefined : parseMetricsCollectionOptions(args[1]),
    ]
  },
}

function parseMetricsRange(value: unknown): MetricsRangeParams {
  const range = requirePlainObject(value, 'metrics range')
  requireExactKeys(range, ['startTime', 'endTime'], ['downsample'], 'metrics range')
  const startTime = parseTimestamp(range.startTime, 'metrics range start')
  const endTime = parseTimestamp(range.endTime, 'metrics range end')
  if (startTime > endTime) invalid('metrics range')
  if (range.downsample !== undefined) {
    requireEnum(range.downsample, DOWNSAMPLE_INTERVALS, 'metrics downsample interval')
  }
  return value as MetricsRangeParams
}

const metricsRangeArgsSchema: IpcRuntimeSchema<[string, string, MetricsRangeParams]> = {
  parse(value: unknown): [string, string, MetricsRangeParams] {
    const [connectionId, ref, range] = requireTuple(value, 3, 'metrics range arguments')
    return [
      parseConnectionId(connectionId),
      requireRef(ref, 'metrics entity reference'),
      parseMetricsRange(range),
    ]
  },
}

const metricsStatsArgsSchema: IpcRuntimeSchema<[
  string,
  string,
  MetricType,
  MetricsRangeParams,
]> = {
  parse(value: unknown): [string, string, MetricType, MetricsRangeParams] {
    const [connectionId, ref, metricType, range] = requireTuple(
      value,
      4,
      'metrics statistics arguments',
    )
    return [
      parseConnectionId(connectionId),
      requireRef(ref, 'metrics entity reference'),
      requireEnum(metricType, METRIC_TYPES, 'metric type'),
      parseMetricsRange(range),
    ]
  },
}

function parseMetricDataPoint(value: unknown): MetricDataPoint {
  const point = requirePlainObject(value, 'metric data point')
  requireExactKeys(
    point,
    ['timestamp', 'cpuPercent', 'memoryPercent'],
    ['networkRxBytes', 'networkTxBytes', 'diskReadBytes', 'diskWriteBytes', 'availableMetrics'],
    'metric data point',
  )
  parseTimestamp(point.timestamp, 'metric timestamp')
  requireFiniteNumber(point.cpuPercent, 'CPU percentage')
  requireFiniteNumber(point.memoryPercent, 'memory percentage')
  if (point.availableMetrics !== undefined) parseAvailableMetrics(point.availableMetrics)
  for (const key of [
    'networkRxBytes',
    'networkTxBytes',
    'diskReadBytes',
    'diskWriteBytes',
  ] as const) {
    if (point[key] !== undefined) requireNonNegativeNumber(point[key], `metric ${key}`)
  }
  return value as MetricDataPoint
}

function parseVmMetricDataPoint(value: unknown): VmMetricDataPoint {
  const point = requirePlainObject(value, 'VM metric data point')
  requireExactKeys(
    point,
    ['timestamp', 'cpuPercent', 'memoryPercent'],
    [
      'memoryUsed',
      'memoryTotal',
      'networkRxBytes',
      'networkTxBytes',
      'diskReadBytes',
      'diskWriteBytes',
      'availableMetrics',
    ],
    'VM metric data point',
  )
  parseTimestamp(point.timestamp, 'VM metric timestamp')
  requireFiniteNumber(point.cpuPercent, 'VM CPU percentage')
  requireFiniteNumber(point.memoryPercent, 'VM memory percentage')
  if (point.availableMetrics !== undefined) parseAvailableMetrics(point.availableMetrics)
  for (const key of [
    'memoryUsed',
    'memoryTotal',
    'networkRxBytes',
    'networkTxBytes',
    'diskReadBytes',
    'diskWriteBytes',
  ] as const) {
    if (point[key] !== undefined) requireNonNegativeNumber(point[key], `VM metric ${key}`)
  }
  return value as VmMetricDataPoint
}

function parseAvailableMetrics(value: unknown): void {
  const allowed = ['cpuPercent', 'memoryPercent', 'networkRxBytes', 'networkTxBytes', 'diskReadBytes', 'diskWriteBytes', 'memoryBytes', 'memoryTotalKiB']
  if (!Array.isArray(value) || value.some((key) => typeof key !== 'string' || !allowed.includes(key))) throw new Error('Invalid available metric names')
}

const hostMetricsHistoryResultSchema: IpcRuntimeSchema<HostMetricsHistory[]> = {
  parse(value: unknown): HostMetricsHistory[] {
    return requireArray(value, 'host metrics history').map((entry) => {
      const history = requirePlainObject(entry, 'host metrics history entry')
      requireExactKeys(
        history,
        ['hostRef', 'hostName', 'dataPoints'],
        [],
        'host metrics history entry',
      )
      requireRef(history.hostRef, 'host reference')
      requireString(history.hostName, 'host name')
      requireArray(history.dataPoints, 'host metric data points').forEach(parseMetricDataPoint)
      return entry as HostMetricsHistory
    })
  },
}

const metricDataPointsResultSchema: IpcRuntimeSchema<MetricDataPoint[]> = {
  parse(value: unknown): MetricDataPoint[] {
    return requireArray(value, 'metric data points').map(parseMetricDataPoint)
  },
}

const vmMetricDataPointsResultSchema: IpcRuntimeSchema<VmMetricDataPoint[]> = {
  parse(value: unknown): VmMetricDataPoint[] {
    return requireArray(value, 'VM metric data points').map(parseVmMetricDataPoint)
  },
}

const metricStatsResultSchema: IpcRuntimeSchema<MetricStats> = {
  parse(value: unknown): MetricStats {
    const stats = requirePlainObject(value, 'metric statistics')
    requireExactKeys(stats, ['current', 'max', 'avg', 'min'], ['sampleCount'], 'metric statistics')
    if (stats.sampleCount !== undefined) requireNonNegativeNumber(stats.sampleCount, 'metric sample count')
    requireFiniteNumber(stats.current, 'current metric value')
    requireFiniteNumber(stats.max, 'maximum metric value')
    requireFiniteNumber(stats.avg, 'average metric value')
    requireFiniteNumber(stats.min, 'minimum metric value')
    return value as MetricStats
  },
}

function parseAlertFilters(value: unknown): AlertFilters {
  const filters = requirePlainObject(value, 'alert filters')
  requireExactKeys(
    filters,
    [],
    ['severity', 'since', 'until', 'objUuid'],
    'alert filters',
  )
  if (filters.severity !== undefined) {
    requireArray(filters.severity, 'alert severities').forEach((severity) => {
      requireEnum(severity, XAPI_ALERT_SEVERITIES, 'alert severity')
    })
  }
  const since = filters.since === undefined
    ? undefined
    : parseTimestamp(filters.since, 'alert start timestamp')
  const until = filters.until === undefined
    ? undefined
    : parseTimestamp(filters.until, 'alert end timestamp')
  if (since !== undefined && until !== undefined && since > until) invalid('alert time range')
  if (filters.objUuid !== undefined) requireNonBlankString(filters.objUuid, 'alert object UUID')
  return value as AlertFilters
}

function parseOptionalConnectionFiltersArgs(
  value: unknown,
  label: string,
): [string, AlertFilters?] {
  const args = requireTuple(value, 1, label, 1)
  const connectionId = parseConnectionId(args[0])
  if (args.length === 1) return [connectionId]
  return [connectionId, args[1] === undefined ? undefined : parseAlertFilters(args[1])]
}

const alertsGetAllArgsSchema: IpcRuntimeSchema<[string, AlertFilters?]> = {
  parse: (value) => parseOptionalConnectionFiltersArgs(value, 'alert list arguments'),
}

const alertsDismissAllArgsSchema: IpcRuntimeSchema<[string, AlertFilters?]> = {
  parse: (value) => parseOptionalConnectionFiltersArgs(value, 'alert dismissal arguments'),
}

const alertsDismissArgsSchema: IpcRuntimeSchema<[string, string]> = {
  parse(value: unknown): [string, string] {
    const [connectionId, alertRef] = requireTuple(value, 2, 'alert dismissal arguments')
    return [parseConnectionId(connectionId), requireRef(alertRef, 'alert reference')]
  },
}

function parseConnectedAlertRecord(value: unknown): ConnectedAlertRecord {
  const alert = requirePlainObject(value, 'connected alert record')
  requireExactKeys(
    alert,
    [
      'ref',
      'uuid',
      'name',
      'priority',
      'severity',
      'body',
      'timestamp',
      'cls',
      'objUuid',
      'connectionId',
      'poolName',
    ],
    [],
    'connected alert record',
  )
  requireRef(alert.ref, 'alert reference')
  requireString(alert.uuid, 'alert UUID')
  requireString(alert.name, 'alert name')
  requireNonNegativeSafeInteger(alert.priority, 'alert priority')
  requireEnum(alert.severity, XAPI_ALERT_SEVERITIES, 'alert severity')
  requireString(alert.body, 'alert body')
  parseTimestamp(alert.timestamp, 'alert timestamp')
  requireString(alert.cls, 'alert class')
  requireString(alert.objUuid, 'alert object UUID')
  parseConnectionId(alert.connectionId)
  requireString(alert.poolName, 'alert pool name')
  return value as ConnectedAlertRecord
}

const connectedAlertsResultSchema: IpcRuntimeSchema<ConnectedAlertRecord[]> = {
  parse(value: unknown): ConnectedAlertRecord[] {
    return requireArray(value, 'connected alerts').map(parseConnectedAlertRecord)
  },
}

const nonNegativeIntegerResultSchema: IpcRuntimeSchema<number> = {
  parse(value: unknown): number {
    return requireNonNegativeSafeInteger(value, 'non-negative integer result')
  },
}

function parseRuleThreshold(metricType: MetricType, value: unknown): number {
  const threshold = requireNonNegativeNumber(value, 'alert rule threshold')
  if ((metricType === 'cpu' || metricType === 'memory') && threshold > 100) {
    invalid('alert rule threshold')
  }
  return threshold
}

function validateRuleTarget(rule: UnknownRecord, allowUndefinedPair = false): void {
  const hasTargetRef = hasOwn(rule, 'targetRef')
  const hasTargetType = hasOwn(rule, 'targetType')
  if (hasTargetRef !== hasTargetType) invalid('alert rule target')
  if (hasTargetRef) {
    if (allowUndefinedPair && rule.targetRef === undefined && rule.targetType === undefined) return
    requireRef(rule.targetRef, 'alert rule target reference')
    requireEnum(rule.targetType, ALERT_TARGET_TYPES, 'alert rule target type')
  }
}

function validateRuleFields(rule: UnknownRecord, allowUndefinedTargetPair = false): void {
  if (hasOwn(rule, 'name')) {
    const name = requireNonBlankString(rule.name, 'alert rule name')
    if (name.length > 100) invalid('alert rule name')
  }
  let metricType: MetricType | undefined
  if (hasOwn(rule, 'metricType')) {
    metricType = requireEnum(rule.metricType, METRIC_TYPES, 'alert rule metric type')
  }
  if (hasOwn(rule, 'operator')) {
    requireEnum(rule.operator, ALERT_OPERATORS, 'alert rule operator')
  }
  if (hasOwn(rule, 'threshold')) {
    if (metricType === undefined) {
      requireNonNegativeNumber(rule.threshold, 'alert rule threshold')
    } else {
      parseRuleThreshold(metricType, rule.threshold)
    }
  }
  if (hasOwn(rule, 'duration')) {
    const duration = requirePositiveInteger(rule.duration, 'alert rule duration')
    if (duration > 1440) invalid('alert rule duration')
  }
  if (hasOwn(rule, 'severity')) {
    requireEnum(rule.severity, ALERT_SEVERITIES, 'alert rule severity')
  }
  if (rule.connectionId !== undefined) parseConnectionId(rule.connectionId)
  if (hasOwn(rule, 'enabled')) requireBoolean(rule.enabled, 'alert rule enabled state')
  validateRuleTarget(rule, allowUndefinedTargetPair)
}

function parseAlertRuleInput(value: unknown): AlertRuleInput {
  const rule = requirePlainObject(value, 'alert rule input')
  requireExactKeys(
    rule,
    ['name', 'metricType', 'operator', 'threshold', 'duration', 'severity'],
    ['enabled', 'targetRef', 'targetType', 'connectionId'],
    'alert rule input',
  )
  validateRuleFields(rule, true)
  parseRuleThreshold(rule.metricType as MetricType, rule.threshold)
  return value as AlertRuleInput
}

function parseAlertRuleUpdate(value: unknown): AlertRuleUpdate {
  const rule = requirePlainObject(value, 'alert rule update')
  requireExactKeys(
    rule,
    [],
    [
      'name',
      'metricType',
      'operator',
      'threshold',
      'duration',
      'severity',
      'enabled',
      'targetRef',
      'targetType', 'connectionId',
    ],
    'alert rule update',
  )
  if (Object.keys(rule).length === 0) invalid('empty alert rule update')
  validateRuleFields(rule, true)
  return value as AlertRuleUpdate
}

function parseAlertRule(value: unknown): AlertRule {
  const rule = requirePlainObject(value, 'alert rule')
  requireExactKeys(
    rule,
    [
      'id',
      'name',
      'metricType',
      'operator',
      'threshold',
      'duration',
      'severity',
      'enabled',
      'createdAt',
      'updatedAt',
    ],
    ['targetRef', 'targetType', 'connectionId'],
    'alert rule',
  )
  requireNonBlankString(rule.id, 'alert rule identity')
  validateRuleFields(rule, true)
  parseRuleThreshold(rule.metricType as MetricType, rule.threshold)
  parseTimestamp(rule.createdAt, 'alert rule creation timestamp')
  parseTimestamp(rule.updatedAt, 'alert rule update timestamp')
  return value as AlertRule
}

const alertRuleInputArgsSchema: IpcRuntimeSchema<[AlertRuleInput]> = {
  parse(value: unknown): [AlertRuleInput] {
    const [rule] = requireTuple(value, 1, 'alert rule creation arguments')
    return [parseAlertRuleInput(rule)]
  },
}

const alertRuleUpdateArgsSchema: IpcRuntimeSchema<[string, AlertRuleUpdate]> = {
  parse(value: unknown): [string, AlertRuleUpdate] {
    const [id, update] = requireTuple(value, 2, 'alert rule update arguments')
    return [requireNonBlankString(id, 'alert rule identity'), parseAlertRuleUpdate(update)]
  },
}

const alertRuleResultSchema: IpcRuntimeSchema<AlertRule> = {
  parse: parseAlertRule,
}

const alertRulesResultSchema: IpcRuntimeSchema<AlertRule[]> = {
  parse(value: unknown): AlertRule[] {
    return requireArray(value, 'alert rules').map(parseAlertRule)
  },
}

function parseAlertHistoryRecord(value: unknown): AlertHistoryRecord {
  const record = requirePlainObject(value, 'alert history record')
  requireExactKeys(
    record,
    [
      'id',
      'ruleId',
      'ruleName',
      'connectionId',
      'entityRef',
      'entityName',
      'metricType',
      'metricValue',
      'threshold',
      'severity',
      'triggeredAt',
      'status',
    ],
    ['acknowledgedAt', 'resolvedAt', 'poolUuid'],
    'alert history record',
  )
  requireNonBlankString(record.id, 'alert history identity')
  requireNonBlankString(record.ruleId, 'alert history rule identity')
  requireNonBlankString(record.ruleName, 'alert history rule name')
  parseConnectionId(record.connectionId)
  if (record.poolUuid !== undefined) requireNonBlankString(record.poolUuid, 'alert resource pool identity')
  requireRef(record.entityRef, 'alert history entity reference')
  requireString(record.entityName, 'alert history entity name')
  requireEnum(record.metricType, METRIC_TYPES, 'alert history metric type')
  requireFiniteNumber(record.metricValue, 'alert history metric value')
  requireNonNegativeNumber(record.threshold, 'alert history threshold')
  requireEnum(record.severity, ALERT_SEVERITIES, 'alert history severity')
  parseTimestamp(record.triggeredAt, 'alert trigger timestamp')
  const status = requireEnum(record.status, ALERT_HISTORY_STATUSES, 'alert history status')
  const hasAcknowledgedAt = hasOwn(record, 'acknowledgedAt')
  const hasResolvedAt = hasOwn(record, 'resolvedAt')
  if (
    (status === 'active' && (hasAcknowledgedAt || hasResolvedAt))
    || (status === 'acknowledged' && (!hasAcknowledgedAt || hasResolvedAt))
    || (status === 'resolved' && !hasResolvedAt)
  ) invalid('alert history status timestamps')
  if (hasAcknowledgedAt) {
    parseTimestamp(record.acknowledgedAt, 'alert acknowledgement timestamp')
  }
  if (hasResolvedAt) parseTimestamp(record.resolvedAt, 'alert resolution timestamp')
  return value as AlertHistoryRecord
}

function parseAlertHistoryFilters(value: unknown): AlertHistoryFilters {
  const filters = requirePlainObject(value, 'alert history filters')
  requireExactKeys(
    filters,
    [],
    ['status', 'severity', 'since', 'until', 'connectionId'],
    'alert history filters',
  )
  if (filters.status !== undefined) {
    requireArray(filters.status, 'alert history statuses').forEach((status) => {
      requireEnum(status, ALERT_HISTORY_STATUSES, 'alert history status')
    })
  }
  if (filters.severity !== undefined) {
    requireArray(filters.severity, 'alert history severities').forEach((severity) => {
      requireEnum(severity, ALERT_SEVERITIES, 'alert history severity')
    })
  }
  const since = filters.since === undefined
    ? undefined
    : parseTimestamp(filters.since, 'alert history start timestamp')
  const until = filters.until === undefined
    ? undefined
    : parseTimestamp(filters.until, 'alert history end timestamp')
  if (since !== undefined && until !== undefined && since > until) {
    invalid('alert history time range')
  }
  if (filters.connectionId !== undefined) parseConnectionId(filters.connectionId)
  return value as AlertHistoryFilters
}

const alertHistoryListArgsSchema: IpcRuntimeSchema<[AlertHistoryFilters?]> = {
  parse(value: unknown): [AlertHistoryFilters?] {
    const args = requireTuple(value, 0, 'alert history list arguments', 1)
    if (args.length === 0) return []
    return [args[0] === undefined ? undefined : parseAlertHistoryFilters(args[0])]
  },
}

const alertHistoryRecordsResultSchema: IpcRuntimeSchema<AlertHistoryRecord[]> = {
  parse(value: unknown): AlertHistoryRecord[] {
    return requireArray(value, 'alert history records').map(parseAlertHistoryRecord)
  },
}

const alertHistoryCountResultSchema: IpcRuntimeSchema<AlertHistoryCount> = {
  parse(value: unknown): AlertHistoryCount {
    const count = requirePlainObject(value, 'alert history count')
    requireExactKeys(
      count,
      ['active', 'acknowledged', 'resolved'],
      [],
      'alert history count',
    )
    requireNonNegativeSafeInteger(count.active, 'active alert count')
    requireNonNegativeSafeInteger(count.acknowledged, 'acknowledged alert count')
    requireNonNegativeSafeInteger(count.resolved, 'resolved alert count')
    return value as AlertHistoryCount
  },
}

const alertTriggeredArgsSchema: IpcRuntimeSchema<[AlertHistoryRecord]> = {
  parse(value: unknown): [AlertHistoryRecord] {
    const [record] = requireTuple(value, 1, 'alert-triggered event arguments')
    return [parseAlertHistoryRecord(record)]
  },
}

function parseEmailAuth(value: unknown): EmailConfig['auth'] {
  const auth = requirePlainObject(value, 'email authentication')
  requireExactKeys(auth, ['user', 'pass'], [], 'email authentication')
  requireString(auth.user, 'email authentication user')
  requireString(auth.pass, 'email authentication password')
  return value as EmailConfig['auth']
}

function parseEmailConfig(value: unknown): EmailConfig {
  const config = requirePlainObject(value, 'email notification configuration')
  requireExactKeys(
    config,
    ['enabled', 'host', 'port', 'secure', 'auth', 'from', 'to'],
    ['subjectPrefix'],
    'email notification configuration',
  )
  requireBoolean(config.enabled, 'email enabled state')
  const host = requireString(config.host, 'email host')
  const port = requirePositiveSafeInteger(config.port, 'email port')
  if (port > 65_535) invalid('email port')
  requireBoolean(config.secure, 'email secure state')
  const auth = parseEmailAuth(config.auth)
  const from = requireString(config.from, 'email sender')
  const to = requireString(config.to, 'email recipient')
  if (config.enabled === true) {
    requireNonBlankString(host, 'email host')
    requireNonBlankString(auth.user, 'email authentication user')
    requireNonBlankString(from, 'email sender')
    requireNonBlankString(to, 'email recipient')
  }
  if (config.subjectPrefix !== undefined) {
    requireString(config.subjectPrefix, 'email subject prefix')
  }
  return value as EmailConfig
}

function requireHttpUrl(value: unknown, label: string): string {
  const url = requireNonBlankString(value, label)
  let protocol: string
  try {
    protocol = new URL(url).protocol
  } catch {
    return invalid(label)
  }
  if (protocol !== 'http:' && protocol !== 'https:') invalid(label)
  return url
}

function parseWebhookConfig(value: unknown): WebhookConfig {
  const config = requirePlainObject(value, 'webhook notification configuration')
  requireExactKeys(
    config,
    ['enabled', 'url'],
    ['method', 'headers', 'secret'],
    'webhook notification configuration',
  )
  const enabled = requireBoolean(config.enabled, 'webhook enabled state')
  if (enabled) requireHttpUrl(config.url, 'webhook URL')
  else requireString(config.url, 'webhook URL')
  if (config.method !== undefined) {
    requireEnum(config.method, WEBHOOK_METHODS, 'webhook method')
  }
  if (config.headers !== undefined) {
    requireOpenStringRecord(config.headers, 'webhook headers')
  }
  if (config.secret !== undefined) requireString(config.secret, 'webhook secret')
  return value as WebhookConfig
}

function parseNotificationConfig(value: unknown): DefaultNotificationConfig {
  const config = requirePlainObject(value, 'notification configuration')
  requireExactKeys(
    config,
    ['enabled', 'email', 'webhook', 'filterSeverities'],
    [],
    'notification configuration',
  )
  requireBoolean(config.enabled, 'notifications enabled state')
  parseEmailConfig(config.email)
  parseWebhookConfig(config.webhook)
  requireArray(config.filterSeverities, 'notification severity filters').forEach(
    (severity) => requireEnum(
      severity,
      NOTIFICATION_SEVERITIES,
      'notification severity filter',
    ),
  )
  return value as DefaultNotificationConfig
}

function parsePartialEmailConfig(value: unknown): Partial<EmailConfig> {
  const config = requirePlainObject(value, 'partial email notification configuration')
  requireExactKeys(
    config,
    [],
    ['enabled', 'host', 'port', 'secure', 'auth', 'from', 'to', 'subjectPrefix'],
    'partial email notification configuration',
  )
  if (config.enabled !== undefined) requireBoolean(config.enabled, 'email enabled state')
  if (config.host !== undefined) requireString(config.host, 'email host')
  if (config.port !== undefined) {
    const port = requirePositiveSafeInteger(config.port, 'email port')
    if (port > 65_535) invalid('email port')
  }
  if (config.secure !== undefined) requireBoolean(config.secure, 'email secure state')
  if (config.auth !== undefined) parseEmailAuth(config.auth)
  if (config.from !== undefined) requireString(config.from, 'email sender')
  if (config.to !== undefined) requireString(config.to, 'email recipient')
  if (config.subjectPrefix !== undefined) {
    requireString(config.subjectPrefix, 'email subject prefix')
  }
  return value as Partial<EmailConfig>
}

function parsePartialWebhookConfig(value: unknown): Partial<WebhookConfig> {
  const config = requirePlainObject(value, 'partial webhook notification configuration')
  requireExactKeys(
    config,
    [],
    ['enabled', 'url', 'method', 'headers', 'secret'],
    'partial webhook notification configuration',
  )
  const enabled = config.enabled === undefined
    ? undefined
    : requireBoolean(config.enabled, 'webhook enabled state')
  if (config.url !== undefined) {
    if (enabled) requireHttpUrl(config.url, 'webhook URL')
    else requireString(config.url, 'webhook URL')
  } else if (enabled) {
    invalid('webhook URL')
  }
  if (config.method !== undefined) {
    requireEnum(config.method, WEBHOOK_METHODS, 'webhook method')
  }
  if (config.headers !== undefined) {
    requireOpenStringRecord(config.headers, 'webhook headers')
  }
  if (config.secret !== undefined) requireString(config.secret, 'webhook secret')
  return value as Partial<WebhookConfig>
}

const notificationConfigArgsSchema: IpcRuntimeSchema<[DefaultNotificationConfig]> = {
  parse(value: unknown): [DefaultNotificationConfig] {
    const [config] = requireTuple(value, 1, 'notification configuration arguments')
    return [parseNotificationConfig(config)]
  },
}

const notificationTestArgsSchema: IpcRuntimeSchema<NotificationTestArgs> = {
  parse(value: unknown): NotificationTestArgs {
    const [channel, config] = requireTuple(value, 2, 'notification test arguments')
    if (channel === 'email') {
      const parsed = parsePartialEmailConfig(config)
      const keys: Array<keyof EmailConfig> = [
        'enabled',
        'host',
        'port',
        'secure',
        'auth',
        'from',
        'to',
      ]
      if (parsed.enabled !== true || keys.some((key) => !hasOwn(config as UnknownRecord, key))) {
        invalid('email notification test configuration')
      }
      requireNonBlankString(parsed.host, 'email host')
      requireNonBlankString(parsed.auth?.user, 'email authentication user')
      requireNonBlankString(parsed.from, 'email sender')
      requireNonBlankString(parsed.to, 'email recipient')
      return ['email', parsed]
    }
    if (channel === 'webhook') {
      const parsed = parsePartialWebhookConfig(config)
      if (parsed.enabled !== true) invalid('webhook notification test configuration')
      return ['webhook', parsed]
    }
    return invalid('notification channel')
  },
}

function parseNotificationHistoryFilters(value: unknown): NotificationHistoryFilters {
  const filters = requirePlainObject(value, 'notification history filters')
  requireExactKeys(
    filters,
    [],
    ['since', 'until', 'severity', 'limit'],
    'notification history filters',
  )
  const since = filters.since === undefined
    ? undefined
    : parseTimestamp(filters.since, 'notification history start timestamp')
  const until = filters.until === undefined
    ? undefined
    : parseTimestamp(filters.until, 'notification history end timestamp')
  if (since !== undefined && until !== undefined && since > until) {
    invalid('notification history time range')
  }
  if (filters.severity !== undefined) {
    requireEnum(filters.severity, NOTIFICATION_SEVERITIES, 'notification history severity')
  }
  if (filters.limit !== undefined) {
    requirePositiveSafeInteger(filters.limit, 'notification history limit')
  }
  return value as NotificationHistoryFilters
}

const notificationHistoryArgsSchema: IpcRuntimeSchema<[NotificationHistoryFilters?]> = {
  parse(value: unknown): [NotificationHistoryFilters?] {
    const args = requireTuple(value, 0, 'notification history arguments', 1)
    if (args.length === 0) return []
    return [args[0] === undefined ? undefined : parseNotificationHistoryFilters(args[0])]
  },
}

function parseNotificationRecord(value: unknown): NotificationRecord {
  const record = requirePlainObject(value, 'notification record')
  requireExactKeys(
    record,
    [
      'id',
      'ruleName',
      'connectionId',
      'entityRef',
      'entityName',
      'severity',
      'message',
      'timestamp',
      'channels',
      'status',
    ],
    ['error'],
    'notification record',
  )
  requireNonBlankString(record.id, 'notification identity')
  requireNonBlankString(record.ruleName, 'notification rule name')
  parseConnectionId(record.connectionId)
  requireRef(record.entityRef, 'notification entity reference')
  requireString(record.entityName, 'notification entity name')
  requireEnum(record.severity, NOTIFICATION_SEVERITIES, 'notification severity')
  requireString(record.message, 'notification message')
  parseTimestamp(record.timestamp, 'notification timestamp')
  requireArray(record.channels, 'notification channels').forEach((channel) => {
    if (channel !== 'email' && channel !== 'webhook') invalid('notification channel')
  })
  if (record.status !== 'sent' && record.status !== 'failed' && record.status !== 'unconfirmed') invalid('notification status')
  if (record.error !== undefined) requireString(record.error, 'notification error')
  return value as NotificationRecord
}

function parseAlertNotificationPayload(value: unknown): AlertNotificationPayload {
  const payload = requirePlainObject(value, 'alert notification payload')
  requireExactKeys(
    payload,
    [
      'ruleName',
      'connectionId',
      'poolName',
      'entityRef',
      'entityName',
      'severity',
      'message',
      'timestamp',
    ],
    ['metricType', 'metricValue', 'threshold', 'eventId', 'transition', 'poolUuid'],
    'alert notification payload',
  )
  if (payload.eventId !== undefined) requireNonBlankString(payload.eventId, 'notification event identity')
  if (payload.poolUuid !== undefined) requireNonBlankString(payload.poolUuid, 'notification resource pool identity')
  if (payload.transition !== undefined && payload.transition !== 'triggered' && payload.transition !== 'resolved') invalid('notification transition')
  requireNonBlankString(payload.ruleName, 'notification rule name')
  parseConnectionId(payload.connectionId)
  requireString(payload.poolName, 'notification pool name')
  requireRef(payload.entityRef, 'notification entity reference')
  requireString(payload.entityName, 'notification entity name')
  requireEnum(payload.severity, NOTIFICATION_SEVERITIES, 'notification severity')
  requireString(payload.message, 'notification message')
  parseTimestamp(payload.timestamp, 'notification timestamp')
  const metricKeys = ['metricType', 'metricValue', 'threshold'] as const
  const definedMetricKeyCount = metricKeys.filter((key) => payload[key] !== undefined).length
  if (definedMetricKeyCount !== 0 && definedMetricKeyCount !== metricKeys.length) {
    invalid('notification metric details')
  }
  if (payload.metricType !== undefined) {
    requireNonBlankString(payload.metricType, 'notification metric type')
  }
  if (payload.metricValue !== undefined) {
    requireFiniteNumber(payload.metricValue, 'notification metric value')
  }
  if (payload.threshold !== undefined) {
    requireFiniteNumber(payload.threshold, 'notification threshold')
  }
  return value as AlertNotificationPayload
}

const notificationPayloadArgsSchema: IpcRuntimeSchema<[AlertNotificationPayload]> = {
  parse(value: unknown): [AlertNotificationPayload] {
    const [payload] = requireTuple(value, 1, 'alert notification arguments')
    return [parseAlertNotificationPayload(payload)]
  },
}

const notificationConfigResultSchema: IpcRuntimeSchema<DefaultNotificationConfig> = {
  parse: parseNotificationConfig,
}

const notificationConfigSaveResultSchema: IpcRuntimeSchema<NotificationConfigSaveResult> = {
  parse(value: unknown): NotificationConfigSaveResult {
    const result = requirePlainObject(value, 'notification configuration save result')
    requireExactKeys(result, ['success'], [], 'notification configuration save result')
    if (result.success !== true) invalid('notification configuration save result')
    return value as NotificationConfigSaveResult
  },
}

const notificationTestResultSchema: IpcRuntimeSchema<boolean> = {
  parse(value: unknown): boolean {
    return requireBoolean(value, 'notification test result')
  },
}

const notificationHistoryResultSchema: IpcRuntimeSchema<NotificationRecord[]> = {
  parse(value: unknown): NotificationRecord[] {
    return requireArray(value, 'notification history').map(parseNotificationRecord)
  },
}

const notificationSendResultSchema: IpcRuntimeSchema<AlertNotificationSendResult> = {
  parse(value: unknown): AlertNotificationSendResult {
    const result = requirePlainObject(value, 'notification send result')
    requireExactKeys(result, ['email', 'webhook'], [], 'notification send result')
    requireBoolean(result.email, 'email notification result')
    requireBoolean(result.webhook, 'webhook notification result')
    return value as AlertNotificationSendResult
  },
}

const invokeBoundary = {
  callerPolicy: 'app-window-main-frame' as const,
  redaction: ['none'] as const,
  errorShape: 'ipc-error-response-v1' as const,
}

export const metricsStartCollectionContract = defineInvokeContract({
  channel: Ch.METRICS_START_COLLECTION,
  argsSchema: metricsStartCollectionArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const metricsStopCollectionContract = defineInvokeContract({
  channel: Ch.METRICS_STOP_COLLECTION,
  argsSchema: connectionArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const metricsGetHistoryContract = defineInvokeContract({
  channel: Ch.METRICS_GET_HISTORY,
  argsSchema: connectionArgsSchema,
  resultSchema: hostMetricsHistoryResultSchema,
  ...invokeBoundary,
})

export const metricsGetRangeContract = defineInvokeContract({
  channel: Ch.METRICS_GET_RANGE,
  argsSchema: metricsRangeArgsSchema,
  resultSchema: metricDataPointsResultSchema,
  ...invokeBoundary,
})

export const metricsGetStatsContract = defineInvokeContract({
  channel: Ch.METRICS_GET_STATS,
  argsSchema: metricsStatsArgsSchema,
  resultSchema: metricStatsResultSchema,
  ...invokeBoundary,
})

export const metricsGetVmHistoryContract = defineInvokeContract({
  channel: Ch.METRICS_GET_VM_HISTORY,
  argsSchema: metricsRangeArgsSchema,
  resultSchema: vmMetricDataPointsResultSchema,
  ...invokeBoundary,
})

export const metricsGetCollectionErrorContract = defineInvokeContract({
  channel: Ch.METRICS_GET_COLLECTION_ERROR,
  argsSchema: connectionArgsSchema,
  resultSchema: nullableStringResultSchema,
  ...invokeBoundary,
})

export const alertsGetAllContract = defineInvokeContract({
  channel: Ch.ALERTS_GET_ALL,
  argsSchema: alertsGetAllArgsSchema,
  resultSchema: connectedAlertsResultSchema,
  ...invokeBoundary,
})

export const alertsDismissContract = defineInvokeContract({
  channel: Ch.ALERTS_DISMISS,
  argsSchema: alertsDismissArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const alertsDismissAllContract = defineInvokeContract({
  channel: Ch.ALERTS_DISMISS_ALL,
  argsSchema: alertsDismissAllArgsSchema,
  resultSchema: nonNegativeIntegerResultSchema,
  ...invokeBoundary,
})

export const alertRulesListContract = defineInvokeContract({
  channel: Ch.ALERT_RULES_LIST,
  argsSchema: noArgsSchema,
  resultSchema: alertRulesResultSchema,
  ...invokeBoundary,
})

export const alertRulesCreateContract = defineInvokeContract({
  channel: Ch.ALERT_RULES_CREATE,
  argsSchema: alertRuleInputArgsSchema,
  resultSchema: alertRuleResultSchema,
  ...invokeBoundary,
})

export const alertRulesUpdateContract = defineInvokeContract({
  channel: Ch.ALERT_RULES_UPDATE,
  argsSchema: alertRuleUpdateArgsSchema,
  resultSchema: alertRuleResultSchema,
  ...invokeBoundary,
})

export const alertRulesDeleteContract = defineInvokeContract({
  channel: Ch.ALERT_RULES_DELETE,
  argsSchema: identifierArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const alertRulesEvaluateContract = defineInvokeContract({
  channel: Ch.ALERT_RULES_EVALUATE,
  argsSchema: noArgsSchema,
  resultSchema: alertHistoryRecordsResultSchema,
  ...invokeBoundary,
})

export const alertHistoryListContract = defineInvokeContract({
  channel: Ch.ALERT_HISTORY_LIST,
  argsSchema: alertHistoryListArgsSchema,
  resultSchema: alertHistoryRecordsResultSchema,
  ...invokeBoundary,
})

export const alertHistoryAcknowledgeContract = defineInvokeContract({
  channel: Ch.ALERT_HISTORY_ACKNOWLEDGE,
  argsSchema: identifierArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const alertHistoryGetCountContract = defineInvokeContract({
  channel: Ch.ALERT_HISTORY_GET_COUNT,
  argsSchema: noArgsSchema,
  resultSchema: alertHistoryCountResultSchema,
  ...invokeBoundary,
})

export const alertNotifyConfigGetContract = defineInvokeContract({
  channel: Ch.ALERT_NOTIFY_CONFIG_GET,
  argsSchema: noArgsSchema,
  resultSchema: notificationConfigResultSchema,
  ...invokeBoundary,
})

export const alertNotifyConfigSaveContract = defineInvokeContract({
  channel: Ch.ALERT_NOTIFY_CONFIG_SAVE,
  argsSchema: notificationConfigArgsSchema,
  resultSchema: notificationConfigSaveResultSchema,
  ...invokeBoundary,
  redaction: ['notification-secret'],
})

export const alertNotifyTestContract = defineInvokeContract({
  channel: Ch.ALERT_NOTIFY_TEST,
  argsSchema: notificationTestArgsSchema,
  resultSchema: notificationTestResultSchema,
  ...invokeBoundary,
  redaction: ['notification-secret'],
})

export const alertNotifyHistoryContract = defineInvokeContract({
  channel: Ch.ALERT_NOTIFY_HISTORY,
  argsSchema: notificationHistoryArgsSchema,
  resultSchema: notificationHistoryResultSchema,
  ...invokeBoundary,
})

export const alertNotifySendContract = defineInvokeContract({
  channel: Ch.ALERT_NOTIFY_SEND,
  argsSchema: notificationPayloadArgsSchema,
  resultSchema: notificationSendResultSchema,
  ...invokeBoundary,
})

export const alertTriggeredContract = definePushContract({
  channel: Ch.EVENT_ALERT_TRIGGERED,
  argsSchema: alertTriggeredArgsSchema,
  callerPolicy: 'main-process',
  redaction: ['none'],
})

export const observabilityInvokeContracts = [
  metricsStartCollectionContract,
  metricsStopCollectionContract,
  metricsGetHistoryContract,
  metricsGetRangeContract,
  metricsGetStatsContract,
  metricsGetVmHistoryContract,
  metricsGetCollectionErrorContract,
  alertsGetAllContract,
  alertsDismissContract,
  alertsDismissAllContract,
  alertRulesListContract,
  alertRulesCreateContract,
  alertRulesUpdateContract,
  alertRulesDeleteContract,
  alertRulesEvaluateContract,
  alertHistoryListContract,
  alertHistoryAcknowledgeContract,
  alertHistoryGetCountContract,
  alertNotifyConfigGetContract,
  alertNotifyConfigSaveContract,
  alertNotifyTestContract,
  alertNotifyHistoryContract,
  alertNotifySendContract,
] as const

export const observabilityContracts = [
  ...observabilityInvokeContracts,
  alertTriggeredContract,
] as const
