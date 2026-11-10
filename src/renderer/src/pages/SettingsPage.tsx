import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { SoftwareUpdateSettings } from '../components/layout/SoftwareUpdateSettings'
import { TaskCenter } from '../components/layout/TaskCenter'
import { FeedbackOverlay } from '../components/feedback/FeedbackOverlay'
import { useThemeStore } from '../store/theme.store'

export default function SettingsPage({ standalone = false }: { standalone?: boolean }) {
  const { theme, setTheme } = useThemeStore()
  const content = <div className="mx-auto w-full max-w-2xl space-y-8">
    <h1 className={standalone ? 'text-xl font-semibold text-foreground' : 'sr-only'}>设置</h1>
    <section aria-labelledby="appearance-heading" className="!mt-0 space-y-3">
      <h2 id="appearance-heading" className="text-base font-medium">外观</h2>
      <div role="group" aria-label="外观" className="flex gap-2">
        {([{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }] as const).map((choice) => <button key={choice.value} type="button" aria-pressed={theme === choice.value} onClick={() => setTheme(choice.value)}
          className={`rounded-md border px-4 py-2 text-sm ${theme === choice.value ? 'border-primary bg-accent text-accent-foreground' : 'border-border bg-card text-muted-foreground'}`}>{choice.label}</button>)}
      </div>
    </section>
    <SoftwareUpdateSettings />
  </div>

  if (!standalone) return content

  return <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-background pt-[var(--window-top-offset)]">
    <div className="app-drag-region absolute inset-x-0 top-0 h-[var(--window-top-offset)]" />
    <header className="app-drag-region relative z-[45] flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 lg:px-6">
      <Link to="/connect" className="app-no-drag inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />返回连接
      </Link>
      <div className="app-no-drag flex items-center gap-2"><TaskCenter /></div>
    </header>
    <main className="min-w-0 flex-1 overflow-auto p-4 lg:p-6">{content}</main>
    <FeedbackOverlay />
  </div>
}
