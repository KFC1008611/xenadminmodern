/**
 * Renderer entry point — mounts the React application inside a HashRouter.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { B0GuardEvidencePage } from './components/evidence/B0GuardEvidencePage'
import './styles/globals.css'
import { initializeTheme } from './store/theme.store'
import { createRendererApi, type IpcBridgeApi } from '../../shared/ipc-bridge'

const bridge = (window as Window & { xapiBridge?: IpcBridgeApi<Window['xapi']> }).xapiBridge
initializeTheme()
if (bridge) window.xapi = createRendererApi<Window['xapi']>(bridge)

const isMacOs = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
document.documentElement.classList.toggle('platform-macos', isMacOs)
const isB0GuardObservation = new URLSearchParams(window.location.search).get('b0Observation') === 'guards'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isB0GuardObservation ? (
      <B0GuardEvidencePage />
    ) : (
      <HashRouter>
        <App />
      </HashRouter>
    )}
  </React.StrictMode>
)
