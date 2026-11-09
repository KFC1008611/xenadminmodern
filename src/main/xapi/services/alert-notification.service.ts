/** Durable notification configuration and incident delivery history. */
import { createHash, createHmac } from 'node:crypto'
import { safeStorage } from 'electron'
import { createTransport } from 'nodemailer'
import { readJsonStore, writeJsonStore } from '../../persistence/json-store'
import type {
  AlertNotificationPayload, AlertNotificationSendResult, DefaultNotificationConfig, EmailConfig,
  NotificationHistoryFilters, NotificationRecord, WebhookConfig,
} from '../../../shared/types/xapi'

let loaded = false
let notificationConfig: DefaultNotificationConfig | null = null
const notificationHistory: NotificationRecord[] = []
const deliveries = new Map<string, Promise<AlertNotificationSendResult>>()

function requireEncryption(): void {
  if (!safeStorage?.isEncryptionAvailable()
      || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
    throw new Error('NOTIFICATION_SECRET_STORE_UNAVAILABLE: 系统凭据存储不可用，配置未保存')
  }
}
function ensureLoaded(): void {
  if (loaded) return
  const encrypted = readJsonStore<string | null>('notification-config', null)
  const history = readJsonStore<NotificationRecord[]>('notification-history', [])
  if (!Array.isArray(history)) throw new Error('NOTIFICATION_HISTORY_INVALID: 本地记录已保留')
  let config: DefaultNotificationConfig | null = null
  if (encrypted !== null) {
    requireEncryption()
    config = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64')))
  }
  notificationConfig = config
  notificationHistory.push(...history.slice(0, 1000))
  loaded = true
}
function persistHistory(): void { writeJsonStore('notification-history', notificationHistory.slice(0, 1000)) }
export function getNotificationConfig(): DefaultNotificationConfig | null {
  ensureLoaded()
  return notificationConfig ? structuredClone(notificationConfig) : null
}
export function saveNotificationConfig(config: DefaultNotificationConfig): void {
  ensureLoaded(); requireEncryption()
  // The whole config includes URLs and headers which can contain bearer secrets.
  const encrypted = safeStorage.encryptString(JSON.stringify(config)).toString('base64')
  writeJsonStore('notification-config', encrypted)
  notificationConfig = structuredClone(config)
}
export function initDefaultConfig(): void {
  ensureLoaded()
  if (!notificationConfig) notificationConfig = {
    enabled: false,
    email: { enabled: false, host: '', port: 587, secure: false, auth: { user: '', pass: '' }, from: '', to: '', subjectPrefix: '[XenAdmin]' },
    webhook: { enabled: false, url: '', method: 'POST', headers: {} },
    filterSeverities: ['error', 'warning'],
  }
}

