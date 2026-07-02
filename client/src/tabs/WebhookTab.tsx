import { useEffect, useMemo, useState } from 'react'
import type { AppSettings } from '../state/storage'
import type { RequestLogItem } from '../components/RequestInspector'
import { apiFetch, joinUrl } from '../api/client'
import { CopyButton } from '../components/CopyButton'

function newId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function parseChainIds(raw: string): number[] {
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
}

function parseAddresses(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

type WebhookSubscription = {
  id: string
  targetUrl: string
  secret?: string
  chainIds: number[]
  watchAddresses: string[]
  eventTypes: Array<'activity_created' | 'activity_reverted'>
  isActive: boolean
  createdAt: string
}

type WebhookListResponse = { data: WebhookSubscription[] }

export function WebhookTab(props: { settings: AppSettings; pushLog: (item: RequestLogItem) => void }) {
  const [targetUrl, setTargetUrl] = useState('')
  const [chainIdsRaw, setChainIdsRaw] = useState('')
  const [watchAddressesRaw, setWatchAddressesRaw] = useState('')
  const [eventTypes, setEventTypes] = useState<Array<'activity_created' | 'activity_reverted'>>(['activity_created'])

  const [subs, setSubs] = useState<WebhookSubscription[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [deliveries, setDeliveries] = useState<any[] | null>(null)

  const chainIds = useMemo(() => parseChainIds(chainIdsRaw), [chainIdsRaw])
  const watchAddresses = useMemo(() => parseAddresses(watchAddressesRaw), [watchAddressesRaw])
  const hasToken = Boolean(props.settings.token)

  async function run<T>(name: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
    const result = await apiFetch<T>(url, { method, token: props.settings.token, jsonBody: body })
    props.pushLog({
      id: newId(),
      name,
      method,
      url,
      durationMs: result.durationMs,
      status: result.ok ? result.status : result.status,
      ok: result.ok,
      requestBody: body,
      response: result.ok ? (result as any).data : (result as any).error,
    })
    return result
  }

  async function refreshList() {
    const url = joinUrl(props.settings.apiBase, '/webhooks')
    const r = await run<WebhookListResponse>('List Webhooks', 'GET', url)
    if (r.ok) setSubs(r.data.data ?? [])
  }

  useEffect(() => {
    if (!hasToken) return
    refreshList().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasToken, props.settings.apiBase])

  return (
    <section className="panel">
      <div className="panel-header">
        <div className="panel-title">Webhook</div>
        <div className="panel-actions">
          <button type="button" className="btn" onClick={() => refreshList()} disabled={!hasToken}>
            刷新列表
          </button>
        </div>
      </div>

      {!hasToken && (
        <div className="callout warn">未设置 Token 或 scope 不足会导致 401/403。请先在“设置”页获取 token。</div>
      )}

      <div className="grid-2">
        <section className="subpanel">
          <div className="subpanel-title">创建订阅</div>

          <label className="field">
            <div className="field-label">targetUrl（必须 https）</div>
            <input className="input mono" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://..." />
          </label>

          <label className="field">
            <div className="field-label">chainIds（可空）</div>
            <input className="input mono" value={chainIdsRaw} onChange={(e) => setChainIdsRaw(e.target.value)} placeholder="例如：1,137" />
          </label>

          <label className="field">
            <div className="field-label">watchAddresses（逗号分隔）</div>
            <input className="input mono" value={watchAddressesRaw} onChange={(e) => setWatchAddressesRaw(e.target.value)} placeholder="0x...,0x..." />
          </label>

          <div className="field">
            <div className="field-label">eventTypes</div>
            <div className="row gap wrap">
              <label className="chk">
                <input
                  type="checkbox"
                  checked={eventTypes.includes('activity_created')}
                  onChange={(e) => {
                    setEventTypes((prev) => e.target.checked
                      ? Array.from(new Set([...prev, 'activity_created']))
                      : prev.filter((x) => x !== 'activity_created'))
                  }}
                />
                <span className="mono">activity_created</span>
              </label>
              <label className="chk">
                <input
                  type="checkbox"
                  checked={eventTypes.includes('activity_reverted')}
                  onChange={(e) => {
                    setEventTypes((prev) => e.target.checked
                      ? Array.from(new Set([...prev, 'activity_reverted']))
                      : prev.filter((x) => x !== 'activity_reverted'))
                  }}
                />
                <span className="mono">activity_reverted</span>
              </label>
            </div>
          </div>

          <div className="row gap">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!hasToken || !targetUrl.trim() || watchAddresses.length === 0 || eventTypes.length === 0}
              onClick={async () => {
                const url = joinUrl(props.settings.apiBase, '/webhooks')
                const body = {
                  targetUrl: targetUrl.trim(),
                  chainIds,
                  watchAddresses,
                  eventTypes,
                }
                const r = await run<WebhookSubscription>('Create Webhook', 'POST', url, body)
                if (r.ok) {
                  // 创建成功会返回 secret（只此一次），放到列表里便于复制
                  setSubs((prev) => [r.data, ...prev])
                  setSelectedId(r.data.id)
                }
              }}
            >
              创建
            </button>
          </div>
          <div className="muted">
            说明：创建成功后端会返回一次 <span className="mono">secret</span>（只显示一次），用于接收端验签。
          </div>
        </section>

        <section className="subpanel">
          <div className="subpanel-title">订阅列表</div>
          {subs.length === 0 ? (
            <div className="muted">暂无订阅（或无 read:webhook 权限）。</div>
          ) : (
            <div className="sub-list">
              {subs.map((s) => (
                <div key={s.id} className={selectedId === s.id ? 'sub-item active' : 'sub-item'}>
                  <div className="row gap wrap">
                    <button type="button" className="link" onClick={() => setSelectedId(s.id)}>
                      {selectedId === s.id ? '●' : '○'}
                    </button>
                    <span className="mono">{s.id}</span>
                    <CopyButton value={s.id} label="复制ID" />
                  </div>
                  <div className="muted mono">{s.targetUrl}</div>
                  <div className="row gap wrap">
                    <span className="pill">active: <span className="mono">{String(s.isActive)}</span></span>
                    <span className="pill">chains: <span className="mono">{s.chainIds?.length ? s.chainIds.join(',') : '(all)'}</span></span>
                    <span className="pill">events: <span className="mono">{s.eventTypes.join(',')}</span></span>
                  </div>
                  {s.secret && (
                    <div className="callout warn">
                      secret（只此一次）：<span className="mono">{s.secret}</span> <CopyButton value={s.secret} label="复制secret" />
                    </div>
                  )}

                  <div className="row gap wrap">
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={!hasToken}
                      onClick={async () => {
                        const url = joinUrl(props.settings.apiBase, `/webhooks/${s.id}/test`)
                        await run<{ ok: boolean; eventId: string }>('Test Webhook', 'POST', url, {})
                      }}
                    >
                      Test
                    </button>
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={!hasToken}
                      onClick={async () => {
                        const url = joinUrl(props.settings.apiBase, `/webhooks/${s.id}`)
                        const r = await run<WebhookSubscription>('Toggle Webhook', 'PATCH', url, { isActive: !s.isActive })
                        if (r.ok) setSubs((prev) => prev.map((x) => (x.id === s.id ? r.data : x)))
                      }}
                    >
                      {s.isActive ? '停用' : '启用'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={!hasToken}
                      onClick={async () => {
                        const url = joinUrl(props.settings.apiBase, `/webhooks/${s.id}`)
                        const r = await run<unknown>('Delete Webhook', 'DELETE', url)
                        if (r.ok) setSubs((prev) => prev.filter((x) => x.id !== s.id))
                      }}
                    >
                      删除
                    </button>
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={!hasToken}
                      onClick={async () => {
                        setSelectedId(s.id)
                        const url = joinUrl(props.settings.apiBase, `/webhooks/${s.id}/deliveries?limit=50`)
                        const r = await run<{ data: any[] }>('List Deliveries', 'GET', url)
                        if (r.ok) setDeliveries(r.data.data ?? [])
                      }}
                    >
                      看 Deliveries
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="subpanel">
        <div className="subpanel-title">Deliveries（投递记录）</div>
        {deliveries == null ? (
          <div className="muted">选择一个订阅并点击“看 Deliveries”。</div>
        ) : deliveries.length === 0 ? (
          <div className="muted">暂无投递记录。</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>status</th>
                <th>attempt</th>
                <th>lastStatus</th>
                <th>nextRetryAt</th>
                <th>lastError</th>
                <th>createdAt</th>
                <th>deliveredAt</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id}>
                  <td className={d.status === 'delivered' ? 'ok' : d.status === 'dead' ? 'err' : ''}>{d.status}</td>
                  <td className="mono">{d.attemptCount}</td>
                  <td className="mono">{d.lastStatusCode ?? '-'}</td>
                  <td className="mono">{d.nextRetryAt ?? '-'}</td>
                  <td className="mono">{d.lastError ?? ''}</td>
                  <td className="mono">{d.createdAt ?? ''}</td>
                  <td className="mono">{d.deliveredAt ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </section>
  )
}

