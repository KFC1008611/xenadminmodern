/**
 * AppShell — the two-column authenticated application layout (sidebar + content).
 *
 * UX Architecture Redesign:
 * - Scope navigation and resource navigation share the current route
 * - Added FeedbackOverlay for unified toast/progress/confirm system
 */
import { ReactNode, useState } from 'react'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import { FeedbackOverlay } from '../feedback/FeedbackOverlay'
import { ResourceReadBanner } from './ResourceReadBanner'

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'xenadmin:sidebar-collapsed'

function readInitialSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readInitialSidebarCollapsed)

  const handleSidebarCollapsedChange = (collapsed: boolean) => {
    setSidebarCollapsed(collapsed)
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0')
    } catch {
      // localStorage may be unavailable in tests or restricted environments.
    }
  }

  return (
    <div className="relative flex h-screen min-w-0 bg-background overflow-hidden pt-[var(--window-top-offset)]">
      <div className="app-drag-region absolute top-0 left-0 right-0 h-[var(--window-top-offset)]" />
      {sidebarOpen && (
        <button
          type="button"
          aria-label="关闭导航"
          className="fixed bottom-0 left-0 right-0 top-[var(--window-top-offset)] z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <Sidebar
        open={sidebarOpen}
        collapsed={!sidebarOpen && sidebarCollapsed}
        onCollapsedChange={handleSidebarCollapsedChange}
        onNavigate={() => setSidebarOpen(false)}
      />
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar onOpenSidebar={() => setSidebarOpen(true)} />
        <main className="min-w-0 flex-1 overflow-auto px-4 py-3 lg:px-6">
          <div className="mx-auto max-w-[1600px] min-w-0">
            <ResourceReadBanner />
            {children}
          </div>
        </main>
      </div>
      <FeedbackOverlay />
    </div>
  )
}
