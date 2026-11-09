import { create } from 'zustand'

export type Theme = 'light' | 'dark'
export const THEME_STORAGE_KEY = 'xenadmin:theme'

function readTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* A restricted store must not prevent the app from opening. */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
}

export const useThemeStore = create<{ theme: Theme; setTheme: (theme: Theme) => void }>((set) => ({
  theme: readTheme(),
  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
    try { window.localStorage.setItem(THEME_STORAGE_KEY, theme) } catch { /* Keep the session preference. */ }
  },
}))

/** Run before mounting React so restored windows use the saved palette immediately. */
export function initializeTheme() {
  const theme = readTheme()
  applyTheme(theme)
  useThemeStore.setState({ theme })
}
