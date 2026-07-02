import { useState } from 'react'
import { CopyButton } from './CopyButton'

export type RequestLogItem = {
  id: string
  name: string
  method: string
  url: string
  durationMs: number
  status: number | null
  ok: boolean
  requestBody?: unknown
  response?: unknown
}

function badgeClass(ok: boolean) {
  return ok ? 'badge ok' : 'badge err'
}

export function RequestInspector(props: { items: RequestLogItem[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})

  if (props.items.length === 0) {
    return <div className="muted">暂无请求记录。点击下方任意按钮后会在此显示。</div>
  }

  return (
    <div className="req-list">
      {props.items.map((it) => {
        const isOpen = Boolean(open[it.id])
        return (
          <div className="req-item" key={it.id}>
            <div className="req-row">
              <button
                type="button"
                className="link"
                onClick={() => setOpen((p) => ({ ...p, [it.id]: !isOpen }))}
                title="展开/折叠"
              >
                {isOpen ? '▼' : '▶'}
              </button>
              <span className={badgeClass(it.ok)}>{it.ok ? 'OK' : 'ERR'}</span>
              <span className="req-name">{it.name}</span>
              <span className="muted mono">{it.method}</span>
              <span className="muted mono">{it.status ?? '-'}</span>
              <span className="muted mono">{it.durationMs}ms</span>
              <span className="req-url mono" title={it.url}>{it.url}</span>
              <CopyButton value={it.url} label="复制URL" className="btn btn-small" />
            </div>

            {isOpen && (
              <div className="req-details">
                {it.requestBody !== undefined && (
                  <div className="kv">
                    <div className="kv-k">Request Body</div>
                    <pre className="pre">{JSON.stringify(it.requestBody, null, 2)}</pre>
                  </div>
                )}
                {it.response !== undefined && (
                  <div className="kv">
                    <div className="kv-k">Response</div>
                    <pre className="pre">{JSON.stringify(it.response, null, 2)}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

