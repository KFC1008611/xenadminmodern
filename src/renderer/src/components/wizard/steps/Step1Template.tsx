/**
 * Step 1 — Template selection.
 * Loads all VM templates, supports live search and groups by OS family.
 */
import { useEffect, useState } from 'react'
import { Search, Loader2 } from 'lucide-react'
import type { VmRecord } from '../../../types/xapi'

interface Step1TemplateProps {
  connectionId: string
  selectedTemplateRef: string
  onSelect: (template: VmRecord) => void
}

type OsFamily = 'Windows' | 'Linux' | 'Other'

const OS_FAMILY_ORDER: OsFamily[] = ['Windows', 'Linux', 'Other']

function inferOsFamily(nameLabel: string): OsFamily {
  const name = nameLabel.toLowerCase()
  if (name.includes('windows') || name.includes('win')) return 'Windows'
  if (
    name.includes('linux') ||
    name.includes('ubuntu') ||
    name.includes('debian') ||
    name.includes('centos') ||
    name.includes('rhel') ||
    name.includes('fedora') ||
    name.includes('suse') ||
    name.includes('oracle') ||
    name.includes('coreos')
  )
    return 'Linux'
  return 'Other'
}

export default function Step1Template({ connectionId, selectedTemplateRef, onSelect }: Step1TemplateProps) {
  const [templates, setTemplates] = useState<VmRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let current = true
    setTemplates([])
    setError(null)
    setLoading(true)
    if (!connectionId) {
      setError('没有可用的资源池连接')
      setLoading(false)
      return undefined
    }
    window.xapi.vm.templates(connectionId)
      .then((result) => {
        if (!current) return
        // 合并用户模板和系统模板供选择
        const allTemplates = [...(result.user || []), ...(result.system || [])]
        setTemplates(allTemplates)
      })
      .catch((err: any) => { if (current) setError(err?.message || '模板读取失败') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [connectionId, retry])

  const filtered = templates.filter((t) =>
    t.name_label.toLowerCase().includes(search.toLowerCase())
  )

  const grouped = OS_FAMILY_ORDER.reduce<Record<OsFamily, VmRecord[]>>(
    (acc, family) => {
      acc[family] = filtered.filter((t) => inferOsFamily(t.name_label) === family)
      return acc
    },
    { Windows: [], Linux: [], Other: [] }
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        正在加载模板...
      </div>
    )
  }

  if (error) {
    return (
      <div role="alert" className="break-words p-4 bg-danger-soft border border-danger/30 rounded-lg text-danger text-sm">
        {error}
        <button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-3 block rounded bg-muted px-3 py-2 text-foreground">重新读取模板</button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
        <input
          type="text"
          placeholder="Search templates..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-muted border border-input rounded-lg text-foreground placeholder-subtle focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label="Search templates"
        />
      </div>

      <div className="space-y-4 max-h-72 overflow-y-auto pr-1">
        {OS_FAMILY_ORDER.map((family) =>
          grouped[family].length > 0 ? (
            <div key={family}>
              <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2">
                {family}
              </h3>
              <div className="space-y-1">
                {grouped[family].map((template) => (
                  <button
                    key={template.ref}
                    type="button"
                    onClick={() => onSelect(template)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
                      selectedTemplateRef === template.ref
                        ? 'bg-primary text-primary-foreground'
                        : 'text-secondary-foreground hover:bg-secondary'
                    }`}
                  >
                    <div className="break-all font-medium text-sm">{template.name_label}</div>
                    {template.name_description && (
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">
                        {template.name_description}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : null
        )}
        {filtered.length === 0 && (
          <p className="text-center text-subtle py-8">No templates match your search</p>
        )}
      </div>
    </div>
  )
}
