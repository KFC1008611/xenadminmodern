import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppearanceMenu } from '../../src/renderer/src/components/layout/AppearanceMenu'
import TopBar from '../../src/renderer/src/components/layout/TopBar'
import ConnectPage from '../../src/renderer/src/pages/ConnectPage'
import { initializeTheme, THEME_STORAGE_KEY, useThemeStore } from '../../src/renderer/src/store/theme.store'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'

const future = { v7_startTransition: true, v7_relativeSplatPath: true } as const

describe('appearance preference and top menu', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    useThemeStore.getState().setTheme('light')
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('applies the saved theme before mounting and restores it after a new initialization', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    initializeTheme()
    expect(document.documentElement).toHaveClass('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    useThemeStore.getState().setTheme('light')
    initializeTheme()
    expect(document.documentElement).not.toHaveClass('dark')
    expect(useThemeStore.getState().theme).toBe('light')
  })

  it('uses the system preference on first use or when the saved value is invalid', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'invalid')
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    initializeTheme()
    expect(useThemeStore.getState().theme).toBe('dark')
    window.localStorage.removeItem(THEME_STORAGE_KEY)
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
    initializeTheme()
    expect(useThemeStore.getState().theme).toBe('light')
    vi.unstubAllGlobals()
  })

  it('continues changing the session theme when storage access fails', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable') })
    expect(() => initializeTheme()).not.toThrow()
    expect(() => useThemeStore.getState().setTheme('dark')).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('selects and persists either theme, closes the menu and returns focus', async () => {
    render(<AppearanceMenu />)
    const trigger = screen.getByRole('button', { name: '外观' })
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitemradio', { name: '浅色' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: '深色' }))
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
    fireEvent.click(trigger)
    expect(screen.getByRole('menuitemradio', { name: '深色' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: '浅色' }))
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('supports keyboard opening, wrapping arrows, Home/End and Escape', async () => {
    render(<AppearanceMenu />)
    const trigger = screen.getByRole('button', { name: '外观' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const light = screen.getByRole('menuitemradio', { name: '浅色' })
    const dark = screen.getByRole('menuitemradio', { name: '深色' })
    await waitFor(() => expect(light).toHaveFocus())
    fireEvent.keyDown(light, { key: 'ArrowUp' })
    expect(dark).toHaveFocus()
    fireEvent.keyDown(dark, { key: 'ArrowDown' })
    expect(light).toHaveFocus()
    fireEvent.keyDown(light, { key: 'End' })
    expect(dark).toHaveFocus()
    fireEvent.keyDown(dark, { key: 'Home' })
    expect(light).toHaveFocus()
    fireEvent.keyDown(light, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes on outside pointer and Tab without trapping focus', () => {
    render(<><AppearanceMenu /><button>下一项</button></>)
    const trigger = screen.getByRole('button', { name: '外观' })
    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByRole('button', { name: '下一项' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole('menuitemradio', { name: '浅色' }), { key: 'Tab' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('provides appearance in the connected top bar while preserving refresh and disconnect actions', () => {
    useConnectionManagerStore.setState({ connections: [], activeConnectionId: null })
    useMultiDataStore.setState({ hosts: [], vms: [], pools: [] })
    render(<MemoryRouter future={future}><TopBar /></MemoryRouter>)
    const header = screen.getByRole('banner')
    expect(within(header).getByRole('button', { name: '外观' })).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: '刷新' })).toBeDisabled()
    expect(within(header).getByRole('button', { name: /断开资源池/ })).toBeDisabled()
  })

  it('provides the same top menu before connecting to any server', async () => {
    Object.assign(window, { xapi: { profiles: { list: vi.fn().mockResolvedValue([]), hasSavedPassword: vi.fn().mockResolvedValue(false) } } })
    useConnectionManagerStore.setState({ isLoading: false, error: null })
    render(<MemoryRouter future={future}><ConnectPage /></MemoryRouter>)
    const header = screen.getByRole('banner')
    fireEvent.click(within(header).getByRole('button', { name: '外观' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '深色' }))
    expect(document.documentElement).toHaveClass('dark')
    await waitFor(() => expect(window.xapi.profiles.list).toHaveBeenCalled())
  })
})
