import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { SoftwareUpdateSettings } from '../components/layout/SoftwareUpdateSettings'
import { AppearanceMenu } from '../components/layout/AppearanceMenu'
import { TaskCenter } from '../components/layout/TaskCenter'
import { FeedbackOverlay } from '../components/feedback/FeedbackOverlay'

export default function SettingsPage({ standalone = false }: { standalone?: boolean }) {
  const content = <div className="mx-auto w-full max-w-2xl space-y-8">
    <h1 className="text-xl font-semibold text-foreground">设置</h1>
    <SoftwareUpdateSettings />
  </div>

  if (!standalone) return content

  return <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-background pt-[var(--window-top-offset)]">
    <div className="app-drag-region absolute inset-x-0 top-0 h-[var(--window-top-offset)]" />
    <header className="app-drag-region relative z-[45] flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 lg:px-6">
      <Link to="/connect" className="app-no-drag inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />返回连接
      </Link>
      <div className="app-no-drag flex items-center gap-2"><TaskCenter /><AppearanceMenu /></div>
    </header>
    <main className="min-w-0 flex-1 overflow-auto p-4 lg:p-6">{content}</main>
    <FeedbackOverlay />
  </div>
}