export async function sendEmailNotification(config: EmailConfig, subject: string, body: string): Promise<void> {
  if (!config.enabled) return
  const transport = createTransport({ host: config.host, port: config.port, secure: config.secure,
    auth: { user: config.auth.user, pass: config.auth.pass }, connectionTimeout: 15_000,
    greetingTimeout: 15_000, socketTimeout: 30_000 })
  try {
    await transport.sendMail({ from: config.from, to: config.to,
      subject: config.subjectPrefix ? `${config.subjectPrefix} ${subject}` : subject, html: body })
  } finally { transport.close() }
}
export async function sendWebhookNotification(config: WebhookConfig, payload: Record<string, any>): Promise<void> {
  if (!config.enabled) return
  const body = JSON.stringify(payload)
  const headers = { 'Content-Type': 'application/json', ...config.headers } as Record<string, string>
  if (config.secret) headers['X-Alert-Signature'] = createHmac('sha256', config.secret).update(body).digest('hex')
  const url = new URL(config.url)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('WEBHOOK_URL_INVALID')
  const response = await fetch(config.url, { method: config.method || 'POST', headers, body,
    redirect: 'error', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw Object.assign(new Error(`WEBHOOK_REJECTED: HTTP ${response.status}`), { code: 'WEBHOOK_REJECTED' })
}
function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}
function deliveryId(payload: AlertNotificationPayload): string {
  const identity = [payload.connectionId, payload.poolUuid || '', payload.eventId || `${payload.ruleName}:${payload.entityRef}:${payload.timestamp}`, payload.transition || 'triggered']
  return `notification-${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`
}
async function deliver(payload: AlertNotificationPayload, id: string): Promise<AlertNotificationSendResult> {
  initDefaultConfig()
  const config = notificationConfig!
  const result = { email: false, webhook: false }
  if (!config.enabled || !config.filterSeverities.includes(payload.severity)) return result
  const previous = notificationHistory.find((record) => record.id === id)
  if (previous) return { email: previous.channels.includes('email'), webhook: previous.channels.includes('webhook') }
  if (!config.email.enabled && !config.webhook.enabled) return result
  const record: NotificationRecord = {
    id, ruleName: payload.ruleName, connectionId: payload.connectionId, entityRef: payload.entityRef,
    entityName: payload.entityName, severity: payload.severity, message: payload.message,
    timestamp: payload.timestamp, channels: [], status: 'unconfirmed',
  }
  // Persist an attempt before transport. A crash or lost response is not replayed.
  notificationHistory.unshift(record); notificationHistory.length = Math.min(notificationHistory.length, 1000)
  persistHistory()
  let uncertain = false, failed = false
  for (const channel of ['email', 'webhook'] as const) {
    if (!config[channel].enabled) continue
    try {
      if (channel === 'email') {
        const rows = [['规则', payload.ruleName], ['资源池', payload.poolName], ['实体', payload.entityName], ['消息', payload.message], ['指标', `${payload.metricType ?? ''}: ${payload.metricValue ?? ''}`], ['阈值', payload.threshold ?? ''], ['时间', new Date(payload.timestamp).toISOString()]]
        const body = `<h2>${payload.transition === 'resolved' ? '告警恢复' : '告警触发'}</h2><table>${rows.map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>`).join('')}</table>`
        await sendEmailNotification(config.email, `${payload.transition === 'resolved' ? 'RESOLVED' : payload.severity.toUpperCase()}: ${payload.ruleName}`, body)
      } else await sendWebhookNotification(config.webhook, payload)
      result[channel] = true; record.channels.push(channel)
    } catch (error: any) {
      if (error?.code === 'WEBHOOK_REJECTED' || Number(error?.responseCode) >= 400) failed = true
      else uncertain = true
      // Do not persist transport messages: URLs and authentication values may be embedded.
      record.error = uncertain ? '发送结果未确认；请在接收端核对，不自动重发。' : '通知服务明确拒绝了此次发送。'
    }
    persistHistory()
  }
  record.status = uncertain ? 'unconfirmed' : failed ? 'failed' : 'sent'
  persistHistory()
  return result
}
export function sendAlertNotification(payload: AlertNotificationPayload): Promise<AlertNotificationSendResult> {
  const id = deliveryId(payload)
  let pending = deliveries.get(id)
  if (!pending) {
    pending = deliver(payload, id).finally(() => { deliveries.delete(id) })
    deliveries.set(id, pending)
  }
  return pending
}
export function getNotificationHistory(filters?: NotificationHistoryFilters): NotificationRecord[] {
  ensureLoaded()
  return notificationHistory.filter((record) => (filters?.since === undefined || record.timestamp >= filters.since)
    && (filters?.until === undefined || record.timestamp <= filters.until)
    && (!filters?.severity || record.severity === filters.severity))
    .slice(0, filters?.limit || 1000).map((record) => ({ ...record, channels: [...record.channels] }))
}
export async function testNotification(channel: 'email' | 'webhook', config: Partial<EmailConfig> | Partial<WebhookConfig>): Promise<boolean> {
  if (config.enabled !== true) throw new Error('NOTIFICATION_CHANNEL_DISABLED: 请先启用该通知渠道')
  if (channel === 'email') await sendEmailNotification(config as EmailConfig, '测试告警', '<p>这是一条测试告警消息</p>')
  else await sendWebhookNotification(config as WebhookConfig, { ruleName: '测试规则', severity: 'info', message: '这是一条测试告警消息', timestamp: Date.now() })
  return true
}
