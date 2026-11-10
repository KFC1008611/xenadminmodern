import { useParams, useSearchParams } from 'react-router-dom'
import { useConnectionManagerStore } from '../store/connectionManager.store'
import PoolManagerPage from './PoolManagerPage'
import RbacPage from './RbacPage'
import { HaSettingsTab } from '../components/ha/HaSettingsTab'

const tabs = [
  { value: 'general', label: '常规' },
  { value: 'access', label: '用户与权限' },
  { value: 'ha', label: '高可用' },
]

export default function PoolSettingsPage() {
  const { connectionId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const connection = useConnectionManagerStore((s) => s.connections.find((item) => item.id === connectionId))
  const tab = tabs.some((item) => item.value === params.get('tab')) ? params.get('tab') : 'general'

  return (
    <div className="space-y-5">
      <h1 className="sr-only">池设置</h1>
      <nav aria-label="池设置" className="!mt-0 flex gap-2">
        {tabs.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={tab === item.value}
            onClick={() => setParams(item.value === 'general' ? {} : { tab: item.value })}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === item.value ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {connection?.state === 'connected' ? (
        <div key={JSON.stringify([connectionId, connection.epoch, connection.connectedAt, connection.poolUuid])}>
          {tab === 'general' && <PoolManagerPage connectionId={connectionId} />}
          {tab === 'access' && <RbacPage connectionId={connectionId} />}
          {tab === 'ha' && <HaSettingsTab connectionId={connectionId} />}
        </div>
      ) : (
        <p role="alert" className="text-sm text-warning">资源池未连接，请从侧栏重新连接。</p>
      )}
    </div>
  )
}
