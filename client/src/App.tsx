import { useMemo, useState } from 'react'
import { RequestInspector, type RequestLogItem } from './components/RequestInspector'
import { SettingsTab } from './tabs/SettingsTab'
import { AddressTab } from './tabs/AddressTab'
import { WebhookTab } from './tabs/WebhookTab'
import { loadAppSettings, saveAppSettings, type AppSettings } from './state/storage'

type TabId = 'settings' | 'address' | 'webhook'

export default function App() {
  const [tab, setTab] = useState<TabId>('settings')
  const [logs, setLogs] = useState<RequestLogItem[]>([])

  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings())

  const context = useMemo(() => {
    return {
      settings,
      setSettings: (next: AppSettings) => {
        setSettings(next)
        saveAppSettings(next)
      },
      pushLog: (item: RequestLogItem) => {
        setLogs((prev) => [item, ...prev].slice(0, 50))
      },
      clearLogs: () => setLogs([]),
    }
  }, [settings])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-title">Wallet Platform 测试客户端</div>
          <div className="brand-sub">联动测试 Aggregator API</div>
        </div>

        <nav className="tabs" role="tablist" aria-label="Main tabs">
          <button
            type="button"
            className={tab === 'settings' ? 'tab active' : 'tab'}
            onClick={() => setTab('settings')}
            role="tab"
            aria-selected={tab === 'settings'}
          >
            设置
          </button>
          <button
            type="button"
            className={tab === 'address' ? 'tab active' : 'tab'}
            onClick={() => setTab('address')}
            role="tab"
            aria-selected={tab === 'address'}
          >
            地址查询
          </button>
          <button
            type="button"
            className={tab === 'webhook' ? 'tab active' : 'tab'}
            onClick={() => setTab('webhook')}
            role="tab"
            aria-selected={tab === 'webhook'}
          >
            Webhook
          </button>
        </nav>
      </header>

      <main className="content">
        <section className="panel">
          <div className="panel-header">
            <div className="panel-title">请求面板</div>
            <div className="panel-actions">
              <button type="button" className="btn" onClick={context.clearLogs}>
                清空
              </button>
            </div>
          </div>
          <RequestInspector items={logs} />
        </section>

        {tab === 'settings' && (
          <SettingsTab
            settings={context.settings}
            setSettings={context.setSettings}
            pushLog={context.pushLog}
          />
        )}
        {tab === 'address' && (
          <AddressTab
            settings={context.settings}
            pushLog={context.pushLog}
          />
        )}
        {tab === 'webhook' && (
          <WebhookTab
            settings={context.settings}
            pushLog={context.pushLog}
          />
        )}
      </main>
    </div>
  )
}
