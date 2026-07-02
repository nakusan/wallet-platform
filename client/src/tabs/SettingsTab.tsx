import { useMemo, useState } from 'react'
import { apiFetch, joinUrl } from '../api/client'
import type { AppSettings } from '../state/storage'
import type { RequestLogItem } from '../components/RequestInspector'
import { CopyButton } from '../components/CopyButton'

function newId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function SettingsTab(props: {
  settings: AppSettings
  setSettings: (next: AppSettings) => void
  pushLog: (item: RequestLogItem) => void
}) {
  const [busy, setBusy] = useState(false)
  const [tokenVisible, setTokenVisible] = useState(false)

  const expiresInSec = useMemo(() => {
    if (!props.settings.tokenExpiresAt) return null
    return Math.max(0, Math.floor((props.settings.tokenExpiresAt - Date.now()) / 1000))
  }, [props.settings.tokenExpiresAt])

  return (
    <section className="panel">
      <div className="panel-header">
        <div className="panel-title">设置 / 鉴权</div>
      </div>

      <div className="form-grid">
        <label className="field">
          <div className="field-label">API Base</div>
          <input
            className="input mono"
            value={props.settings.apiBase}
            onChange={(e) => props.setSettings({ ...props.settings, apiBase: e.target.value })}
            placeholder="/v1 或 http://localhost:3000/v1"
          />
          <div className="field-hint muted">推荐使用 `/v1` + Vite proxy。</div>
        </label>

        <label className="field">
          <div className="field-label">API Key</div>
          <input
            className="input mono"
            value={props.settings.apiKey}
            onChange={(e) => props.setSettings({ ...props.settings, apiKey: e.target.value })}
            placeholder="粘贴 apiKey（联调用）"
          />
        </label>

        <div className="field">
          <div className="field-label">Token</div>
          <div className="row gap">
            <button
              type="button"
              className="btn"
              onClick={() => setTokenVisible((v) => !v)}
              disabled={!props.settings.token}
            >
              {tokenVisible ? '隐藏' : '显示'}
            </button>
            <CopyButton value={props.settings.token} label="复制Token" className="btn" />
            <button
              type="button"
              className="btn"
              onClick={() => props.setSettings({ ...props.settings, token: '', tokenExpiresAt: null })}
              disabled={!props.settings.token}
            >
              清空Token
            </button>
          </div>
          {props.settings.token && (
            <div className="muted">
              {expiresInSec != null ? `预计剩余：${expiresInSec}s` : '未设置过期时间'}
            </div>
          )}
          {tokenVisible && props.settings.token && (
            <pre className="pre">{props.settings.token}</pre>
          )}
        </div>
      </div>

      <div className="row gap">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !props.settings.apiKey.trim()}
          onClick={async () => {
            setBusy(true)
            const url = joinUrl(props.settings.apiBase, '/auth/token')
            const result = await apiFetch<{ token: string; ttl: number }>(url, {
              method: 'POST',
              jsonBody: { apiKey: props.settings.apiKey },
            })
            props.pushLog({
              id: newId(),
              name: 'Auth Token',
              method: 'POST',
              url,
              durationMs: result.durationMs,
              status: result.ok ? result.status : result.status,
              ok: result.ok,
              requestBody: { apiKey: '***' },
              response: result.ok ? result.data : result.error,
            })

            if (result.ok) {
              const expiresAt = Date.now() + result.data.ttl * 1000
              props.setSettings({
                ...props.settings,
                token: result.data.token,
                tokenExpiresAt: expiresAt,
              })
            }
            setBusy(false)
          }}
        >
          获取 Token
        </button>
      </div>
    </section>
  )
}

