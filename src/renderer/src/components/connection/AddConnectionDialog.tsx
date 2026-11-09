/**
 * AddConnectionDialog — dialog for adding new XCP-ng/XenServer connections.
 * v4: Supports multi-connection architecture.
 */
import { useState } from 'react'
import { X, Server, Loader2, Wifi, Eye, EyeOff } from 'lucide-react'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import type { XapiConnectionOptions, XapiTransportScheme } from '../../types/xapi'

interface AddConnectionDialogProps {
  open: boolean
  onClose: () => void
  onConnected?: (connectionId: string) => void
}

export function AddConnectionDialog({ open, onClose, onConnected }: AddConnectionDialogProps) {
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('443')
  const [scheme, setScheme] = useState<XapiTransportScheme>('https:')
  const [username, setUsername] = useState('root')
  const [password, setPassword] = useState('')
  const [allowSelfSigned, setAllowSelfSigned] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connect = useConnectionManagerStore((s) => s.connect)

  if (!open) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const opts: XapiConnectionOptions & { name?: string } = {
      host: host.trim(),
      port: parseInt(port, 10),
      scheme,
      username: username.trim(),
      password,
      allowSelfSigned,
      ...(name.trim() ? { name: name.trim() } : {}),
    }

    try {
      const id = await connect(opts)
      onConnected?.(id)
      handleClose()
    } catch (err: any) {
      setError(err?.faultString || err?.message || 'Connection failed. Check host and credentials.')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (loading) return
    setName('')
    setHost('')
    setPort('443')
    setScheme('https:')
    setUsername('root')
    setPassword('')
    setAllowSelfSigned(true)
    setShowPassword(false)
    setError(null)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div className="w-full max-w-md rounded-xl border border-input bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent border border-primary/30 flex items-center justify-center">
              <Server className="w-4 h-4 text-accent-foreground" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Add Connection</h2>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="p-1.5 text-subtle hover:text-secondary-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-40"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Display name */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Display Name <span className="text-subtle font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Production Pool"
              disabled={loading}
              className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
          </div>

          {/* Host + Transport */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_6rem]">
            <div className="flex-1">
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Host / IP <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.100"
                required
                disabled={loading}
                autoFocus
                className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Protocol
              </label>
              <select
                aria-label="Protocol"
                value={scheme}
                onChange={(e) => setScheme(e.target.value as XapiTransportScheme)}
                disabled={loading}
                className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              >
                <option value="https:">HTTPS</option>
                <option value="http:">HTTP</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Port <span className="text-danger">*</span>
              </label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                required
                min={1}
                max={65535}
                disabled={loading}
                className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
            </div>
          </div>

          {/* Username */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Username <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={loading}
              className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Password <span className="text-danger">*</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                className="w-full px-3 py-2 pr-10 bg-muted border border-input rounded-lg text-sm text-foreground placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                disabled={loading}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle hover:text-secondary-foreground transition-colors disabled:opacity-40"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Self-signed toggle */}
          {scheme === 'https:' && <label className="flex items-center gap-3 cursor-pointer">
            <div
              onClick={() => !loading && setAllowSelfSigned(!allowSelfSigned)}
              className={`w-9 h-5 rounded-full relative transition-colors cursor-pointer ${
                allowSelfSigned ? 'bg-primary' : 'bg-secondary'
              } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  allowSelfSigned ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </div>
            <span className="text-sm text-muted-foreground">Allow self-signed certificates</span>
          </label>}

          {/* Error */}
          {error && (
            <div role="alert" className="flex items-start gap-2.5 p-3 bg-danger-soft border border-danger/60 rounded-lg">
              <span className="text-danger text-xs font-bold mt-0.5">!</span>
              <p className="min-w-0 break-words text-sm text-danger">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={loading || !host.trim() || !username.trim() || !password}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-primary hover:bg-primary disabled:bg-secondary disabled:text-subtle disabled:cursor-not-allowed text-primary-foreground text-sm font-medium rounded-lg transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Connecting...</span>
                </>
              ) : (
                <>
                  <Wifi className="w-4 h-4" />
                  <span>Connect</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="px-4 py-2.5 bg-muted hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed text-secondary-foreground text-sm font-medium rounded-lg transition-colors border border-input"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
