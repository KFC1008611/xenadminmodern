/**
 * NotificationConfigPanel - Alert notification configuration panel.
 * v9: Rewritten to use Tailwind CSS instead of shadcn/ui.
 */
import { useState, useEffect } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { Bell, Mail, Globe, Loader2, Save, Send } from 'lucide-react'
import { feedback } from '../../store/feedback.store'

interface EmailConfig {
  enabled: boolean
  host: string
  port: number
  secure: boolean
  auth: { user: string; pass: string }
  from: string
  to: string
  subjectPrefix?: string
}

interface WebhookConfig {
  enabled: boolean
  url: string
  method?: 'POST' | 'PUT'
  headers?: Record<string, string>
  secret?: string
}

interface NotificationConfig {
  enabled: boolean
  email: EmailConfig
  webhook: WebhookConfig
  filterSeverities: ('error' | 'warning' | 'info')[]
}

export function NotificationConfigPanel() {
  const [config, setConfig] = useState<NotificationConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [activeNotifyTab, setActiveNotifyTab] = useState('email')

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const cfg = await window.xapi.alertNotify.getConfig()
      setConfig(cfg)
    } catch (err: any) {
      setLoadError(err?.message || '加载配置失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!config) return

    setSaving(true)
    try {
      await window.xapi.alertNotify.saveConfig(config)
      feedback.success('配置已保存')
    } catch (err: any) {
      feedback.error(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async (channel: 'email' | 'webhook') => {
    if (!config) return

    setTesting(true)
    try {
      const testConfig = channel === 'email' ? config.email : config.webhook
      const result = await window.xapi.alertNotify.test(channel, testConfig)
      if (result) {
        feedback.success('测试消息发送成功')
      } else {
        feedback.error('测试消息发送失败')
      }
    } catch (err: any) {
      feedback.error(err.message || '测试失败')
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">加载配置中...</span>
      </div>
    )
  }

  if (!config) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center">
        <Bell className="w-8 h-8 text-subtle mx-auto mb-3" />
        <p className="text-muted-foreground text-sm">无法加载通知配置</p>
        {loadError && <p role="alert" className="mt-2 break-words text-sm text-danger">{loadError}</p>}
        <button type="button" onClick={() => void loadConfig()} className="mt-4 rounded-lg border border-input px-3 py-2 text-sm text-secondary-foreground">重新读取通知配置</button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
            <Bell className="w-4 h-4 text-accent-foreground" />
            告警通知
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">启用通知</span>
          <button
            type="button" role="switch" aria-label="启用通知" aria-checked={config.enabled}
            onClick={() => setConfig({ ...config, enabled: !config.enabled })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              config.enabled ? 'bg-primary' : 'bg-secondary'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              config.enabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
      </div>

      {/* Severity filter */}
      <div className="bg-card border border-border rounded-xl p-4">
        <p className="text-xs text-muted-foreground mb-2">通知严重性过滤</p>
        <div className="flex gap-4">
          {(['error', 'warning', 'info'] as const).map((sev) => (
            <label key={sev} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.filterSeverities.includes(sev)}
                onChange={(e) => {
                  const severities = e.target.checked
                    ? [...config.filterSeverities, sev]
                    : config.filterSeverities.filter((s) => s !== sev)
                  setConfig({ ...config, filterSeverities: severities })
                }}
                className="rounded border-input bg-muted text-accent-foreground focus:ring-primary"
              />
              <span className="text-sm text-secondary-foreground">
                {sev === 'error' ? '错误' : sev === 'warning' ? '警告' : '信息'}
              </span>
            </label>
          ))}
        </div>
      </div>

      <Tabs.Root value={activeNotifyTab} onValueChange={setActiveNotifyTab}>
        <div className="mb-4 overflow-x-auto border-b border-border">
          <Tabs.List className="flex min-w-max gap-1">
            <Tabs.Trigger
              value="email"
              className="relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors data-[state=active]:text-accent-foreground outline-none after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary after:scale-x-0 after:transition-transform data-[state=active]:after:scale-x-100"
            >
              <Mail className="w-3.5 h-3.5" />
              邮件
            </Tabs.Trigger>
            <Tabs.Trigger
              value="webhook"
              className="relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors data-[state=active]:text-accent-foreground outline-none after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary after:scale-x-0 after:transition-transform data-[state=active]:after:scale-x-100"
            >
              <Globe className="w-3.5 h-3.5" />
              Webhook
            </Tabs.Trigger>
          </Tabs.List>
        </div>

        {/* Email config */}
        <Tabs.Content value="email" className="outline-none">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium text-foreground">SMTP 配置</h4>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">启用</span>
                <button
                  type="button" role="switch" aria-label="启用邮件通知" aria-checked={config.email.enabled}
                  onClick={() => setConfig({ ...config, email: { ...config.email, enabled: !config.email.enabled } })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    config.email.enabled ? 'bg-primary' : 'bg-secondary'
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    config.email.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="notify-smtp-host" className="text-xs text-muted-foreground mb-1.5 block">SMTP 主机</label>
                  <input
                    id="notify-smtp-host"
                    value={config.email.host}
                    onChange={(e) => setConfig({ ...config, email: { ...config.email, host: e.target.value } })}
                    placeholder="smtp.example.com"
                    className="w-full px-3 py-2 text-sm bg-muted border border-input rounded-lg text-foreground placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label htmlFor="notify-smtp-port" className="text-xs text-muted-foreground mb-1.5 block">端口</label>
                  <input
                    id="notify-smtp-port"
                    type="number"
                    value={config.email.port}
                    onChange={(e) => setConfig({ ...config, email: { ...config.email, port: parseInt(e.target.value, 10) } })}
                    className="w-full px-3 py-2 text-sm bg-muted border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="notify-email-from" className="text-xs text-muted-foreground mb-1.5 block">发件人</label>
                <input
                  id="notify-email-from"
                  value={config.email.from}
                  onChange={(e) => setConfig({ ...config, email: { ...config.email, from: e.target.value } })}
                  placeholder="alerts@example.com"
                  className="w-full px-3 py-2 text-sm bg-muted border border-input rounded-lg text-foreground placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label htmlFor="notify-email-to" className="text-xs text-muted-foreground mb-1.5 block">收件人</label>
                <input
                  id="notify-email-to"
                  value={config.email.to}
                  onChange={(e) => setConfig({ ...config, email: { ...config.email, to: e.target.value } })}
                  placeholder="admin@example.com"
                  className="w-full px-3 py-2 text-sm bg-muted border border-input rounded-lg text-foreground placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="notify-email-user" className="text-xs text-muted-foreground mb-1.5 block">用户名</label>
                  <input
                    id="notify-email-user"
                    value={config.email.auth.user}
                    onChange={(e) => setConfig({ ...config, email: { ...config.email, auth: { ...config.email.auth, user: e.target.value } } })}
                    className="w-full px-3 py-2 text-sm bg-muted border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label htmlFor="notify-email-password" className="text-xs text-muted-foreground mb-1.5 block">密码</label>
                  <input
                    id="notify-email-password"
                    type="password"
                    value={config.email.auth.pass}
                    onChange={(e) => setConfig({ ...config, email: { ...config.email, auth: { ...config.email.auth, pass: e.target.value } } })}
                    className="w-full px-3 py-2 text-sm bg-muted border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => handleTest('email')}
                  disabled={testing || !config.email.enabled}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-muted hover:bg-secondary disabled:opacity-50 text-foreground rounded-lg transition-colors border border-input"
                >
                  <Send className="w-3 h-3" />
                  {testing ? '发送中...' : '测试'}
                </button>
              </div>
            </div>
          </div>
        </Tabs.Content>

        {/* Webhook config */}
        <Tabs.Content value="webhook" className="outline-none">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium text-foreground">Webhook 配置</h4>
                <p className="text-xs text-subtle mt-0.5">发送告警到外部系统</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">启用</span>
                <button
                  type="button" role="switch" aria-label="启用 Webhook 通知" aria-checked={config.webhook.enabled}
                  onClick={() => setConfig({ ...config, webhook: { ...config.webhook, enabled: !config.webhook.enabled } })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    config.webhook.enabled ? 'bg-primary' : 'bg-secondary'
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    config.webhook.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label htmlFor="notify-webhook-url" className="text-xs text-muted-foreground mb-1.5 block">Webhook URL</label>
                <input
                  id="notify-webhook-url"
                  value={config.webhook.url}
                  onChange={(e) => setConfig({ ...config, webhook: { ...config.webhook, url: e.target.value } })}
                  placeholder="https://hooks.slack.com/..."
                  className="w-full px-3 py-2 text-sm bg-muted border border-input rounded-lg text-foreground placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label htmlFor="notify-webhook-method" className="text-xs text-muted-foreground mb-1.5 block">HTTP 方法</label>
                <select
                  id="notify-webhook-method"
                  value={config.webhook.method || 'POST'}
                  onChange={(e) => setConfig({ ...config, webhook: { ...config.webhook, method: e.target.value as 'POST' | 'PUT' } })}
                  className="w-full px-3 py-2 text-sm bg-muted border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                </select>
              </div>
              <div>
                <label htmlFor="notify-webhook-secret" className="text-xs text-muted-foreground mb-1.5 block">密钥 (可选，用于 HMAC 签名)</label>
                <input
                  id="notify-webhook-secret"
                  type="password"
                  value={config.webhook.secret || ''}
                  onChange={(e) => setConfig({ ...config, webhook: { ...config.webhook, secret: e.target.value } })}
                  placeholder="your-secret-key"
                  className="w-full px-3 py-2 text-sm bg-muted border border-input rounded-lg text-foreground placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => handleTest('webhook')}
                  disabled={testing || !config.webhook.enabled}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-muted hover:bg-secondary disabled:opacity-50 text-foreground rounded-lg transition-colors border border-input"
                >
                  <Send className="w-3 h-3" />
                  {testing ? '发送中...' : '测试'}
                </button>
              </div>
            </div>
          </div>
        </Tabs.Content>
      </Tabs.Root>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving || testing}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary hover:bg-primary-hover disabled:bg-secondary disabled:text-subtle disabled:cursor-not-allowed text-primary-foreground rounded-lg transition-colors"
        >
          <Save className="w-4 h-4" />
          {saving ? '保存中...' : '保存配置'}
        </button>
      </div>
    </div>
  )
}
